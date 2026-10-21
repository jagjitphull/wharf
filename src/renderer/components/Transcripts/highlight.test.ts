import { describe, expect, it } from "vitest";
import { highlightRuns } from "./highlight";

describe("highlightRuns", () => {
  it("returns the text whole when there is nothing to find", () => {
    expect(highlightRuns("hello", "")).toEqual([{ text: "hello", hit: false }]);
    expect(highlightRuns("hello", "zzz")).toEqual([{ text: "hello", hit: false }]);
  });

  it("flags each occurrence, ignoring case but keeping the original text", () => {
    expect(highlightRuns("Error: an error", "error")).toEqual([
      { text: "Error", hit: true },
      { text: ": an ", hit: false },
      { text: "error", hit: true },
    ]);
  });

  it("handles a match at either end and adjacent matches", () => {
    expect(highlightRuns("abab", "ab")).toEqual([
      { text: "ab", hit: true },
      { text: "ab", hit: true },
    ]);
  });

  it("treats the query literally, not as a pattern", () => {
    expect(highlightRuns("a.c abc", ".")).toEqual([
      { text: "a", hit: false },
      { text: ".", hit: true },
      { text: "c abc", hit: false },
    ]);
  });
});
