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
  const { tabs, activeTabId, paneMeta, hosts } = useAppStore();
  const [now, setNow] = useState(Date.now());

  const activeTab = tabs.find((t) => t.tabId === activeTabId) ?? null;
  // The status bar reflects whichever pane has focus within the active tab
  // — a multi-pane tab has no single "the" session, so this is the one
  // that's actually receiving keystrokes right now.
  const activeMeta = activeTab ? paneMeta[activeTab.activePaneId] : null;
  const sessionCount = Object.keys(paneMeta).length;

  useEffect(() => {
    if (!activeMeta || activeMeta.closed) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [activeTab?.activePaneId, activeMeta?.closed]);

  if (!activeTab || !activeMeta) {
    return (
      <div className="status-bar">
        <span className="status-dim">No active session</span>
      </div>
    );
  }

  const host = hosts.find((h) => h.id === activeMeta.hostId);

  return (
    <div className="status-bar">
      <span
        className={`status-dot ${activeMeta.closed ? "closed" : activeMeta.reconnecting ? "reconnecting" : "connected"}`}
      />
      <span className="status-text">
        {activeMeta.closed
          ? "Disconnected"
          : activeMeta.reconnecting
            ? `Reconnecting… (${activeMeta.reconnecting.attempt}/${activeMeta.reconnecting.maxAttempts})`
            : "Connected"}
      </span>
      {host ? (
        <span className="status-host">
          {host.username}@{host.hostname}:{host.port}
        </span>
      ) : (
        activeMeta.hostId === null && <span className="status-host">Local shell</span>
      )}
      {!activeMeta.closed && <span className="status-duration">{formatDuration(now - activeMeta.connectedAt)}</span>}
      {activeMeta.closeError && <span className="status-error">{activeMeta.closeError}</span>}
      <span className="status-spacer" />
      <span className="status-dim">
        {sessionCount} session{sessionCount === 1 ? "" : "s"}
      </span>
    </div>
  );
}
