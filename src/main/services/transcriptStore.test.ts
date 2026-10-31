import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { open, seal } from "./masterKey";
import { createTranscriptStore, MAX_TRANSCRIPT_BYTES, type Sealing } from "./transcriptStore";
import type { TranscriptSettings } from "../../shared/transcripts";

let dir: string;
let settings: TranscriptSettings;
let sealing: Sealing;
let clock: number;
const key = Buffer.alloc(32, 9);

function make() {
  return createTranscriptStore({ dir: () => dir, settings: () => settings, sealing: () => sealing, now: () => clock });
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "wharf-transcripts-"));
  settings = { enabled: true, retentionDays: 30 };
  sealing = { mode: "none" };
  clock = 1_700_000_000_000;
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("recording", () => {
  it("is off by default settings: nothing is written", async () => {
    settings = { enabled: false, retentionDays: 30 };
    const t = make();
    t.begin("s1", { hostId: null, hostName: "Local" });
    t.feed("s1", "hello\r\n");
    expect(readdirSync(dir)).toEqual([]);
    expect(await t.list()).toEqual([]);
  });

  it("records cleaned lines with the host and times", async () => {
    const t = make();
    t.begin("s1", { hostId: "h1", hostName: "prod" });
    clock += 1000;
    t.feed("s1", "\x1b[32mhello\x1b[0m\r\nwor");
    t.feed("s1", "ld\r\n");
    t.end("s1");
    const content = await t.read("s1");
    expect(content?.info).toMatchObject({ id: "s1", hostId: "h1", hostName: "prod", active: false });
    expect(content?.lines.map((l) => l.text)).toEqual(["hello", "world"]);
    expect(content?.lines[0].t).toBe(clock);
  });

  it("keeps an unfinished last line when the session ends", async () => {
    const t = make();
    t.begin("s1", { hostId: null, hostName: "Local" });
    t.feed("s1", "done\r\nuser@host:~$ ");
    t.end("s1");
    expect((await t.read("s1"))?.lines.map((l) => l.text)).toEqual(["done", "user@host:~$"]);
  });

  it("lists sessions newest first and marks the open ones", async () => {
    const t = make();
    t.begin("old", { hostId: null, hostName: "A" });
    t.end("old");
    clock += 5000;
    t.begin("new", { hostId: null, hostName: "B" });
    const list = await t.list();
    expect(list.map((i) => [i.id, i.active])).toEqual([
      ["new", true],
      ["old", false],
    ]);
  });

  it("stops recording a session when the setting is switched off", async () => {
    const t = make();
    t.begin("s1", { hostId: null, hostName: "Local" });
    t.feed("s1", "before\r\n");
    settings = { ...settings, enabled: false };
    t.feed("s1", "after\r\n");
    expect(t.isActive("s1")).toBe(false);
    expect((await t.read("s1"))?.lines.map((l) => l.text)).toEqual(["before"]);
  });

  it("stops at the size cap with a note, and does not grow past it", async () => {
    const t = make();
    t.begin("s1", { hostId: null, hostName: "Local" });
    const line = "x".repeat(1000) + "\r\n";
    for (let i = 0; i < MAX_TRANSCRIPT_BYTES / 1000 + 50; i++) t.feed("s1", line);
    t.end("s1");
    const file = path.join(dir, readdirSync(dir)[0]);
    expect(statSync(file).size).toBeLessThan(MAX_TRANSCRIPT_BYTES + 4096);
    const lines = (await t.read("s1"))!.lines;
    expect(lines[lines.length - 1].text).toMatch(/size limit/);
  });

  // Windows has no POSIX permission bits to check (files there are protected by the profile's ACLs).
  it.skipIf(process.platform === "win32")("writes files owner-only", () => {
    const t = make();
    t.begin("s1", { hostId: null, hostName: "Local" });
    t.end("s1");
    expect(statSync(path.join(dir, readdirSync(dir)[0])).mode & 0o077).toBe(0);
  });
});

describe("search", () => {
  it("finds lines case-insensitively across sessions, newest first, with context", async () => {
    const t = make();
    t.begin("a", { hostId: null, hostName: "alpha" });
    t.feed("a", "l1\r\nl2\r\nERROR: disk full\r\nl4\r\nl5\r\nl6\r\n");
    t.end("a");
    clock += 1000;
    t.begin("b", { hostId: null, hostName: "beta" });
    t.feed("b", "an error occurred\r\n");
    t.end("b");
    const { matches, truncated } = await t.search("Error");
    expect(truncated).toBe(false);
    expect(matches.map((m) => [m.hostName, m.text])).toEqual([
      ["beta", "an error occurred"],
      ["alpha", "ERROR: disk full"],
    ]);
    expect(matches[1]).toMatchObject({ line: 2, before: ["l1", "l2"], after: ["l4", "l5"] });
  });

  it("returns nothing for an empty query and caps the number of matches", async () => {
    const t = make();
    t.begin("a", { hostId: null, hostName: "alpha" });
    t.feed("a", "hit\r\n".repeat(10));
    t.end("a");
    expect((await t.search("  ")).matches).toEqual([]);
    const capped = await t.search("hit", 4);
    expect(capped.matches).toHaveLength(4);
    expect(capped.truncated).toBe(true);
  });

  it("includes output still waiting to be flushed from an open session", async () => {
    const t = make();
    t.begin("a", { hostId: null, hostName: "alpha" });
    t.feed("a", "needle in progress\r\n");
    expect((await t.search("needle")).matches).toHaveLength(1);
  });
});

describe("removal and retention", () => {
  it("removes one transcript, or all", async () => {
    const t = make();
    t.begin("a", { hostId: null, hostName: "a" });
    clock += 1;
    t.begin("b", { hostId: null, hostName: "b" });
    await t.remove("a");
    expect((await t.list()).map((i) => i.id)).toEqual(["b"]);
    expect(t.isActive("a")).toBe(false);
    await t.clear();
    expect(await t.list()).toEqual([]);
  });

  it("refuses an id that isn't a plain id", async () => {
    const t = make();
    expect(await t.read("../../etc/passwd")).toBeNull();
    await t.remove("../x"); // no throw, nothing happens
  });

  it("prunes transcripts older than the retention, but never an open one", async () => {
    const t = make();
    t.begin("old", { hostId: null, hostName: "a" });
    t.end("old");
    clock += 1;
    t.begin("open", { hostId: null, hostName: "b" });
    const days = 40 * 24 * 3600;
    for (const name of readdirSync(dir)) utimesSync(path.join(dir, name), clock / 1000 - days, clock / 1000 - days);
    expect(await t.prune()).toBe(1);
    expect((await t.list()).map((i) => i.id)).toEqual(["open"]);
    settings = { ...settings, retentionDays: 0 };
    expect(await t.prune()).toBe(0);
  });
});

describe("with a master password", () => {
  it("seals every line: nothing readable on disk, but it reads back and searches while unlocked", async () => {
    sealing = { mode: "key", key };
    const t = make();
    t.begin("s1", { hostId: null, hostName: "secret-host" });
    t.feed("s1", "cat /etc/shadow\r\n");
    t.end("s1");
    const onDisk = readFileSync(path.join(dir, readdirSync(dir)[0]), "utf8");
    expect(onDisk).not.toContain("shadow");
    expect(onDisk).not.toContain("secret-host");
    expect((await t.search("shadow")).matches).toHaveLength(1);
  });

  it("is unreadable while locked, and not recorded", async () => {
    sealing = { mode: "key", key };
    const t = make();
    t.begin("s1", { hostId: null, hostName: "h" });
    t.feed("s1", "before lock\r\n");
    sealing = { mode: "locked" };
    t.feed("s1", "while locked\r\n");
    expect(await t.list()).toEqual([]);
    expect((await t.search("lock")).matches).toEqual([]);
    t.begin("s2", { hostId: null, hostName: "x" });
    expect(t.isActive("s2")).toBe(false);
    sealing = { mode: "key", key };
    t.end("s1");
    expect((await t.read("s1"))?.lines.map((l) => l.text)).toEqual(["before lock"]);
  });

  it("convertAll seals existing plain transcripts, and an open one keeps recording", async () => {
    const t = make();
    t.begin("s1", { hostId: null, hostName: "plain-host" });
    t.feed("s1", "first line\r\n");
    sealing = { mode: "key", key };
    t.convertAll((line) => (line.startsWith("mp:") ? line : seal(key, line)));
    t.feed("s1", "second line\r\n");
    t.end("s1");
    const onDisk = readFileSync(path.join(dir, readdirSync(dir)[0]), "utf8");
    expect(onDisk).not.toContain("first line");
    expect(onDisk).not.toContain("plain-host");
    expect((await t.read("s1"))?.lines.map((l) => l.text)).toEqual(["first line", "second line"]);

    // …and back to plain
    t.convertAll((line) => (line.startsWith("mp:") ? open(key, line) : line));
    sealing = { mode: "none" };
    expect(readFileSync(path.join(dir, readdirSync(dir)[0]), "utf8")).toContain("first line");
    expect((await t.read("s1"))?.lines).toHaveLength(2);
  });
});
