import { useState } from "react";
import type { BackupImportResult, BackupPart, BackupPreview } from "@shared/types";
import { ipcErrorMessage, wharf } from "../../api/wharf";
import { useAppStore } from "../../state/store";
import { toast } from "../../state/toastStore";
import "../../styles/dialog.css";
import "./BackupSettings.css";

const MIN_PASSPHRASE = 8;

/** The window's own preferences (theme, fonts, layout…) — only the renderer can read them, so it hands them to the backup. */
function collectRendererSettings(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith("wharf-")) out[key] = localStorage.getItem(key) ?? "";
    }
  } catch {
    /* storage unavailable: the backup just has no window preferences */
  }
  return out;
}

const PART_LABEL: Record<BackupPart, string> = {
  tunnels: "Port-forwarding tunnels",
  snippets: "Snippets",
  workspaces: "Workspaces",
  settings: "App settings (theme, fonts, history and recording choices…)",
};

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function summarize(result: BackupImportResult): string {
  const { added } = result;
  const bits = [
    added.hosts && plural(added.hosts, "host"),
    added.groups && plural(added.groups, "group"),
    added.tunnels && plural(added.tunnels, "tunnel"),
    added.snippets && plural(added.snippets, "snippet"),
    added.workspaces && plural(added.workspaces, "workspace"),
    result.secrets && `${plural(result.secrets, "saved password")}`,
    result.settingsApplied && "settings",
  ].filter(Boolean);
  const tail = [result.skipped && `${result.skipped} already there`, result.invalid && `${result.invalid} unreadable left out`].filter(
    Boolean,
  );
  const head = bits.length > 0 ? `Imported ${bits.join(", ")}` : "Nothing new to import";
  return tail.length > 0 ? `${head} (${tail.join(", ")}).` : `${head}.`;
}

function ExportDialog({ onClose }: { onClose(): void }) {
  const [parts, setParts] = useState<Record<BackupPart, boolean>>({ tunnels: true, snippets: true, workspaces: true, settings: true });
  const [withSecrets, setWithSecrets] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (withSecrets) {
      if (passphrase.length < MIN_PASSPHRASE) return setError(`The passphrase must be at least ${MIN_PASSPHRASE} characters.`);
      if (passphrase !== confirmation) return setError("The two passphrases don't match.");
    }
    setBusy(true);
    try {
      const chosen = (Object.keys(parts) as BackupPart[]).filter((p) => parts[p]);
      const path = await wharf.backup.export({
        parts: chosen,
        passphrase: withSecrets ? passphrase : undefined,
        rendererSettings: parts.settings ? collectRendererSettings() : undefined,
      });
      if (path) {
        toast.success(`Backup saved to ${path}`);
        onClose();
      }
    } catch (err) {
      setError(ipcErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="dialog-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        className="dialog backup-dialog"
        noValidate
        onSubmit={submit}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
        aria-label="Export backup"
      >
        <h2>Export backup</h2>
        <label className="backup-check">
          <input type="checkbox" checked disabled /> Hosts and groups
        </label>
        {(Object.keys(PART_LABEL) as BackupPart[]).map((p) => (
          <label className="backup-check" key={p}>
            <input type="checkbox" checked={parts[p]} onChange={(e) => setParts({ ...parts, [p]: e.target.checked })} /> {PART_LABEL[p]}
          </label>
        ))}
        <label className="backup-check backup-secrets-toggle">
          <input type="checkbox" checked={withSecrets} onChange={(e) => setWithSecrets(e.target.checked)} /> Saved passwords and key
          passphrases
        </label>
        {withSecrets ? (
          <>
            <label>
              Backup passphrase
              <input
                type="password"
                autoComplete="new-password"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                autoFocus
              />
            </label>
            <label>
              Repeat it
              <input type="password" autoComplete="new-password" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} />
            </label>
            <p className="hint">
              They are encrypted with this passphrase (not your master password) and can only be read with it. Wharf can&apos;t recover a
              forgotten one.
            </p>
          </>
        ) : (
          <p className="hint">Passwords and key passphrases stay out of the file unless you tick this.</p>
        )}
        {error && <div className="dialog-error">{error}</div>}
        <div className="dialog-actions">
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={busy}>
            {busy ? "Working…" : "Export…"}
          </button>
        </div>
      </form>
    </div>
  );
}

function ImportDialog({ preview, onClose, onDone }: { preview: BackupPreview; onClose(): void; onDone(result: BackupImportResult): void }) {
  const available = (["tunnels", "snippets", "workspaces"] as const).filter((p) => preview.counts[p] > 0);
  const [parts, setParts] = useState<Record<BackupPart, boolean>>({ tunnels: true, snippets: true, workspaces: true, settings: false });
  const [withSecrets, setWithSecrets] = useState(true);
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (preview.hasSecrets && withSecrets && !passphrase) return setError("Enter the backup passphrase, or untick the saved passwords.");
    setBusy(true);
    try {
      const chosen = (Object.keys(parts) as BackupPart[]).filter(
        (p) => parts[p] && (p === "settings" ? preview.hasSettings : preview.counts[p] > 0),
      );
      const result = await wharf.backup.apply(preview.token, {
        parts: chosen,
        passphrase: preview.hasSecrets && withSecrets ? passphrase : undefined,
        skipSecrets: preview.hasSecrets && !withSecrets,
      });
      onDone(result);
    } catch (err) {
      setError(ipcErrorMessage(err));
      setBusy(false);
    }
  }

  return (
    <div className="dialog-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        className="dialog backup-dialog"
        noValidate
        onSubmit={submit}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
        aria-label="Import backup"
      >
        <h2>Import backup</h2>
        <p className="hint">
          {preview.fileName}
          {preview.exportedAt ? ` · exported ${new Date(preview.exportedAt).toLocaleString()}` : ""}
        </p>
        <label className="backup-check">
          <input type="checkbox" checked disabled /> {plural(preview.counts.hosts, "host")} and {plural(preview.counts.groups, "group")}
        </label>
        {available.map((p) => (
          <label className="backup-check" key={p}>
            <input type="checkbox" checked={parts[p]} onChange={(e) => setParts({ ...parts, [p]: e.target.checked })} />
            {plural(preview.counts[p], p === "workspaces" ? "workspace" : p === "tunnels" ? "tunnel" : "snippet")}
          </label>
        ))}
        {preview.hasSettings && (
          <label className="backup-check">
            <input type="checkbox" checked={parts.settings} onChange={(e) => setParts({ ...parts, settings: e.target.checked })} /> App
            settings (replaces yours for what the file sets)
          </label>
        )}
        {preview.hasSecrets && (
          <>
            <label className="backup-check backup-secrets-toggle">
              <input type="checkbox" checked={withSecrets} onChange={(e) => setWithSecrets(e.target.checked)} /> Saved passwords and key
              passphrases
            </label>
            {withSecrets && (
              <label>
                Backup passphrase
                <input type="password" autoComplete="off" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} autoFocus />
              </label>
            )}
          </>
        )}
        <p className="hint">
          Anything you already have (same host, group, tunnel, snippet or workspace) is left as it is, so importing the same file twice adds
          nothing.
          {preview.invalid > 0 && ` ${plural(preview.invalid, "entry", "entries")} in the file can't be read and will be left out.`}
        </p>
        {error && <div className="dialog-error">{error}</div>}
        <div className="dialog-actions">
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={busy}>
            {busy ? "Importing…" : "Import"}
          </button>
        </div>
      </form>
    </div>
  );
}

export function BackupSettings() {
  const loadAll = useAppStore((s) => s.loadAll);
  const [exporting, setExporting] = useState(false);
  const [preview, setPreview] = useState<BackupPreview | null>(null);
  const [busy, setBusy] = useState(false);

  async function pick() {
    setBusy(true);
    try {
      setPreview(await wharf.backup.pick());
    } catch (err) {
      toast.error(ipcErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function imported(result: BackupImportResult) {
    setPreview(null);
    toast.success(summarize(result));
    if (result.rendererSettings) {
      try {
        for (const [key, value] of Object.entries(result.rendererSettings)) localStorage.setItem(key, value);
      } catch {
        /* the settings simply aren't applied */
      }
      // Theme, fonts and layout are read at startup.
      setTimeout(() => void wharf.window.reload(), 900);
      return;
    }
    await loadAll();
  }

  return (
    <>
      <p className="hint">
        Save your hosts and groups — and, if you like, tunnels, snippets, workspaces, settings and saved passwords — to a file, and bring
        them into another Wharf. Saved passwords are only included when you give the backup its own passphrase.
      </p>
      <div className="backup-actions">
        <button className="btn ghost small" onClick={() => setExporting(true)}>
          Export backup…
        </button>
        <button className="btn ghost small" onClick={() => void pick()} disabled={busy}>
          Import backup…
        </button>
      </div>
      {exporting && <ExportDialog onClose={() => setExporting(false)} />}
      {preview && <ImportDialog preview={preview} onClose={() => setPreview(null)} onDone={(r) => void imported(r)} />}
    </>
  );
}
