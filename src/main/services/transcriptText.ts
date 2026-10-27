/**
 * Turns the raw bytes a terminal receives into the lines a person would read
 * on screen, for searchable session transcripts: escape sequences are dropped,
 * a carriage return or backspace followed by new text overwrites what was
 * there (progress bars, readline redrawing the command line), and
 * full-screen programs (vim, top, less — the alternate screen) are replaced by
 * a one-line marker, since their screen updates make no sense as text.
 *
 * Streaming: state carries over between feed() calls, so a sequence split
 * across two chunks is still understood.
 */

export const FULL_SCREEN_MARKER = "[full-screen application]";
const MAX_LINE_LENGTH = 4000;
const TAB_WIDTH = 8;

type State = "ground" | "esc" | "csi" | "string" | "string-esc" | "charset";

export interface TranscriptCleaner {
  /** Consumes output, returning the lines it completed (without line ends). */
  feed(chunk: string): string[];
  /** The line still being written (no line end yet), and forgets it. Null when empty. */
  flush(): string | null;
}

export function createTranscriptCleaner(): TranscriptCleaner {
  let state: State = "ground";
  let line: string[] = [];
  let cursor = 0;
  let csi = "";
  let altScreen = false;
  const out: string[] = [];

  function finishLine() {
    out.push(line.join("").trimEnd());
    line = [];
    cursor = 0;
  }

  function put(ch: string) {
    if (cursor >= MAX_LINE_LENGTH) return;
    while (line.length < cursor) line.push(" ");
    line[cursor++] = ch;
  }

  function handleCsi(params: string, final: string) {
    const priv = params.startsWith("?");
    if (priv && (final === "h" || final === "l")) {
      const alt = params
        .slice(1)
        .split(";")
        .some((p) => p === "1049" || p === "1047" || p === "47");
      if (alt) {
        if (final === "h" && !altScreen) {
          if (line.length > 0) finishLine();
          out.push(FULL_SCREEN_MARKER);
          altScreen = true;
        } else if (final === "l") {
          altScreen = false;
        }
      }
      return;
    }
    if (priv || altScreen) return;
    const n = Math.max(1, parseInt(params, 10) || 1);
    switch (final) {
      case "K": {
        const mode = parseInt(params, 10) || 0;
        if (mode === 0) line.length = Math.min(line.length, cursor);
        else if (mode === 1) for (let i = 0; i < cursor && i < line.length; i++) line[i] = " ";
        else {
          line = [];
        }
        break;
      }
      case "C":
        cursor = Math.min(cursor + n, MAX_LINE_LENGTH);
        break;
      case "D":
        cursor = Math.max(0, cursor - n);
        break;
      case "G":
        cursor = Math.min(n - 1, MAX_LINE_LENGTH);
        break;
      case "P":
        line.splice(cursor, n);
        break;
      default:
        break; // colours, cursor shape, scrolling regions… nothing to keep
    }
  }

  function step(ch: string) {
    switch (state) {
      case "ground": {
        if (ch === "\x1b") state = "esc";
        else if (altScreen) return;
        else if (ch === "\n") finishLine();
        else if (ch === "\r") cursor = 0;
        else if (ch === "\b") cursor = Math.max(0, cursor - 1);
        else if (ch === "\t") {
          const next = (Math.floor(cursor / TAB_WIDTH) + 1) * TAB_WIDTH;
          while (cursor < next) put(" ");
        } else if (ch >= " " && ch !== "\x7f") put(ch);
        return;
      }
      case "esc": {
        if (ch === "[") {
          state = "csi";
          csi = "";
        } else if (ch === "]" || ch === "P" || ch === "X" || ch === "^" || ch === "_") state = "string";
        else if (ch === "(" || ch === ")" || ch === "*" || ch === "+" || ch === "#" || ch === "%") state = "charset";
        else state = "ground"; // a one-character escape (ESC =, ESC >, ESC M …)
        return;
      }
      case "charset":
        state = "ground";
        return;
      case "csi": {
        const code = ch.charCodeAt(0);
        if (code >= 0x40 && code <= 0x7e) {
          state = "ground";
          handleCsi(csi, ch);
        } else if (ch === "\x1b") {
          state = "esc"; // an interrupted sequence
        } else if (csi.length < 64) csi += ch;
        return;
      }
      case "string": {
        // OSC / DCS / APC … run until BEL or ST (ESC \).
        if (ch === "\x07") state = "ground";
        else if (ch === "\x1b") state = "string-esc";
        return;
      }
      case "string-esc":
        state = ch === "\\" ? "ground" : ch === "\x1b" ? "string-esc" : "string";
        return;
    }
  }

  return {
    feed(chunk) {
      for (const ch of chunk) step(ch);
      return out.splice(0);
    },
    flush() {
      const text = line.join("").trimEnd();
      line = [];
      cursor = 0;
      return text.length > 0 ? text : null;
    },
  };
}
