import Store from "electron-store";
import type { GroupRecord, HostRecord, TunnelRecord } from "../../shared/types";

interface Schema {
  hosts: HostRecord[];
  groups: GroupRecord[];
  tunnels: TunnelRecord[];
  /** secretId -> base64-encoded ciphertext produced by Electron's safeStorage. */
  secrets: Record<string, string>;
}

const defaults: Schema = {
  hosts: [],
  groups: [],
  tunnels: [],
  secrets: {},
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
