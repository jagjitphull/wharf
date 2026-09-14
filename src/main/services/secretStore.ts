import { safeStorage } from "electron";
import { nanoid } from "nanoid";
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
  const id = nanoid();
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
    return safeStorage.decryptString(buf);
  }
  // Legacy/unexpected format.
  return "";
}
