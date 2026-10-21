import { describe, expect, it } from "vitest";
import { guessMatchesScreen, readTypedLine, type LineBuffer } from "./typedLine";

/** A screen of fixed-width rows; `wrapped` marks rows that continue the one above. */
function screen(
  rows: string[],
  cursor: { x: number; y: number },
  opts: { width?: number; wrapped?: number[]; baseY?: number } = {},
): LineBuffer {
  const width = opts.width ?? 40;
  const wrapped = new Set(opts.wrapped ?? []);
  return {
    cursorX: cursor.x,
    cursorY: cursor.y,
    baseY: opts.baseY ?? 0,
    getLine: (y) => {
      const row = rows[y];
      if (row === undefined) return undefined;
      const padded = row.padEnd(width, " ");
      return {
        isWrapped: wrapped.has(y),
        translateToString: (trimRight = false, start = 0, end = width) => {
          const s = padded.slice(start, end);
          return trimRight ? s.trimEnd() : s;
        },
      };
    },
  };
}

const PROMPT = "me@host:~$ ";

describe("readTypedLine", () => {
  it("reads what follows the prompt, up to the cursor", () => {
    const b = screen([`${PROMPT}echo hi`], { x: PROMPT.length + 7, y: 0 });
    expect(readTypedLine(b, { line: 0, column: PROMPT.length })).toEqual({ text: "echo hi", cursorAtEnd: true });
  });

  it("sees what Tab completion or history recall put there, which keystrokes never show", () => {
    const b = screen([`${PROMPT}echo pyfile_abc `], { x: PROMPT.length + 16, y: 0 });
    expect(readTypedLine(b, { line: 0, column: PROMPT.length })?.text).toBe("echo pyfile_abc ");
  });

  it("is empty at a bare prompt", () => {
    const b = screen([PROMPT], { x: PROMPT.length, y: 0 });
    expect(readTypedLine(b, { line: 0, column: PROMPT.length })).toEqual({ text: "", cursorAtEnd: true });
  });

  it("keeps trailing spaces", () => {
    const b = screen([`${PROMPT}ls `], { x: PROMPT.length + 3, y: 0 });
    expect(readTypedLine(b, { line: 0, column: PROMPT.length })?.text).toBe("ls ");
  });

  it("says when the cursor is not at the end of the line", () => {
    const b = screen([`${PROMPT}echo hi`], { x: PROMPT.length + 4, y: 0 });
    expect(readTypedLine(b, { line: 0, column: PROMPT.length })).toEqual({ text: "echo", cursorAtEnd: false });
  });

  it("follows a line that wrapped onto the next row", () => {
    const rows = [`${PROMPT}aaaaaaaaaaaaaaaaaaaaaaaaaaaaa`, "bbbbbb"];
    const b = screen(rows, { x: 6, y: 1 }, { wrapped: [1] });
    expect(readTypedLine(b, { line: 0, column: PROMPT.length })?.text).toBe("a".repeat(29) + "bbbbbb");
  });

  it("works when the buffer has scrolled (absolute rows)", () => {
    const rows = ["old output", "more", `${PROMPT}pwd`];
    const b = screen(rows, { x: PROMPT.length + 3, y: 0 }, { baseY: 2 });
    expect(readTypedLine(b, { line: 2, column: PROMPT.length })?.text).toBe("pwd");
  });

  it("gives up when the prompt scrolled out of the buffer", () => {
    const b = screen([`${PROMPT}x`], { x: 12, y: 0 });
    expect(readTypedLine(b, { line: -1, column: 0 })).toBeNull();
  });

  it("gives up when the cursor is above where typing began", () => {
    const b = screen(["a", "b"], { x: 0, y: 0 });
    expect(readTypedLine(b, { line: 1, column: 2 })).toBeNull();
  });

  it("gives up when the cursor is left of the prompt's end on its own row", () => {
    const b = screen([`${PROMPT}x`], { x: 3, y: 0 });
    expect(readTypedLine(b, { line: 0, column: PROMPT.length })).toBeNull();
  });

  it("gives up across a row that isn't a wrapped continuation (multi-line prompt, a full-screen program)", () => {
    const b = screen([`${PROMPT}echo \\`, "> more"], { x: 6, y: 1 });
    expect(readTypedLine(b, { line: 0, column: PROMPT.length })).toBeNull();
  });
});

describe("guessMatchesScreen", () => {
  it("is true when the guess is what sits just left of the cursor at the end of the line", () => {
    const b = screen([`${PROMPT}echo hi`], { x: PROMPT.length + 7, y: 0 });
    expect(guessMatchesScreen(b, "echo hi")).toBe(true);
  });

  it("is false once Tab completion changed the line behind the guess's back", () => {
    const b = screen([`${PROMPT}echo pyfile_abc `], { x: PROMPT.length + 16, y: 0 });
    expect(guessMatchesScreen(b, "echo pyf")).toBe(false);
  });

  it("is false when the cursor is mid-line", () => {
    const b = screen([`${PROMPT}echo hi`], { x: PROMPT.length + 4, y: 0 });
    expect(guessMatchesScreen(b, "echo")).toBe(false);
  });

  it("is false when the row doesn't exist", () => {
    expect(guessMatchesScreen(screen([], { x: 0, y: 0 }), "x")).toBe(false);
  });
});
