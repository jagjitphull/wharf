import { useEffect, useState } from "react";
import type { AuthMethod, GroupRecord, HostInput, HostRecord } from "@shared/types";
import { ipcErrorMessage, wharf } from "../../api/wharf";
import "../../styles/dialog.css";

interface Props {
  host: HostRecord | null;
  groups: GroupRecord[];
  hosts: HostRecord[];
  isPro: boolean;
  defaultGroupId: string | null;
  onClose(): void;
  onSaved(): void;
}

const emptyForm = (defaultGroupId: string | null): HostInput => ({
  name: "",
  hostname: "",
  port: 22,
  username: "",
  groupId: defaultGroupId,
  authMethod: "password",
  secret: "",
  privateKeyPath: "",
  jumpHostId: null,
});

export function HostDialog({ host, groups, hosts, isPro, defaultGroupId, onClose, onSaved }: Props) {
  const [form, setForm] = useState<HostInput>(() =>
    host
      ? {
          name: host.name,
          hostname: host.hostname,
          port: host.port,
          username: host.username,
          groupId: host.groupId,
          authMethod: host.authMethod,
          secret: "",
          privateKeyPath: host.privateKeyPath ?? "",
          jumpHostId: host.jumpHostId ?? null,
          color: host.color,
          tags: host.tags,
        }
      : emptyForm(defaultGroupId),
  );
  const [secretPlaceholder] = useState(host?.secretId ? "•••••••• (unchanged)" : "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const input: HostInput = { ...form, port: Number(form.port) || 22 };
      if (host) await wharf.hosts.update(host.id, input);
      else await wharf.hosts.create(input);
      onSaved();
    } catch (err) {
      setError(ipcErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const jumpHostCandidates = hosts.filter((h) => h.id !== host?.id);

  return (
    <div className="dialog-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="dialog" onSubmit={handleSubmit}>
        <h2>{host ? "Edit host" : "Add host"}</h2>

        <label>
          Name
          <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="prod-web-1" />
        </label>

        <div className="dialog-row">
          <label className="grow">
            Hostname / IP
            <input required value={form.hostname} onChange={(e) => setForm({ ...form, hostname: e.target.value })} placeholder="203.0.113.10" />
          </label>
          <label className="narrow">
            Port
            <input required type="number" value={form.port} onChange={(e) => setForm({ ...form, port: Number(e.target.value) })} />
          </label>
        </div>

        <label>
          Username
          <input required value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder="root" />
        </label>

        <label>
          Group
          <select
            value={form.groupId ?? ""}
            onChange={(e) => setForm({ ...form, groupId: e.target.value || null })}
          >
            <option value="">(none)</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          Auth method
          <select
            value={form.authMethod}
            onChange={(e) => setForm({ ...form, authMethod: e.target.value as AuthMethod })}
          >
            <option value="password">Password</option>
            <option value="privateKey">Private key</option>
            <option value="agent">SSH agent</option>
          </select>
        </label>

        {form.authMethod === "password" && (
          <label>
            Password
            <input
              type="password"
              value={form.secret}
              placeholder={secretPlaceholder}
              onChange={(e) => setForm({ ...form, secret: e.target.value })}
            />
          </label>
        )}

        {form.authMethod === "privateKey" && (
          <>
            <label>
              Private key file path
              <input
                required
                value={form.privateKeyPath}
                onChange={(e) => setForm({ ...form, privateKeyPath: e.target.value })}
                placeholder="/home/you/.ssh/id_ed25519"
              />
            </label>
            <label>
              Key passphrase (if any)
              <input
                type="password"
                value={form.secret}
                placeholder={secretPlaceholder}
                onChange={(e) => setForm({ ...form, secret: e.target.value })}
              />
            </label>
          </>
        )}

        <label>
          Jump host {!isPro && <span className="pro-badge">PRO</span>}
          <select
            disabled={!isPro}
            value={form.jumpHostId ?? ""}
            onChange={(e) => setForm({ ...form, jumpHostId: e.target.value || null })}
          >
            <option value="">(direct connection)</option>
            {jumpHostCandidates.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
        </label>

        {error && <div className="dialog-error">{error}</div>}

        <div className="dialog-actions">
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}
