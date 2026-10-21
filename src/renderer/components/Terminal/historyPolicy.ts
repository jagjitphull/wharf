/**
 * Decides whether a line the user just typed is a *command* worth putting in
 * Command History, or an answer to something else — above all a password.
 *
 * Wharf rebuilds typed lines from keystrokes, and a keystroke can't tell a
 * command from the password typed at `sudo`'s or `ssh`'s prompt (the terminal
 * isn't echoing it, but the keys still go through). Two signals separate them:
 *
 *  - With shell integration (OSC 133), the shell says when it is showing its own
 *    prompt. A line typed while a command is *running* is input to that command,
 *    not a new command, so it is never recorded.
 *  - Without it, the only hint is the program's own prompt: output ending in
 *    "Password:", "Enter passphrase for key …:", "[sudo] password for me:" and
 *    the like. The line typed in answer is skipped.
 */

// Matches the end of the output so far: a prompt that asks for a secret.
const SECRET_PROMPT = /(pass(word|phrase|code)|\bpin\b|secret|token|verification code|one-time|otp)\b[^\n:?]{0,60}[:?]\s*$/i;

// Control sequences that decorate output but aren't text: CSI, OSC (to BEL or ST), and other two-byte escapes.
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g;

/** Keeps just enough of the end of the output to recognise a prompt on it. */
export function appendOutputTail(tail: string, chunk: string): string {
  return (tail + chunk.replace(ANSI, "")).slice(-200);
}

export function looksLikeSecretPrompt(outputTail: string): boolean {
  return SECRET_PROMPT.test(outputTail);
}

export interface RecordingContext {
  /** Any OSC 133 marker has arrived in this session, so the shell is reporting its prompts. */
  integrationSeen: boolean;
  /** Between the shell's prompt-end marker and the next command-start marker. */
  atPrompt: boolean;
  /** The output so far ends in a prompt asking for a secret. */
  secretPromptShown: boolean;
}

export function shouldRecordTypedLine(ctx: RecordingContext): boolean {
  if (ctx.integrationSeen) return ctx.atPrompt;
  return !ctx.secretPromptShown;
}
