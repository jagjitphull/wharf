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
    // Deferred a frame rather than called synchronously here — this dialog
    // always opens in response to a button click, and stealing focus in the
    // very same tick as that click risks losing the race for real OS-level
    // keyboard focus on some Linux/Electron setups (reported: the input
    // visibly shows its default text selected, but typed keystrokes don't
    // land — consistent with the button that opened the dialog still
    // actually holding focus). Same fix already used for Terminal's own
    // search bar (Terminal.tsx) for the same class of issue.
    const raf = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => cancelAnimationFrame(raf);
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
