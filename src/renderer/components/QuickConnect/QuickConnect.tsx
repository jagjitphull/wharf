import { useEffect, useMemo, useRef, useState } from "react";
import type { GroupRecord, HostRecord } from "@shared/types";
import { wharf } from "../../api/wharf";
import "./QuickConnect.css";

type Reachability = "checking" | "online" | "offline";

const REACHABILITY_LABEL: Record<Reachability, string> = {
  checking: "Checking…",
  online: "Online",
  offline: "Offline / unreachable",
};

interface Props {
  hosts: HostRecord[];
  groups: GroupRecord[];
  onClose(): void;
  onConnect(host: HostRecord): void;
}

function groupName(groups: GroupRecord[], groupId: string | null): string | null {
  return groupId ? (groups.find((g) => g.id === groupId)?.name ?? null) : null;
}

function matches(host: HostRecord, query: string): boolean {
  const haystack = `${host.name} ${host.username} ${host.hostname}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => haystack.includes(term));
}

export function QuickConnect({ hosts, groups, onClose, onConnect }: Props) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [reachability, setReachability] = useState<Record<string, Reachability>>({});
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // A raw TCP probe against each host's hostname:port — no SSH handshake,
  // so it can never trigger a host-key prompt or an auth attempt, just
  // "did something answer". Fires fresh every time the palette opens rather
  // than caching, since the whole point is to reflect current status.
  useEffect(() => {
    let cancelled = false;
    setReachability(Object.fromEntries(hosts.map((h) => [h.id, "checking" as const])));
    for (const host of hosts) {
      void wharf.hosts.checkReachable(host.hostname, host.port).then((reachable) => {
        if (cancelled) return;
        setReachability((prev) => ({ ...prev, [host.id]: reachable ? "online" : "offline" }));
      });
    }
    return () => {
      cancelled = true;
    };
  }, [hosts]);

  const results = useMemo(() => {
    const filtered = query.trim() ? hosts.filter((h) => matches(h, query)) : hosts;
    return [...filtered].sort((a, b) => {
      const q = query.toLowerCase();
      const aStarts = a.name.toLowerCase().startsWith(q) ? 0 : 1;
      const bStarts = b.name.toLowerCase().startsWith(q) ? 0 : 1;
      return aStarts !== bStarts ? aStarts - bStarts : a.name.localeCompare(b.name);
    });
  }, [hosts, query]);

  useEffect(() => {
    setSelected(0);
  }, [query]);

  useEffect(() => {
    listRef.current?.children[selected]?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((s) => Math.min(s + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const host = results[selected];
      if (host) onConnect(host);
    }
  }

  return (
    <div className="quick-connect-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="quick-connect">
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Jump to a host…"
        />
        <div className="quick-connect-list" ref={listRef}>
          {results.map((host, i) => (
            <button
              key={host.id}
              className={`quick-connect-row ${i === selected ? "active" : ""}`}
              onMouseEnter={() => setSelected(i)}
              onClick={() => onConnect(host)}
            >
              <span className="dot" style={{ background: host.color ?? "var(--accent)" }} />
              <span className="quick-connect-name">{host.name}</span>
              <span className="quick-connect-sub">
                {host.username}@{host.hostname}:{host.port}
              </span>
              {groupName(groups, host.groupId) && (
                <span className="quick-connect-group">{groupName(groups, host.groupId)}</span>
              )}
              <span
                className={`quick-connect-status ${reachability[host.id] ?? "checking"}`}
                title={REACHABILITY_LABEL[reachability[host.id] ?? "checking"]}
              />
            </button>
          ))}
          {results.length === 0 && <div className="quick-connect-empty">No matching hosts.</div>}
        </div>
        <div className="quick-connect-hint">↑↓ to navigate · Enter to connect · Esc to close</div>
      </div>
    </div>
  );
}
