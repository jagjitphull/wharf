import { useEffect, useRef, useState } from "react";
import "../../styles/dialog.css";

interface Props {
  title: string;
  label?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  onCancel(): void;
  onSubmit(value: string): void;
}

/**
 * A single-text-field dialog standing in for `window.prompt()`, which
 * Electron's renderer doesn't implement — calling it throws
 * "prompt() is and will not be supported" synchronously, so every prior
 * call site (SFTP new-folder/rename, saving a workspace) silently did
 * nothing instead of asking anything. `window.confirm()`/`alert()` are
 * fine (Electron does implement those as real native dialogs); this is
 * only needed for the free-text case.
 */
export function PromptDialog({ title, label, defaultValue, placeholder, confirmLabel = "Save", onCancel, onSubmit }: Props) {
  const [value, setValue] = useState(defaultValue ?? "");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = value.trim();
    if (trimmed) onSubmit(trimmed);
  }

  return (
    <div className="dialog-overlay" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <form className="dialog" onSubmit={handleSubmit}>
        <h2>{title}</h2>
        <label>
          {label}
          <input ref={inputRef} value={value} onChange={(e) => setValue(e.target.value)} placeholder={placeholder} />
        </label>
        <div className="dialog-actions">
          <button type="button" className="btn ghost" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={!value.trim()}>
            {confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
