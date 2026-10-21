import { beforeEach, describe, expect, it } from "vitest";
import type { CommandHistoryEntry } from "../../shared/types";
import { DEFAULT_HISTORY_SETTINGS, type HistorySettings } from "../../shared/historyFilter";
import { COMMAND_HISTORY_MAX, createHistoryRecorder, type HistoryRecorder } from "./historyRecorder";

let entries: CommandHistoryEntry[];
let settings: HistorySettings;
let clock: number;
let rec: HistoryRecorder;

const who = { sessionId: "s1", hostId: null, hostName: "Local Shell" };
const commands = () => entries.map((e) => e.command);

beforeEach(() => {
  entries = [];
  settings = { ...DEFAULT_HISTORY_SETTINGS };
  clock = 1_000_000;
  rec = createHistoryRecorder({
    entries: () => entries,
    setEntries: (e) => (entries = e),
    settings: () => settings,
    now: () => clock,
  });
});

describe("recording a typed command", () => {
  it("stores it and says so", () => {
    expect(rec.record({ ...who, command: "ls" })).toBe(true);
    expect(commands()).toEqual(["ls"]);
  });
  it("stores nothing, and says so, when history is off", () => {
    settings.enabled = false;
    expect(rec.record({ ...who, command: "ls" })).toBe(false);
    expect(entries).toEqual([]);
  });
  it("skips a secret-looking command", () => {
    expect(rec.record({ ...who, command: "export TOKEN=abc" })).toBe(false);
    expect(entries).toEqual([]);
  });
  it("skips what the ignore patterns match", () => {
    settings.ignorePatterns = ["ls *"];
    expect(rec.record({ ...who, command: "ls -la" })).toBe(false);
    expect(rec.record({ ...who, command: "pwd" })).toBe(true);
  });
  it("keeps at most COMMAND_HISTORY_MAX entries, dropping the oldest", () => {
    for (let i = 0; i < COMMAND_HISTORY_MAX + 3; i++) rec.record({ ...who, command: `c${i}` });
    expect(entries).toHaveLength(COMMAND_HISTORY_MAX);
    expect(entries[0].command).toBe("c3");
  });
});

describe("the shell's own text of a command", () => {
  it("replaces the keystroke guess", () => {
    rec.record({ ...who, command: "ls /va" });
    rec.shellText(who, "ls /var/log");
    expect(commands()).toEqual(["ls /var/log"]);
  });
  it("is recorded on its own when there was no guess (typed ahead)", () => {
    rec.record({ ...who, command: "echo one" });
    rec.shellText(who, "echo one");
    rec.shellText(who, "echo two"); // no guess for this one
    expect(commands()).toEqual(["echo one", "echo two"]);
  });
  it("never overwrites an earlier command when its guess was refused", () => {
    rec.record({ ...who, command: "echo one" });
    rec.shellText(who, "echo one");
    settings.ignorePatterns = ["echo two"];
    rec.record({ ...who, command: "echo two" }); // refused
    rec.shellText(who, "echo two"); // refused again
    expect(commands()).toEqual(["echo one"]);
  });
  it("removes the guess when the shell's text turns out to be a secret", () => {
    rec.record({ ...who, command: "login" });
    rec.shellText(who, "login --password=hunter2");
    expect(entries).toEqual([]);
  });
  it("does nothing when history is off", () => {
    settings.enabled = false;
    rec.record({ ...who, command: "ls" });
    rec.shellText(who, "ls");
    expect(entries).toEqual([]);
  });
  it("tracks each session separately", () => {
    rec.record({ ...who, sessionId: "a", command: "one" });
    rec.record({ ...who, sessionId: "b", command: "two" });
    rec.shellText({ ...who, sessionId: "a" }, "ONE");
    rec.shellText({ ...who, sessionId: "b" }, "TWO");
    expect(commands()).toEqual(["ONE", "TWO"]);
  });
  it("leaves the entry alone if it has aged out meanwhile", () => {
    rec.record({ ...who, command: "ls" });
    entries = [];
    rec.shellText(who, "ls -la");
    expect(entries).toEqual([]);
  });
});

describe("hidden lines (typed with a leading space)", () => {
  it("are not stored, and neither is the shell's report of them", () => {
    expect(rec.record({ ...who, command: "secret-thing", hidden: true })).toBe(false);
    rec.shellText(who, "secret-thing");
    expect(entries).toEqual([]);
  });
  it("don't hide the command after them", () => {
    rec.record({ ...who, command: "x", hidden: true });
    rec.shellText(who, "x");
    rec.record({ ...who, command: "ls" });
    rec.shellText(who, "ls");
    expect(commands()).toEqual(["ls"]);
  });
});

describe("retention", () => {
  const DAY = 86_400_000;
  it("drops entries past the limit when pruning", () => {
    entries = [
      { id: "1", ...who, command: "old", timestamp: clock - 40 * DAY },
      { id: "2", ...who, command: "new", timestamp: clock - 1 * DAY },
    ];
    settings.retentionDays = 30;
    rec.prune();
    expect(commands()).toEqual(["new"]);
  });
  it("applies on every new entry too", () => {
    entries = [{ id: "1", ...who, command: "old", timestamp: clock - 40 * DAY }];
    settings.retentionDays = 30;
    rec.record({ ...who, command: "fresh" });
    expect(commands()).toEqual(["fresh"]);
  });
});
