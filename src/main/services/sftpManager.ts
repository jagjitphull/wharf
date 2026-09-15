import path from "node:path";
import { randomUUID } from "node:crypto";
import type { SFTPWrapper } from "ssh2";
import { BrowserWindow } from "electron";
import { IPC, type SftpEntry, type SftpEntryType } from "../../shared/types";
import { acquireClient, releaseClient } from "./connectionPool";

// Lazily-opened, cached SFTP subsystem channel per host so repeated
// browsing doesn't reopen it on every directory listing. The underlying
// connection itself comes from connectionPool — shared with any shell
// session (or tunnel) already open to the same host, real multiplexing —
// so this holds exactly one pool reference per host for as long as it has
// a cached channel, released via closeSftpForHost/closeAllSftp.
const sftpCache = new Map<string, SFTPWrapper>();

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload);
  }
}

async function getSftp(hostId: string): Promise<SFTPWrapper> {
  const cached = sftpCache.get(hostId);
  if (cached) return cached;

  const { client } = await acquireClient(hostId);

  let sftp: SFTPWrapper;
  try {
    sftp = await new Promise<SFTPWrapper>((resolve, reject) => {
      client.sftp((err, s) => (err ? reject(err) : resolve(s)));
    });
  } catch (err) {
    releaseClient(hostId);
    throw err;
  }

  // The connection dropping (whether we're the only one using it or not)
  // just means our cached channel is dead — forget it so the next call
  // re-acquires. We don't release here: if this fired, the pool entry
  // already tore itself down on its own "close" handler; there's nothing
  // left for us to release a reference to.
  client.on("close", () => sftpCache.delete(hostId));
  sftpCache.set(hostId, sftp);
  return sftp;
}

export function closeSftpForHost(hostId: string): void {
  if (!sftpCache.has(hostId)) return;
  sftpCache.delete(hostId);
  releaseClient(hostId);
}

export function closeAllSftp(): void {
  for (const hostId of [...sftpCache.keys()]) closeSftpForHost(hostId);
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

// A plain-textarea editor isn't the place to open something huge — this is
// a generous cap for source/config files while still guarding against
// accidentally loading a multi-hundred-MB file into a renderer string.
const MAX_EDITABLE_FILE_SIZE = 2 * 1024 * 1024;

/** Reads a remote file's contents as UTF-8 text, for the built-in editor.
 * Throws if the file is larger than MAX_EDITABLE_FILE_SIZE — download it
 * instead of editing in-app past that size. */
export async function readFile(hostId: string, remotePath: string): Promise<string> {
  const sftp = await getSftp(hostId);
  const buf = await new Promise<Buffer>((resolve, reject) => {
    sftp.readFile(remotePath, (err, data) => (err ? reject(err) : resolve(data)));
  });
  if (buf.length > MAX_EDITABLE_FILE_SIZE) {
    const mb = (buf.length / (1024 * 1024)).toFixed(1);
    throw new Error(`File is too large to edit here (${mb} MB, limit 2 MB) — download it instead.`);
  }
  return buf.toString("utf8");
}

/** Overwrites a remote file with `content` (UTF-8), for the built-in editor's Save. */
export async function writeFile(hostId: string, remotePath: string, content: string): Promise<void> {
  const sftp = await getSftp(hostId);
  await new Promise<void>((resolve, reject) => {
    sftp.writeFile(remotePath, Buffer.from(content, "utf8"), (err) => (err ? reject(err) : resolve()));
  });
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
