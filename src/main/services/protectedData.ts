import log from "electron-log/main";
import { open, seal } from "./masterKey";
import { store } from "./store";
import { getUnlockedKey } from "./unlockedKey";
import type { CommandHistoryEntry, WorkspaceRecord, WorkspaceTab } from "../../shared/types";

/**
 * The parts of the data file that say what you ran and where you connected —
 * Command History, saved workspaces and the last session's tabs (with their
 * scrollback) — follow the master password: with one set they are kept sealed
 * with its key instead of as plain JSON, and unreadable (empty) while locked.
 *
 * Reads give an empty value and writes are dropped while locked, never the
 * other way round, so nothing sealed is ever overwritten by an empty list.
 */
export interface ProtectedShape {
  commandHistory: CommandHistoryEntry[];
  workspaces: WorkspaceRecord[];
  lastSessionTabs: WorkspaceTab[];
}

export type ProtectedKey = keyof ProtectedShape;

export const PROTECTED_KEYS: readonly ProtectedKey[] = ["commandHistory", "workspaces", "lastSessionTabs"];

function sealedData() {
  return store.get("sealedData");
}

export function readProtected<K extends ProtectedKey>(name: K): ProtectedShape[K] {
  if (!store.get("masterPassword")) return store.get(name);
  const key = getUnlockedKey();
  const sealed = sealedData()[name];
  if (!key || !sealed) return [] as ProtectedShape[K];
  try {
    return JSON.parse(open(key, sealed)) as ProtectedShape[K];
  } catch (err) {
    log.error(`Couldn't read protected data "${name}":`, err);
    return [] as ProtectedShape[K];
  }
}

/** Stores `value`; false when it couldn't be (the master password is locked), in which case nothing changed. */
export function writeProtected<K extends ProtectedKey>(name: K, value: ProtectedShape[K]): boolean {
  if (!store.get("masterPassword")) {
    store.set(name, value);
    return true;
  }
  const key = getUnlockedKey();
  if (!key) return false;
  store.set("sealedData", { ...sealedData(), [name]: seal(key, JSON.stringify(value)) });
  return true;
}

/** Turning the master password on: seals what is stored in plain. Call before the config is saved; then clearPlain(). */
export function sealAll(key: Buffer): void {
  const next = { ...sealedData() };
  for (const name of PROTECTED_KEYS) next[name] = seal(key, JSON.stringify(store.get(name)));
  store.set("sealedData", next);
}

/** The plain copies, emptied once the sealed ones are in place. */
export function clearPlain(): void {
  for (const name of PROTECTED_KEYS) store.set(name, []);
}

/** Changing the password: re-sealed under the new key. Anything unreadable is left as it was. */
export function resealAll(oldKey: Buffer, newKey: Buffer): void {
  const next = { ...sealedData() };
  for (const name of PROTECTED_KEYS) {
    const sealed = next[name];
    if (!sealed) continue;
    try {
      next[name] = seal(newKey, open(oldKey, sealed));
    } catch (err) {
      log.warn(`Leaving protected data "${name}" as it was while changing the master password:`, err);
    }
  }
  store.set("sealedData", next);
}

/** Turning the master password off: back to plain. Call before the config is cleared; then eraseSealed(). */
export function unsealAll(key: Buffer): void {
  const sealed = sealedData();
  for (const name of PROTECTED_KEYS) {
    const value = sealed[name];
    if (!value) continue;
    try {
      store.set(name, JSON.parse(open(key, value)));
    } catch (err) {
      log.error(`Couldn't restore protected data "${name}" while removing the master password:`, err);
    }
  }
}

/** Drops every sealed copy — after unsealAll(), or when the password was forgotten and they can't be read again. */
export function eraseSealed(): void {
  store.set("sealedData", {});
}
