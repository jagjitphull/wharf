import { useEffect, useRef, useState } from "react";
import type { SnippetRecord } from "@shared/types";
import { useAppStore } from "../../state/store";
import { ipcErrorMessage, wharf } from "../../api/wharf";
import { IconPencil, IconPlus, IconTrash } from "../Icons/Icons";
import { snippetVariables, type SnippetVariable } from "@shared/snippetTemplate";
import { renderForSession } from "./snippetRun";
import "./SnippetPicker.css";

interface Props {
  /** The terminal the snippet goes into — decides what {{$host}}, {{$user}} … mean. */
  sessionId: string;
  onClose(): void;
  /** `run` is the snippet's "press Enter for me" setting. */
  onInsert(command: string, run: boolean): void;
}

export function SnippetPicker({ sessionId, onClose, onInsert }: Props) {
  const { snippets, refreshSnippets } = useAppStore();
  const [filter, setFilter] = useState("");
  const [editing, setEditing] = useState<SnippetRecord | "new" | null>(null);
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [runNow, setRunNow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A snippet whose command contains {{variables}} gets a quick fill-in form here instead of
  // inserting immediately — see shared/snippetTemplate.ts. A plain snippet goes straight to onInsert.
  const [filling, setFilling] = useState<{ snippet: SnippetRecord; variables: SnippetVariable[] } | null>(null);
  const [fillValues, setFillValues] = useState<Record<string, string>>({});
  const inputRef = useRef<HTMLInputElement>(null);
  const firstFillInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing && !filling) inputRef.current?.focus();
    if (filling) firstFillInputRef.current?.focus();
  }, [editing, filling]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !editing) {
        if (filling) setFilling(null);
        else onClose();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [editing, filling, onClose]);

  const visible = snippets.filter(
    (s) => !filter.trim() || s.name.toLowerCase().includes(filter.toLowerCase()) || s.command.toLowerCase().includes(filter.toLowerCase()),
  );

  function startNew() {
    setEditing("new");
    setName("");
    setCommand("");
    setRunNow(false);
    setError(null);
  }

  function startEdit(s: SnippetRecord) {
    setEditing(s);
    setName(s.name);
    setCommand(s.command);
    setRunNow(s.run === true);
    setError(null);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      if (editing === "new") await wharf.snippets.create({ name, command, run: runNow });
      else if (editing) await wharf.snippets.update(editing.id, { name, command, run: runNow });
      setEditing(null);
      await refreshSnippets();
    } catch (err) {
      setError(ipcErrorMessage(err));
    }
  }

  async function handleDelete(s: SnippetRecord) {
    if (!confirm(`Delete snippet "${s.name}"?`)) return;
    await wharf.snippets.remove(s.id);
    await refreshSnippets();
  }

  async function insert(s: SnippetRecord, values: Record<string, string>) {
    onInsert(await renderForSession(s.command, values, sessionId), s.run === true);
  }

  function handleRowClick(s: SnippetRecord) {
    const variables = snippetVariables(s.command);
    if (variables.length === 0) {
      void insert(s, {});
      return;
    }
    setFilling({ snippet: s, variables });
    setFillValues(Object.fromEntries(variables.map((v) => [v.name, v.default ?? ""])));
  }

  function handleFillSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!filling) return;
    void insert(filling.snippet, fillValues);
    setFilling(null);
  }

  return (
    <div className="snippet-picker-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="snippet-picker">
        {filling ? (
          <form className="snippet-form" onSubmit={handleFillSubmit}>
            <h3>{filling.snippet.name}</h3>
            <p className="hint snippet-fill-preview">{filling.snippet.command}</p>
            {filling.variables.map((variable, i) => (
              <label key={variable.name}>
                {variable.name}
                {variable.options ? (
                  <select
                    value={fillValues[variable.name] ?? ""}
                    onChange={(e) => setFillValues({ ...fillValues, [variable.name]: e.target.value })}
                  >
                    {variable.options.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    ref={i === 0 ? firstFillInputRef : undefined}
                    required={variable.default === undefined}
                    value={fillValues[variable.name] ?? ""}
                    onChange={(e) => setFillValues({ ...fillValues, [variable.name]: e.target.value })}
                  />
                )}
              </label>
            ))}
            <div className="snippet-form-actions">
              <button type="button" className="btn ghost small" onClick={() => setFilling(null)}>
                Cancel
              </button>
              <button type="submit" className="btn primary small">
                {filling.snippet.run ? "Run" : "Insert"}
              </button>
            </div>
          </form>
        ) : editing ? (
          <form className="snippet-form" onSubmit={handleSave}>
            <h3>{editing === "new" ? "New snippet" : "Edit snippet"}</h3>
            <label>
              Name
              <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Restart nginx" />
            </label>
            <label>
              Command
              <textarea
                required
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder="sudo systemctl restart nginx"
                rows={3}
              />
            </label>
            <label className="snippet-run-toggle">
              <input type="checkbox" checked={runNow} onChange={(e) => setRunNow(e.target.checked)} />
              Run it right away (press Enter after inserting)
            </label>
            <p className="hint">
              Add <code>{"{{name}}"}</code> to be asked for a value each time, e.g. <code>docker logs -f {"{{container}}"}</code>.{" "}
              <code>{"{{name:default}}"}</code> pre-fills one and <code>{"{{env=prod|staging}}"}</code> offers a choice. Built in:{" "}
              <code>{"{{$host}}"}</code>, <code>{"{{$hostname}}"}</code>, <code>{"{{$user}}"}</code>, <code>{"{{$date}}"}</code>,{" "}
              <code>{"{{$time}}"}</code>, <code>{"{{$timestamp}}"}</code>, <code>{"{{$clipboard}}"}</code>.
            </p>
            {error && <div className="snippet-error">{error}</div>}
            <div className="snippet-form-actions">
              <button type="button" className="btn ghost small" onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button type="submit" className="btn primary small">
                Save
              </button>
            </div>
          </form>
        ) : (
          <>
            <div className="snippet-picker-header">
              <input ref={inputRef} value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter snippets…" />
              <button className="btn primary small" onClick={startNew}>
                <IconPlus size={12} /> New
              </button>
            </div>
            <div className="snippet-list">
              {visible.map((s) => {
                const variables = snippetVariables(s.command);
                return (
                  <div key={s.id} className="snippet-row" onClick={() => handleRowClick(s)}>
                    <div className="snippet-row-text">
                      <div className="snippet-name">
                        {s.name}
                        {variables.length > 0 && (
                          <span className="snippet-workflow-badge" title={`Fill in: ${variables.map((v) => v.name).join(", ")}`}>
                            Workflow
                          </span>
                        )}
                        {s.run && (
                          <span className="snippet-workflow-badge" title="Runs as soon as it is inserted">
                            ⏎ runs
                          </span>
                        )}
                      </div>
                      <div className="snippet-command">{s.command}</div>
                    </div>
                    <div className="snippet-row-actions">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          startEdit(s);
                        }}
                      >
                        <IconPencil />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(s);
                        }}
                      >
                        <IconTrash />
                      </button>
                    </div>
                  </div>
                );
              })}
              {visible.length === 0 && <div className="snippet-empty">{snippets.length === 0 ? "No snippets yet." : "No matches."}</div>}
            </div>
            <div className="snippet-picker-hint">Click a snippet to insert it into the terminal · Esc to close</div>
          </>
        )}
      </div>
    </div>
  );
}
