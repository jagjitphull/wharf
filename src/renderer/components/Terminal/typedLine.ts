/**
 * What is actually typed at the shell prompt, read from the terminal's own
 * screen rather than rebuilt from keystrokes.
 *
 * The keystroke buffer (commandCapture.ts) can't know what the shell did with
 * the keys: Tab completion, ↑/↓ history recall, Ctrl+R, Ctrl+W and editing
 * mid-line all change the line without it seeing the new text. Anything that
 * must match the real line — above all the inline suggestion's "accept", which
 * types the rest of a command — has to read the screen instead.
 *
 * It needs to know where the prompt ended, which only OSC 133 shell
 * integration reports (the ;B marker); without it there is no reliable answer,
 * and callers fall back to the keystroke buffer, checked against the screen.
 */

/** The slice of xterm's buffer this reads (the real buffer satisfies it). */
export interface LineBuffer {
  readonly cursorX: number;
  readonly cursorY: number;
  readonly baseY: number;
  getLine(
    y: number,
  ): { isWrapped: boolean; translateToString(trimRight?: boolean, startColumn?: number, endColumn?: number): string } | undefined;
}

export interface PromptEnd {
  /** Absolute buffer row (follows scrolling via a marker, so the caller passes `marker.line`). */
  line: number;
  /** Column where the prompt ended, i.e. where typing starts on that row. */
  column: number;
}

export interface TypedLine {
  /** Everything between the end of the prompt and the cursor. */
  text: string;
  /** Nothing follows the cursor on its row, i.e. it is at the end of the line. */
  cursorAtEnd: boolean;
}

/**
 * The text typed after the prompt, up to the cursor, following the line across
 * rows that wrapped. Null when it can't be read reliably: the prompt scrolled
 * away, the cursor is above where typing started, or a following row isn't a
 * wrapped continuation (a multi-line prompt or a program drawing its own UI).
 */
export function readTypedLine(buffer: LineBuffer, promptEnd: PromptEnd): TypedLine | null {
  const cursorRow = buffer.baseY + buffer.cursorY;
  if (promptEnd.line < 0 || cursorRow < promptEnd.line) return null;
  if (cursorRow === promptEnd.line && buffer.cursorX < promptEnd.column) return null;

  let text = "";
  for (let y = promptEnd.line; y <= cursorRow; y++) {
    const line = buffer.getLine(y);
    if (!line) return null;
    if (y > promptEnd.line && !line.isWrapped) return null;
    const from = y === promptEnd.line ? promptEnd.column : 0;
    const to = y === cursorRow ? buffer.cursorX : undefined;
    text += line.translateToString(false, from, to);
  }
  const current = buffer.getLine(cursorRow);
  const cursorAtEnd = !current || current.translateToString(true, buffer.cursorX) === "";
  return { text, cursorAtEnd };
}

/**
 * Without prompt markers: whether the keystroke guess is really what sits left
 * of the cursor on this row. When it isn't (Tab completion, history recall…) the
 * guess is stale and must not be acted on.
 */
export function guessMatchesScreen(buffer: LineBuffer, guess: string): boolean {
  const line = buffer.getLine(buffer.baseY + buffer.cursorY);
  if (!line) return false;
  const before = line.translateToString(false, 0, buffer.cursorX);
  const cursorAtEnd = line.translateToString(true, buffer.cursorX) === "";
  return cursorAtEnd && before.endsWith(guess);
}
