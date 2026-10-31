import { useCallback, useEffect, useState } from "react";
import type { SecretStorageStatus } from "@shared/types";
import { ipcErrorMessage, wharf } from "../../api/wharf";
import { AUTO_LOCK_CHOICES } from "../../../shared/autoLock";

const AUTO_LOCK_LABEL: Record<number, string> = {
  0: "Never",
  5: "After 5 minutes",
  15: "After 15 minutes",
  30: "After 30 minutes",
  60: "After 1 hour",
  240: "After 4 hours",
};

type Form = "set" | "change" | "remove" | "unlock" | null;

/** Where saved passwords and key passphrases end up: encrypted with the OS
 * keyring, sealed with a master password, or — on a Linux machine with
 * neither — only base64-encoded, which is worth saying out loud rather than
 * leaving to the README. */
export function SecretStorageSettings() {
  const [status, setStatus] = useState<SecretStorageStatus | null>(null);
  const [form, setForm] = useState<Form>(null);
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [autoLock, setAutoLock] = useState(0);

  const refresh = useCallback(() => wharf.secrets.status().then(setStatus), []);
  useEffect(() => {
    void refresh();
    void wharf.secrets.getAutoLock().then(setAutoLock);
    // "Lock now" and auto-lock both land here: keep the buttons in step with the real state.
    return wharf.secrets.onLocked(() => void refresh());
  }, [refresh]);

  function open(next: Form) {
    setForm(next);
    setCurrent("");
    setPassword("");
    setConfirmation("");
    setError(null);
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      setForm(null);
      await refresh();
    } catch (err) {
      setError(ipcErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if ((form === "set" || form === "change") && password !== confirmation) {
      setError("The two passwords don't match.");
      return;
    }
    if (form === "set") void run(() => wharf.secrets.setMasterPassword(password));
    else if (form === "change") void run(() => wharf.secrets.changeMasterPassword(current, password));
    else if (form === "remove") void run(() => wharf.secrets.removeMasterPassword(current));
    else if (form === "unlock") void run(() => wharf.secrets.unlock(current));
  }

  async function forgot() {
    if (
      !confirm(
        "This erases every saved password and key passphrase, your Command History, saved workspaces and the last session (all sealed with the master password), and removes the master password. Hosts and settings are kept. Continue?",
      )
    )
      return;
    await run(() => wharf.secrets.reset());
  }

  if (!status) return null;
  const master = status.masterPassword;

  return (
    <>
      {master === "none" &&
        (status.encrypted && status.unencryptedCount === 0 ? (
          <p className="hint">Saved passwords and key passphrases are encrypted with your system keyring.</p>
        ) : (
          <div className="secret-warning" role="alert">
            <strong>No system keyring found.</strong> Saved passwords and key passphrases are only base64-encoded in{" "}
            <code>wharf-data.json</code> — not encrypted. That file is readable by your user only, but anyone who can read it (or a backup
            of it) can recover them. A master password (below) encrypts them without needing a keyring. Installing and unlocking a keyring
            (GNOME Keyring, KWallet, or anything that provides the Secret Service) also fixes this: Wharf encrypts the ones already saved
            the next time it starts. An SSH agent or a key without a passphrase avoids storing a secret at all.
            {status.unencryptedCount > 0 && (
              <>
                {" "}
                Right now {status.unencryptedCount} saved {status.unencryptedCount === 1 ? "secret is" : "secrets are"} stored this way.
              </>
            )}
          </div>
        ))}
      {master !== "none" && (
        <p className="hint">
          Saved passwords, key passphrases, Command History, saved workspaces and the last session are encrypted with your master password
          {master === "locked" ? " and are locked until you enter it." : "."} Wharf asks for it each time it starts; there is no way to
          recover it if it is forgotten.
        </p>
      )}

      {master !== "none" && (
        <div className="appearance-row">
          <span className="appearance-label">Lock automatically when idle</span>
          <select
            className="font-family-select"
            value={autoLock}
            onChange={(e) => void wharf.secrets.setAutoLock(Number(e.target.value)).then(setAutoLock)}
          >
            {AUTO_LOCK_CHOICES.map((m) => (
              <option key={m} value={m}>
                {AUTO_LOCK_LABEL[m]}
              </option>
            ))}
          </select>
        </div>
      )}
      {master !== "none" && autoLock > 0 && (
        <p className="hint">
          Idle means no typing or clicking in any Wharf window. Locking only forgets the key: open sessions and tunnels keep running, but
          one that has to reconnect with a saved password waits for you to unlock.
        </p>
      )}

      <div className="backup-actions">
        {master === "none" && (
          <button className="btn ghost small" onClick={() => open("set")}>
            Set a master password…
          </button>
        )}
        {master === "locked" && (
          <button className="btn ghost small" onClick={() => open("unlock")}>
            Unlock…
          </button>
        )}
        {master === "unlocked" && (
          <>
            <button className="btn ghost small" onClick={() => void run(() => wharf.secrets.lock())}>
              Lock now
            </button>
            <button className="btn ghost small" onClick={() => open("change")}>
              Change master password…
            </button>
            <button className="btn ghost small" onClick={() => open("remove")}>
              Remove master password…
            </button>
          </>
        )}
        {master === "locked" && (
          <button className="btn ghost small" onClick={() => void forgot()}>
            Forgot it…
          </button>
        )}
      </div>

      {form && (
        <form className="master-password-form" onSubmit={submit}>
          {(form === "change" || form === "remove" || form === "unlock") && (
            <label>
              {form === "change" ? "Current master password" : "Master password"}
              <input
                type="password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                autoComplete="current-password"
                autoFocus
              />
            </label>
          )}
          {(form === "set" || form === "change") && (
            <>
              <label>
                {form === "change" ? "New master password" : "Master password"} (at least 8 characters)
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  autoFocus={form === "set"}
                />
              </label>
              <label>
                Repeat it
                <input type="password" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} autoComplete="new-password" />
              </label>
            </>
          )}
          {form === "set" && (
            <p className="hint">
              Every saved password and passphrase is re-encrypted under this password. If you forget it they cannot be recovered; you would
              have to erase them and enter each one again.
            </p>
          )}
          {form === "remove" && !status.keyringAvailable && (
            <p className="hint">
              This machine has no system keyring, so after removing the master password saved secrets are only base64-encoded again.
            </p>
          )}
          {error && <div className="dialog-error">{error}</div>}
          <div className="backup-actions">
            <button type="button" className="btn ghost small" onClick={() => open(null)}>
              Cancel
            </button>
            <button type="submit" className="btn small" disabled={busy}>
              {busy
                ? "Working…"
                : form === "set"
                  ? "Set password"
                  : form === "change"
                    ? "Change password"
                    : form === "remove"
                      ? "Remove"
                      : "Unlock"}
            </button>
          </div>
        </form>
      )}
    </>
  );
}
