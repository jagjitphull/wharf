import { useEffect, useState } from "react";
import { useAppStore } from "../../state/store";
import "./StatusBar.css";

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function StatusBar() {
  const { tabs, activeTabId, hosts } = useAppStore();
  const [now, setNow] = useState(Date.now());

  const activeTab = tabs.find((t) => t.sessionId === activeTabId) ?? null;

  useEffect(() => {
    if (!activeTab || activeTab.closed) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [activeTab?.sessionId, activeTab?.closed]);

  if (!activeTab) {
    return (
      <div className="status-bar">
        <span className="status-dim">No active session</span>
      </div>
    );
  }

  const host = hosts.find((h) => h.id === activeTab.hostId);

  return (
    <div className="status-bar">
      <span
        className={`status-dot ${activeTab.closed ? "closed" : activeTab.reconnecting ? "reconnecting" : "connected"}`}
      />
      <span className="status-text">
        {activeTab.closed
          ? "Disconnected"
          : activeTab.reconnecting
            ? `Reconnecting… (${activeTab.reconnecting.attempt}/${activeTab.reconnecting.maxAttempts})`
            : "Connected"}
      </span>
      {host ? (
        <span className="status-host">
          {host.username}@{host.hostname}:{host.port}
        </span>
      ) : (
        activeTab.hostId === null && <span className="status-host">Local shell</span>
      )}
      {!activeTab.closed && <span className="status-duration">{formatDuration(now - activeTab.connectedAt)}</span>}
      {activeTab.closeError && <span className="status-error">{activeTab.closeError}</span>}
      <span className="status-spacer" />
      <span className="status-dim">
        {tabs.length} session{tabs.length === 1 ? "" : "s"}
      </span>
    </div>
  );
}
