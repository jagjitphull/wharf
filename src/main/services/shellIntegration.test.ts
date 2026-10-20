import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const state = vi.hoisted(() => ({ userData: "" }));
vi.mock("electron", () => ({ app: { getPath: () => state.userData } }));

const hasShell = (name: string): boolean => spawnSync(name, ["-c", "true"]).status === 0;
const hasBash = hasShell("bash");
const hasZsh = hasShell("zsh");
const hasFish = hasShell("fish");
// /bin/sh is dash on Debian/Ubuntu, but bash (in POSIX mode, still setting
// $BASH_VERSION) on macOS: the "neither bash, zsh nor fish" tests need a sh that really is neither.
const hasPlainSh = spawnSync("sh", ["-c", 'test -z "$BASH_VERSION$ZSH_VERSION$FISH_VERSION"']).status === 0;
// A pty to run an interactive fish in (fish only fires its preexec/postexec
// events interactively): util-linux's `script` provides one.
const hasScript = spawnSync("script", ["--version"]).status === 0;
const canRunFishInPty = hasFish && hasScript;
const canRunBashInPty = hasBash && hasScript;

const OSC_PROMPT_START = "\x1b]133;A\x07";
const b64 = (s: string): string => Buffer.from(s, "utf8").toString("base64");

let mod: typeof import("./shellIntegration");

beforeEach(async () => {
  state.userData = mkdtempSync(path.join(tmpdir(), "wharf-shellint-test-"));
  vi.resetModules();
  mod = await import("./shellIntegration");
});

afterEach(() => {
  rmSync(state.userData, { recursive: true, force: true });
});

/** Pulls the three base64 hook bodies back out of the bootstrap line. */
function decodedHooks(command: string): { bash: string; zsh: string; fish: string } {
  const payloads = [...command.matchAll(/echo ([A-Za-z0-9+/=]+) \| base64 -d/g)].map((m) => Buffer.from(m[1], "base64").toString("utf8"));
  expect(payloads).toHaveLength(3);
  return { bash: payloads[0], zsh: payloads[1], fish: payloads[2] };
}

/** Types `lines` into an interactive fish (no user config) running in a pty,
 * after `fishArgs`, and returns everything it wrote. */
function runFishInPty(fishArgs: string[], lines: string[]): string {
  const quoted = ["fish", "--no-config", ...fishArgs, "-i"].map((a) => `'${a.replace(/'/g, `'\\''`)}'`).join(" ");
  const result = spawnSync("script", ["-qfc", quoted, "/dev/null"], {
    input: `${lines.join("\n")}\nexit\n`,
    encoding: "utf8",
    env: { PATH: process.env.PATH, TERM: "xterm", HOME: state.userData },
    timeout: 20000,
  });
  return result.stdout.replace(/\r/g, "\n");
}

/** Same, for bash: `bashArgs` first, then an interactive shell reading `lines` from a pty. `home` is a
 * directory to use as $HOME (so a test can give it a .bashrc); `env` adds environment variables. */
function runBashInPty(bashArgs: string[], lines: string[], env: Record<string, string> = {}, home = state.userData): string {
  const quoted = ["bash", ...bashArgs].map((a) => `'${a.replace(/'/g, `'\\''`)}'`).join(" ");
  const result = spawnSync("script", ["-qfc", quoted, "/dev/null"], {
    input: `${lines.join("\n")}\nexit\n`,
    encoding: "utf8",
    env: { PATH: process.env.PATH, TERM: "xterm", HOME: home, ...env },
    timeout: 20000,
  });
  return result.stdout.replace(/\r/g, "\n");
}

/** The ;C/;D markers a pty run produced, in order: "C:<decoded command>" and "D:<exit code>". */
function markersOf(output: string): string[] {
  return [...output.matchAll(/\x1b\]133;([CD]);?([^\x07]*)\x07/g)].map(([, kind, arg]) =>
    kind === "C" ? `C:${Buffer.from(arg, "base64").toString("utf8")}` : `D:${arg}`,
  );
}

describe("buildRemoteBootstrapCommand", () => {
  it("is exactly one line (it's sent as a single line of real input)", () => {
    expect(mod.buildRemoteBootstrapCommand()).not.toMatch(/[\r\n]/);
  });

  it("embeds the bash, zsh and fish hooks as base64 payloads that decode to the OSC 133 hook bodies", () => {
    const { bash, zsh, fish } = decodedHooks(mod.buildRemoteBootstrapCommand());
    expect(fish).toContain("--on-event fish_preexec");
    expect(fish).toContain("133;D;");
    expect(bash).toContain("PROMPT_COMMAND");
    expect(bash).toContain("133;D;");
    expect(zsh).toContain("add-zsh-hook precmd");
    expect(zsh).toContain("133;C;");
  });

  it.skipIf(!hasBash)("is syntactically valid shell", () => {
    const result = spawnSync("bash", ["-n"], { input: mod.buildRemoteBootstrapCommand() });
    expect(result.status).toBe(0);
  });

  it.skipIf(!hasFish)("is syntactically valid fish too (every shell has to parse the whole line)", () => {
    const file = path.join(state.userData, "bootstrap.fish");
    writeFileSync(file, mod.buildRemoteBootstrapCommand());
    const result = spawnSync("fish", ["--no-config", "--no-execute", file], { encoding: "utf8" });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });

  it.skipIf(!hasShell("dash"))("is syntactically valid POSIX sh, for minimal remote hosts", () => {
    const result = spawnSync("dash", ["-n"], { input: mod.buildRemoteBootstrapCommand(), encoding: "utf8" });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });

  it.skipIf(!hasBash)("leaves $? at 0, so the first prompt after connecting doesn't look like a failure", () => {
    const out = execFileSync("bash", ["--norc", "-c", `${mod.buildRemoteBootstrapCommand()}; echo "status=$?"`], { encoding: "utf8" });
    expect(out).toContain("status=0");
  });

  it.skipIf(!hasPlainSh)("is a silent no-op, exiting 0, on a shell that is neither bash, zsh nor fish", () => {
    const out = execFileSync("sh", ["-c", mod.buildRemoteBootstrapCommand()], { encoding: "utf8", env: { PATH: process.env.PATH } });
    expect(out).toBe("");
  });

  it.skipIf(!hasBash)("makes bash emit a ;D;<exit code> marker followed by a fresh prompt-start marker", () => {
    const out = execFileSync(
      "bash",
      ["--norc", "-c", `${mod.buildRemoteBootstrapCommand()}; __wharf_in_cmd=1; false; __wharf_cmd_end; true`],
      {
        encoding: "utf8",
      },
    );
    expect(out).toContain(`\x1b]133;D;1\x07${OSC_PROMPT_START}`);
  });

  it.skipIf(!hasBash)("reports a zero exit code too, not just failures", () => {
    const out = execFileSync("bash", ["--norc", "-c", `${mod.buildRemoteBootstrapCommand()}; __wharf_in_cmd=1; true; __wharf_cmd_end`], {
      encoding: "utf8",
    });
    expect(out).toContain(`\x1b]133;D;0\x07${OSC_PROMPT_START}`);
  });

  it.skipIf(!hasBash)("makes bash emit the command text, base64-encoded, in a ;C marker", () => {
    const out = execFileSync("bash", ["--norc", "-c", `${mod.buildRemoteBootstrapCommand()}; __wharf_armed=1; echo 'a;b'`], {
      encoding: "utf8",
    });
    expect(out).toContain(`\x1b]133;C;${b64("echo 'a;b'")}\x07`);
  });

  it.skipIf(!hasZsh)("ships zsh hooks that parse cleanly under zsh", () => {
    const { zsh } = decodedHooks(mod.buildRemoteBootstrapCommand());
    expect(spawnSync("zsh", ["-n"], { input: zsh }).status).toBe(0);
  });
});

describe("prepareLocalShellIntegration", () => {
  it("returns null for shells that aren't supported, so they spawn exactly as before", () => {
    expect(mod.prepareLocalShellIntegration("/bin/sh")).toBeNull();
    expect(mod.prepareLocalShellIntegration("")).toBeNull();
    expect(mod.prepareLocalShellIntegration("powershell.exe")).toBeNull();
  });

  it("gives fish the hooks as an --init-command, which runs after the user's own config", () => {
    const result = mod.prepareLocalShellIntegration("/usr/bin/fish");
    expect(result).not.toBeNull();
    expect(result!.args[0]).toBe("--init-command");
    expect(result!.args[1]).toContain("--on-event fish_preexec");
    expect(result!.args).toHaveLength(2);
    expect(result!.env).toEqual({});
  });

  it("gives bash a generated --rcfile that sources the user's ~/.bashrc and then the hooks", () => {
    const result = mod.prepareLocalShellIntegration("/usr/bin/bash");
    expect(result).not.toBeNull();
    expect(result!.args[0]).toBe("--rcfile");
    expect(result!.args[2]).toBe("-i");
    expect(result!.env).toEqual({});

    const initPath = result!.args[1];
    expect(initPath.startsWith(state.userData)).toBe(true);
    const contents = readFileSync(initPath, "utf8");
    expect(contents.indexOf("source ~/.bashrc")).toBeGreaterThanOrEqual(0);
    expect(contents.indexOf("source ~/.bashrc")).toBeLessThan(contents.indexOf("PROMPT_COMMAND"));
  });

  it.skipIf(!hasBash)("generates a bash init file that parses cleanly", () => {
    const result = mod.prepareLocalShellIntegration("bash");
    expect(spawnSync("bash", ["-n", result!.args[1]]).status).toBe(0);
  });

  it("gives zsh a generated ZDOTDIR whose .zshrc sources the user's real one first, then the hooks", () => {
    vi.stubEnv("ZDOTDIR", "/custom/zdotdir");
    try {
      const result = mod.prepareLocalShellIntegration("/bin/zsh");
      expect(result).not.toBeNull();
      expect(result!.args).toEqual([]);
      expect(result!.env.ZDOTDIR.startsWith(state.userData)).toBe(true);
      expect(result!.env.WHARF_ORIG_ZDOTDIR).toBe("/custom/zdotdir");

      const rcPath = path.join(result!.env.ZDOTDIR, ".zshrc");
      expect(existsSync(rcPath)).toBe(true);
      const rc = readFileSync(rcPath, "utf8");
      expect(rc.indexOf('source "$ORIG_ZDOTDIR/.zshrc"')).toBeGreaterThanOrEqual(0);
      expect(rc.indexOf('source "$ORIG_ZDOTDIR/.zshrc"')).toBeLessThan(rc.indexOf("add-zsh-hook"));
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("falls back to $HOME as the original ZDOTDIR when none is set", () => {
    vi.stubEnv("ZDOTDIR", "");
    vi.stubEnv("HOME", "/home/someone");
    try {
      expect(mod.prepareLocalShellIntegration("zsh")!.env.WHARF_ORIG_ZDOTDIR).toBe("/home/someone");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it.skipIf(!hasZsh)("generates a .zshrc that parses cleanly under zsh", () => {
    const result = mod.prepareLocalShellIntegration("zsh");
    expect(spawnSync("zsh", ["-n", path.join(result!.env.ZDOTDIR, ".zshrc")]).status).toBe(0);
  });
});

describe("BootstrapEchoSuppressor", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("passes everything straight through until start() is called", () => {
    const s = new mod.BootstrapEchoSuppressor();
    expect(s.feed("hello")).toBe("hello");
  });

  it("holds output back until the shell's first prompt-start marker, then releases it with a leading line break", () => {
    const s = new mod.BootstrapEchoSuppressor();
    s.start(() => {});
    expect(s.feed(' if [ -n "$BASH_VERSION" ]; then eval ...\r\n')).toBe("");
    expect(s.feed(`${OSC_PROMPT_START}user@host:~$ `)).toBe(`\r\n${OSC_PROMPT_START}user@host:~$ `);
  });

  it("finds a marker that arrives split across two chunks", () => {
    const s = new mod.BootstrapEchoSuppressor();
    s.start(() => {});
    expect(s.feed("echo\r\n\x1b]13")).toBe("");
    expect(s.feed("3;A\x07$ ")).toBe(`\r\n${OSC_PROMPT_START}$ `);
  });

  it("goes back to pass-through after releasing, and never fires the timeout callback afterward", () => {
    const onTimeout = vi.fn();
    const s = new mod.BootstrapEchoSuppressor();
    s.start(onTimeout);
    s.feed(`junk${OSC_PROMPT_START}`);
    expect(s.feed("later output")).toBe("later output");
    vi.advanceTimersByTime(10_000);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it("flushes whatever was held back on timeout, so an unsupported shell isn't left silent", () => {
    const onTimeout = vi.fn();
    const s = new mod.BootstrapEchoSuppressor();
    s.start(onTimeout, 3000);
    expect(s.feed("fish prompt> ")).toBe("");
    vi.advanceTimersByTime(2999);
    expect(onTimeout).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onTimeout).toHaveBeenCalledExactlyOnceWith("fish prompt> ");
    expect(s.feed("next")).toBe("next");
  });

  it("doesn't call the timeout callback when nothing was held back", () => {
    const onTimeout = vi.fn();
    const s = new mod.BootstrapEchoSuppressor();
    s.start(onTimeout, 1000);
    vi.advanceTimersByTime(1000);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it("restarting discards anything held from the previous start", () => {
    const first = vi.fn();
    const second = vi.fn();
    const s = new mod.BootstrapEchoSuppressor();
    s.start(first, 1000);
    s.feed("stale");
    s.start(second, 1000);
    s.feed("fresh");
    vi.advanceTimersByTime(1000);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledExactlyOnceWith("fresh");
  });
});

describe.skipIf(!canRunFishInPty)("fish integration, run for real in a pty", () => {
  it("reports each command's text and exit code, in order", () => {
    const hooks = mod.prepareLocalShellIntegration("fish")!;
    const out = runFishInPty(hooks.args, ["echo hi", "false", "sh -c 'exit 7'"]);
    // (the trailing `exit` the helper types adds one more C/D pair after these)
    expect(markersOf(out).slice(0, 6)).toEqual(["C:echo hi", "D:0", "C:false", "D:1", "C:sh -c 'exit 7'", "D:7"]);
  });

  it("brackets every prompt with prompt-start and prompt-end markers", () => {
    const out = runFishInPty(mod.prepareLocalShellIntegration("fish")!.args, ["true"]);
    const a = out.match(/\x1b\]133;A\x07/g)?.length ?? 0;
    const b = out.match(/\x1b\]133;B\x07/g)?.length ?? 0;
    expect(a).toBeGreaterThanOrEqual(2);
    expect(b).toBe(a);
    expect(out.indexOf("\x1b]133;A\x07")).toBeLessThan(out.indexOf("\x1b]133;B\x07"));
  });

  it("keeps the user's own prompt, including one that reads $status", () => {
    const own = 'function fish_prompt; echo -n "[st=$status]> "; end';
    const out = runFishInPty(["--init-command", own, ...mod.prepareLocalShellIntegration("fish")!.args], ["false", "true"]);
    expect(out).toContain("[st=1]> ");
    expect(out).toContain("[st=0]> ");
  });

  it("handles command text that would break a naive payload (;, quotes, unicode)", () => {
    const text = "echo 'a;b' \"c\" é✓";
    const out = runFishInPty(mod.prepareLocalShellIntegration("fish")!.args, [text]);
    expect(markersOf(out)).toContain(`C:${text}`);
  });

  it("is loaded by the one-line remote bootstrap, typed into a fish session", () => {
    const out = runFishInPty([], [mod.buildRemoteBootstrapCommand().trim(), "echo remote"]);
    expect(markersOf(out)).toContain("C:echo remote");
    expect(markersOf(out)).toContain("D:0");
    expect(out).not.toMatch(/error|Unknown command|Expected/i);
  });

  it("installs nothing when the shell is fish 4 or later, which writes the markers itself", () => {
    const { fish } = decodedHooks(mod.buildRemoteBootstrapCommand());
    // `version` is read-only in fish, so run the same script with the version swapped in.
    const asFish4 = fish.replace("(string split . -- $version)", "(string split . -- 4.1.0)");
    const out = runFishInPty(
      ["--init-command", asFish4, "--init-command", "functions -q __wharf_preexec; and echo HOOKS-PRESENT; or echo HOOKS-ABSENT"],
      ["echo x"],
    );
    expect(out).toContain("HOOKS-ABSENT");
    expect(markersOf(out)).toEqual(expect.not.arrayContaining(["C:echo x"]));
  });
});

describe.skipIf(!canRunBashInPty)("bash integration, run for real in a pty", () => {
  const hooks = () => mod.prepareLocalShellIntegration("bash")!;
  const markers = (lines: string[], env: Record<string, string> = {}, home = state.userData) =>
    markersOf(runBashInPty(hooks().args, lines, env, home));

  it("reports each command once, with its text and exit code, in order", () => {
    // (the trailing `exit` the helper types adds one more C/D pair after these)
    expect(markers(["echo hi", "false", "sh -c 'exit 7'"]).slice(0, 6)).toEqual([
      "C:echo hi",
      "D:0",
      "C:false",
      "D:1",
      "C:sh -c 'exit 7'",
      "D:7",
    ]);
  });

  it("never reports its own hook functions as a command", () => {
    const all = markers(["echo a", "echo b", "true"]);
    expect(all.filter((m) => m.startsWith("C:")).some((m) => m.includes("__wharf"))).toBe(false);
  });

  it("reports the whole typed line for a compound command, not just its first part", () => {
    expect(markers(["echo a && echo b"]).slice(0, 2)).toEqual(["C:echo a && echo b", "D:0"]);
  });

  it("reports a backslash-continued command as one command", () => {
    expect(markers(["echo one \\", "two"]).slice(0, 2)).toEqual(["C:echo one two", "D:0"]);
  });

  it("reports nothing for an empty line", () => {
    expect(markers(["", "echo x"]).slice(0, 2)).toEqual(["C:echo x", "D:0"]);
  });

  it("keeps working when history ignores lines starting with a space (falls back to the command bash runs)", () => {
    const c = markers(["echo first", " echo second"], { HISTCONTROL: "ignorespace" }).filter((m) => m.startsWith("C:"));
    expect(c.slice(0, 2)).toEqual(["C:echo first", "C:echo second"]);
  });

  it("leaves the user's $? and PROMPT_COMMAND alone (even one ending in a semicolon)", () => {
    const home = mkdtempSync(path.join(tmpdir(), "wharf-bashhome-"));
    try {
      writeFileSync(path.join(home, ".bashrc"), "PS1='[$?]> '\nPROMPT_COMMAND='export SEEN=1;'\n", "utf8");
      const out = runBashInPty(hooks().args, ["false", "true", 'echo "seen=$SEEN"'], {}, home);
      expect(out).toContain("[1]> ");
      expect(out).toContain("[0]> ");
      expect(out).toContain("seen=1");
      expect(out).not.toMatch(/syntax error/i);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("brackets every prompt with prompt-start and prompt-end markers", () => {
    const out = runBashInPty(hooks().args, ["true"]);
    const a = out.match(/\x1b\]133;A\x07/g)?.length ?? 0;
    const b = out.match(/\x1b\]133;B\x07/g)?.length ?? 0;
    expect(a).toBeGreaterThanOrEqual(2);
    expect(b).toBeGreaterThanOrEqual(2);
  });

  it("is loaded by the one-line remote bootstrap, typed into a plain bash session", () => {
    const out = runBashInPty(["--norc", "--noprofile", "-i"], [mod.buildRemoteBootstrapCommand().trim(), "echo remote", "false"]);
    const m = markersOf(out);
    expect(m).toContain("C:echo remote");
    expect(m).toContain("C:false");
    expect(m).toContain("D:1");
    expect(m.some((x) => x.includes("__wharf"))).toBe(false);
    expect(out).not.toMatch(/syntax error|command not found/i);
  });
});
