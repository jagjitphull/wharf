import { useEffect, useMemo, useState } from "react";
import type { CommandHistoryEntry } from "@shared/types";
import { wharf } from "../../api/wharf";
import { useAppStore } from "../../state/store";
import { EmptyState } from "../EmptyState/EmptyState";
import { IconCheck, IconClock, IconCopy, IconSearch, IconTerminal, IconTrash } from "../Icons/Icons";
import "./CommandHistory.css";

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/** "Today", "Yesterday", or the full date, for the heading above a day's commands. */
function dayLabel(ms: number, now = new Date()): string {
  const d = new Date(ms);
  if (d.toDateString() === now.toDateString()) return "Today";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "short", year: "numeric", month: "short", day: "numeric" });
}

/** Newest-first entries split into consecutive runs that share a calendar day. */
function groupByDay(entries: CommandHistoryEntry[]): { label: string; entries: CommandHistoryEntry[] }[] {
  const groups: { label: string; entries: CommandHistoryEntry[] }[] = [];
  for (const entry of entries) {
    const label = dayLabel(entry.timestamp);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.entries.push(entry);
    else groups.push({ label, entries: [entry] });
  }
  return groups;
}

export function CommandHistory() {
  const [entries, setEntries] = useState<CommandHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

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
    return ordered.filter((e) => e.command.toLowerCase().includes(normalizedFilter) || e.hostName.toLowerCase().includes(normalizedFilter));
  }, [entries, normalizedFilter]);

  const groups = useMemo(() => groupByDay(filtered), [filtered]);

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
        <div>
          <h2>Command history</h2>
          <div className="history-count">
            {entries.length === 0 ? "Nothing recorded yet" : `${entries.length} ${entries.length === 1 ? "command" : "commands"}`}
          </div>
        </div>
        <button className="btn small danger" onClick={clearAll} disabled={entries.length === 0}>
          <IconTrash size={13} />
          Clear history
        </button>
      </div>
      <p className="history-hint">
        A log of commands typed into terminal sessions. For bash, zsh and fish with Command Blocks enabled (Settings), the shell itself
        reports the exact command, so tab completion, history recall (↑/↓) and multi-line commands come through correctly; otherwise it is
        reconstructed from raw keystrokes and can miss those.
      </p>

      <label className="history-search">
        <IconSearch size={14} />
        <input
          className="history-filter"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by command or host…"
        />
      </label>

      <div className="history-list">
        {loading && <div className="history-empty">Loading…</div>}
        {!loading && filtered.length === 0 && normalizedFilter && <div className="history-empty">No matches.</div>}
        {!loading && filtered.length === 0 && !normalizedFilter && (
          <EmptyState
            compact
            icon={<IconClock size={40} />}
            title="No commands recorded yet"
            hint="Commands you run in a terminal show up here, grouped by day, so you can find one again and run it with a click."
          >
            <button className="btn primary small" onClick={() => void useAppStore.getState().openLocalShell()}>
              <IconTerminal size={13} /> Open a local shell
            </button>
          </EmptyState>
        )}
        {!loading &&
          groups.map((group) => (
            <section className="history-group" key={group.label}>
              <h3 className="history-day">{group.label}</h3>
              {group.entries.map((entry) => {
                const expanded = expandedId === entry.id;
                return (
                  <div className={`history-row ${expanded ? "expanded" : ""}`} key={entry.id}>
                    <span className="history-time">{formatTime(entry.timestamp)}</span>
                    <span className="history-host" title={entry.hostName}>
                      {entry.hostName}
                    </span>
                    <button
                      className="history-command"
                      title={expanded ? "Click to collapse" : "Click to show the whole command"}
                      aria-expanded={expanded}
                      onClick={() => setExpandedId(expanded ? null : entry.id)}
                    >
                      {entry.command}
                    </button>
                    <button
                      className={`btn ghost small icon history-copy ${copiedId === entry.id ? "copied" : ""}`}
                      title={copiedId === entry.id ? "Copied" : "Copy command"}
                      aria-label="Copy command"
                      onClick={() => copy(entry)}
                    >
                      {copiedId === entry.id ? <IconCheck size={13} /> : <IconCopy size={13} />}
                    </button>
                  </div>
                );
              })}
            </section>
          ))}
      </div>
    </div>
  );
}
