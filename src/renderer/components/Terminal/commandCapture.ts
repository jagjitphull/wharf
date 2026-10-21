/**
 * Best-effort reconstruction of "commands typed into a terminal", built by
 * buffering the raw keystrokes xterm.js hands to onData (the same bytes
 * that get written to the pty) until Enter completes a line. This is NOT a
 * perfect transcript of what the shell actually saw:
 *  - Arrow-key history recall (↑/↓) redraws a previous command on-screen
 *    without us ever seeing its text as typed input — the escape sequence
 *    itself is stripped (see ESCAPE_SEQ below) rather than captured.
 *  - Tab completion similarly expands text the shell fills in, not us.
 *  - A pasted multi-line block is treated as one command per embedded
 *    newline, same as if it had been typed — except that a line ending in a
 *    backslash continues onto the next, as the shell treats it. (Quoted
 *    strings and heredocs that span lines still come out as one entry per
 *    line here; with Command Blocks the shell's own text corrects the last.)
 * Good enough for "what did I run, and roughly when" on its own — an audit
 * trail, not a session recording. For bash/zsh with Command Blocks enabled,
 * though, this is only ever a same-tick placeholder: shellIntegration.ts's
 * hooks report the shell's own authoritative command text a moment later
 * (see decodeOsc133CommandText in commandBlocks.ts and Terminal.tsx's
 * commandHistory.shellText call), which is immune to exactly the two
 * blind spots above and overwrites this guess once it arrives.
 */

export interface CommandCaptureState {
  buffer: string;
}

export function createCommandCaptureState(): CommandCaptureState {
  return { buffer: "" };
}

// CSI sequences (arrow keys, Home/End, etc.) and SS3 sequences (arrow keys
// in some terminals' "application mode"), plus a catch-all for any other
// ESC-prefixed two-byte sequence — stripped before the buffer sees them so
// cursor-movement bytes never show up as literal garbage in a "command".
const ESCAPE_SEQ = /\x1b\[[0-9;]*[A-Za-z~]|\x1bO[A-Za-z]|\x1b./gs;

/** Feeds one chunk of raw input bytes (as sent to the pty) into the capture
 * buffer. Returns any commands completed by this chunk — normally zero or
 * one, but a pasted block with embedded newlines can complete several at
 * once. Empty (whitespace-only) lines are dropped, not returned. */
export function feedCommandCapture(state: CommandCaptureState, rawData: string): string[] {
  return feedCommandCaptureDetailed(state, rawData).map((c) => c.command);
}

export interface CapturedCommand {
  command: string;
  /** The line was typed with a leading space: the long-standing shell convention for "don't remember this one". */
  hidden: boolean;
}

/** Same as feedCommandCapture, but says which lines were typed with a leading space. */
export function feedCommandCaptureDetailed(state: CommandCaptureState, rawData: string): CapturedCommand[] {
  const data = rawData.replace(ESCAPE_SEQ, "");
  const completed: CapturedCommand[] = [];

  for (const ch of data) {
    if (ch === "\r" || ch === "\n") {
      // A line ending in an (unescaped) backslash continues on the next one:
      // the shell joins the two, so this is still one command, not several.
      const trailing = /\\+$/.exec(state.buffer)?.[0].length ?? 0;
      if (trailing % 2 === 1) {
        state.buffer = state.buffer.slice(0, -1);
        continue;
      }
      const command = state.buffer.trim();
      if (command) completed.push({ command, hidden: /^[ \t]/.test(state.buffer) });
      state.buffer = "";
    } else if (ch === "\x7f" || ch === "\b") {
      // Backspace/Delete — drop the last character, same as the shell's own line editing.
      state.buffer = state.buffer.slice(0, -1);
    } else if (ch === "\x03" || ch === "\x15") {
      // Ctrl+C (interrupt) or Ctrl+U (kill line) — whatever was typed is abandoned, not run.
      state.buffer = "";
    } else if (ch >= " ") {
      state.buffer += ch;
    }
    // Other C0 control characters are silently ignored — notably \t (Tab):
    // appending it here used to be exactly the bug the doc comment above
    // already warned about ("Tab completion ... expands text the shell
    // fills in, not us") — a real Tab keypress sends this same raw byte to
    // the pty, so the old code baked a literal tab into the buffer on every
    // completion attempt. That permanently desynced this buffer from the
    // real line (whatever the shell actually expanded it to), and every
    // consumer downstream of it — the ghost-suggestion decoration's
    // position/text and the AI popup's requestLine check in particular —
    // kept computing against that wrong, tab-polluted text until the next
    // Enter/Ctrl+C/Ctrl+U reset it, which is what showed up as misplaced,
    // gapped-looking ghost text after tab-completing a path.
  }

  return completed;
}
