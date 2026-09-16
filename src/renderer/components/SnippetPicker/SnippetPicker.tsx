import { useEffect, useRef, useState } from "react";
import type { SnippetRecord } from "@shared/types";
import { useAppStore } from "../../state/store";
import { ipcErrorMessage, wharf } from "../../api/wharf";
import { IconPencil, IconPlus, IconTrash } from "../Icons/Icons";
import { extractPlaceholders, fillPlaceholders } from "./workflowVars";
import "./SnippetPicker.css";

interface Props {
  onClose(): void;
  onInsert(command: string): void;
}

export function SnippetPicker({ onClose, onInsert }: Props) {
  const { snippets, refreshSnippets } = useAppStore();
  const [filter, setFilter] = useState("");
  const [editing, setEditing] = useState<SnippetRecord | "new" | null>(null);
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Warp-style "Workflows": a snippet whose command contains {{placeholder}}
  // tokens gets a quick fill-in form here instead of inserting immediately —
  // see workflowVars.ts. A plain snippet skips straight to onInsert, same as always.
  const [filling, setFilling] = useState<SnippetRecord | null>(null);
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
    (s) =>
      !filter.trim() ||
      s.name.toLowerCase().includes(filter.toLowerCase()) ||
      s.command.toLowerCase().includes(filter.toLowerCase()),
  );

  function startNew() {
    setEditing("new");
    setName("");
    setCommand("");
    setError(null);
  }

  function startEdit(s: SnippetRecord) {
    setEditing(s);
    setName(s.name);
    setCommand(s.command);
    setError(null);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      if (editing === "new") await wharf.snippets.create({ name, command });
      else if (editing) await wharf.snippets.update(editing.id, { name, command });
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

  function handleRowClick(s: SnippetRecord) {
    const placeholders = extractPlaceholders(s.command);
    if (placeholders.length === 0) {
      onInsert(s.command);
      return;
    }
    setFilling(s);
    setFillValues(Object.fromEntries(placeholders.map((p) => [p, ""])));
  }

  function handleFillSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!filling) return;
    onInsert(fillPlaceholders(filling.command, fillValues));
    setFilling(null);
  }

  return (
    <div className="snippet-picker-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="snippet-picker">
        {filling ? (
          <form className="snippet-form" onSubmit={handleFillSubmit}>
            <h3>{filling.name}</h3>
            <p className="hint snippet-fill-preview">{filling.command}</p>
            {extractPlaceholders(filling.command).map((placeholder, i) => (
              <label key={placeholder}>
                {placeholder}
                <input
                  ref={i === 0 ? firstFillInputRef : undefined}
                  required
                  value={fillValues[placeholder] ?? ""}
                  onChange={(e) => setFillValues({ ...fillValues, [placeholder]: e.target.value })}
                />
              </label>
            ))}
            <div className="snippet-form-actions">
              <button type="button" className="btn ghost small" onClick={() => setFilling(null)}>
                Cancel
              </button>
              <button type="submit" className="btn primary small">
                Insert
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
            <p className="hint">
              Add <code>{"{{name}}"}</code> placeholders to turn this into a Workflow — you'll be prompted to fill
              them in each time you insert it, e.g. <code>docker logs -f {"{{container}}"}</code>.
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
              <input
                ref={inputRef}
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter snippets…"
              />
              <button className="btn primary small" onClick={startNew}>
                <IconPlus size={12} /> New
              </button>
            </div>
            <div className="snippet-list">
              {visible.map((s) => {
                const placeholders = extractPlaceholders(s.command);
                return (
                  <div key={s.id} className="snippet-row" onClick={() => handleRowClick(s)}>
                    <div className="snippet-row-text">
                      <div className="snippet-name">
                        {s.name}
                        {placeholders.length > 0 && (
                          <span className="snippet-workflow-badge" title={`Fill in: ${placeholders.join(", ")}`}>
                            Workflow
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
              {visible.length === 0 && (
                <div className="snippet-empty">{snippets.length === 0 ? "No snippets yet." : "No matches."}</div>
              )}
            </div>
            <div className="snippet-picker-hint">Click a snippet to insert it into the terminal · Esc to close</div>
          </>
        )}
      </div>
    </div>
  );
}
