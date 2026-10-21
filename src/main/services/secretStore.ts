import { safeStorage } from "electron";
import { randomUUID } from "node:crypto";
import log from "electron-log/main";
import { store } from "./store";
import type { MasterPasswordState } from "../../shared/types";
import { clearPlain, eraseSealed, resealAll, sealAll, unsealAll } from "./protectedData";
import { getUnlockedKey, setUnlockedKey } from "./unlockedKey";
import { createConfig, keyFor, MIN_PASSWORD_LENGTH, open, SEALED_PREFIX, seal } from "./masterKey";

/**
 * Stores host passwords / private-key passphrases encrypted at rest using
 * Electron's `safeStorage`, which delegates to the OS keychain (Keychain on
 * macOS, DPAPI on Windows, libsecret/kwallet on Linux). Only ciphertext ever
 * touches disk (inside the electron-store JSON file); plaintext only exists
 * transiently in the main process and in-flight over IPC when the user
 * enters or reveals a secret.
 */
const LOCKED_MESSAGE = "Saved passwords are locked. Unlock them with your master password in Settings, or when Wharf starts.";

export function masterPasswordState(): MasterPasswordState {
  if (!store.get("masterPassword")) return "none";
  return getUnlockedKey() ? "unlocked" : "locked";
}

export function saveSecret(plaintext: string): string {
  const id = randomUUID();
  const secrets = store.get("secrets");
  secrets[id] = encrypt(plaintext);
  store.set("secrets", secrets);
  return id;
}

export function updateSecret(id: string, plaintext: string): void {
  const secrets = store.get("secrets");
  secrets[id] = encrypt(plaintext);
  store.set("secrets", secrets);
}

export function readSecret(id: string | null | undefined): string | null {
  if (!id) return null;
  const secrets = store.get("secrets");
  const ciphertext = secrets[id];
  if (!ciphertext) return null;
  return decrypt(ciphertext);
}

export function deleteSecret(id: string | null | undefined): void {
  if (!id) return;
  const secrets = store.get("secrets");
  delete secrets[id];
  store.set("secrets", secrets);
}

/** Whether new secrets are encrypted with the OS keyring. False on a Linux
 * machine with no secret service running (see encrypt()). */
export function isEncryptionAvailable(): boolean {
  return safeStorage.isEncryptionAvailable();
}

/** How many saved secrets are stored only base64-encoded (the no-keyring fallback). */
export function countUnencryptedSecrets(): number {
  return Object.values(store.get("secrets")).filter((v) => v.startsWith("plain:")).length;
}

/**
 * Re-encrypts secrets that were saved in the no-keyring fallback format once
 * a keyring is available (the user installed or unlocked one since). Returns
 * how many it upgraded; does nothing while the keyring is still missing. An
 * entry that can't be read is left exactly as it was.
 */
export function upgradeUnencryptedSecrets(): number {
  // With a master password every entry is already sealed with it.
  if (store.get("masterPassword") || !safeStorage.isEncryptionAvailable()) return 0;
  const secrets = { ...store.get("secrets") };
  let upgraded = 0;
  for (const [id, stored] of Object.entries(secrets)) {
    if (!stored.startsWith("plain:")) continue;
    try {
      secrets[id] = encrypt(decrypt(stored));
      upgraded++;
    } catch (err) {
      log.error(`Couldn't upgrade secret ${id} to encrypted storage:`, err);
    }
  }
  if (upgraded > 0) store.set("secrets", secrets);
  return upgraded;
}

function encrypt(plaintext: string): string {
  if (store.get("masterPassword")) {
    const key = getUnlockedKey();
    if (!key) throw new Error(LOCKED_MESSAGE);
    return seal(key, plaintext);
  }
  if (!safeStorage.isEncryptionAvailable()) {
    // Fall back to storing base64 rather than plaintext so the format stays
    // consistent; this path only hits on Linux systems with no secret
    // service available and is clearly weaker — surfaced in the README.
    return `plain:${Buffer.from(plaintext, "utf8").toString("base64")}`;
  }
  return `enc:${safeStorage.encryptString(plaintext).toString("base64")}`;
}

function decrypt(stored: string): string {
  if (stored.startsWith(SEALED_PREFIX)) {
    const key = getUnlockedKey();
    if (!key) throw new Error(LOCKED_MESSAGE);
    return open(key, stored);
  }
  if (stored.startsWith("plain:")) {
    return Buffer.from(stored.slice("plain:".length), "base64").toString("utf8");
  }
  if (stored.startsWith("enc:")) {
    const buf = Buffer.from(stored.slice("enc:".length), "base64");
    try {
      return safeStorage.decryptString(buf);
    } catch (err) {
      // safeStorage.decryptString throws a raw, OS-internal message (e.g.
      // "Decryption is not available") that's meaningless to a user — this
      // happens for real when the OS keychain entry it was encrypted under
      // is gone (a different machine/user account, or the Linux secret
      // service got reset), not just on literal data corruption. Surface
      // something they can actually act on instead, and keep the original
      // for diagnosis in the log file.
      log.error("Failed to decrypt a stored secret:", err);
      throw new Error(
        "Couldn't decrypt the saved password/passphrase (the OS keychain entry is missing or unreadable) — re-enter it by editing the host.",
      );
    }
  }
  // Legacy/unexpected format.
  return "";
}

// ---------------------------------------------------------------------------
// Master password
// ---------------------------------------------------------------------------

function requireValidPassword(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`The master password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
}

/** Every stored secret re-encoded by `convert`; entries it can't read (their
 * keyring entry is gone) are carried over untouched rather than lost. */
function reencryptAll(read: (stored: string) => string, write: (plaintext: string) => string): Record<string, string> {
  const next: Record<string, string> = {};
  for (const [id, stored] of Object.entries(store.get("secrets"))) {
    try {
      next[id] = write(read(stored));
    } catch (err) {
      log.warn(`Leaving secret ${id} as it was while changing the master password:`, err);
      next[id] = stored;
    }
  }
  return next;
}

function requireConfig() {
  const config = store.get("masterPassword");
  if (!config) throw new Error("No master password is set.");
  return config;
}

function checkedKey(password: string): Buffer {
  const key = keyFor(password, requireConfig());
  if (!key) throw new Error("Wrong master password.");
  return key;
}

/** Turns the master password on: every saved secret is re-encrypted under it, and Wharf is unlocked for this run. */
export function enableMasterPassword(password: string): void {
  if (store.get("masterPassword")) throw new Error("A master password is already set. Change or remove it instead.");
  requireValidPassword(password);
  const { config, key } = createConfig(password);
  const secrets = reencryptAll(decrypt, (plaintext) => seal(key, plaintext));
  sealAll(key);
  store.set("secrets", secrets);
  store.set("masterPassword", config);
  clearPlain();
  setUnlockedKey(key);
}

/** Checks the password and unlocks saved secrets for this run. Throws "Wrong master password." otherwise. */
export function unlock(password: string): void {
  setUnlockedKey(checkedKey(password));
}

/** Forgets the key; saved secrets stay unreadable until unlock(). */
export function lock(): void {
  setUnlockedKey(null);
}

export function changeMasterPassword(current: string, next: string): void {
  const oldKey = checkedKey(current);
  requireValidPassword(next);
  const { config, key } = createConfig(next);
  const secrets = reencryptAll(
    (stored) => (stored.startsWith(SEALED_PREFIX) ? open(oldKey, stored) : decrypt(stored)),
    (plaintext) => seal(key, plaintext),
  );
  resealAll(oldKey, key);
  store.set("secrets", secrets);
  store.set("masterPassword", config);
  setUnlockedKey(key);
}

/** Turns the master password off, returning secrets to keyring storage (or, on a machine without one, the base64 fallback). */
export function removeMasterPassword(password: string): void {
  const key = checkedKey(password);
  const secrets = reencryptAll(
    (stored) => (stored.startsWith(SEALED_PREFIX) ? open(key, stored) : decrypt(stored)),
    (plaintext) =>
      safeStorage.isEncryptionAvailable()
        ? `enc:${safeStorage.encryptString(plaintext).toString("base64")}`
        : `plain:${Buffer.from(plaintext, "utf8").toString("base64")}`,
  );
  unsealAll(key);
  store.set("secrets", secrets);
  store.set("masterPassword", null);
  eraseSealed();
  setUnlockedKey(null);
}

/** The way out when the password is forgotten: erases every saved secret, the master password, and the History, workspaces and last session that were sealed with it. Hosts and their settings stay; passwords must be entered again. */
export function resetSecrets(): void {
  store.set("secrets", {});
  store.set("masterPassword", null);
  eraseSealed();
  setUnlockedKey(null);
}
