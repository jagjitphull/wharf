import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { moveAsideIfCorrupt } from "./dataFileRecovery";

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "wharf-recovery-test-"));
  file = path.join(dir, "wharf-data.json");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("moveAsideIfCorrupt", () => {
  it("does nothing when the file doesn't exist yet (first launch)", () => {
    expect(moveAsideIfCorrupt(file)).toBeNull();
    expect(readdirSync(dir)).toEqual([]);
  });

  it("leaves a valid data file completely untouched", () => {
    const contents = JSON.stringify({ hosts: [{ id: "a" }], windowBounds: null }, null, "\t");
    writeFileSync(file, contents);
    expect(moveAsideIfCorrupt(file)).toBeNull();
    expect(readFileSync(file, "utf8")).toBe(contents);
    expect(readdirSync(dir)).toEqual(["wharf-data.json"]);
  });

  it("moves a syntactically broken file aside, byte-for-byte, and reports the backup path", () => {
    const broken = '{ "hosts": [ invalid json here';
    writeFileSync(file, broken);
    const backup = moveAsideIfCorrupt(file, () => 1234567890);
    expect(backup).toBe(`${file}.corrupted-1234567890`);
    expect(existsSync(file)).toBe(false);
    expect(readFileSync(backup!, "utf8")).toBe(broken);
  });

  it("treats a truncated file (the usual crash-mid-write result) as corrupt", () => {
    const full = JSON.stringify({ hosts: [{ id: "a", name: "prod" }], secrets: { x: "enc:abc" } });
    writeFileSync(file, full.slice(0, full.length - 10));
    const backup = moveAsideIfCorrupt(file);
    expect(backup).not.toBeNull();
    expect(existsSync(file)).toBe(false);
  });

  it("treats an empty file as corrupt (the store constructor would throw on it too)", () => {
    writeFileSync(file, "");
    expect(moveAsideIfCorrupt(file)).not.toBeNull();
    expect(existsSync(file)).toBe(false);
  });

  it("uses the clock for the backup name, so repeated recoveries never overwrite an earlier backup", () => {
    writeFileSync(file, "{ nope");
    const first = moveAsideIfCorrupt(file, () => 1);
    writeFileSync(file, "{ also nope");
    const second = moveAsideIfCorrupt(file, () => 2);
    expect(first).not.toBe(second);
    expect(readFileSync(first!, "utf8")).toBe("{ nope");
    expect(readFileSync(second!, "utf8")).toBe("{ also nope");
  });

  it("moves aside something unreadable as a file (a directory in its place) instead of throwing", () => {
    mkdirSync(file);
    const backup = moveAsideIfCorrupt(file);
    expect(backup).not.toBeNull();
    expect(existsSync(file)).toBe(false);
  });

  it("leaves the store free to start fresh afterwards: the original path no longer exists", () => {
    writeFileSync(file, "garbage");
    moveAsideIfCorrupt(file);
    expect(existsSync(file)).toBe(false);
    // …so a second call is a clean no-op, not another backup.
    expect(moveAsideIfCorrupt(file)).toBeNull();
    expect(readdirSync(dir)).toHaveLength(1);
  });
});
