import { ipcMain } from "electron";
import { promises as fs, type Dirent } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { IPC, type SftpEntry, type SftpEntryType } from "../../shared/types";

function entryType(dirent: Dirent): SftpEntryType {
  if (dirent.isSymbolicLink()) return "symlink";
  if (dirent.isDirectory()) return "directory";
  if (dirent.isFile()) return "file";
  return "other";
}

// Mirrors sftpManager's permissionsString (POSIX mode bits) so local and
// remote rows render identically — on Windows, fs.Stats.mode's permission
// bits are a coarse approximation (no real POSIX permissions), but the
// column still shows something directionally sensible.
function permissionsString(mode: number, isDir: boolean): string {
  const bits = [
    mode & 0o400 ? "r" : "-",
    mode & 0o200 ? "w" : "-",
    mode & 0o100 ? "x" : "-",
    mode & 0o040 ? "r" : "-",
    mode & 0o020 ? "w" : "-",
    mode & 0o010 ? "x" : "-",
    mode & 0o004 ? "r" : "-",
    mode & 0o002 ? "w" : "-",
    mode & 0o001 ? "x" : "-",
  ].join("");
  return (isDir ? "d" : "-") + bits;
}

export function registerLocalFsIpc(): void {
  ipcMain.handle(IPC.localFs.list, async (_event, dirPath: string): Promise<SftpEntry[]> => {
    const dirents = await fs.readdir(dirPath, { withFileTypes: true });
    const entries: SftpEntry[] = [];
    for (const dirent of dirents) {
      const fullPath = path.join(dirPath, dirent.name);
      try {
        const stat = await fs.lstat(fullPath);
        entries.push({
          name: dirent.name,
          path: fullPath,
          type: entryType(dirent),
          size: stat.size,
          modifiedAt: stat.mtimeMs,
          permissions: permissionsString(stat.mode, dirent.isDirectory()),
        });
      } catch {
        continue; // permission denied, broken symlink target, etc. — skip this entry
      }
    }
    return entries.sort((a, b) =>
      a.type === b.type ? a.name.localeCompare(b.name) : a.type === "directory" ? -1 : 1,
    );
  });

  ipcMain.handle(IPC.localFs.mkdir, async (_event, dirPath: string): Promise<void> => {
    await fs.mkdir(dirPath);
  });

  ipcMain.handle(IPC.localFs.rmdir, async (_event, dirPath: string): Promise<void> => {
    await fs.rmdir(dirPath);
  });

  ipcMain.handle(IPC.localFs.unlink, async (_event, filePath: string): Promise<void> => {
    await fs.unlink(filePath);
  });

  ipcMain.handle(IPC.localFs.rename, async (_event, oldPath: string, newPath: string): Promise<void> => {
    await fs.rename(oldPath, newPath);
  });

  ipcMain.handle(IPC.localFs.homeDir, (): string => homedir());
}
