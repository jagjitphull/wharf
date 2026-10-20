import { useEffect, useMemo, useRef, useState } from "react";
import type { GroupRecord, HostRecord } from "@shared/types";
import { REACHABILITY_LABEL, useReachability } from "../../state/useReachability";
import { IconSearch } from "../Icons/Icons";
import { buildSections, flatten, type PaletteAction, type PaletteEntry } from "./paletteModel";
import "./CommandPalette.css";

interface Props {
  hosts: HostRecord[];
  groups: GroupRecord[];
  actions: PaletteAction[];
  onClose(): void;
  onConnect(host: HostRecord): void;
}

function groupName(groups: GroupRecord[], groupId: string | null): string | null {
  return groupId ? (groups.find((g) => g.id === groupId)?.name ?? null) : null;
}

export function CommandPalette({ hosts, groups, actions, onClose, onConnect }: Props) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const reachability = useReachability(hosts);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const sections = useMemo(() => buildSections(actions, hosts, query), [actions, hosts, query]);
  const entries = useMemo(() => flatten(sections), [sections]);

  useEffect(() => {
    setSelected(0);
  }, [query]);

  useEffect(() => {
    listRef.current?.querySelector(".palette-row.active")?.scrollIntoView({ block: "nearest" });
  }, [selected, sections]);

  function choose(entry: PaletteEntry | undefined) {
    if (!entry) return;
    if (entry.type === "host") {
      onConnect(entry.host);
    } else {
      onClose();
      entry.action.run();
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((s) => Math.min(s + 1, entries.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(entries[selected]);
    }
  }

  let index = -1;
  return (
    <div className="palette-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-label="Command palette">
        <div className="palette-input">
          <IconSearch size={18} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Jump to a host, or type > for actions…"
            aria-label="Search hosts and actions"
          />
          <kbd>esc</kbd>
        </div>
        <div className="palette-list" ref={listRef}>
          {sections.map((section) => (
            <div key={section.title} className="palette-section">
              <div className="palette-section-title">{section.title}</div>
              {section.entries.map((entry) => {
                index += 1;
                const i = index;
                const active = i === selected;
                if (entry.type === "action") {
                  const a = entry.action;
                  return (
                    <button
                      key={a.id}
                      className={`palette-row ${active ? "active" : ""}`}
                      onMouseEnter={() => setSelected(i)}
                      onClick={() => choose(entry)}
                    >
                      <span className="palette-text">
                        <span className="palette-title">{a.title}</span>
                        {a.subtitle && <span className="palette-sub">{a.subtitle}</span>}
                      </span>
                      {a.keys && <kbd>{a.keys}</kbd>}
                    </button>
                  );
                }
                const host = entry.host;
                const status = reachability[host.id] ?? "checking";
                const group = groupName(groups, host.groupId);
                return (
                  <button
                    key={host.id}
                    className={`palette-row ${active ? "active" : ""}`}
                    onMouseEnter={() => setSelected(i)}
                    onClick={() => choose(entry)}
                  >
                    <span className="palette-dot" style={{ background: host.color ?? "var(--accent)" }} />
                    <span className="palette-text">
                      <span className="palette-title">{host.name}</span>
                      <span className="palette-sub palette-mono">
                        {host.username}@{host.hostname}:{host.port}
                      </span>
                    </span>
                    {group && <span className="palette-group">{group}</span>}
                    <span className={`palette-status ${status}`} title={REACHABILITY_LABEL[status]} />
                    {active && <kbd>↵ connect</kbd>}
                  </button>
                );
              })}
            </div>
          ))}
          {entries.length === 0 && <div className="palette-empty">Nothing matches “{query}”.</div>}
        </div>
        <div className="palette-footer">
          <span>
            <kbd>↑ ↓</kbd> navigate
          </span>
          <span>
            <kbd>↵</kbd> run
          </span>
          <span className="palette-footer-hint">
            Type <kbd>&gt;</kbd> for actions only
          </span>
        </div>
      </div>
    </div>
  );
}
