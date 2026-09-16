import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";

/**
 * Optional shell integration: emits OSC 133 sequences (the same protocol
 * iTerm2/VS Code/WezTerm/Warp use) around every command a shell runs —
 * ;A prompt-start, ;B prompt-end/input-start, ;C command-start,
 * ;D;<exitcode> command-end — so the renderer can group each command with
 * its real output into a block and know its real exit code, rather than
 * guessing from keystrokes alone. Bash and zsh are supported; other shells
 * (fish, sh/dash, PowerShell, cmd.exe) are left alone entirely — a session
 * without integration still works exactly as before, just without blocks/
 * exit codes.
 *
 * The hook logic itself is identical whether it's loaded at shell startup
 * (local shell, where we control the spawn args) or eval'd into an
 * already-running login shell (SSH/Mosh, where we don't) — only the
 * delivery mechanism differs. See prepareLocalShellIntegration() and
 * buildRemoteBootstrapCommand() below.
 */

// Defines the four hook functions and wires them into bash's prompt/trap
// mechanism. DEBUG fires once per simple command (including extra times for
// compound commands and the prompt's own $(...) substitution) — harmless,
// since the "armed" guard only lets the first one after a prompt through.
const BASH_HOOKS = `
__wharf_prompt_start() { printf '\\033]133;A\\007'; }
__wharf_prompt_end() { printf '\\033]133;B\\007'; }
__wharf_cmd_start() {
  if [ "$__wharf_armed" = "1" ]; then
    __wharf_armed=0
    printf '\\033]133;C\\007'
  fi
}
__wharf_cmd_end() {
  local ec=$?
  if [ "$__wharf_in_cmd" = "1" ]; then
    printf '\\033]133;D;%s\\007' "$ec"
    __wharf_in_cmd=0
  fi
  __wharf_armed=0
  printf '\\033]133;A\\007'
}
PROMPT_COMMAND='__wharf_cmd_end'"\${PROMPT_COMMAND:+; \$PROMPT_COMMAND}"
PS1="\${PS1}"'\\[\$(__wharf_prompt_end)\\]'
trap '__wharf_armed=1; __wharf_in_cmd=1; __wharf_cmd_start' DEBUG
`.trim();

// zsh has native precmd/preexec hooks (add-zsh-hook), no DEBUG-trap hack
// needed — precmd runs before each prompt (so it both closes the previous
// command with its real $? and opens the next prompt), preexec runs once
// right before a typed command actually executes.
const ZSH_HOOKS = `
__wharf_prompt_start() { printf '\\033]133;A\\007'; }
__wharf_preexec() { printf '\\033]133;C\\007'; }
__wharf_precmd() {
  local ec=$?
  printf '\\033]133;D;%s\\007' "$ec"
  __wharf_prompt_start
}
autoload -Uz add-zsh-hook
add-zsh-hook precmd __wharf_precmd
add-zsh-hook preexec __wharf_preexec
PS1="\${PS1}"'%{'$'\\033]133;B\\007''%}'
`.trim();

function integrationDir(): string {
  const dir = join(app.getPath("userData"), "shell-integration");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export interface LocalIntegration {
  args: string[];
  env: Record<string, string>;
}

/** For a locally-spawned shell (Local Shell tabs), where we control the
 * spawn arguments directly — the clean, robust delivery: bash gets a
 * generated --rcfile that sources the user's real ~/.bashrc first, then
 * appends the hooks; zsh gets a generated ZDOTDIR that sources the user's
 * real zdotdir's .zshrc first, then appends the hooks. Returns null for any
 * other shell (or if the shell can't be determined) — meaning "spawn
 * exactly as before, no integration". */
export function prepareLocalShellIntegration(shellPath: string): LocalIntegration | null {
  const shellName = shellPath.split(/[/\\]/).pop() ?? "";

  if (shellName === "bash") {
    const dir = integrationDir();
    const initPath = join(dir, "bash-init.sh");
    writeFileSync(initPath, `[ -f ~/.bashrc ] && source ~/.bashrc\n${BASH_HOOKS}\n`, "utf8");
    return { args: ["--rcfile", initPath, "-i"], env: {} };
  }

  if (shellName === "zsh") {
    const dir = join(integrationDir(), "zsh-zdotdir");
    mkdirSync(dir, { recursive: true });
    const rcPath = join(dir, ".zshrc");
    const rc = [
      'ORIG_ZDOTDIR="${WHARF_ORIG_ZDOTDIR:-$HOME}"',
      "ZDOTDIR=\"$ORIG_ZDOTDIR\"",
      '[ -f "$ORIG_ZDOTDIR/.zshrc" ] && source "$ORIG_ZDOTDIR/.zshrc"',
      "",
      ZSH_HOOKS,
      "",
    ].join("\n");
    writeFileSync(rcPath, rc, "utf8");
    return {
      args: [],
      env: { ZDOTDIR: dir, WHARF_ORIG_ZDOTDIR: process.env.ZDOTDIR || process.env.HOME || "" },
    };
  }

  return null;
}

/** For a remote shell we don't control the startup of (SSH, Mosh) — sent as
 * one line of real input right after the session connects, exactly as if
 * the user had typed and run it themselves. Detects bash vs. zsh (or
 * neither) at runtime on the remote end and evals the matching hooks via a
 * base64 payload, so it's a single robust line regardless of quoting in the
 * script bodies; a no-op, harmless on any other remote shell. This line
 * will be visible in the session's scrollback (and shell history, unless
 * the remote's HISTCONTROL ignores space-prefixed lines) — a deliberate
 * trade of a little visual noise for not risking silently eating real
 * output, which a more aggressive suppression scheme would require. */
export function buildRemoteBootstrapCommand(): string {
  const bashB64 = Buffer.from(BASH_HOOKS, "utf8").toString("base64");
  const zshB64 = Buffer.from(ZSH_HOOKS, "utf8").toString("base64");
  return (
    ` if [ -n "$BASH_VERSION" ]; then eval "$(echo ${bashB64} | base64 -d)"; ` +
    `elif [ -n "$ZSH_VERSION" ]; then eval "$(echo ${zshB64} | base64 -d)"; fi`
  );
}
