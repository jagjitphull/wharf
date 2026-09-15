import Store from "electron-store";
import type { CommandHistoryEntry, GroupRecord, HostRecord, SnippetRecord, TunnelRecord } from "../../shared/types";

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Schema {
  hosts: HostRecord[];
  groups: GroupRecord[];
  tunnels: TunnelRecord[];
  snippets: SnippetRecord[];
  commandHistory: CommandHistoryEntry[];
  /** secretId -> base64-encoded ciphertext produced by Electron's safeStorage. */
  secrets: Record<string, string>;
  windowBounds: WindowBounds | null;
}

const defaults: Schema = {
  hosts: [],
  groups: [],
  tunnels: [],
  snippets: [],
  commandHistory: [],
  secrets: {},
  windowBounds: null,
};

/**
 * Single persisted JSON store (via electron-store, which writes to the OS
 * user-data directory) for everything that isn't a raw secret. Deliberately
 * avoids a native-module database (e.g. sqlite) to keep the starter easy to
 * build/package across platforms; swap for a real DB if data volume grows.
 */
export const store = new Store<Schema>({
  name: "wharf-data",
  defaults,
});

export function getHosts(): HostRecord[] {
  return store.get("hosts");
}

export function setHosts(hosts: HostRecord[]): void {
  store.set("hosts", hosts);
}

export function getGroups(): GroupRecord[] {
  return store.get("groups");
}

export function setGroups(groups: GroupRecord[]): void {
  store.set("groups", groups);
}

export function getTunnels(): TunnelRecord[] {
  return store.get("tunnels");
}

export function setTunnels(tunnels: TunnelRecord[]): void {
  store.set("tunnels", tunnels);
}

export function getSnippets(): SnippetRecord[] {
  return store.get("snippets");
}

export function setSnippets(snippets: SnippetRecord[]): void {
  store.set("snippets", snippets);
}

// Caps the persisted log so a long-lived install doesn't grow this file
// unboundedly — oldest entries are dropped first (FIFO) once past the cap.
const COMMAND_HISTORY_MAX = 2000;

export function getCommandHistory(): CommandHistoryEntry[] {
  return store.get("commandHistory");
}

export function addCommandHistoryEntry(entry: CommandHistoryEntry): void {
  const next = [...store.get("commandHistory"), entry];
  if (next.length > COMMAND_HISTORY_MAX) next.splice(0, next.length - COMMAND_HISTORY_MAX);
  store.set("commandHistory", next);
}

export function clearCommandHistory(): void {
  store.set("commandHistory", []);
}

export function getWindowBounds(): WindowBounds | null {
  return store.get("windowBounds");
}

export function setWindowBounds(bounds: WindowBounds): void {
  store.set("windowBounds", bounds);
}
