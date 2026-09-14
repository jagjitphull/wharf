import { useState } from "react";
import { useAppStore } from "../../state/store";
import { ipcErrorMessage, wharf } from "../../api/wharf";
import "../../styles/dialog.css";
import "./Settings.css";

const VALIDITY_LABEL: Record<string, string> = {
  unactivated: "No license activated",
  valid: "Active",
  expired: "Expired",
  invalid: "Invalid license key",
  revoked: "Revoked",
};

export function Settings() {
  const { license, refreshLicense } = useAppStore();
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function activate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await wharf.license.activate(key.trim());
      if (result.validity !== "valid") {
        setError(VALIDITY_LABEL[result.validity] ?? "Could not activate this license key.");
      } else {
        setKey("");
      }
      await refreshLicense();
    } catch (err) {
      setError(ipcErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function deactivate() {
    if (!confirm("Deactivate the current license? Pro features will be locked.")) return;
    await wharf.license.deactivate();
    await refreshLicense();
  }

  const isPro = license?.validity === "valid" && license.plan === "pro";

  return (
    <div className="settings-panel">
      <h2>License</h2>

      <div className={`license-card ${isPro ? "pro" : ""}`}>
        <div className="license-status">
          <span className={`status-dot ${license?.validity ?? "unactivated"}`} />
          {license ? VALIDITY_LABEL[license.validity] : "Loading…"}
        </div>

        {license?.payload && (
          <dl className="license-details">
            <dt>Plan</dt>
            <dd>{license.payload.plan === "pro" ? "Pro" : "Free"}</dd>
            <dt>Email</dt>
            <dd>{license.payload.email}</dd>
            <dt>Seats</dt>
            <dd>{license.payload.seats}</dd>
            <dt>Expires</dt>
            <dd>{license.payload.expiresAt ? new Date(license.payload.expiresAt).toLocaleDateString() : "Never (perpetual)"}</dd>
            <dt>Features</dt>
            <dd>{license.payload.features.join(", ") || "(plan default)"}</dd>
          </dl>
        )}

        {isPro ? (
          <button className="btn ghost small" onClick={deactivate}>
            Deactivate license
          </button>
        ) : (
          <form className="activate-form" onSubmit={activate}>
            <input
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="Paste your Wharf Pro license key…"
              spellCheck={false}
            />
            <button className="btn primary small" type="submit" disabled={busy || !key.trim()}>
              {busy ? "Activating…" : "Activate"}
            </button>
          </form>
        )}
        {error && <div className="dialog-error">{error}</div>}
      </div>

      <div className="settings-dev-note">
        <h3>Testing Pro locally</h3>
        <p>This starter ships with a dev signing key so you can issue test licenses without a backend:</p>
        <pre>{`npm run license:generate -- --email you@example.com --plan pro --days 365`}</pre>
        <p>Paste the printed key above. Swap the signing key before shipping a real release — see keys.ts.</p>
      </div>

      <h2>About</h2>
      <p className="hint">Wharf — an SSH/SFTP client starter with a gated Pro tier (unlimited hosts/groups, jump hosts, port forwarding).</p>
    </div>
  );
}
