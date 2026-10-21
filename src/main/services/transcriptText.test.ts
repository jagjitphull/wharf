import { describe, expect, it } from "vitest";
import { createTranscriptCleaner, FULL_SCREEN_MARKER } from "./transcriptText";

function clean(...chunks: string[]): string[] {
  const c = createTranscriptCleaner();
  const lines = chunks.flatMap((chunk) => c.feed(chunk));
  const rest = c.flush();
  return rest === null ? lines : [...lines, rest];
}

describe("createTranscriptCleaner", () => {
  it("returns plain lines without their line ends", () => {
    expect(clean("one\r\ntwo\nthree")).toEqual(["one", "two", "three"]);
  });

  it("drops colours, titles and the shell-integration marks", () => {
    expect(clean("\x1b[1;32muser@host\x1b[0m:\x1b[34m~\x1b[0m$ ls\r\n")).toEqual(["user@host:~$ ls"]);
    expect(clean("\x1b]0;a title\x07prompt$ \x1b]133;A\x1b\\x\r\n")).toEqual(["prompt$ x"]);
  });

  it("understands an escape sequence split across chunks", () => {
    expect(clean("ok \x1b[3", "1mred\x1b", "[0m done\r\n")).toEqual(["ok red done"]);
  });

  it("lets a carriage return overwrite, like a progress bar", () => {
    expect(clean("10%\r50%\r100%\r\ndone\r\n")).toEqual(["100%", "done"]);
    // the shorter overwrite leaves the tail of the longer one, as on a real terminal
    expect(clean("abcdef\rXY\r\n")).toEqual(["XYcdef"]);
  });

  it("applies backspaces and erase-to-end-of-line (readline redrawing)", () => {
    expect(clean("$ lx\b\bls\r\n")).toEqual(["$ ls"]);
    expect(clean("$ echo hello\b\b\b\b\b\x1b[K\r\n")).toEqual(["$ echo"]);
    expect(clean("$ gitt\b\x1b[K status\r\n")).toEqual(["$ git status"]);
  });

  it("moves the cursor for cursor-forward / delete-character", () => {
    expect(clean("ab\x1b[3Ccd\r\n")).toEqual(["ab   cd"]);
    expect(clean("abcde\r\x1b[2C\x1b[1P\r\n")).toEqual(["abde"]);
  });

  it("expands tabs to the next stop", () => {
    expect(clean("a\tb\r\n")).toEqual(["a       b"]);
  });

  it("keeps non-ASCII text and drops other control characters", () => {
    expect(clean("héllo 🌍\x07\x00 ok\r\n")).toEqual(["héllo 🌍 ok"]);
  });

  it("replaces a full-screen program with one marker line", () => {
    const lines = clean("$ vim x\r\n\x1b[?1049h\x1b[2J~ junk \x1b[H lots of redraws\r\nmore\r\n\x1b[?1049l$ ls\r\n");
    expect(lines).toEqual(["$ vim x", FULL_SCREEN_MARKER, "$ ls"]);
  });

  it("flush() returns the unfinished line once", () => {
    const c = createTranscriptCleaner();
    expect(c.feed("user@host:~$ ")).toEqual([]);
    expect(c.flush()).toBe("user@host:~$");
    expect(c.flush()).toBeNull();
  });

  it("caps a runaway line", () => {
    const [line] = clean("x".repeat(10_000) + "\r\n");
    expect(line.length).toBe(4000);
  });
});
