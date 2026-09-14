import { useState } from "react";
import { useAppStore } from "../../state/store";
import { TerminalView } from "./Terminal";
import { ContextMenu, useContextMenu } from "../ContextMenu/ContextMenu";
import "./TerminalPanel.css";

export function TerminalPanel() {
  const { tabs, activeTabId, hosts, setActiveTab, closeTerminal, duplicateTab, reorderTab } = useAppStore();
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

  if (tabs.length === 0) {
    return (
      <div className="terminal-empty">
        <p>No open sessions.</p>
        <p className="hint">Double-click a host in the sidebar (or hit ▶) to connect.</p>
      </div>
    );
  }

  return (
    <div className="terminal-panel">
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
              ])
            }
            title={tab.closeError}
          >
            {hostColor && <span className="tab-color-dot" style={{ background: hostColor }} />}
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
          <TerminalView key={tab.sessionId} sessionId={tab.sessionId} visible={tab.sessionId === activeTabId} />
        ))}
      </div>
      <ContextMenu menu={menu} onClose={closeMenu} />
    </div>
  );
}
