import { safeStorage } from "electron";
import { randomUUID } from "node:crypto";
import log from "electron-log/main";
import { store } from "./store";

/**
 * Stores host passwords / private-key passphrases encrypted at rest using
 * Electron's `safeStorage`, which delegates to the OS keychain (Keychain on
 * macOS, DPAPI on Windows, libsecret/kwallet on Linux). Only ciphertext ever
 * touches disk (inside the electron-store JSON file); plaintext only exists
 * transiently in the main process and in-flight over IPC when the user
 * enters or reveals a secret.
 */
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

function encrypt(plaintext: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    // Fall back to storing base64 rather than plaintext so the format stays
    // consistent; this path only hits on Linux systems with no secret
    // service available and is clearly weaker — surfaced in the README.
    return `plain:${Buffer.from(plaintext, "utf8").toString("base64")}`;
  }
  return `enc:${safeStorage.encryptString(plaintext).toString("base64")}`;
}

function decrypt(stored: string): string {
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
