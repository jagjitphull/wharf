import path from "node:path";
import { randomUUID } from "node:crypto";
import { Client, type SFTPWrapper } from "ssh2";
import { BrowserWindow } from "electron";
import { IPC, type SftpEntry, type SftpEntryType } from "../../shared/types";
import { getHosts } from "./store";
import { buildConnectConfig } from "./sshManager";

interface Pooled {
  client: Client;
  sftp: SFTPWrapper;
}

// Lazily-opened, cached SFTP connection per host so repeated browsing
// doesn't re-authenticate on every directory listing. Direct connections
// only (no jump-host chaining yet — see README "Known limitations").
const pool = new Map<string, Pooled>();

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload);
  }
}

async function getSftp(hostId: string): Promise<SFTPWrapper> {
  const existing = pool.get(hostId);
  if (existing) return existing.sftp;

  const host = getHosts().find((h) => h.id === hostId);
  if (!host) throw new Error(`Host ${hostId} not found`);

  const client = await new Promise<Client>((resolve, reject) => {
    const c = new Client();
    c.on("ready", () => resolve(c));
    c.on("error", reject);
    c.connect(buildConnectConfig(host));
  });

  const sftp = await new Promise<SFTPWrapper>((resolve, reject) => {
    client.sftp((err, s) => (err ? reject(err) : resolve(s)));
  });

  client.on("close", () => pool.delete(hostId));
  pool.set(hostId, { client, sftp });
  return sftp;
}

export function closeSftpForHost(hostId: string): void {
  const entry = pool.get(hostId);
  if (!entry) return;
  entry.client.end();
  pool.delete(hostId);
}

export function closeAllSftp(): void {
  for (const hostId of [...pool.keys()]) closeSftpForHost(hostId);
}

// ssh2's plain `readdir` returns raw Attributes (a mode bitmask), not the
// Stats-with-methods variant (that's only FileEntryWithStats), so type is
// derived from the POSIX mode bits directly rather than via isDirectory().
const S_IFMT = 0o170000;
function entryType(mode: number): SftpEntryType {
  switch (mode & S_IFMT) {
    case 0o040000:
      return "directory";
    case 0o120000:
      return "symlink";
    case 0o100000:
      return "file";
    default:
      return "other";
  }
}

function permissionsString(mode: number): string {
  const type = (mode & 0o170000) === 0o040000 ? "d" : (mode & 0o170000) === 0o120000 ? "l" : "-";
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
  return type + bits;
}

export async function list(hostId: string, remotePath: string): Promise<SftpEntry[]> {
  const sftp = await getSftp(hostId);
  const entries = await new Promise<import("ssh2").FileEntry[]>((resolve, reject) => {
    sftp.readdir(remotePath, (err, list) => (err ? reject(err) : resolve(list)));
  });

  return entries
    .map((e): SftpEntry => ({
      name: e.filename,
      path: path.posix.join(remotePath, e.filename),
      type: entryType(e.attrs.mode ?? 0),
      size: e.attrs.size ?? 0,
      modifiedAt: (e.attrs.mtime ?? 0) * 1000,
      permissions: permissionsString(e.attrs.mode ?? 0),
    }))
    .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "directory" ? -1 : 1));
}

export async function mkdir(hostId: string, remotePath: string): Promise<void> {
  const sftp = await getSftp(hostId);
  await new Promise<void>((resolve, reject) => sftp.mkdir(remotePath, (err) => (err ? reject(err) : resolve())));
}

export async function rmdir(hostId: string, remotePath: string): Promise<void> {
  const sftp = await getSftp(hostId);
  await new Promise<void>((resolve, reject) => sftp.rmdir(remotePath, (err) => (err ? reject(err) : resolve())));
}

export async function unlink(hostId: string, remotePath: string): Promise<void> {
  const sftp = await getSftp(hostId);
  await new Promise<void>((resolve, reject) => sftp.unlink(remotePath, (err) => (err ? reject(err) : resolve())));
}

export async function rename(hostId: string, oldPath: string, newPath: string): Promise<void> {
  const sftp = await getSftp(hostId);
  await new Promise<void>((resolve, reject) =>
    sftp.rename(oldPath, newPath, (err) => (err ? reject(err) : resolve())),
  );
}

export async function upload(hostId: string, localPath: string, remotePath: string): Promise<string> {
  const sftp = await getSftp(hostId);
  const transferId = randomUUID();
  const fileName = path.basename(localPath);

  sftp.fastPut(
    localPath,
    remotePath,
    {
      step: (transferred, _chunk, total) => {
        broadcast(IPC.sftp.onProgress, {
          transferId,
          hostId,
          direction: "upload",
          fileName,
          bytesTransferred: transferred,
          totalBytes: total,
          done: false,
        });
      },
    },
    (err) => {
      broadcast(IPC.sftp.onProgress, {
        transferId,
        hostId,
        direction: "upload",
        fileName,
        bytesTransferred: 0,
        totalBytes: 0,
        done: true,
        error: err?.message,
      });
    },
  );

  return transferId;
}

// Recursive search is capped on three axes so a huge or oddly-structured
// remote tree (or a typo'd root like "/") can't turn one search into a
// runaway scan: how many matches to collect, how many entries to look at
// in total, and how deep to recurse.
const SEARCH_MAX_RESULTS = 200;
const SEARCH_MAX_SCANNED = 5000;
const SEARCH_MAX_DEPTH = 12;

/** Recursively searches under `rootPath` for entries whose name contains
 * `query` (case-insensitive substring). Directories that error out while
 * being read (permission denied, a broken symlink target, etc.) are
 * skipped rather than failing the whole search. */
export async function search(hostId: string, rootPath: string, query: string): Promise<SftpEntry[]> {
  const sftp = await getSftp(hostId);
  const needle = query.toLowerCase();
  const results: SftpEntry[] = [];
  let scanned = 0;

  async function walk(dir: string, depth: number): Promise<void> {
    if (results.length >= SEARCH_MAX_RESULTS || scanned >= SEARCH_MAX_SCANNED || depth > SEARCH_MAX_DEPTH) return;

    let entries: import("ssh2").FileEntry[];
    try {
      entries = await new Promise((resolve, reject) => {
        sftp.readdir(dir, (err, list) => (err ? reject(err) : resolve(list)));
      });
    } catch {
      return; // permission denied, broken symlink, etc. — skip this branch
    }

    const subdirs: string[] = [];
    for (const e of entries) {
      if (results.length >= SEARCH_MAX_RESULTS || scanned >= SEARCH_MAX_SCANNED) return;
      scanned++;
      const type = entryType(e.attrs.mode ?? 0);
      const fullPath = path.posix.join(dir, e.filename);
      if (e.filename.toLowerCase().includes(needle)) {
        results.push({
          name: e.filename,
          path: fullPath,
          type,
          size: e.attrs.size ?? 0,
          modifiedAt: (e.attrs.mtime ?? 0) * 1000,
          permissions: permissionsString(e.attrs.mode ?? 0),
        });
      }
      // Symlinks aren't followed — a symlink pointing back up the tree
      // would otherwise recurse forever.
      if (type === "directory") subdirs.push(fullPath);
    }
    for (const subdir of subdirs) await walk(subdir, depth + 1);
  }

  await walk(rootPath, 0);
  return results;
}

export async function download(hostId: string, remotePath: string, localPath: string): Promise<string> {
  const sftp = await getSftp(hostId);
  const transferId = randomUUID();
  const fileName = path.basename(remotePath);

  sftp.fastGet(
    remotePath,
    localPath,
    {
      step: (transferred, _chunk, total) => {
        broadcast(IPC.sftp.onProgress, {
          transferId,
          hostId,
          direction: "download",
          fileName,
          bytesTransferred: transferred,
          totalBytes: total,
          done: false,
        });
      },
    },
    (err) => {
      broadcast(IPC.sftp.onProgress, {
        transferId,
        hostId,
        direction: "download",
        fileName,
        bytesTransferred: 0,
        totalBytes: 0,
        done: true,
        error: err?.message,
      });
    },
  );

  return transferId;
}
