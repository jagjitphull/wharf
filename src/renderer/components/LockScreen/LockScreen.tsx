import { useEffect, useRef, useState } from "react";
import { ipcErrorMessage, wharf } from "../../api/wharf";
import "../../styles/dialog.css";
import "./LockScreen.css";

interface Props {
  /** Passwords are unlocked (or the user chose to carry on without them). */
  onDone(): void;
}

/**
 * Asked for when Wharf starts with a master password set. It sits below the
 * title bar (the window has no native frame, so the title bar's window
 * controls stay usable) and blocks the app until the password is entered or
 * the user carries on without unlocking: hosts that use an agent or a key
 * without a passphrase still work, saved passwords just can't be used.
 */
export function LockScreen({ onDone }: Props) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const raf = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, []);

  async function unlock(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await wharf.secrets.unlock(password);
      onDone();
    } catch (err) {
      setError(ipcErrorMessage(err));
      setPassword("");
      inputRef.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  async function forgot() {
    if (
      !confirm(
        "This erases every saved password and key passphrase, and removes the master password. Your hosts and settings are kept, but you will need to enter each password again. Continue?",
      )
    ) {
      return;
    }
    try {
      await wharf.secrets.reset();
      onDone();
    } catch (err) {
      setError(ipcErrorMessage(err));
    }
  }

  return (
    <div className="lock-screen" role="dialog" aria-modal="true" aria-label="Unlock Wharf">
      <form className="dialog lock-dialog" onSubmit={unlock}>
        <h2>Saved passwords are locked</h2>
        <p className="hint">Enter your master password to use saved passwords and key passphrases.</p>
        <label>
          Master password
          <input
            ref={inputRef}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </label>
        {error && <div className="dialog-error">{error}</div>}
        <div className="dialog-actions">
          <button type="button" className="btn ghost" onClick={onDone}>
            Continue without unlocking
          </button>
          <button type="submit" className="btn primary" disabled={busy || password.length === 0}>
            {busy ? "Unlocking…" : "Unlock"}
          </button>
        </div>
        <button type="button" className="lock-forgot" onClick={() => void forgot()}>
          Forgot the password…
        </button>
      </form>
    </div>
  );
}
