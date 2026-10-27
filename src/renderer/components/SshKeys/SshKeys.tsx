import { useEffect, useState } from "react";
import type { GenerateKeyRequest, HostRecord, SshKeyInfo, SshKeyType } from "@shared/types";
import { ECDSA_BITS, MIN_KEY_PASSPHRASE, RSA_BITS, suggestKeyName, validateGenerateRequest } from "@shared/sshKeys";
import { ipcErrorMessage, wharf } from "../../api/wharf";
import { useAppStore } from "../../state/store";
import { toast } from "../../state/toastStore";
import { IconCopy, IconKey, IconPlus, IconTrash } from "../Icons/Icons";
import "../../styles/dialog.css";
import "./SshKeys.css";

const TYPE_LABEL: Record<string, string> = {
  "ssh-ed25519": "Ed25519",
  "ssh-rsa": "RSA",
  "ecdsa-sha2-nistp256": "ECDSA",
  "ecdsa-sha2-nistp384": "ECDSA",
  "ecdsa-sha2-nistp521": "ECDSA",
};

function typeText(key: SshKeyInfo): string {
  if (!key.type) return "type unknown";
  const label = TYPE_LABEL[key.type] ?? key.type;
  return key.type === "ssh-ed25519" || !key.bits ? label : `${label} ${key.bits}`;
}

function GenerateDialog({ taken, onClose, onCreated }: { taken: string[]; onClose(): void; onCreated(key: SshKeyInfo): void }) {
  const [type, setType] = useState<SshKeyType>("ed25519");
  const [name, setName] = useState(() => suggestKeyName("ed25519", taken));
  const [nameEdited, setNameEdited] = useState(false);
  const [bits, setBits] = useState<number>(4096);
  const [comment, setComment] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function chooseType(next: SshKeyType) {
    setType(next);
    setBits(next === "ecdsa" ? 384 : 4096);
    if (!nameEdited) setName(suggestKeyName(next, taken));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const request: GenerateKeyRequest = {
      name: name.trim(),
      type,
      ...(type === "ed25519" ? {} : { bits }),
      comment: comment.trim(),
      passphrase,
    };
    const problem =
      validateGenerateRequest(request) ?? (taken.includes(request.name) ? `${request.name} already exists. Pick another name.` : null);
    if (problem) return setError(problem);
    if (passphrase !== confirmation) return setError("The two passphrases don't match.");
    setBusy(true);
    try {
      onCreated(await wharf.sshKeys.generate(request));
    } catch (err) {
      setError(ipcErrorMessage(err));
      setBusy(false);
    }
  }

  return (
    <div className="dialog-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        className="dialog keys-dialog"
        noValidate
        onSubmit={submit}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
        aria-label="Generate key"
      >
        <h2>Generate an SSH key</h2>
        <div className="dialog-row">
          <label className="grow">
            Type
            <select value={type} onChange={(e) => chooseType(e.target.value as SshKeyType)}>
              <option value="ed25519">Ed25519 (recommended)</option>
              <option value="rsa">RSA</option>
              <option value="ecdsa">ECDSA</option>
            </select>
          </label>
          {type !== "ed25519" && (
            <label className="narrow">
              Bits
              <select value={bits} onChange={(e) => setBits(Number(e.target.value))}>
                {(type === "rsa" ? RSA_BITS : ECDSA_BITS).map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        <label>
          File name (saved in ~/.ssh)
          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setNameEdited(true);
            }}
            aria-label="Key file name"
            autoFocus
          />
        </label>
        <label>
          Comment (optional — shows after the key, e.g. you@laptop)
          <input value={comment} onChange={(e) => setComment(e.target.value)} />
        </label>
        <label>
          Passphrase (optional, at least {MIN_KEY_PASSPHRASE} characters)
          <input type="password" autoComplete="new-password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />
        </label>
        {passphrase && (
          <label>
            Repeat it
            <input type="password" autoComplete="new-password" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} />
          </label>
        )}
        <p className="hint">
          A passphrase protects the key if the file is copied. Wharf asks for it when you connect with that key, or you can use an SSH
          agent.
        </p>
        {error && <div className="dialog-error">{error}</div>}
        <div className="dialog-actions">
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={busy}>
            {busy ? "Generating…" : "Generate"}
          </button>
        </div>
      </form>
    </div>
  );
}

function InstallDialog({ keyInfo, hosts, onClose }: { keyInfo: SshKeyInfo; hosts: HostRecord[]; onClose(): void }) {
  const [hostId, setHostId] = useState(hosts[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await wharf.sshKeys.install(keyInfo.name, hostId);
      const host = hosts.find((h) => h.id === hostId);
      toast.success(result.added ? `Added ${keyInfo.name} to ${host?.name}` : `${host?.name} already has ${keyInfo.name}`);
      onClose();
    } catch (err) {
      setError(ipcErrorMessage(err));
      setBusy(false);
    }
  }

  return (
    <div className="dialog-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="dialog keys-dialog" onSubmit={submit} onKeyDown={(e) => e.key === "Escape" && onClose()} aria-label="Install key">
        <h2>Install {keyInfo.name} on a host</h2>
        <label>
          Host
          <select value={hostId} onChange={(e) => setHostId(e.target.value)} aria-label="Host">
            {hosts.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name} — {h.username}@{h.hostname}
              </option>
            ))}
          </select>
        </label>
        <p className="hint">
          Adds the public key to that host&apos;s <code>~/.ssh/authorized_keys</code> (once), signing in with the host&apos;s saved login.
          After that you can switch the host to key authentication.
        </p>
        {error && <div className="dialog-error">{error}</div>}
        <div className="dialog-actions">
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={busy || !hostId}>
            {busy ? "Installing…" : "Install"}
          </button>
        </div>
      </form>
    </div>
  );
}

export function SshKeys() {
  const hosts = useAppStore((s) => s.hosts);
  const [keys, setKeys] = useState<SshKeyInfo[] | null>(null);
  const [generating, setGenerating] = useState(false);
  const [installing, setInstalling] = useState<SshKeyInfo | null>(null);

  async function refresh() {
    try {
      setKeys(await wharf.sshKeys.list());
    } catch (err) {
      setKeys([]);
      toast.error(ipcErrorMessage(err));
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function copyPublic(key: SshKeyInfo) {
    const line = await wharf.sshKeys.publicKey(key.name);
    if (!line) {
      toast.error(`${key.name}'s public half can't be read — it needs a ${key.name}.pub file next to it.`);
      return;
    }
    wharf.clipboard.writeText(line);
    toast.success(`Public key of ${key.name} copied`);
  }

  async function remove(key: SshKeyInfo) {
    const used =
      key.usedBy.length > 0 ? `\n\nHosts using it: ${key.usedBy.join(", ")} — they will stop being able to sign in with it.` : "";
    if (!confirm(`Delete ${key.path} and ${key.name}.pub? This can't be undone.${used}`)) return;
    try {
      await wharf.sshKeys.remove(key.name);
      await refresh();
    } catch (err) {
      toast.error(ipcErrorMessage(err));
    }
  }

  return (
    <div className="keys-panel">
      <div className="keys-header">
        <div>
          <h2>SSH keys</h2>
          <div className="keys-sub">
            {keys === null
              ? "Looking in ~/.ssh…"
              : keys.length === 0
                ? "No keys in ~/.ssh"
                : `${keys.length} ${keys.length === 1 ? "key" : "keys"} in ~/.ssh`}
          </div>
        </div>
        <button className="btn primary small" onClick={() => setGenerating(true)}>
          <IconPlus size={13} /> Generate key…
        </button>
      </div>

      {keys !== null && keys.length === 0 && (
        <div className="keys-empty">
          <span className="keys-empty-icon">
            <IconKey size={28} />
          </span>
          <p>You have no private keys in ~/.ssh yet. Make one, put its public half on a server, and sign in without typing a password.</p>
        </div>
      )}

      <div className="keys-list">
        {(keys ?? []).map((key) => (
          <div className="key-row" key={key.name}>
            <span className="key-icon">
              <IconKey size={18} />
            </span>
            <div className="key-main">
              <div className="key-title">
                <strong>{key.name}</strong>
                <span className="key-badge">{typeText(key)}</span>
                {key.encrypted && <span className="key-badge key-badge-lock">passphrase</span>}
                {!key.hasPublicFile && <span className="key-badge key-badge-warn">no .pub</span>}
              </div>
              <div className="key-fingerprint" title="SHA256 fingerprint, as `ssh-keygen -l` shows it">
                {key.fingerprint ?? "fingerprint unavailable — protected key without a .pub file"}
              </div>
              <div className="key-meta">
                {key.comment && <span>{key.comment}</span>}
                <span>{new Date(key.modifiedAt).toLocaleDateString()}</span>
                {key.usedBy.length > 0 && <span className="key-used">used by {key.usedBy.join(", ")}</span>}
              </div>
            </div>
            <div className="key-actions">
              <button className="btn ghost small" onClick={() => void copyPublic(key)} title="Copy the public key">
                <IconCopy size={13} /> Copy public key
              </button>
              <button
                className="btn ghost small"
                onClick={() => setInstalling(key)}
                disabled={hosts.length === 0}
                title="Add it to a host's authorized_keys"
              >
                Install on host…
              </button>
              <button
                className="btn ghost small icon"
                onClick={() => void remove(key)}
                title="Delete key"
                aria-label={`Delete ${key.name}`}
              >
                <IconTrash size={13} />
              </button>
            </div>
          </div>
        ))}
      </div>

      {generating && (
        <GenerateDialog
          taken={(keys ?? []).map((k) => k.name)}
          onClose={() => setGenerating(false)}
          onCreated={(key) => {
            setGenerating(false);
            toast.success(`Created ${key.name}`);
            void refresh();
          }}
        />
      )}
      {installing && <InstallDialog keyInfo={installing} hosts={hosts} onClose={() => setInstalling(null)} />}
    </div>
  );
}
