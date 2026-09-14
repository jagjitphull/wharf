import { useEffect, useRef, useState } from "react";
import type { SnippetRecord } from "@shared/types";
import { useAppStore } from "../../state/store";
import { ipcErrorMessage, wharf } from "../../api/wharf";
import { IconPencil, IconPlus, IconTrash } from "../Icons/Icons";
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
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) inputRef.current?.focus();
  }, [editing]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !editing) onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [editing, onClose]);

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

  return (
    <div className="snippet-picker-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="snippet-picker">
        {editing ? (
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
              {visible.map((s) => (
                <div key={s.id} className="snippet-row" onClick={() => onInsert(s.command)}>
                  <div className="snippet-row-text">
                    <div className="snippet-name">{s.name}</div>
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
              ))}
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
