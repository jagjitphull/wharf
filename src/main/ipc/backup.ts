import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { dialog, ipcMain } from "electron";
import { IPC, type BackupImportResult, type BackupPart, type BackupPreview } from "../../shared/types";
import { countBackup, parseBackup, type ParsedBackup } from "../../shared/backupFormat";
import { createBackup, type ExportOptions } from "../services/backup";
import { readProtected, writeProtected } from "../services/protectedData";
import { readSecret, saveSecret } from "../services/secretStore";
import {
  getCommandBlocksEnabled,
  getGroups,
  getHistorySettings,
  getHosts,
  getSnippets,
  getTranscriptSettings,
  getTunnels,
  getUpdateCheckEnabled,
  setCommandBlocksEnabled,
  setGroups,
  setHistorySettings,
  setHosts,
  setSnippets,
  setTranscriptSettings,
  setTunnels,
  setUpdateCheckEnabled,
} from "../services/store";

const backup = createBackup({
  data: () => ({
    groups: getGroups(),
    hosts: getHosts(),
    tunnels: getTunnels(),
    snippets: getSnippets(),
    workspaces: readProtected("workspaces"),
  }),
  save: (data) => {
    if (!writeProtected("workspaces", data.workspaces)) throw new Error("Unlock Wharf with your master password first.");
    setGroups(data.groups);
    setHosts(data.hosts);
    setTunnels(data.tunnels);
    setSnippets(data.snippets);
  },
  settings: () => ({
    historySettings: getHistorySettings(),
    transcriptSettings: getTranscriptSettings(),
    commandBlocksEnabled: getCommandBlocksEnabled(),
    updateCheckEnabled: getUpdateCheckEnabled(),
  }),
  applySettings: (main) => {
    if (main.historySettings) setHistorySettings(main.historySettings);
    if (main.transcriptSettings) setTranscriptSettings(main.transcriptSettings);
    if (main.commandBlocksEnabled !== undefined) setCommandBlocksEnabled(main.commandBlocksEnabled);
    if (main.updateCheckEnabled !== undefined) setUpdateCheckEnabled(main.updateCheckEnabled);
  },
  readSecret,
  saveSecret,
  newId: randomUUID,
  now: Date.now,
});

/** The file picked for import, held here between "pick" (which shows what it holds) and "apply". */
let pending: { token: string; parsed: ParsedBackup; fileName: string } | null = null;

// Only the end-to-end tests set this, to skip the native file dialogs they can't drive.
const testFile = (): string | null => process.env.WHARF_E2E_BACKUP_FILE || null;

export interface BackupExportRequest extends ExportOptions {
  parts: BackupPart[];
}

export function registerBackupIpc(): void {
  ipcMain.handle(IPC.backup.export, async (_event, request: BackupExportRequest): Promise<string | null> => {
    let target = testFile();
    if (!target) {
      const result = await dialog.showSaveDialog({
        title: "Export Wharf backup",
        defaultPath: `wharf-backup-${new Date().toISOString().slice(0, 10)}.json`,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (result.canceled || !result.filePath) return null;
      target = result.filePath;
    }
    const file = backup.build({
      parts: request.parts,
      passphrase: request.passphrase || undefined,
      rendererSettings: request.rendererSettings,
    });
    // A backup can hold sealed passwords, so it is as private as the data file itself.
    writeFileSync(target, JSON.stringify(file, null, 2), { encoding: "utf8", mode: 0o600 });
    return target;
  });

  ipcMain.handle(IPC.backup.pick, async (): Promise<BackupPreview | null> => {
    let source = testFile();
    if (!source) {
      const result = await dialog.showOpenDialog({
        title: "Import Wharf backup",
        properties: ["openFile"],
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (result.canceled || result.filePaths.length === 0) return null;
      source = result.filePaths[0];
    }
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(source, "utf8"));
    } catch {
      throw new Error("Couldn't read that file as JSON.");
    }
    const parsed = parseBackup(raw);
    const token = randomUUID();
    pending = { token, parsed, fileName: path.basename(source) };
    return {
      token,
      fileName: pending.fileName,
      exportedAt: parsed.file.exportedAt || null,
      counts: countBackup(parsed.file),
      hasSettings: !!parsed.file.settings,
      hasSecrets: !!parsed.file.secrets && Object.keys(parsed.file.secrets.items).length > 0,
      invalid: parsed.invalid,
    };
  });

  ipcMain.handle(
    IPC.backup.apply,
    (_event, token: string, options: { parts: BackupPart[]; passphrase?: string; skipSecrets?: boolean }): BackupImportResult => {
      if (!pending || pending.token !== token) throw new Error("That import is no longer open; pick the file again.");
      const result = backup.apply(
        pending.parsed.file,
        new Set(options.parts),
        options.passphrase || undefined,
        options.skipSecrets === true,
      );
      result.invalid += pending.parsed.invalid;
      pending = null;
      return result;
    },
  );
}
