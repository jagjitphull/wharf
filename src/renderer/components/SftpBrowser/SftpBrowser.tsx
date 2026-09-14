import { useEffect, useState } from "react";
import type { SftpEntry, SftpTransferProgress } from "@shared/types";
import { useAppStore } from "../../state/store";
import { ipcErrorMessage, wharf } from "../../api/wharf";
import { ContextMenu, useContextMenu } from "../ContextMenu/ContextMenu";
import "./SftpBrowser.css";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(1)} ${units[i]}`;
}

export function SftpBrowser() {
  const { hosts, contextHostId } = useAppStore();
  const host = hosts.find((h) => h.id === contextHostId) ?? null;

  const [path, setPath] = useState(".");
  const [entries, setEntries] = useState<SftpEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transfers, setTransfers] = useState<Record<string, SftpTransferProgress>>({});
  const { menu, open: openMenu, close: closeMenu } = useContextMenu();

  useEffect(() => {
    setPath(".");
  }, [contextHostId]);

  useEffect(() => {
    if (!host) return;
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host?.id, path]);

  useEffect(() => {
    return wharf.sftp.onProgress((event) => {
      if (!host || event.hostId !== host.id) return;
      setTransfers((prev) => ({ ...prev, [event.transferId]: event }));
      if (event.done) {
        setTimeout(() => setTransfers((prev) => { const { [event.transferId]: _drop, ...rest } = prev; return rest; }), 2500);
        if (!event.error) void refresh();
      }
    });
  }, [host?.id]);

  async function refresh() {
    if (!host) return;
    setLoading(true);
    setError(null);
    try {
      setEntries(await wharf.sftp.list(host.id, path));
    } catch (err) {
      setError(ipcErrorMessage(err));
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }

  function goUp() {
    if (path === "." || path === "/") return;
    const parts = path.split("/").filter(Boolean);
    parts.pop();
    setPath(parts.length ? "/" + parts.join("/") : "/");
  }

  async function openEntry(entry: SftpEntry) {
    if (entry.type === "directory") {
      setPath(entry.path);
    }
  }

  async function handleDownload(entry: SftpEntry) {
    if (!host) return;
    try {
      await wharf.sftp.download(host.id, entry.path);
    } catch (err) {
      setError(ipcErrorMessage(err));
    }
  }

  async function handleUpload() {
    if (!host) return;
    try {
      await wharf.sftp.upload(host.id, path);
    } catch (err) {
      setError(ipcErrorMessage(err));
    }
  }

  async function handleDelete(entry: SftpEntry) {
    if (!host) return;
    if (!confirm(`Delete ${entry.type === "directory" ? "folder" : "file"} "${entry.name}"?`)) return;
    try {
      if (entry.type === "directory") await wharf.sftp.rmdir(host.id, entry.path);
      else await wharf.sftp.unlink(host.id, entry.path);
      await refresh();
    } catch (err) {
      setError(ipcErrorMessage(err));
    }
  }

  async function handleNewFolder() {
    if (!host) return;
    const name = prompt("New folder name:");
    if (!name) return;
    try {
      await wharf.sftp.mkdir(host.id, `${path === "/" ? "" : path}/${name}`.replace(/\/+/g, "/"));
      await refresh();
    } catch (err) {
      setError(ipcErrorMessage(err));
    }
  }

  async function handleRename(entry: SftpEntry) {
    if (!host) return;
    const name = prompt("Rename to:", entry.name);
    if (!name || name === entry.name) return;
    const newPath = entry.path.slice(0, entry.path.length - entry.name.length) + name;
    try {
      await wharf.sftp.rename(host.id, entry.path, newPath);
      await refresh();
    } catch (err) {
      setError(ipcErrorMessage(err));
    }
  }

  if (!host) {
    return (
      <div className="sftp-empty">
        <p>Select a host in the sidebar and click 📁 to browse its files.</p>
      </div>
    );
  }

  return (
    <div className="sftp-browser">
      <div className="sftp-toolbar">
        <button className="btn ghost small" onClick={goUp} disabled={path === "." || path === "/"}>
          ↑ Up
        </button>
        <input className="sftp-path" value={path} onChange={(e) => setPath(e.target.value)} onKeyDown={(e) => e.key === "Enter" && refresh()} />
        <button className="btn ghost small" onClick={refresh}>
          ⟳
        </button>
        <button className="btn ghost small" onClick={handleNewFolder}>
          + Folder
        </button>
        <button className="btn primary small" onClick={handleUpload}>
          ↑ Upload
        </button>
      </div>

      {error && <div className="sftp-error">{error}</div>}

      {Object.values(transfers).length > 0 && (
        <div className="sftp-transfers">
          {Object.values(transfers).map((t) => (
            <div key={t.transferId} className="transfer-row">
              <span>
                {t.direction === "upload" ? "↑" : "↓"} {t.fileName}
              </span>
              {t.error ? (
                <span className="transfer-error">{t.error}</span>
              ) : (
                <span>{t.done ? "done" : `${formatSize(t.bytesTransferred)} / ${formatSize(t.totalBytes)}`}</span>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="sftp-list">
        {loading && <div className="sftp-loading">Loading…</div>}
        {!loading &&
          entries.map((entry) => (
            <div
              className="sftp-row"
              key={entry.path}
              onDoubleClick={() => openEntry(entry)}
              onContextMenu={(e) =>
                openMenu(e, [
                  ...(entry.type === "directory"
                    ? [{ label: "Open", onClick: () => openEntry(entry) }]
                    : [{ label: "Download", onClick: () => handleDownload(entry) }]),
                  { label: "Rename…", onClick: () => handleRename(entry) },
                  { separator: true },
                  { label: "Delete", danger: true, onClick: () => handleDelete(entry) },
                ])
              }
            >
              <span className="sftp-icon">{entry.type === "directory" ? "📁" : "📄"}</span>
              <span className="sftp-name">{entry.name}</span>
              <span className="sftp-size">{entry.type === "directory" ? "" : formatSize(entry.size)}</span>
              <span className="sftp-modified">{new Date(entry.modifiedAt).toLocaleString()}</span>
              <span className="sftp-perms">{entry.permissions}</span>
              <div className="sftp-row-actions">
                {entry.type !== "directory" && <button onClick={() => handleDownload(entry)}>↓</button>}
                <button onClick={() => handleRename(entry)}>✎</button>
                <button onClick={() => handleDelete(entry)}>🗑</button>
              </div>
            </div>
          ))}
        {!loading && entries.length === 0 && <div className="sftp-loading">Empty directory.</div>}
      </div>
      <ContextMenu menu={menu} onClose={closeMenu} />
    </div>
  );
}
