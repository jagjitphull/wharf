import { useEffect, useState } from "react";
import type { HostRecord, SftpEntry, SftpTransferProgress } from "@shared/types";
import { ipcErrorMessage, wharf } from "../../api/wharf";
import { ContextMenu, useContextMenu } from "../ContextMenu/ContextMenu";
import {
  IconArrowRight,
  IconChevronDown,
  IconChevronUp,
  IconDownload,
  IconFile,
  IconFolder,
  IconPencil,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconTrash,
  IconUpload,
} from "../Icons/Icons";
import { FileEditorDialog } from "../FileEditor/FileEditorDialog";
import { formatSize } from "./formatSize";
import { readTransferData, setTransferData, TRANSFER_MIME } from "./dragTransfer";
import "./SftpBrowser.css";

interface Props {
  host: HostRecord;
  path: string;
  onPathChange(path: string): void;
  /** Label for the *other* pane, used in the "Send to…" row action — "local
   * pane" when paired with LocalPane, or the other host's name when paired
   * with a second RemotePane (remote-to-remote). */
  otherPaneLabel: string;
  /** "Send to…" button/menu item on a remote row, and a row from the other
   * pane dropped here (download from this pane's perspective). */
  onTransferToOther(remotePath: string): void;
  onTransferFromOther(sourcePath: string): void;
}

export function RemotePane({ host, path, onPathChange, otherPaneLabel, onTransferToOther, onTransferFromOther }: Props) {
  const [entries, setEntries] = useState<SftpEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transfers, setTransfers] = useState<Record<string, SftpTransferProgress>>({});
  const [isDragOver, setIsDragOver] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SftpEntry[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [editingPath, setEditingPath] = useState<string | null>(null);
  const { menu, open: openMenu, close: closeMenu } = useContextMenu();

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host.id, path]);

  useEffect(() => {
    return wharf.sftp.onProgress((event) => {
      if (event.hostId !== host.id) return;
      setTransfers((prev) => ({ ...prev, [event.transferId]: event }));
      if (event.done) {
        setTimeout(
          () => setTransfers((prev) => { const { [event.transferId]: _drop, ...rest } = prev; return rest; }),
          2500,
        );
        if (!event.error) void refresh();
      }
    });
    // Re-subscribes on every path change (not just host.id) — the closure
    // otherwise captures a stale `path`/`refresh`, so a transfer completing
    // after the user has navigated elsewhere would re-list the *old*
    // directory instead of the one currently open.
  }, [host.id, path]);

  async function refresh() {
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
    onPathChange(parts.length ? "/" + parts.join("/") : "/");
  }

  function openEntry(entry: SftpEntry) {
    if (entry.type === "directory") onPathChange(entry.path);
    else if (entry.type === "file") setEditingPath(entry.path);
  }

  async function handleDownload(entry: SftpEntry) {
    try {
      await wharf.sftp.download(host.id, entry.path);
    } catch (err) {
      setError(ipcErrorMessage(err));
    }
  }

  async function handleUpload() {
    try {
      await wharf.sftp.upload(host.id, path);
    } catch (err) {
      setError(ipcErrorMessage(err));
    }
  }

  async function handleFileDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragOver(false);

    const transfer = readTransferData(e);
    if (transfer) {
      // A row dropped on this same remote pane (dragged from itself) is a
      // no-op either way — otherwise it's a real transfer in from whichever
      // pane it came from, local or another remote host.
      if (transfer.source === "local") onTransferFromOther(transfer.path);
      else if (transfer.source === "remote" && transfer.hostId !== host.id) onTransferFromOther(transfer.path);
      return;
    }

    const files = Array.from(e.dataTransfer.files) as (File & { path?: string })[];
    for (const file of files) {
      if (!file.path) continue;
      try {
        await wharf.sftp.uploadPath(host.id, file.path, path);
      } catch (err) {
        setError(ipcErrorMessage(err));
      }
    }
  }

  async function handleDelete(entry: SftpEntry) {
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

  async function runSearch() {
    const query = searchQuery.trim();
    if (!query) {
      setSearchResults(null);
      return;
    }
    setSearching(true);
    setError(null);
    try {
      setSearchResults(await wharf.sftp.search(host.id, path, query));
    } catch (err) {
      setError(ipcErrorMessage(err));
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }

  function closeSearch() {
    setSearchOpen(false);
    setSearchQuery("");
    setSearchResults(null);
  }

  function revealResult(entry: SftpEntry) {
    const parent = entry.path.slice(0, entry.path.length - entry.name.length - 1) || "/";
    closeSearch();
    onPathChange(parent);
  }

  const displayedEntries = searchResults ?? entries;
  const inSearchMode = searchResults !== null;

  return (
    <div
      className={`sftp-pane ${isDragOver ? "drag-over" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        if (e.dataTransfer.types.includes("Files") || e.dataTransfer.types.includes(TRANSFER_MIME)) {
          setIsDragOver(true);
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setIsDragOver(false);
      }}
      onDrop={handleFileDrop}
    >
      {isDragOver && (
        <div className="sftp-drop-overlay">
          <p>Drop to upload to {path === "." ? "this folder" : path}</p>
        </div>
      )}
      <div className="sftp-pane-header">Remote — {host.name}</div>
      <div className="sftp-toolbar">
        <button className="btn ghost small" onClick={goUp} disabled={path === "." || path === "/" || inSearchMode}>
          <IconChevronUp size={12} /> Up
        </button>
        <input
          className="sftp-path"
          value={path}
          onChange={(e) => onPathChange(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && refresh()}
        />
        <button className="btn ghost small icon-btn" onClick={refresh} title="Refresh">
          <IconRefresh />
        </button>
        <button
          className={`btn ghost small icon-btn ${searchOpen ? "active" : ""}`}
          title="Search this folder (recursive)"
          onClick={() => (searchOpen ? closeSearch() : setSearchOpen(true))}
        >
          <IconSearch />
        </button>
        <button className="btn ghost small" onClick={handleNewFolder}>
          <IconPlus size={12} /> Folder
        </button>
        <button className="btn primary small" onClick={handleUpload}>
          <IconUpload size={12} /> Upload
        </button>
      </div>

      {searchOpen && (
        <div className="sftp-search-bar">
          <input
            autoFocus
            placeholder={`Search filenames under ${path === "." ? "this folder" : path}…`}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void runSearch();
              if (e.key === "Escape") closeSearch();
            }}
          />
          <button className="btn ghost small" onClick={runSearch} disabled={searching}>
            {searching ? "Searching…" : "Search"}
          </button>
          {inSearchMode && (
            <button className="btn ghost small" onClick={() => setSearchResults(null)}>
              Clear
            </button>
          )}
        </div>
      )}

      {error && <div className="sftp-error">{error}</div>}

      {Object.values(transfers).length > 0 && (
        <div className="sftp-transfers">
          {Object.values(transfers).map((t) => (
            <div key={t.transferId} className="transfer-row">
              <span className="transfer-row-name">
                {t.direction === "upload" ? <IconChevronUp size={11} /> : <IconChevronDown size={11} />} {t.fileName}
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
        {(loading || searching) && <div className="sftp-loading">Loading…</div>}
        {!loading &&
          !searching &&
          displayedEntries.map((entry) => (
            <div
              className="sftp-row"
              key={entry.path}
              draggable
              onDragStart={(e) => setTransferData(e, { source: "remote", hostId: host.id, path: entry.path, isDir: entry.type === "directory" })}
              onDoubleClick={() => (inSearchMode ? revealResult(entry) : openEntry(entry))}
              onContextMenu={(e) =>
                openMenu(e, [
                  ...(inSearchMode
                    ? [{ label: "Reveal in folder", onClick: () => revealResult(entry) }]
                    : entry.type === "directory"
                      ? [{ label: "Open", onClick: () => openEntry(entry) }]
                      : [
                          ...(entry.type === "file" ? [{ label: "Edit…", onClick: () => setEditingPath(entry.path) }] : []),
                          { label: "Download…", onClick: () => handleDownload(entry) },
                        ]),
                  ...(entry.type !== "directory"
                    ? [{ label: `Send to ${otherPaneLabel}`, onClick: () => onTransferToOther(entry.path) }]
                    : []),
                  { label: "Rename…", onClick: () => handleRename(entry) },
                  { separator: true },
                  { label: "Delete", danger: true, onClick: () => handleDelete(entry) },
                ])
              }
            >
              <span className="sftp-icon">{entry.type === "directory" ? <IconFolder /> : <IconFile />}</span>
              <span className="sftp-name" title={inSearchMode ? entry.path : entry.name}>
                {inSearchMode ? entry.path : entry.name}
              </span>
              <span className="sftp-size">{entry.type === "directory" ? "" : formatSize(entry.size)}</span>
              <span className="sftp-modified">{new Date(entry.modifiedAt).toLocaleString()}</span>
              <span className="sftp-perms">{entry.permissions}</span>
              <div className="sftp-row-actions">
                {entry.type !== "directory" && (
                  <>
                    <button onClick={() => handleDownload(entry)} title="Download (pick location)…">
                      <IconDownload />
                    </button>
                    <button onClick={() => onTransferToOther(entry.path)} title={`Send to ${otherPaneLabel}`}>
                      <IconArrowRight />
                    </button>
                  </>
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
        {!loading && !searching && displayedEntries.length === 0 && (
          <div className="sftp-loading">{inSearchMode ? "No matches." : "Empty directory."}</div>
        )}
      </div>
      <ContextMenu menu={menu} onClose={closeMenu} />
      {editingPath && (
        <FileEditorDialog
          hostId={host.id}
          remotePath={editingPath}
          onClose={() => setEditingPath(null)}
          onSaved={refresh}
        />
      )}
    </div>
  );
}
