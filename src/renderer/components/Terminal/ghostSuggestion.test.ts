import { describe, expect, it } from "vitest";
import {
  createGhostHistoryCache,
  createGhostTransitionMap,
  findGhostSuggestion,
  findNextCommandSuggestion,
  pushToGhostHistoryCache,
  recordGhostTransition,
} from "./ghostSuggestion";

describe("ghost history cache", () => {
  it("is most-recent-first and keeps the latest run of a repeated command", () => {
    expect(createGhostHistoryCache(["a", "b", "a", "c"])).toEqual(["c", "a", "b"]);
  });

  it("moves a re-run command to the front instead of duplicating it", () => {
    const cache = createGhostHistoryCache(["a", "b"]);
    pushToGhostHistoryCache(cache, "a");
    expect(cache).toEqual(["a", "b"]);
  });

  it("caps its size at 500, dropping the oldest", () => {
    const commands = Array.from({ length: 600 }, (_, i) => `cmd${i}`);
    const cache = createGhostHistoryCache(commands);
    expect(cache).toHaveLength(500);
    expect(cache[0]).toBe("cmd599");
    expect(cache).not.toContain("cmd0");
  });
});

describe("findGhostSuggestion", () => {
  const cache = createGhostHistoryCache(["git commit -m x", "git status", "ls"]);

  it("suggests the most recent command starting with the buffer", () => {
    expect(findGhostSuggestion("git", cache)).toBe("git status");
  });

  it("suggests nothing for an empty buffer or no match", () => {
    expect(findGhostSuggestion("", cache)).toBeNull();
    expect(findGhostSuggestion("docker", cache)).toBeNull();
  });

  it("suggests nothing once the buffer is the whole command", () => {
    expect(findGhostSuggestion("ls", cache)).toBeNull();
    expect(findGhostSuggestion("git status", cache)).toBeNull();
  });

  it("is case-sensitive", () => {
    expect(findGhostSuggestion("GIT", cache)).toBeNull();
  });
});

describe("next-command prediction", () => {
  it("predicts the most frequent follower", () => {
    const map = createGhostTransitionMap(["build", "test", "build", "test", "build", "deploy"]);
    expect(findNextCommandSuggestion("build", map)).toBe("test");
  });

  it("ignores a command repeated back-to-back", () => {
    const map = createGhostTransitionMap(["ls", "ls", "ls"]);
    expect(findNextCommandSuggestion("ls", map)).toBeNull();
  });

  it("returns null with no previous command or no history for it", () => {
    const map = createGhostTransitionMap(["a", "b"]);
    expect(findNextCommandSuggestion(null, map)).toBeNull();
    expect(findNextCommandSuggestion("zzz", map)).toBeNull();
    expect(findNextCommandSuggestion("b", map)).toBeNull(); // last entry has no follower
  });

  it("learns live transitions, and a null `from` is a no-op", () => {
    const map = createGhostTransitionMap([]);
    recordGhostTransition(map, null, "a");
    expect(map.size).toBe(0);
    recordGhostTransition(map, "a", "b");
    expect(findNextCommandSuggestion("a", map)).toBe("b");
  });

  it("keeps the first-seen follower on a tie", () => {
    const map = createGhostTransitionMap(["a", "x", "a", "y"]);
    expect(findNextCommandSuggestion("a", map)).toBe("x");
  });
});
