import { ipcMain } from "electron";
import { IPC, type SessionStartResult } from "../../shared/types";
import * as sshManager from "../services/sshManager";

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
}
