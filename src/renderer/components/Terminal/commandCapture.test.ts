import { describe, expect, it } from "vitest";
import { createCommandCaptureState, feedCommandCapture } from "./commandCapture";

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
