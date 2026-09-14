import path from "node:path";
import { dialog, ipcMain } from "electron";
import { IPC, type SftpEntry } from "../../shared/types";
import * as sftpManager from "../services/sftpManager";

export function registerSftpIpc(): void {
  ipcMain.handle(IPC.sftp.list, async (_event, hostId: string, remotePath: string): Promise<SftpEntry[]> => {
    return sftpManager.list(hostId, remotePath);
  });

  ipcMain.handle(IPC.sftp.mkdir, async (_event, hostId: string, remotePath: string): Promise<void> => {
    return sftpManager.mkdir(hostId, remotePath);
  });

  ipcMain.handle(IPC.sftp.rmdir, async (_event, hostId: string, remotePath: string): Promise<void> => {
    return sftpManager.rmdir(hostId, remotePath);
  });

  ipcMain.handle(IPC.sftp.unlink, async (_event, hostId: string, remotePath: string): Promise<void> => {
    return sftpManager.unlink(hostId, remotePath);
  });

  ipcMain.handle(
    IPC.sftp.rename,
    async (_event, hostId: string, oldPath: string, newPath: string): Promise<void> => {
      return sftpManager.rename(hostId, oldPath, newPath);
    },
  );

  // Uploads/downloads pick the local side of the transfer via a native
  // dialog in the main process (renderer has no filesystem access), and
  // return null if the user cancels.
  ipcMain.handle(
    IPC.sftp.upload,
    async (_event, hostId: string, remoteDir: string): Promise<string | null> => {
      const result = await dialog.showOpenDialog({ properties: ["openFile"] });
      if (result.canceled || result.filePaths.length === 0) return null;
      const localPath = result.filePaths[0];
      const remotePath = path.posix.join(remoteDir, path.basename(localPath));
      return sftpManager.upload(hostId, localPath, remotePath);
    },
  );

  ipcMain.handle(
    IPC.sftp.download,
    async (_event, hostId: string, remotePath: string): Promise<string | null> => {
      const result = await dialog.showSaveDialog({ defaultPath: path.posix.basename(remotePath) });
      if (result.canceled || !result.filePath) return null;
      return sftpManager.download(hostId, remotePath, result.filePath);
    },
  );
}
