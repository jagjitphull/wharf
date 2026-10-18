import { beforeAll, describe, expect, it } from "vitest";
import { createConfig, deriveKey, kdf, keyFor, open, seal, SEALED_PREFIX } from "./masterKey";

beforeAll(() => {
  kdf.cost = 2 ** 10; // fast for tests; the real cost is a default, not a different code path
});

describe("seal / open", () => {
  const key = Buffer.alloc(32, 7);

  it("round-trips text, including non-ASCII", () => {
    for (const text of ["hunter2", "", "pässwörd 🔐", "x".repeat(10_000)]) {
      expect(open(key, seal(key, text))).toBe(text);
    }
  });

  it("marks sealed values and doesn't contain the plaintext", () => {
    const sealed = seal(key, "supersecret-value");
    expect(sealed.startsWith(SEALED_PREFIX)).toBe(true);
    expect(Buffer.from(sealed.slice(SEALED_PREFIX.length), "base64").toString("latin1")).not.toContain("supersecret");
  });

  it("uses a fresh nonce each time", () => {
    expect(seal(key, "same")).not.toBe(seal(key, "same"));
  });

  it("refuses the wrong key", () => {
    expect(() => open(Buffer.alloc(32, 8), seal(key, "x"))).toThrow();
  });

  it("refuses data that was altered", () => {
    const sealed = seal(key, "tamper with me");
    const raw = Buffer.from(sealed.slice(SEALED_PREFIX.length), "base64");
    raw[raw.length - 1] ^= 1;
    expect(() => open(key, SEALED_PREFIX + raw.toString("base64"))).toThrow();
  });

  it("refuses a value too short to be one", () => {
    expect(() => open(key, SEALED_PREFIX + "AAAA")).toThrow(/too short/);
  });
});

describe("keyFor", () => {
  it("returns the key for the right password and null for any other", () => {
    const { config, key } = createConfig("correct horse");
    expect(keyFor("correct horse", config)?.equals(key)).toBe(true);
    expect(keyFor("correct horsf", config)).toBeNull();
    expect(keyFor("", config)).toBeNull();
  });

  it("derives different keys from different salts", () => {
    const a = createConfig("same password");
    const b = createConfig("same password");
    expect(a.config.salt).not.toBe(b.config.salt);
    expect(a.key.equals(b.key)).toBe(false);
  });

  it("treats equivalent Unicode spellings of a password as the same", () => {
    const { config } = createConfig("café au lait"); // é as one character
    expect(keyFor("café au lait", config)).not.toBeNull(); // e + combining accent
  });

  it("is deterministic for a given password, salt and cost", () => {
    const { config, key } = createConfig("repeatable");
    expect(deriveKey("repeatable", config.salt, config.cost).equals(key)).toBe(true);
  });

  it("never stores the password or key in the config", () => {
    const { config, key } = createConfig("do not leak");
    const text = JSON.stringify(config);
    expect(text).not.toContain("do not leak");
    expect(text).not.toContain(key.toString("base64"));
  });
});
