import { ipcMain, dialog } from "electron";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { IPC, type SessionStartResult } from "../../shared/types";
import * as sshManager from "../services/sshManager";

function defaultLogPath(hostName: string): string {
  const dir = join(homedir(), "Documents", "wharf-logs");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safeName = hostName.replace(/[/\\?%*:|"<>]/g, "_");
  return join(dir, `${safeName}-${stamp}.log`);
}

export function registerSshIpc(): void {
  ipcMain.handle(
    IPC.ssh.connect,
    async (_event, hostId: string, cols: number, rows: number): Promise<SessionStartResult> => {
      const sessionId = await sshManager.connect(hostId, cols, rows);
      return { sessionId };
    },
  );

  // High-frequency, fire-and-forget: keystrokes and resize events use `send`/`on`
  // rather than `invoke`/`handle` to avoid the overhead of a reply round-trip.
  ipcMain.on(IPC.ssh.write, (_event, sessionId: string, data: string) => {
    sshManager.write(sessionId, data);
  });

  ipcMain.on(IPC.ssh.resize, (_event, sessionId: string, cols: number, rows: number) => {
    sshManager.resize(sessionId, cols, rows);
  });

  ipcMain.handle(IPC.ssh.disconnect, (_event, sessionId: string) => {
    sshManager.disconnect(sessionId);
  });

  ipcMain.handle(IPC.ssh.startLogging, async (_event, sessionId: string): Promise<string | null> => {
    const hostName = sshManager.getHostNameForSession(sessionId) ?? "session";
    const result = await dialog.showSaveDialog({
      title: "Save session log",
      defaultPath: defaultLogPath(hostName),
      filters: [
        { name: "Log files", extensions: ["log", "txt"] },
        { name: "All files", extensions: ["*"] },
      ],
    });
    if (result.canceled || !result.filePath) return null;
    sshManager.startLogging(sessionId, result.filePath);
    return result.filePath;
  });

  ipcMain.handle(IPC.ssh.stopLogging, (_event, sessionId: string) => {
    sshManager.stopLogging(sessionId);
  });
}
