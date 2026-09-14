import { useState } from "react";
import { useAppStore } from "../../state/store";
import { useTerminalPrefsStore } from "../../state/terminalPrefsStore";
import { getTerminalThemePreset } from "../../state/terminalThemes";
import { wharf } from "../../api/wharf";
import { TerminalView } from "./Terminal";
import { ContextMenu, useContextMenu } from "../ContextMenu/ContextMenu";
import { buildTerminalThemeMenuItems } from "./TerminalThemeSwatches";
import "./TerminalPanel.css";

interface Props {
  /** Kept mounted but display:none rather than unmounted while another view
   * (Settings, SFTP, Tunnels) is active, so switching away and back doesn't
   * tear down and recreate every open xterm instance — which would destroy
   * their scrollback and, for a moment, the underlying SSH data listeners. */
  hidden: boolean;
}

export function TerminalPanel({ hidden }: Props) {
  const { tabs, activeTabId, hosts, setActiveTab, closeTerminal, duplicateTab, reorderTab, setTabThemeId, setTabLogPath } =
    useAppStore();
  const globalTerminalThemeId = useTerminalPrefsStore((s) => s.terminalThemeId);
  const { menu, open: openMenu, close: closeMenu } = useContextMenu();
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);

  async function closeOthers(sessionId: string) {
    for (const tab of tabs) {
      if (tab.sessionId !== sessionId) await closeTerminal(tab.sessionId);
    }
  }

  async function closeAll() {
    for (const tab of tabs) await closeTerminal(tab.sessionId);
  }

  async function toggleLogging(sessionId: string, currentLogPath: string | undefined) {
    if (currentLogPath) {
      await wharf.ssh.stopLogging(sessionId);
      setTabLogPath(sessionId, undefined);
    } else {
      const path = await wharf.ssh.startLogging(sessionId);
      if (path) setTabLogPath(sessionId, path);
    }
  }

  if (tabs.length === 0) {
    return (
      <div className="terminal-empty" style={hidden ? { display: "none" } : undefined}>
        <p>No open sessions.</p>
        <p className="hint">Double-click a host in the sidebar (or hit ▶) to connect.</p>
      </div>
    );
  }

  return (
    <div className="terminal-panel" style={hidden ? { display: "none" } : undefined}>
      <div className="tab-bar">
        {tabs.map((tab) => {
          const hostColor = hosts.find((h) => h.id === tab.hostId)?.color;
          return (
          <div
            key={tab.sessionId}
            draggable
            onDragStart={() => setDraggingId(tab.sessionId)}
            onDragEnd={() => {
              setDraggingId(null);
              setDropTargetId(null);
            }}
            onDragOver={(e) => {
              if (draggingId && draggingId !== tab.sessionId) {
                e.preventDefault();
                setDropTargetId(tab.sessionId);
              }
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (draggingId) reorderTab(draggingId, tab.sessionId);
              setDraggingId(null);
              setDropTargetId(null);
            }}
            className={`tab ${tab.sessionId === activeTabId ? "active" : ""} ${tab.closed ? "closed" : ""} ${
              tab.sessionId === draggingId ? "dragging" : ""
            } ${tab.sessionId === dropTargetId ? "drop-target" : ""}`}
            style={hostColor ? { boxShadow: `inset 0 2px 0 ${hostColor}` } : undefined}
            onClick={() => setActiveTab(tab.sessionId)}
            onContextMenu={(e) =>
              openMenu(e, [
                { label: "Duplicate", onClick: () => duplicateTab(tab.sessionId) },
                { separator: true },
                { label: "Close", onClick: () => closeTerminal(tab.sessionId) },
                { label: "Close Others", disabled: tabs.length < 2, onClick: () => closeOthers(tab.sessionId) },
                { label: "Close All", onClick: () => closeAll() },
                { separator: true },
                {
                  label: tab.logPath ? "Stop Logging" : "Start Logging…",
                  onClick: () => toggleLogging(tab.sessionId, tab.logPath),
                },
                ...buildTerminalThemeMenuItems(tab.themeId ?? globalTerminalThemeId, (id) =>
                  setTabThemeId(tab.sessionId, id),
                ),
              ])
            }
            title={tab.closeError}
          >
            {hostColor && <span className="tab-color-dot" style={{ background: hostColor }} />}
            {tab.logPath && <span className="tab-logging-dot" title={`Logging to ${tab.logPath}`} />}
            {tab.themeId && (
              <span
                className="tab-theme-dot"
                title={`Color theme: ${getTerminalThemePreset(tab.themeId).name}`}
                style={{ background: getTerminalThemePreset(tab.themeId).theme?.background ?? "var(--term-bg)" }}
              />
            )}
            <span>{tab.title}</span>
            {tab.closed && <span className="tab-dot" />}
            <button
              className="tab-duplicate"
              title="Duplicate tab"
              onClick={(e) => {
                e.stopPropagation();
                duplicateTab(tab.sessionId);
              }}
            >
              ⧉
            </button>
            <button
              className="tab-close"
              title="Close tab"
              onClick={(e) => {
                e.stopPropagation();
                closeTerminal(tab.sessionId);
              }}
            >
              ×
            </button>
          </div>
          );
        })}
      </div>
      <div className="terminal-stack">
        {tabs.map((tab) => (
          <TerminalView
            key={tab.sessionId}
            sessionId={tab.sessionId}
            // Folds in the panel's own hidden state (set when a different
            // top-level view like Settings is active) so returning to it
            // is treated the same as switching back to this tab: xterm gets
            // its forced-repaint pass (see the `visible` effect in
            // Terminal.tsx) instead of staying stuck on stale pixels.
            visible={!hidden && tab.sessionId === activeTabId}
            themeOverrideId={tab.themeId}
            logPath={tab.logPath}
          />
        ))}
      </div>
      <ContextMenu menu={menu} onClose={closeMenu} />
    </div>
  );
}
