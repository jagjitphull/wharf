import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createHmac, randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";

// knownHosts.ts resolves ~/.ssh/known_hosts from os.homedir() once, at
// module-load time — os.homedir() reads $HOME on POSIX, so pointing HOME at
// a fresh temp directory before each dynamic import (with resetModules() to
// bypass Node's module cache) sandboxes every test from the real file at
// ~/.ssh/known_hosts without touching the module's source at all.
let tmpHome: string;
let sshDir: string;
let knownHostsPath: string;
let mod: typeof import("./knownHosts");

function keyBlob(type: string, marker: string): Buffer {
  // A real SSH wire-format key blob is `uint32 len + type string + ...key
  // material`; checkHostKey only reads the type string back out and
  // otherwise compares blobs byte-for-byte, so a distinct trailing marker
  // is all that's needed to make two "keys" of the same type distinct.
  const typeBuf = Buffer.from(type, "ascii");
  const header = Buffer.alloc(4);
  header.writeUInt32BE(typeBuf.length, 0);
  return Buffer.concat([header, typeBuf, Buffer.from(marker, "ascii")]);
}

function hashedField(label: string, salt: Buffer): string {
  const hash = createHmac("sha1", salt).update(label).digest();
  return `|1|${salt.toString("base64")}|${hash.toString("base64")}`;
}

function writeKnownHosts(lines: string[]): void {
  writeFileSync(knownHostsPath, lines.join("\n") + "\n");
}

beforeEach(async () => {
  tmpHome = mkdtempSync(path.join(tmpdir(), "wharf-knownhosts-test-"));
  sshDir = path.join(tmpHome, ".ssh");
  mkdirSync(sshDir, { recursive: true });
  knownHostsPath = path.join(sshDir, "known_hosts");
  vi.stubEnv("HOME", tmpHome);
  vi.resetModules();
  mod = await import("./knownHosts");
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(tmpHome, { recursive: true, force: true });
});

describe("checkHostKey", () => {
  it("reports a brand-new host (no known_hosts file at all) as new", () => {
    const key = keyBlob("ssh-ed25519", "a");
    expect(mod.checkHostKey("example.com", 22, key)).toBe("new");
  });

  it("reports an exact plain-text match", () => {
    const key = keyBlob("ssh-ed25519", "a");
    writeKnownHosts([`example.com ssh-ed25519 ${key.toString("base64")}`]);
    expect(mod.checkHostKey("example.com", 22, key)).toBe("match");
  });

  it("reports a mismatch when the host is known but offers a different key", () => {
    const trusted = keyBlob("ssh-ed25519", "a");
    const impostor = keyBlob("ssh-ed25519", "b");
    writeKnownHosts([`example.com ssh-ed25519 ${trusted.toString("base64")}`]);
    expect(mod.checkHostKey("example.com", 22, impostor)).toBe("mismatch");
  });

  it("matches a HashKnownHosts-hashed entry", () => {
    const key = keyBlob("ssh-ed25519", "a");
    const salt = randomBytes(20);
    writeKnownHosts([`${hashedField("example.com", salt)} ssh-ed25519 ${key.toString("base64")}`]);
    expect(mod.checkHostKey("example.com", 22, key)).toBe("match");
  });

  it("reports a mismatch against a hashed entry for the same host with a different key", () => {
    const trusted = keyBlob("ssh-ed25519", "a");
    const impostor = keyBlob("ssh-ed25519", "b");
    const salt = randomBytes(20);
    writeKnownHosts([`${hashedField("example.com", salt)} ssh-ed25519 ${trusted.toString("base64")}`]);
    expect(mod.checkHostKey("example.com", 22, impostor)).toBe("mismatch");
  });

  it("keeps different key types for the same host independent (a trusted RSA key says nothing about Ed25519)", () => {
    const rsaKey = keyBlob("ssh-rsa", "a");
    const ed25519Key = keyBlob("ssh-ed25519", "a");
    writeKnownHosts([`example.com ssh-rsa ${rsaKey.toString("base64")}`]);
    expect(mod.checkHostKey("example.com", 22, ed25519Key)).toBe("new");
  });

  it("uses the [host]:port label for a non-default port, distinct from the bare host on port 22", () => {
    const key = keyBlob("ssh-ed25519", "a");
    writeKnownHosts([`example.com ssh-ed25519 ${key.toString("base64")}`]);
    expect(mod.checkHostKey("example.com", 2222, key)).toBe("new");
    writeKnownHosts([`[example.com]:2222 ssh-ed25519 ${key.toString("base64")}`]);
    expect(mod.checkHostKey("example.com", 2222, key)).toBe("match");
    expect(mod.checkHostKey("example.com", 22, key)).toBe("new");
  });

  it("matches a glob host pattern", () => {
    const key = keyBlob("ssh-ed25519", "a");
    writeKnownHosts([`*.example.com ssh-ed25519 ${key.toString("base64")}`]);
    expect(mod.checkHostKey("host.example.com", 22, key)).toBe("match");
  });

  it("honors ! negation even when a broader pattern on the same line would otherwise match", () => {
    const key = keyBlob("ssh-ed25519", "a");
    writeKnownHosts([`!bad.example.com,*.example.com ssh-ed25519 ${key.toString("base64")}`]);
    expect(mod.checkHostKey("bad.example.com", 22, key)).toBe("new");
    expect(mod.checkHostKey("good.example.com", 22, key)).toBe("match");
  });

  it("refuses a key marked @revoked even though it otherwise matches", () => {
    const key = keyBlob("ssh-ed25519", "a");
    writeKnownHosts([`@revoked example.com ssh-ed25519 ${key.toString("base64")}`]);
    expect(mod.checkHostKey("example.com", 22, key)).toBe("revoked");
  });

  it("treats a key as revoked even if a separate line also trusts the exact same key", () => {
    const key = keyBlob("ssh-ed25519", "a");
    writeKnownHosts([`example.com ssh-ed25519 ${key.toString("base64")}`, `@revoked example.com ssh-ed25519 ${key.toString("base64")}`]);
    expect(mod.checkHostKey("example.com", 22, key)).toBe("revoked");
  });
});

describe("trustHostKey", () => {
  it("appends a new entry that a later checkHostKey call then matches", () => {
    const key = keyBlob("ssh-ed25519", "a");
    expect(mod.checkHostKey("example.com", 22, key)).toBe("new");
    mod.trustHostKey("example.com", 22, key);
    expect(mod.checkHostKey("example.com", 22, key)).toBe("match");
  });

  it("creates ~/.ssh if it doesn't exist yet", () => {
    rmSync(sshDir, { recursive: true, force: true });
    const key = keyBlob("ssh-ed25519", "a");
    expect(() => mod.trustHostKey("example.com", 22, key)).not.toThrow();
    expect(mod.checkHostKey("example.com", 22, key)).toBe("match");
  });
});

describe("fingerprintSha256", () => {
  it("formats as SHA256:<base64, no padding> and is stable for the same key", () => {
    const key = keyBlob("ssh-ed25519", "a");
    const fp = mod.fingerprintSha256(key);
    expect(fp).toMatch(/^SHA256:[A-Za-z0-9+/]+$/);
    expect(fp).not.toContain("=");
    expect(mod.fingerprintSha256(key)).toBe(fp);
  });

  it("differs for different keys", () => {
    const a = mod.fingerprintSha256(keyBlob("ssh-ed25519", "a"));
    const b = mod.fingerprintSha256(keyBlob("ssh-ed25519", "b"));
    expect(a).not.toBe(b);
  });
});
