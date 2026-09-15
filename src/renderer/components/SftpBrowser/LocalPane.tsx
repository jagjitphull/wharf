import { useEffect, useState } from "react";
import type { SftpEntry, SftpTransferProgress } from "@shared/types";
import { ipcErrorMessage, wharf } from "../../api/wharf";
import { ContextMenu, useContextMenu } from "../ContextMenu/ContextMenu";
import { IconFile, IconFolder, IconPencil, IconTrash, IconUpload } from "../Icons/Icons";
import { formatSize } from "./formatSize";
import { readTransferData, setTransferData, TRANSFER_MIME } from "./dragTransfer";
import { isLocalRoot, localBaseName, localJoin, localParent } from "../../utils/localPath";
import "./SftpBrowser.css";

interface Props {
  path: string;
  onPathChange(path: string): void;
  /** "Send to remote pane" button on a local row, and a remote row dropped here (download). */
  onTransferToRemote(localPath: string): void;
  onTransferFromRemote(remotePath: string): void;
}

export function LocalPane({ path, onPathChange, onTransferToRemote, onTransferFromRemote }: Props) {
  const [entries, setEntries] = useState<SftpEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const { menu, open: openMenu, close: closeMenu } = useContextMenu();

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  // Any active SFTP download completing means new content may now sit in
  // whatever local directory it targeted — cheap to just refresh rather
  // than track exact destination directories across the IPC boundary.
  useEffect(() => {
    return wharf.sftp.onProgress((event) => {
      if (event.direction === "download" && event.done && !event.error) void refresh();
    });
    // Re-subscribes on every path change — see the identical note in
    // RemotePane.tsx (a stale closure would otherwise re-list wherever
    // the pane was pointed at mount, not the current directory).
  }, [path]);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      setEntries(await wharf.localFs.list(path));
    } catch (err) {
      setError(ipcErrorMessage(err));
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }

  function goUp() {
    if (isLocalRoot(path)) return;
    onPathChange(localParent(path));
  }

  function openEntry(entry: SftpEntry) {
    if (entry.type === "directory") onPathChange(entry.path);
  }

  async function handleFileDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragOver(false);

    const transfer = readTransferData(e);
    if (transfer) {
      if (transfer.source === "remote") onTransferFromRemote(transfer.path);
      return; // a local row dropped on the local pane itself is a no-op
    }

    // A native OS file drag (e.g. from the system file manager) dropped
    // onto the local pane doesn't need transferring — it's already local.
    // Nothing to do here; only cross-pane and remote-origin drops act.
  }

  async function handleDelete(entry: SftpEntry) {
    if (!confirm(`Delete ${entry.type === "directory" ? "folder" : "file"} "${entry.name}"?`)) return;
    try {
      if (entry.type === "directory") await wharf.localFs.rmdir(entry.path);
      else await wharf.localFs.unlink(entry.path);
      await refresh();
    } catch (err) {
      setError(ipcErrorMessage(err));
    }
  }

  async function handleNewFolder() {
    const name = prompt("New folder name:");
    if (!name) return;
    try {
      await wharf.localFs.mkdir(localJoin(path, name));
      await refresh();
    } catch (err) {
      setError(ipcErrorMessage(err));
    }
  }

  async function handleRename(entry: SftpEntry) {
    const name = prompt("Rename to:", entry.name);
    if (!name || name === entry.name) return;
    try {
      await wharf.localFs.rename(entry.path, localJoin(localParent(entry.path), name));
      await refresh();
    } catch (err) {
      setError(ipcErrorMessage(err));
    }
  }

  return (
    <div
      className={`sftp-pane ${isDragOver ? "drag-over" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        if (e.dataTransfer.types.includes(TRANSFER_MIME)) setIsDragOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setIsDragOver(false);
      }}
      onDrop={handleFileDrop}
    >
      {isDragOver && (
        <div className="sftp-drop-overlay">
          <p>Drop to download to {localBaseName(path) || path}</p>
        </div>
      )}
      <div className="sftp-pane-header">Local</div>
      <div className="sftp-toolbar">
        <button className="btn ghost small" onClick={goUp} disabled={isLocalRoot(path)}>
          ↑ Up
        </button>
        <input
          className="sftp-path"
          value={path}
          onChange={(e) => onPathChange(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && refresh()}
        />
        <button className="btn ghost small" onClick={refresh} title="Refresh">
          ⟳
        </button>
        <button className="btn ghost small" onClick={handleNewFolder}>
          + Folder
        </button>
      </div>

      {error && <div className="sftp-error">{error}</div>}

      <div className="sftp-list">
        {loading && <div className="sftp-loading">Loading…</div>}
        {!loading &&
          entries.map((entry) => (
            <div
              className="sftp-row"
              key={entry.path}
              draggable
              onDragStart={(e) => setTransferData(e, { source: "local", path: entry.path, isDir: entry.type === "directory" })}
              onDoubleClick={() => openEntry(entry)}
              onContextMenu={(e) =>
                openMenu(e, [
                  entry.type === "directory"
                    ? { label: "Open", onClick: () => openEntry(entry) }
                    : { label: "Send to remote pane", onClick: () => onTransferToRemote(entry.path) },
                  { label: "Rename…", onClick: () => handleRename(entry) },
                  { separator: true },
                  { label: "Delete", danger: true, onClick: () => handleDelete(entry) },
                ])
              }
            >
              <span className="sftp-icon">{entry.type === "directory" ? <IconFolder /> : <IconFile />}</span>
              <span className="sftp-name">{entry.name}</span>
              <span className="sftp-size">{entry.type === "directory" ? "" : formatSize(entry.size)}</span>
              <span className="sftp-modified">{new Date(entry.modifiedAt).toLocaleString()}</span>
              <span className="sftp-perms">{entry.permissions}</span>
              <div className="sftp-row-actions">
                {entry.type !== "directory" && (
                  <button onClick={() => onTransferToRemote(entry.path)} title="Send to remote pane">
                    <IconUpload />
                  </button>
                )}
                <button onClick={() => handleRename(entry)}>
                  <IconPencil />
                </button>
                <button onClick={() => handleDelete(entry)}>
                  <IconTrash />
                </button>
              </div>
            </div>
          ))}
        {!loading && entries.length === 0 && <div className="sftp-loading">Empty directory.</div>}
      </div>
      <ContextMenu menu={menu} onClose={closeMenu} />
    </div>
  );
}
