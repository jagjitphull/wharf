import { useEffect, useState } from "react";
import type { HostStatsSnapshot } from "@shared/types";
import { useAppStore } from "../../state/store";
import { wharf } from "../../api/wharf";
import "./StatusBar.css";

function formatStats(stats: HostStatsSnapshot): string | null {
  const parts: string[] = [];
  if (stats.loadAvg) parts.push(`Load ${stats.loadAvg[0].toFixed(2)}`);
  if (stats.memTotalMb !== null && stats.memUsedMb !== null && stats.memTotalMb > 0) {
    parts.push(`Mem ${Math.round((stats.memUsedMb / stats.memTotalMb) * 100)}%`);
  }
  if (stats.diskUsePercent !== null) parts.push(`Disk ${stats.diskUsePercent}%`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

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
  const [stats, setStats] = useState<HostStatsSnapshot | null>(null);

  const activeTab = tabs.find((t) => t.tabId === activeTabId) ?? null;
  // The status bar reflects whichever pane has focus within the active tab
  // — a multi-pane tab has no single "the" session, so this is the one
  // that's actually receiving keystrokes right now.
  const activeMeta = activeTab ? paneMeta[activeTab.activePaneId] : null;
  const sessionCount = Object.keys(paneMeta).length;
  const activeSessionId = activeTab?.activePaneId ?? null;
  const host = hosts.find((h) => h.id === activeMeta?.hostId);
  // Mosh panes have no ssh2 Client on the main-process side (a separate
  // pty-backed process, see moshManager.ts) — exec-based polling has
  // nothing to run against, so never start it for one.
  const statsEligible = !!activeSessionId && !!activeMeta && !activeMeta.closed && !!host && !host.mosh;

  useEffect(() => {
    if (!activeMeta || activeMeta.closed) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [activeTab?.activePaneId, activeMeta?.closed]);

  // Polls at most one session at a time — whichever pane currently has
  // focus — starting/stopping as focus moves so a backgrounded tab's host
  // isn't polled for no one to see.
  useEffect(() => {
    if (!statsEligible || !activeSessionId) {
      setStats(null);
      return;
    }
    setStats(null);
    wharf.hostStats.start(activeSessionId);
    return () => wharf.hostStats.stop(activeSessionId);
  }, [statsEligible, activeSessionId]);

  useEffect(() => {
    return wharf.hostStats.onUpdate((event) => {
      if (event.sessionId === activeSessionId) setStats(event.stats);
    });
  }, [activeSessionId]);

  if (!activeTab || !activeMeta) {
    return (
      <div className="status-bar">
        <span className="status-dim">No active session</span>
      </div>
    );
  }

  const statsText = stats && formatStats(stats);

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
      {statsText && <span className="status-stats">{statsText}</span>}
      <span className="status-spacer" />
      <span className="status-dim">
        {sessionCount} session{sessionCount === 1 ? "" : "s"}
      </span>
    </div>
  );
}
