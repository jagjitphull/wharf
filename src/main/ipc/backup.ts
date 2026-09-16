import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dialog, ipcMain } from "electron";
import {
  IPC,
  type AuthMethod,
  type BackupImportResult,
  type GroupRecord,
  type HostRecord,
} from "../../shared/types";
import { getGroups, getHosts, setGroups, setHosts } from "../services/store";

/**
 * Portable (no-secrets) shape of a host/group for export/import. Secrets
 * are deliberately never written to the export file — passwords/key
 * passphrases must be re-entered after importing on another machine.
 */
interface ExportedGroup {
  id: string;
  name: string;
  parentId: string | null;
  color?: string;
}

interface ExportedHost {
  id: string;
  name: string;
  hostname: string;
  port: number;
  username: string;
  groupId: string | null;
  authMethod: AuthMethod;
  privateKeyPath?: string;
  color?: string;
  tags?: string[];
  jumpHostId?: string | null;
}

interface ExportFile {
  version: 1;
  exportedAt: string;
  groups: ExportedGroup[];
  hosts: ExportedHost[];
}

function isExportFile(value: unknown): value is ExportFile {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return v.version === 1 && Array.isArray(v.groups) && Array.isArray(v.hosts);
}

export function registerBackupIpc(): void {
  ipcMain.handle(IPC.backup.export, async (): Promise<string | null> => {
    const result = await dialog.showSaveDialog({
      title: "Export Wharf hosts",
      defaultPath: `wharf-hosts-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePath) return null;

    const data: ExportFile = {
      version: 1,
      exportedAt: new Date().toISOString(),
      groups: getGroups().map((g) => ({ id: g.id, name: g.name, parentId: g.parentId, color: g.color })),
      hosts: getHosts().map((h) => ({
        id: h.id,
        name: h.name,
        hostname: h.hostname,
        port: h.port,
        username: h.username,
        groupId: h.groupId,
        authMethod: h.authMethod,
        privateKeyPath: h.privateKeyPath,
        color: h.color,
        tags: h.tags,
        jumpHostId: h.jumpHostId ?? null,
      })),
    };
    writeFileSync(result.filePath, JSON.stringify(data, null, 2), "utf8");
    return result.filePath;
  });

  ipcMain.handle(IPC.backup.import, async (): Promise<BackupImportResult | null> => {
    const result = await dialog.showOpenDialog({
      title: "Import Wharf hosts",
      properties: ["openFile"],
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (result.canceled || result.filePaths.length === 0) return null;

    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(result.filePaths[0], "utf8"));
    } catch {
      throw new Error("Couldn't parse that file as JSON.");
    }
    if (!isExportFile(parsed)) {
      throw new Error("This doesn't look like a Wharf export file.");
    }

    // New ids for everything (never collide with existing records), with a
    // full id map built up front so parent/jump-host references resolve
    // correctly regardless of array order.
    const groupIdMap = new Map<string, string>();
    for (const g of parsed.groups) groupIdMap.set(g.id, randomUUID());
    const hostIdMap = new Map<string, string>();
    for (const h of parsed.hosts) hostIdMap.set(h.id, randomUUID());

    const now = Date.now();
    const newGroups: GroupRecord[] = parsed.groups.map((g) => ({
      id: groupIdMap.get(g.id)!,
      name: g.name,
      parentId: g.parentId ? (groupIdMap.get(g.parentId) ?? null) : null,
      color: g.color,
      createdAt: now,
      updatedAt: now,
    }));
    const newHosts: HostRecord[] = parsed.hosts.map((h) => ({
      id: hostIdMap.get(h.id)!,
      name: h.name,
      hostname: h.hostname,
      port: h.port,
      username: h.username,
      groupId: h.groupId ? (groupIdMap.get(h.groupId) ?? null) : null,
      authMethod: h.authMethod,
      // Secrets are never in the export file — imported hosts start with
      // none set; password/agent auth will prompt for a blank one until
      // the user re-enters it via Edit.
      secretId: null,
      privateKeyPath: h.privateKeyPath,
      color: h.color,
      tags: h.tags,
      jumpHostId: h.jumpHostId ? (hostIdMap.get(h.jumpHostId) ?? null) : null,
      createdAt: now,
      updatedAt: now,
    }));

    setGroups([...getGroups(), ...newGroups]);
    setHosts([...getHosts(), ...newHosts]);

    return { importedGroups: newGroups.length, importedHosts: newHosts.length };
  });
}
