import { useEffect, useMemo, useState } from "react";
import type { SshConfigCandidate } from "@shared/types";
import { ipcErrorMessage, wharf } from "../../api/wharf";
import "../../styles/dialog.css";
import "./SshConfigImportDialog.css";

interface Props {
  onClose(): void;
  onImported(count: number): void;
}

export function SshConfigImportDialog({ onClose, onImported }: Props) {
  const [candidates, setCandidates] = useState<SshConfigCandidate[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    wharf.sshConfig
      .parse()
      .then((found) => {
        setCandidates(found);
        setSelected(new Set(found.filter((c) => !c.alreadyImported).map((c) => c.alias)));
      })
      .catch((err) => setError(ipcErrorMessage(err)));
  }, []);

  const allSelected = useMemo(
    () => !!candidates?.length && candidates.every((c) => selected.has(c.alias)),
    [candidates, selected],
  );

  function toggle(alias: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(alias)) next.delete(alias);
      else next.add(alias);
      return next;
    });
  }

  function toggleAll() {
    if (!candidates) return;
    setSelected(allSelected ? new Set() : new Set(candidates.map((c) => c.alias)));
  }

  async function handleImport() {
    setError(null);
    setImporting(true);
    try {
      const result = await wharf.sshConfig.import([...selected]);
      onImported(result.importedHosts);
    } catch (err) {
      setError(ipcErrorMessage(err));
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="dialog-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog ssh-config-dialog">
        <h2>Import from ~/.ssh/config</h2>

        {candidates === null && !error && <p className="hint">Reading ~/.ssh/config…</p>}

        {candidates !== null && candidates.length === 0 && !error && (
          <p className="hint">No hosts found in ~/.ssh/config (or the file doesn't exist).</p>
        )}

        {candidates !== null && candidates.length > 0 && (
          <>
            <div className="ssh-config-list-header">
              <label className="ssh-config-row select-all">
                <input type="checkbox" checked={allSelected} onChange={toggleAll} />
                <span>{selected.size} of {candidates.length} selected</span>
              </label>
            </div>
            <div className="ssh-config-list">
              {candidates.map((c) => (
                <label key={c.alias} className="ssh-config-row">
                  <input type="checkbox" checked={selected.has(c.alias)} onChange={() => toggle(c.alias)} />
                  <div className="ssh-config-row-main">
                    <div className="ssh-config-row-title">
                      {c.alias}
                      {c.alreadyImported && <span className="ssh-config-badge">already added</span>}
                      {c.identityFile && <span className="ssh-config-badge key">key</span>}
                      {c.proxyJump && <span className="ssh-config-badge">via {c.proxyJump}</span>}
                    </div>
                    <div className="ssh-config-row-sub">
                      {c.username ? `${c.username}@` : ""}
                      {c.hostname}:{c.port}
                    </div>
                  </div>
                </label>
              ))}
            </div>
            <p className="hint">
              Parsing is approximate (Include and Host-* defaults are supported; Match blocks aren't) — review
              before importing. Passwords aren't stored in SSH config files, so imported hosts use key or agent
              auth; add a password afterward via Edit if needed.
            </p>
          </>
        )}

        {error && <div className="dialog-error">{error}</div>}

        <div className="dialog-actions">
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={importing || !candidates?.length || selected.size === 0}
            onClick={handleImport}
          >
            {importing ? "Importing…" : `Import ${selected.size || ""}`}
          </button>
        </div>
      </div>
    </div>
  );
}
