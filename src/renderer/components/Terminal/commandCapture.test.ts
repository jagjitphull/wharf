import { describe, expect, it } from "vitest";
import { createCommandCaptureState, feedCommandCapture, feedCommandCaptureDetailed } from "./commandCapture";

function run(...chunks: string[]): string[] {
  const state = createCommandCaptureState();
  return chunks.flatMap((c) => feedCommandCapture(state, c));
}

describe("feedCommandCapture", () => {
  it("returns a command once Enter completes the line", () => {
    expect(run("ls -la", "\r")).toEqual(["ls -la"]);
  });

  it("buffers across chunks and treats \\n like \\r", () => {
    expect(run("g", "it ", "status\n")).toEqual(["git status"]);
  });

  it("applies backspace", () => {
    expect(run("lss\x7f\r")).toEqual(["ls"]);
    expect(run("lss\b\r")).toEqual(["ls"]);
  });

  it("drops the line on Ctrl+C and Ctrl+U", () => {
    expect(run("rm -rf x\x03", "ls\r")).toEqual(["ls"]);
    expect(run("rm -rf x\x15ls\r")).toEqual(["ls"]);
  });

  it("drops whitespace-only lines", () => {
    expect(run("   \r", "\r")).toEqual([]);
  });

  it("splits a multi-line paste into one command per line", () => {
    expect(run("cd /tmp\npwd\nls\n")).toEqual(["cd /tmp", "pwd", "ls"]);
  });

  it("joins backslash-continued lines into one command, as the shell does", () => {
    const text =
      'linuxops targets add rocky-bad \\\r--host 127.0.0.1 --port 2224 \\\r--identity "$PWD/keys/k" \\\r--known-hosts "$PWD/keys/kh"\r';
    expect(run(text)).toEqual([
      'linuxops targets add rocky-bad --host 127.0.0.1 --port 2224 --identity "$PWD/keys/k" --known-hosts "$PWD/keys/kh"',
    ]);
  });

  it("keeps a continuation pending across chunks, and Ctrl+C abandons it", () => {
    expect(run("echo a \\", "\r", "b\r")).toEqual(["echo a b"]);
    expect(run("echo a \\\r", "\x03", "ls\r")).toEqual(["ls"]);
  });

  it("treats an escaped backslash (two in a row) as a complete line", () => {
    expect(run("echo \\\\\r")).toEqual(["echo \\\\"]);
  });

  it("keeps an unfinished line pending", () => {
    const state = createCommandCaptureState();
    expect(feedCommandCapture(state, "echo hi")).toEqual([]);
    expect(state.buffer).toBe("echo hi");
  });

  it("strips arrow-key and other escape sequences", () => {
    expect(run("\x1b[A\x1b[D\x1b[1;5C", "ls\r")).toEqual(["ls"]);
    expect(run("\x1bOA", "ls\r")).toEqual(["ls"]);
    expect(run("l\x1b[3~s\r")).toEqual(["ls"]);
  });

  it("ignores Tab so completion doesn't pollute the buffer", () => {
    const state = createCommandCaptureState();
    feedCommandCapture(state, "cd /us\t");
    expect(state.buffer).toBe("cd /us");
  });
});

describe("feedCommandCaptureDetailed", () => {
  const lines = (...chunks: string[]) => {
    const state = createCommandCaptureState();
    return chunks.flatMap((c) => feedCommandCaptureDetailed(state, c));
  };

  it("marks a line typed with a leading space as hidden, and trims it", () => {
    expect(lines(" echo secret\r", "echo plain\r")).toEqual([
      { command: "echo secret", hidden: true },
      { command: "echo plain", hidden: false },
    ]);
  });

  it("treats a leading tab the same way", () => {
    expect(lines("\techo x\r")[0].hidden).toBe(false); // a Tab keypress is Tab completion, not text
  });

  it("a space typed and then backspaced away doesn't hide the line", () => {
    expect(lines(" \x7fls\r")).toEqual([{ command: "ls", hidden: false }]);
  });

  it("keeps whether a backslash-continued command began with a space", () => {
    expect(lines(" echo a \\\r", "b\r")).toEqual([{ command: "echo a b", hidden: true }]);
  });
});
