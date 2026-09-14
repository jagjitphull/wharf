import { ipcMain } from "electron";
import { randomUUID } from "node:crypto";
import { IPC, type HostInput, type HostRecord } from "../../shared/types";
import { getHosts, getTunnels, setHosts, setTunnels } from "../services/store";
import { deleteSecret, saveSecret, updateSecret } from "../services/secretStore";
import { disconnectSessionsForHost } from "../services/sshManager";
import { closeSftpForHost } from "../services/sftpManager";

export function registerHostsIpc(): void {
  ipcMain.handle(IPC.hosts.list, (): HostRecord[] => {
    return getHosts();
  });

  ipcMain.handle(IPC.hosts.create, (_event, input: HostInput): HostRecord => {
    const hosts = getHosts();
    const now = Date.now();
    const secretId = input.secret ? saveSecret(input.secret) : null;
    const record: HostRecord = {
      id: randomUUID(),
      name: input.name,
      hostname: input.hostname,
      port: input.port,
      username: input.username,
      groupId: input.groupId,
      authMethod: input.authMethod,
      secretId,
      privateKeyPath: input.privateKeyPath,
      color: input.color,
      tags: input.tags,
      jumpHostId: input.jumpHostId ?? null,
      createdAt: now,
      updatedAt: now,
    };
    setHosts([...hosts, record]);
    return record;
  });

  ipcMain.handle(IPC.hosts.update, (_event, id: string, input: HostInput): HostRecord => {
    const hosts = getHosts();
    const idx = hosts.findIndex((h) => h.id === id);
    if (idx === -1) throw new Error(`Host ${id} not found`);
    const existing = hosts[idx];

    let secretId = existing.secretId;
    if (input.secret) {
      if (secretId) updateSecret(secretId, input.secret);
      else secretId = saveSecret(input.secret);
    }

    const updated: HostRecord = {
      ...existing,
      name: input.name,
      hostname: input.hostname,
      port: input.port,
      username: input.username,
      groupId: input.groupId,
      authMethod: input.authMethod,
      secretId,
      privateKeyPath: input.privateKeyPath,
      color: input.color,
      tags: input.tags,
      jumpHostId: input.jumpHostId ?? null,
      updatedAt: Date.now(),
    };
    const next = [...hosts];
    next[idx] = updated;
    setHosts(next);
    return updated;
  });

  ipcMain.handle(IPC.hosts.remove, (_event, id: string): void => {
    const host = getHosts().find((h) => h.id === id);
    if (host?.secretId) deleteSecret(host.secretId);
    setHosts(getHosts().filter((h) => h.id !== id));
    // Cascade: drop any tunnels defined against this host.
    setTunnels(getTunnels().filter((t) => t.hostId !== id));
    disconnectSessionsForHost(id);
    closeSftpForHost(id);
  });
}
