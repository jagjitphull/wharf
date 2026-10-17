import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chmodSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { restrictToOwner } from "./dataFilePermissions";

// File modes mean nothing on Windows.
const posix = process.platform !== "win32";
const mode = (p: string) => statSync(p).mode & 0o777;

let dir: string;
let file: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "wharf-perms-"));
  file = path.join(dir, "wharf-data.json");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe.skipIf(!posix)("restrictToOwner", () => {
  it("tightens a world-readable, world-writable data file and its directory", () => {
    writeFileSync(file, "{}");
    chmodSync(file, 0o666);
    chmodSync(dir, 0o755);
    const changed = restrictToOwner(dir, file);
    expect(mode(file)).toBe(0o600);
    expect(mode(dir)).toBe(0o700);
    expect(changed.sort()).toEqual([dir, file].sort());
  });

  it("tightens a file that is merely group-readable too", () => {
    writeFileSync(file, "{}");
    chmodSync(file, 0o640);
    restrictToOwner(dir, file);
    expect(mode(file)).toBe(0o600);
  });

  it("changes nothing, and reports nothing, when the modes are already right", () => {
    writeFileSync(file, "{}");
    chmodSync(file, 0o600);
    chmodSync(dir, 0o700);
    expect(restrictToOwner(dir, file)).toEqual([]);
  });

  it("leaves a file that doesn't exist yet alone (a first launch)", () => {
    chmodSync(dir, 0o755);
    expect(restrictToOwner(dir, file)).toEqual([dir]);
    expect(mode(dir)).toBe(0o700);
  });

  it("doesn't throw for a path that doesn't exist at all", () => {
    expect(() => restrictToOwner(path.join(dir, "nope"), path.join(dir, "nope", "x.json"))).not.toThrow();
  });
});
