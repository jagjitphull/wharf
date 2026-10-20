import { describe, expect, it } from "vitest";
import { blockPillText, blockStatus, formatDuration } from "./blockDecorations";

describe("blockStatus", () => {
  it("is running until the shell reports an end", () => {
    expect(blockStatus({ exitCode: null, endedAt: null })).toBe("running");
  });
  it("is ok for exit 0, failed for anything else", () => {
    expect(blockStatus({ exitCode: 0, endedAt: 5 })).toBe("ok");
    expect(blockStatus({ exitCode: 22, endedAt: 5 })).toBe("failed");
  });
  it("treats an ended block with no exit code as ok, not failed", () => {
    expect(blockStatus({ exitCode: null, endedAt: 5 })).toBe("ok");
  });
});

describe("formatDuration", () => {
  it.each([
    [0, "<1 ms"],
    [0.4, "<1 ms"],
    [1, "1 ms"],
    [180, "180 ms"],
    [1500, "1.50 s"],
    [12_340, "12.3 s"],
    [65_000, "1m 05s"],
    [119_700, "2m 00s"],
  ])("%d ms -> %s", (ms, text) => expect(formatDuration(ms)).toBe(text));
});

describe("blockPillText", () => {
  it("shows the mark, exit code and duration", () => {
    expect(blockPillText({ exitCode: 0, endedAt: 1180, timestamp: 1000 })).toBe("✓ 0 · 180 ms");
    expect(blockPillText({ exitCode: 22, endedAt: 1410, timestamp: 1000 })).toBe("✕ 22 · 410 ms");
  });
  it("shows only the duration when there is no exit code", () => {
    expect(blockPillText({ exitCode: null, endedAt: 3000, timestamp: 1000 })).toBe("2.00 s");
  });
  it("is empty when nothing is known", () => {
    expect(blockPillText({ exitCode: null, endedAt: null, timestamp: 1000 })).toBe("");
  });
});
