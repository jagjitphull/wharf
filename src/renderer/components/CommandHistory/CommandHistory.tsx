import { useEffect, useMemo, useState } from "react";
import type { CommandHistoryEntry } from "@shared/types";
import { wharf } from "../../api/wharf";
import "./CommandHistory.css";

function formatTimestamp(ms: number): string {
  const d = new Date(ms);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  return sameDay ? time : `${d.toLocaleDateString()} ${time}`;
}

export function CommandHistory() {
  const [entries, setEntries] = useState<CommandHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      setEntries(await wharf.commandHistory.list());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  const normalizedFilter = filter.trim().toLowerCase();
  const filtered = useMemo(() => {
    // Newest first — the store appends in the order commands were run, and
    // that's the least useful order to read an audit trail in.
    const ordered = [...entries].reverse();
    if (!normalizedFilter) return ordered;
    return ordered.filter(
      (e) => e.command.toLowerCase().includes(normalizedFilter) || e.hostName.toLowerCase().includes(normalizedFilter),
    );
  }, [entries, normalizedFilter]);

  async function clearAll() {
    if (!confirm("Clear all command history? This can't be undone.")) return;
    await wharf.commandHistory.clear();
    setEntries([]);
  }

  function copy(entry: CommandHistoryEntry) {
    wharf.clipboard.writeText(entry.command);
    setCopiedId(entry.id);
    setTimeout(() => setCopiedId((id) => (id === entry.id ? null : id)), 1500);
  }

  return (
    <div className="history-panel">
      <div className="history-header">
        <h2>Command history</h2>
        <button className="btn ghost small" onClick={clearAll} disabled={entries.length === 0}>
          Clear History
        </button>
      </div>
      <p className="history-hint">
        A best-effort log of commands typed into terminal sessions — reconstructed from keystrokes, so shell history
        recall (↑/↓) and tab completion aren't captured exactly as run.
      </p>

      <input
        className="history-filter"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter by command or host…"
      />

      <div className="history-list">
        {loading && <div className="history-empty">Loading…</div>}
        {!loading && filtered.length === 0 && (
          <div className="history-empty">{normalizedFilter ? "No matches." : "No commands recorded yet."}</div>
        )}
        {!loading &&
          filtered.map((entry) => (
            <div className="history-row" key={entry.id}>
              <span className="history-time">{formatTimestamp(entry.timestamp)}</span>
              <span className="history-host">{entry.hostName}</span>
              <span className="history-command" title={entry.command}>
                {entry.command}
              </span>
              <button className="btn ghost small" onClick={() => copy(entry)}>
                {copiedId === entry.id ? "Copied" : "Copy"}
              </button>
            </div>
          ))}
      </div>
    </div>
  );
}
