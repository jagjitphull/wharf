import { useMemo, useState } from "react";
import type { HostRecord, TunnelInput, TunnelType } from "@shared/types";
import { validateTunnelInput } from "@shared/tunnelInput";
import { ipcErrorMessage, wharf } from "../../api/wharf";
import { useAppStore } from "../../state/store";
import { toast } from "../../state/toastStore";
import { describeTunnel, SERVICE_PRESETS, suggestLocalPort, suggestTunnelName } from "./tunnelPlan";
import "../../styles/dialog.css";
import "./TunnelDialog.css";

interface Props {
  host: HostRecord;
  onClose(): void;
}

const TYPE_LABEL: Record<TunnelType, string> = { local: "Local", remote: "Remote", dynamic: "SOCKS proxy" };
const TYPE_HELP: Record<TunnelType, string> = {
  local: "Listen on this computer and forward to a service reachable from the host.",
  remote: "Listen on the host and forward back to a service on this computer.",
  dynamic: "Listen on this computer as a SOCKS5 proxy; each connection goes out through the host.",
};

/** Sets up a port forward for one host without leaving Home. */
export function TunnelDialog({ host, onClose }: Props) {
  const tunnels = useAppStore((s) => s.tunnels);
  const refreshTunnels = useAppStore((s) => s.refreshTunnels);
  const usedPorts = useMemo(() => tunnels.map((t) => t.srcPort), [tunnels]);

  const [type, setType] = useState<TunnelType>("local");
  const [dstHost, setDstHost] = useState("127.0.0.1");
  const [dstPort, setDstPort] = useState(5432);
  const [srcHost, setSrcHost] = useState("127.0.0.1");
  const [srcPort, setSrcPort] = useState(() => suggestLocalPort(5432, usedPorts));
  const [name, setName] = useState("");
  const [startNow, setStartNow] = useState(true);
  const [autoStart, setAutoStart] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The name follows the other fields until it is typed into.
  const suggestedName = suggestTunnelName(host.name, type, srcPort, dstHost, dstPort);
  const shownName = name || suggestedName;

  function pickService(port: number) {
    setDstPort(port);
    setSrcPort(suggestLocalPort(port, usedPorts));
  }

  const input: TunnelInput = {
    hostId: host.id,
    name: shownName.trim(),
    type,
    srcHost: srcHost.trim(),
    srcPort,
    ...(type === "dynamic" ? {} : { dstHost: dstHost.trim(), dstPort }),
    ...(autoStart ? { autoStart: true } : {}),
  };
  const clash = tunnels.find((t) => t.srcPort === srcPort && t.srcHost === srcHost.trim());

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const problem = validateTunnelInput(input) ?? (clash ? `Port ${srcPort} is already used by the tunnel “${clash.name}”.` : null);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    let created;
    try {
      created = await wharf.tunnels.create(input);
      await refreshTunnels();
    } catch (err) {
      setError(ipcErrorMessage(err));
      setBusy(false);
      return;
    }
    const what = describeTunnel(type, input.srcHost, srcPort, dstHost.trim(), dstPort);
    if (!startNow) {
      toast.success(`Tunnel saved: ${what}`);
      onClose();
      return;
    }
    try {
      await wharf.tunnels.start(created.id);
      toast.success(`Tunnel running: ${what}`);
    } catch (err) {
      // It is saved either way; the Tunnels page shows it stopped, ready to start once the cause is fixed.
      toast.error(`Tunnel saved, but it couldn't start: ${ipcErrorMessage(err)}`);
    }
    onClose();
  }

  return (
    <div className="dialog-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        className="dialog tunnel-dialog"
        noValidate
        onSubmit={submit}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
        aria-label="Port forward"
      >
        <h2>Port forward through {host.name}</h2>

        <div className="tunnel-type" role="radiogroup" aria-label="Tunnel type">
          {(Object.keys(TYPE_LABEL) as TunnelType[]).map((t) => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={type === t}
              className={`tunnel-type-btn ${type === t ? "active" : ""}`}
              onClick={() => setType(t)}
            >
              {TYPE_LABEL[t]}
            </button>
          ))}
        </div>
        <p className="hint">{TYPE_HELP[type]}</p>

        {type !== "dynamic" && (
          <>
            <div className="tunnel-presets" aria-label="Common services">
              {SERVICE_PRESETS.map((p) => (
                <button
                  key={p.port}
                  type="button"
                  className={`tunnel-preset ${dstPort === p.port ? "active" : ""}`}
                  onClick={() => pickService(p.port)}
                >
                  {p.label} <span>{p.port}</span>
                </button>
              ))}
            </div>
            <div className="dialog-row">
              <label className="grow">
                {type === "local" ? "Remote service host (as the server sees it)" : "Local service host"}
                <input value={dstHost} onChange={(e) => setDstHost(e.target.value)} />
              </label>
              <label className="narrow">
                Port
                <input type="number" min={1} max={65535} value={dstPort} onChange={(e) => setDstPort(Number(e.target.value))} />
              </label>
            </div>
          </>
        )}

        <div className="dialog-row">
          <label className="grow">
            {type === "remote" ? "Listen on the host at" : "Listen on this computer at"}
            <input value={srcHost} onChange={(e) => setSrcHost(e.target.value)} />
          </label>
          <label className="narrow">
            Port
            <input
              type="number"
              min={1}
              max={65535}
              value={srcPort}
              autoFocus
              onChange={(e) => setSrcPort(Number(e.target.value))}
              aria-label="Listening port"
            />
          </label>
        </div>
        {clash && (
          <div className="tunnel-clash">
            Port {srcPort} is already used by “{clash.name}”.
          </div>
        )}

        <label>
          Name
          <input value={shownName} onChange={(e) => setName(e.target.value)} />
        </label>

        <label className="tunnel-check">
          <input type="checkbox" checked={startNow} onChange={(e) => setStartNow(e.target.checked)} />
          Start it now
        </label>
        <label className="tunnel-check">
          <input type="checkbox" checked={autoStart} onChange={(e) => setAutoStart(e.target.checked)} />
          Start automatically when Wharf launches
        </label>

        {error && <div className="dialog-error">{error}</div>}
        <div className="dialog-actions">
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={busy}>
            {busy ? "Working…" : startNow ? "Create and start" : "Create"}
          </button>
        </div>
      </form>
    </div>
  );
}
