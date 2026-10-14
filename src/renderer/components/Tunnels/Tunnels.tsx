import { useEffect, useState } from "react";
import type { TunnelInput, TunnelStatus, TunnelType } from "@shared/types";
import { useAppStore } from "../../state/store";
import { ipcErrorMessage, wharf } from "../../api/wharf";
import "../../styles/dialog.css";
import "./Tunnels.css";

const emptyForm = (hostId: string): TunnelInput => ({
  hostId,
  name: "",
  type: "local",
  srcHost: "127.0.0.1",
  srcPort: 8080,
  dstHost: "127.0.0.1",
  dstPort: 80,
});

export function Tunnels() {
  const { hosts, tunnels, refreshTunnels } = useAppStore();

  const [statuses, setStatuses] = useState<Record<string, { status: TunnelStatus; error?: string }>>({});
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<TunnelInput>(() => emptyForm(hosts[0]?.id ?? ""));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return wharf.tunnels.onState(({ tunnelId, status, error }) => {
      setStatuses((prev) => ({ ...prev, [tunnelId]: { status, error } }));
    });
  }, []);

  async function createTunnel(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const input = form.type === "dynamic" ? { ...form, dstHost: undefined, dstPort: undefined } : form;
      await wharf.tunnels.create(input);
      setShowForm(false);
      await refreshTunnels();
    } catch (err) {
      setError(ipcErrorMessage(err));
    }
  }

  async function removeTunnel(id: string) {
    if (!confirm("Delete this tunnel?")) return;
    await wharf.tunnels.remove(id);
    await refreshTunnels();
  }

  async function toggleTunnel(id: string, running: boolean) {
    setError(null);
    try {
      if (running) await wharf.tunnels.stop(id);
      else await wharf.tunnels.start(id);
    } catch (err) {
      setError(ipcErrorMessage(err));
    }
  }

  return (
    <div className="tunnels-panel">
      <div className="tunnels-header">
        <h2>Port forwarding</h2>
        <button className="btn primary small" onClick={() => setShowForm((v) => !v)} disabled={hosts.length === 0}>
          + Tunnel
        </button>
      </div>

      {hosts.length === 0 && <p className="hint">Add a host first to create a tunnel against it.</p>}
      {error && <div className="dialog-error">{error}</div>}

      {showForm && (
        <form className="tunnel-form" onSubmit={createTunnel}>
          <label>
            Name
            <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="postgres tunnel" />
          </label>
          <label>
            Host
            <select value={form.hostId} onChange={(e) => setForm({ ...form, hostId: e.target.value })}>
              {hosts.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Type
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as TunnelType })}>
              <option value="local">Local (bind here → forward to remote)</option>
              <option value="remote">Remote (bind on remote → forward to here)</option>
              <option value="dynamic">Dynamic / SOCKS5 (bind here → proxy, destination chosen per-connection)</option>
            </select>
          </label>
          <div className="dialog-row">
            <label className="grow">
              Source host
              <input value={form.srcHost} onChange={(e) => setForm({ ...form, srcHost: e.target.value })} />
            </label>
            <label className="narrow">
              Source port
              <input type="number" value={form.srcPort} onChange={(e) => setForm({ ...form, srcPort: Number(e.target.value) })} />
            </label>
          </div>
          {form.type !== "dynamic" && (
            <div className="dialog-row">
              <label className="grow">
                Destination host
                <input value={form.dstHost} onChange={(e) => setForm({ ...form, dstHost: e.target.value })} />
              </label>
              <label className="narrow">
                Destination port
                <input type="number" value={form.dstPort} onChange={(e) => setForm({ ...form, dstPort: Number(e.target.value) })} />
              </label>
            </div>
          )}
          <div className="dialog-actions">
            <button type="button" className="btn ghost" onClick={() => setShowForm(false)}>
              Cancel
            </button>
            <button type="submit" className="btn primary">
              Create
            </button>
          </div>
        </form>
      )}

      <div className="tunnel-list">
        {tunnels.map((t) => {
          const state = statuses[t.id];
          const running = state?.status === "running" || state?.status === "starting";
          return (
            <div key={t.id} className="tunnel-row">
              <div className="tunnel-info">
                <span className={`tunnel-dot ${state?.status ?? "stopped"}`} />
                <div>
                  <div className="tunnel-name">{t.name}</div>
                  <div className="tunnel-sub">
                    {t.type === "dynamic"
                      ? `dynamic (SOCKS5) · listening on ${t.srcHost}:${t.srcPort}`
                      : `${t.type} · ${t.srcHost}:${t.srcPort} → ${t.dstHost}:${t.dstPort}`}
                  </div>
                  {state?.error && <div className="tunnel-error">{state.error}</div>}
                </div>
              </div>
              <div className="tunnel-actions">
                <button className="btn ghost small" onClick={() => toggleTunnel(t.id, running)}>
                  {running ? "Stop" : "Start"}
                </button>
                <button className="btn ghost small" onClick={() => removeTunnel(t.id)}>
                  Delete
                </button>
              </div>
            </div>
          );
        })}
        {tunnels.length === 0 && !showForm && <p className="hint">No tunnels yet.</p>}
      </div>
    </div>
  );
}
