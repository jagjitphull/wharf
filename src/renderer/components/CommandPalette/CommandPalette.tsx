import { useEffect, useMemo, useRef, useState } from "react";
import type { GroupRecord, HostRecord, SnippetRecord } from "@shared/types";
import { snippetVariables, type SnippetVariable } from "@shared/snippetTemplate";
import { REACHABILITY_LABEL, useReachability } from "../../state/useReachability";
import { IconSearch } from "../Icons/Icons";
import { buildSections, flatten, type PaletteAction, type PaletteEntry } from "./paletteModel";
import "./CommandPalette.css";

interface Props {
  hosts: HostRecord[];
  groups: GroupRecord[];
  actions: PaletteAction[];
  snippets: SnippetRecord[];
  /** Whether a live terminal is focused, i.e. whether a snippet has somewhere to go. */
  canRunSnippets: boolean;
  onClose(): void;
  onConnect(host: HostRecord): void;
  /** Types the snippet into the focused terminal (and runs it, if it is set to). */
  onRunSnippet(snippet: SnippetRecord, values: Record<string, string>): void;
}

function groupName(groups: GroupRecord[], groupId: string | null): string | null {
  return groupId ? (groups.find((g) => g.id === groupId)?.name ?? null) : null;
}

export function CommandPalette({ hosts, groups, actions, snippets, canRunSnippets, onClose, onConnect, onRunSnippet }: Props) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  // A snippet with {{variables}} turns the palette into a small fill-in form until it is run or backed out of.
  const [filling, setFilling] = useState<{ snippet: SnippetRecord; variables: SnippetVariable[] } | null>(null);
  const [fillValues, setFillValues] = useState<Record<string, string>>({});
  const reachability = useReachability(hosts);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const fillRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (filling) fillRef.current?.querySelector<HTMLElement>("input, select")?.focus();
    else inputRef.current?.focus();
  }, [filling]);

  const sections = useMemo(() => buildSections(actions, hosts, query, snippets), [actions, hosts, query, snippets]);
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
    } else if (entry.type === "snippet") {
      const variables = snippetVariables(entry.snippet.command);
      if (variables.length === 0) {
        onClose();
        onRunSnippet(entry.snippet, {});
      } else {
        setFillValues(Object.fromEntries(variables.map((v) => [v.name, v.default ?? ""])));
        setFilling({ snippet: entry.snippet, variables });
      }
    } else {
      onClose();
      entry.action.run();
    }
  }

  function submitFill(e: React.FormEvent) {
    e.preventDefault();
    if (!filling) return;
    onClose();
    onRunSnippet(filling.snippet, fillValues);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      if (filling) setFilling(null);
      else onClose();
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
        {filling ? (
          <form
            className="palette-fill"
            ref={fillRef}
            onSubmit={submitFill}
            onKeyDown={(e) => {
              if (e.key === "Escape") setFilling(null); // back to the list, not out of the palette
            }}
          >
            <div className="palette-fill-title">{filling.snippet.name}</div>
            <div className="palette-fill-preview">{filling.snippet.command}</div>
            {filling.variables.map((v) => (
              <label key={v.name} className="palette-fill-field">
                <span>{v.name}</span>
                {v.options ? (
                  <select value={fillValues[v.name] ?? ""} onChange={(e) => setFillValues({ ...fillValues, [v.name]: e.target.value })}>
                    {v.options.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    required={v.default === undefined}
                    value={fillValues[v.name] ?? ""}
                    onChange={(e) => setFillValues({ ...fillValues, [v.name]: e.target.value })}
                  />
                )}
              </label>
            ))}
            <div className="palette-fill-actions">
              <span className="palette-fill-hint">
                <kbd>esc</kbd> back
              </span>
              <button type="submit" className="btn primary small">
                {filling.snippet.run ? "Run" : "Insert"} <kbd>↵</kbd>
              </button>
            </div>
          </form>
        ) : (
          <>
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
                    if (entry.type === "snippet") {
                      const sn = entry.snippet;
                      const variables = snippetVariables(sn.command);
                      return (
                        <button
                          key={sn.id}
                          className={`palette-row ${active ? "active" : ""}`}
                          onMouseEnter={() => setSelected(i)}
                          onClick={() => choose(entry)}
                        >
                          <span className="palette-text">
                            <span className="palette-title">{sn.name}</span>
                            <span className="palette-sub palette-mono">{sn.command.replace(/\s*\n\s*/g, " ⏎ ")}</span>
                          </span>
                          {!canRunSnippets ? (
                            <span className="palette-group">open a terminal first</span>
                          ) : (
                            active && <kbd>{variables.length > 0 ? "↵ fill in" : sn.run ? "↵ run" : "↵ insert"}</kbd>
                          )}
                        </button>
                      );
                    }
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
          </>
        )}
      </div>
    </div>
  );
}
