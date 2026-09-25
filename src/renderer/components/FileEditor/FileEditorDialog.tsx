import { useEffect, useState } from "react";
import { ipcErrorMessage, wharf } from "../../api/wharf";
import { IconClose } from "../Icons/Icons";
import "../../styles/dialog.css";
import "./FileEditorDialog.css";

interface Props {
  hostId: string;
  remotePath: string;
  onClose(): void;
  /** Called after a successful save, so the pane behind this dialog can
   * refresh its listing (e.g. the file's size/modified time changed). */
  onSaved?(): void;
}

/** A plain-text editor for one remote file, opened over SFTP: reads the
 * whole file into memory on open, Save writes it back in full. No syntax
 * highlighting — this trades that for zero extra dependencies, matching
 * the rest of the app's otherwise-minimal renderer footprint. Good enough
 * for quickly tweaking a config file without a download → edit → re-upload
 * round trip; anything larger or needing a real editor should still be
 * downloaded (sftpManager.readFile caps this at ~2 MB for the same reason
 * a plain textarea isn't the place to open something huge). */
export function FileEditorDialog({ hostId, remotePath, onClose, onSaved }: Props) {
  const [content, setContent] = useState<string | null>(null); // null while loading
  const [original, setOriginal] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setContent(null);
    setError(null);
    wharf.sftp
      .readFile(hostId, remotePath)
      .then((text) => {
        if (cancelled) return;
        setContent(text);
        setOriginal(text);
      })
      .catch((err) => {
        if (!cancelled) setError(ipcErrorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [hostId, remotePath]);

  const dirty = content !== null && content !== original;
  const fileName = remotePath.split("/").filter(Boolean).pop() ?? remotePath;

  async function save() {
    if (content === null || saving) return;
    setSaving(true);
    setError(null);
    try {
      await wharf.sftp.writeFile(hostId, remotePath, content);
      setOriginal(content);
      onSaved?.();
    } catch (err) {
      setError(ipcErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  function requestClose() {
    if (dirty && !confirm("Discard unsaved changes?")) return;
    onClose();
  }

  return (
    <div className="dialog-overlay" onMouseDown={(e) => e.target === e.currentTarget && requestClose()}>
      <div className="dialog file-editor-dialog">
        <div className="file-editor-header">
          <div className="file-editor-titles">
            <h2 title={remotePath}>{fileName}</h2>
            <span className="file-editor-path">{remotePath}</span>
          </div>
          <button className="file-editor-close" onClick={requestClose} title="Close">
            <IconClose />
          </button>
        </div>

        {error && <div className="dialog-error">{error}</div>}

        {content === null ? (
          <div className="file-editor-loading">{error ? null : "Loading…"}</div>
        ) : (
          <textarea
            className="file-editor-textarea"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            spellCheck={false}
            autoFocus
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
                e.preventDefault();
                void save();
              } else if (e.key === "Escape") {
                requestClose();
              } else if (e.key === "Tab") {
                // A plain textarea would otherwise tab focus away entirely —
                // editing a config file without Tab inserting whitespace is
                // painful enough to be worth the (minor) accessibility cost
                // of trapping it here, same trade-off most code editors make.
                e.preventDefault();
                const el = e.currentTarget;
                const { selectionStart, selectionEnd, value } = el;
                const next = value.slice(0, selectionStart) + "\t" + value.slice(selectionEnd);
                setContent(next);
                requestAnimationFrame(() => el.setSelectionRange(selectionStart + 1, selectionStart + 1));
              }
            }}
          />
        )}

        <div className="dialog-actions">
          <span className="file-editor-status">{content !== null && (dirty ? "Unsaved changes" : "No changes")}</span>
          <button className="btn ghost" onClick={requestClose}>
            Close
          </button>
          <button className="btn primary" onClick={save} disabled={content === null || saving || !dirty}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
