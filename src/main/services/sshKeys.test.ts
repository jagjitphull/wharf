import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import ssh2 from "ssh2";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createKeyManager, fingerprintOf } from "./sshKeys";

const { utils } = ssh2;
let dir: string;
const mgr = () => createKeyManager(() => dir);

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "wharf-keys-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("generate", () => {
  it("makes an ed25519 pair with the right permissions and a readable public half", () => {
    const info = mgr().generate({ name: "id_test", type: "ed25519", comment: "me@laptop" });
    expect(info).toMatchObject({
      name: "id_test",
      type: "ssh-ed25519",
      bits: 256,
      comment: "me@laptop",
      encrypted: false,
      hasPublicFile: true,
    });
    expect(info.fingerprint).toMatch(/^SHA256:[A-Za-z0-9+/]{43}$/);
    expect(statSync(path.join(dir, "id_test")).mode & 0o777).toBe(0o600);
    expect(statSync(path.join(dir, "id_test.pub")).mode & 0o777).toBe(0o644);
    expect(readFileSync(path.join(dir, "id_test"), "utf8")).toMatch(/^-----BEGIN OPENSSH PRIVATE KEY-----/);
    expect(readFileSync(path.join(dir, "id_test.pub"), "utf8")).toMatch(/^ssh-ed25519 \S+ me@laptop\n$/);
  });

  it("makes RSA and ECDSA keys of the sizes asked for", () => {
    expect(mgr().generate({ name: "rsa2048", type: "rsa", bits: 2048 })).toMatchObject({ type: "ssh-rsa", bits: 2048 });
    expect(mgr().generate({ name: "ec384", type: "ecdsa", bits: 384 })).toMatchObject({ type: "ecdsa-sha2-nistp384", bits: 384 });
  });

  it("protects the private key with a passphrase when one is given, and still reads the public half from the .pub", () => {
    const info = mgr().generate({ name: "locked", type: "ed25519", passphrase: "correct horse" });
    expect(info.encrypted).toBe(true);
    expect(info.type).toBe("ssh-ed25519");
    expect(info.fingerprint).toMatch(/^SHA256:/);
    const pem = readFileSync(path.join(dir, "locked"), "utf8");
    expect(utils.parseKey(pem)).toBeInstanceOf(Error); // can't be used without it
    expect(utils.parseKey(pem, "correct horse")).not.toBeInstanceOf(Error);
    expect(utils.parseKey(pem, "wrong passphrase")).toBeInstanceOf(Error);
  });

  it("never overwrites an existing key or .pub", () => {
    writeFileSync(path.join(dir, "taken"), "precious");
    expect(() => mgr().generate({ name: "taken", type: "ed25519" })).toThrow(/already exists/);
    expect(readFileSync(path.join(dir, "taken"), "utf8")).toBe("precious");
    writeFileSync(path.join(dir, "half.pub"), "precious pub");
    expect(() => mgr().generate({ name: "half", type: "ed25519" })).toThrow(/already exists/);
    expect(existsSync(path.join(dir, "half"))).toBe(false);
  });

  it("rejects bad requests before touching the disk", () => {
    expect(() => mgr().generate({ name: "../escape", type: "ed25519" })).toThrow();
    expect(() => mgr().generate({ name: "k", type: "rsa", bits: 512 })).toThrow(/RSA/);
    expect(() => mgr().generate({ name: "k", type: "ed25519", passphrase: "abc" })).toThrow(/passphrase/);
    expect(existsSync(path.join(tmpdir(), "escape"))).toBe(false);
  });

  it("creates the key folder (owner-only) when it doesn't exist yet", () => {
    const fresh = path.join(dir, "nested", ".ssh");
    createKeyManager(() => fresh).generate({ name: "k", type: "ed25519" });
    expect(statSync(fresh).mode & 0o777).toBe(0o700);
  });
});

describe("list", () => {
  it("finds private keys, ignoring config, known_hosts, authorized_keys, .pub files and other files", () => {
    mgr().generate({ name: "id_a", type: "ed25519" });
    writeFileSync(path.join(dir, "config"), "Host x\n");
    writeFileSync(path.join(dir, "known_hosts"), "x ssh-ed25519 AAAA\n");
    writeFileSync(path.join(dir, "authorized_keys"), "ssh-ed25519 AAAA\n");
    writeFileSync(path.join(dir, "notes.txt"), "hello");
    writeFileSync(path.join(dir, "fake"), "-----BEGIN RSA PRIVATE KEY-----\ngarbage\n-----END RSA PRIVATE KEY-----\n");
    mkdirSync(path.join(dir, "subdir"));
    writeFileSync(path.join(dir, "big"), "-----BEGIN OPENSSH PRIVATE KEY-----\n" + "x".repeat(70_000));
    expect(
      mgr()
        .list()
        .map((k) => k.name),
    ).toEqual(["id_a"]);
  });

  it("derives the public half from an unprotected key that has no .pub", () => {
    mgr().generate({ name: "lonely", type: "ed25519", comment: "c" });
    const pubLine = readFileSync(path.join(dir, "lonely.pub"), "utf8").trim();
    rmSync(path.join(dir, "lonely.pub"));
    const [k] = mgr().list();
    expect(k).toMatchObject({ hasPublicFile: false, type: "ssh-ed25519", comment: "c" });
    expect(mgr().publicKey("lonely")).toBe(pubLine);
  });

  it("lists a protected key without its .pub as encrypted, with nothing else known", () => {
    mgr().generate({ name: "sealed", type: "ed25519", passphrase: "correct horse" });
    rmSync(path.join(dir, "sealed.pub"));
    const [k] = mgr().list();
    expect(k).toMatchObject({ encrypted: true, type: null, fingerprint: null, hasPublicFile: false });
    expect(mgr().publicKey("sealed")).toBeNull();
  });

  it("says which hosts use a key", () => {
    mgr().generate({ name: "shared", type: "ed25519" });
    const k = mgr().list([
      { name: "web", privateKeyPath: path.join(dir, "shared") },
      { name: "db", privateKeyPath: path.join(dir, "other") },
      { name: "agent" },
    ]);
    expect(k[0].usedBy).toEqual(["web"]);
  });

  it("is empty when the folder doesn't exist", () => {
    expect(createKeyManager(() => path.join(dir, "nope")).list()).toEqual([]);
  });
});

describe("fingerprints", () => {
  it("match what ssh-keygen prints (SHA256 of the key blob, base64, unpadded)", () => {
    const pair = utils.generateKeyPairSync("ed25519");
    const parsed = utils.parseKey(pair.public) as ReturnType<typeof utils.parseKey> & { getPublicSSH(): Buffer };
    const blob = (parsed as unknown as { getPublicSSH(): Buffer }).getPublicSSH();
    const expected =
      "SHA256:" +
      createHash("sha256")
        .update(Buffer.from(pair.public.split(" ")[1], "base64"))
        .digest("base64")
        .replace(/=/g, "");
    expect(fingerprintOf(blob)).toBe(expected);
  });
});

describe("publicKey and remove", () => {
  it("returns the line from the .pub", () => {
    mgr().generate({ name: "k", type: "ed25519", comment: "x" });
    expect(mgr().publicKey("k")).toBe(readFileSync(path.join(dir, "k.pub"), "utf8").trim());
    expect(mgr().publicKey("../k")).toBeNull();
    expect(mgr().publicKey("missing")).toBeNull();
  });

  it("deletes both halves, and only keys", () => {
    mgr().generate({ name: "gone", type: "ed25519" });
    mgr().remove("gone");
    expect(existsSync(path.join(dir, "gone"))).toBe(false);
    expect(existsSync(path.join(dir, "gone.pub"))).toBe(false);
    writeFileSync(path.join(dir, "notes"), "not a key");
    chmodSync(path.join(dir, "notes"), 0o600);
    expect(() => mgr().remove("notes")).toThrow(/isn't a key/);
    expect(() => mgr().remove("../notes")).toThrow();
    expect(existsSync(path.join(dir, "notes"))).toBe(true);
  });
});
