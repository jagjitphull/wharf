import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

/**
 * The cryptography behind the optional master password, kept free of Electron
 * and the store so it can be tested on its own.
 *
 * A key is derived from the password with scrypt (a salted, memory-hard KDF,
 * so guessing from a stolen data file is slow) and used with AES-256-GCM,
 * which also detects a wrong key or tampered data. Nothing here remembers
 * the password or the key; secretStore.ts holds the key while unlocked.
 */

export interface MasterPasswordConfig {
  /** Base64 scrypt salt; random per password. */
  salt: string;
  /** scrypt cost (N) the key was derived with, so it can be raised later without breaking older files. */
  cost: number;
  /** A known string sealed with the key: opening it is how a typed password is checked. */
  check: string;
}

export const SEALED_PREFIX = "mp:";
const CHECK_TEXT = "wharf master password check";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** Tests lower this; the default is OWASP's current scrypt recommendation (N=2^17, r=8, p=1, ~128 MiB, a few tenths of a second). */
export const kdf = { cost: 2 ** 17 };

export const MIN_PASSWORD_LENGTH = 8;

export function deriveKey(password: string, saltBase64: string, cost: number): Buffer {
  return scryptSync(password.normalize("NFKC"), Buffer.from(saltBase64, "base64"), KEY_BYTES, {
    N: cost,
    r: 8,
    p: 1,
    maxmem: 256 * 1024 * 1024,
  });
}

export function seal(key: Buffer, plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return SEALED_PREFIX + Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64");
}

/** Throws if the key is wrong or the data was altered. */
export function open(key: Buffer, sealed: string): string {
  const raw = Buffer.from(sealed.slice(SEALED_PREFIX.length), "base64");
  if (raw.length < IV_BYTES + TAG_BYTES) throw new Error("Sealed value is too short");
  const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, IV_BYTES));
  decipher.setAuthTag(raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
  return Buffer.concat([decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]).toString("utf8");
}

/** A fresh config (new salt) for `password`, plus the key it derives. */
export function createConfig(password: string): { config: MasterPasswordConfig; key: Buffer } {
  const salt = randomBytes(16).toString("base64");
  const cost = kdf.cost;
  const key = deriveKey(password, salt, cost);
  return { config: { salt, cost, check: seal(key, CHECK_TEXT) }, key };
}

/** The key for `password` if it is the right one, otherwise null. */
export function keyFor(password: string, config: MasterPasswordConfig): Buffer | null {
  const key = deriveKey(password, config.salt, config.cost);
  try {
    return open(key, config.check) === CHECK_TEXT ? key : null;
  } catch {
    return null;
  }
}
