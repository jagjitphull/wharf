import { useState } from "react";
import { useAppStore, type PaneNode } from "../../state/store";
import { useTerminalPrefsStore } from "../../state/terminalPrefsStore";
import { getTerminalThemePreset } from "../../state/terminalThemes";
import { wharf } from "../../api/wharf";
import { TerminalView } from "./Terminal";
import { ContextMenu, useContextMenu } from "../ContextMenu/ContextMenu";
import { buildTerminalThemeMenuItems } from "./TerminalThemeSwatches";
import { IconClose, IconDuplicate } from "../Icons/Icons";
import "./TerminalPanel.css";

interface Props {
  /** Kept mounted but display:none rather than unmounted while another view
   * (Settings, SFTP, Tunnels) is active, so switching away and back doesn't
   * tear down and recreate every open xterm instance — which would destroy
   * their scrollback and, for a moment, the underlying SSH data listeners. */
  hidden: boolean;
}

/** Renders a tab's split tree: a leaf becomes one TerminalView, a split
 * becomes a flex row/column of its children (recursively, so nested splits
 * — e.g. a column split with one of its rows further split — just work).
 * Every leaf in the tree is rendered regardless of which tab is active;
 * `tabVisible` (not this component's own state) decides whether any of
 * them are actually shown, so backgrounded tabs keep their xterm instances
 * alive exactly like before splits existed. */
function PaneTree({ node, tabVisible, activePaneId, tabId }: { node: PaneNode; tabVisible: boolean; activePaneId: string; tabId: string }) {
  const setActivePane = useAppStore((s) => s.setActivePane);

  if (node.type === "leaf") {
    return (
      <div
        className="pane-leaf"
        // Multi-pane tabs need a way to tell which pane keystrokes go to;
        // mousedown (not click) so focusing follows the same gesture xterm
        // itself uses to grab focus, not a separate step after it.
        onMouseDown={() => setActivePane(tabId, node.sessionId)}
      >
        <PaneLeafView sessionId={node.sessionId} visible={tabVisible} tabId={tabId} />
      </div>
    );
  }

  return (
    <div className={`pane-split pane-split-${node.direction}`}>
      {node.children.map((child, i) => {
        // The active-pane highlight lives on this wrapper (not .pane-leaf
        // itself) because .pane-leaf's xterm canvas fills it edge-to-edge —
        // an outline/shadow on .pane-leaf gets fully covered. This wrapper's
        // background shows through the small margin .pane-leaf leaves around
        // itself instead (see the CSS), which nothing paints over.
        const isActiveBranch = child.type === "leaf" && child.sessionId === activePaneId;
        return (
          <div className={`pane-split-child ${isActiveBranch ? "active" : ""}`} key={i}>
            <PaneTree node={child} tabVisible={tabVisible} activePaneId={activePaneId} tabId={tabId} />
          </div>
        );
      })}
    </div>
  );
}

/** Thin wrapper pulling this one pane's PaneMeta (theme/logPath) out of the
 * store, so PaneTree itself doesn't need to thread that through. */
function PaneLeafView({ sessionId, visible, tabId }: { sessionId: string; visible: boolean; tabId: string }) {
  const meta = useAppStore((s) => s.paneMeta[sessionId]);
  if (!meta) return null;
  return (
    <TerminalView
      sessionId={sessionId}
      visible={visible}
      themeOverrideId={meta.themeId}
      logPath={meta.logPath}
      tabId={tabId}
    />
  );
}

export function TerminalPanel({ hidden }: Props) {
  const { tabs, activeTabId, paneMeta, setActiveTab, closeTab, duplicateTab, reorderTab, setPaneThemeId, setPaneLogPath, openLocalShell } =
    useAppStore();
  const globalTerminalThemeId = useTerminalPrefsStore((s) => s.terminalThemeId);
  const { menu, open: openMenu, close: closeMenu } = useContextMenu();
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);

  async function closeOthers(tabId: string) {
    for (const tab of tabs) {
      if (tab.tabId !== tabId) await closeTab(tab.tabId);
    }
  }

  async function closeAll() {
    for (const tab of tabs) await closeTab(tab.tabId);
  }

  async function toggleLogging(sessionId: string, currentLogPath: string | undefined) {
    if (currentLogPath) {
      await wharf.ssh.stopLogging(sessionId);
      setPaneLogPath(sessionId, undefined);
    } else {
      const path = await wharf.ssh.startLogging(sessionId);
      if (path) setPaneLogPath(sessionId, path);
    }
  }

  if (tabs.length === 0) {
    return (
      <div className="terminal-empty" style={hidden ? { display: "none" } : undefined}>
        <p>No open sessions.</p>
        <p className="hint">Double-click a host in the sidebar (or hit ▶) to connect.</p>
        <button className="btn ghost small" onClick={() => openLocalShell()}>
          Open Local Shell
        </button>
      </div>
    );
  }

  return (
    <div className="terminal-panel" style={hidden ? { display: "none" } : undefined}>
      <div className="tab-bar">
        {tabs.map((tab) => {
          const activeMeta = paneMeta[tab.activePaneId];
          return (
            <TabButton
              key={tab.tabId}
              tabId={tab.tabId}
              title={activeMeta?.title ?? "…"}
              hostId={activeMeta?.hostId ?? null}
              closed={activeMeta?.closed ?? false}
              closeError={activeMeta?.closeError}
              logPath={activeMeta?.logPath}
              themeId={activeMeta?.themeId}
              isActive={tab.tabId === activeTabId}
              draggingId={draggingId}
              dropTargetId={dropTargetId}
              tabCount={tabs.length}
              globalTerminalThemeId={globalTerminalThemeId}
              onDragStart={() => setDraggingId(tab.tabId)}
              onDragEnd={() => {
                setDraggingId(null);
                setDropTargetId(null);
              }}
              onDragOver={() => setDropTargetId(tab.tabId)}
              onDrop={() => {
                if (draggingId) reorderTab(draggingId, tab.tabId);
                setDraggingId(null);
                setDropTargetId(null);
              }}
              onClick={() => setActiveTab(tab.tabId)}
              onDuplicate={() => duplicateTab(tab.tabId)}
              onClose={() => closeTab(tab.tabId)}
              onCloseOthers={() => closeOthers(tab.tabId)}
              onCloseAll={closeAll}
              onToggleLogging={() => activeMeta && toggleLogging(tab.activePaneId, activeMeta.logPath)}
              onSetTheme={(id) => setPaneThemeId(tab.activePaneId, id)}
              openMenu={openMenu}
            />
          );
        })}
      </div>
      <div className="terminal-stack">
        {tabs.map((tab) => (
          <div
            key={tab.tabId}
            className="tab-pane-container"
            style={{ display: !hidden && tab.tabId === activeTabId ? "flex" : "none" }}
          >
            <PaneTree
              node={tab.layout}
              tabVisible={!hidden && tab.tabId === activeTabId}
              activePaneId={tab.activePaneId}
              tabId={tab.tabId}
            />
          </div>
        ))}
      </div>
      <ContextMenu menu={menu} onClose={closeMenu} />
    </div>
  );
}

interface TabButtonProps {
  tabId: string;
  title: string;
  hostId: string | null;
  closed: boolean;
  closeError?: string;
  logPath?: string;
  themeId?: string;
  isActive: boolean;
  draggingId: string | null;
  dropTargetId: string | null;
  tabCount: number;
  globalTerminalThemeId: string;
  onDragStart(): void;
  onDragEnd(): void;
  onDragOver(): void;
  onDrop(): void;
  onClick(): void;
  onDuplicate(): void;
  onClose(): void;
  onCloseOthers(): void;
  onCloseAll(): void;
  onToggleLogging(): void;
  onSetTheme(id: string): void;
  openMenu: ReturnType<typeof useContextMenu>["open"];
}

function TabButton(p: TabButtonProps) {
  const hosts = useAppStore((s) => s.hosts);
  const hostColor = hosts.find((h) => h.id === p.hostId)?.color;

  return (
    <div
      draggable
      onDragStart={p.onDragStart}
      onDragEnd={p.onDragEnd}
      onDragOver={(e) => {
        if (p.draggingId && p.draggingId !== p.tabId) {
          e.preventDefault();
          p.onDragOver();
        }
      }}
      onDrop={(e) => {
        e.preventDefault();
        p.onDrop();
      }}
      className={`tab ${p.isActive ? "active" : ""} ${p.closed ? "closed" : ""} ${
        p.tabId === p.draggingId ? "dragging" : ""
      } ${p.tabId === p.dropTargetId ? "drop-target" : ""}`}
      style={hostColor ? { boxShadow: `inset 0 2px 0 ${hostColor}` } : undefined}
      onClick={p.onClick}
      onContextMenu={(e) =>
        p.openMenu(e, [
          { label: "Duplicate", onClick: p.onDuplicate },
          { separator: true },
          { label: "Close", onClick: p.onClose },
          { label: "Close Others", disabled: p.tabCount < 2, onClick: p.onCloseOthers },
          { label: "Close All", onClick: p.onCloseAll },
          { separator: true },
          { label: p.logPath ? "Stop Logging" : "Start Logging…", onClick: p.onToggleLogging },
          ...buildTerminalThemeMenuItems(p.themeId ?? p.globalTerminalThemeId, p.onSetTheme),
        ])
      }
      title={p.closeError}
    >
      {hostColor && <span className="tab-color-dot" style={{ background: hostColor }} />}
      {p.logPath && <span className="tab-logging-dot" title={`Logging to ${p.logPath}`} />}
      {p.themeId && (
        <span
          className="tab-theme-dot"
          title={`Color theme: ${getTerminalThemePreset(p.themeId).name}`}
          style={{ background: getTerminalThemePreset(p.themeId).theme?.background ?? "var(--term-bg)" }}
        />
      )}
      <span>{p.title}</span>
      {p.closed && <span className="tab-dot" />}
      <button
        className="tab-duplicate"
        title="Duplicate tab"
        onClick={(e) => {
          e.stopPropagation();
          p.onDuplicate();
        }}
      >
        <IconDuplicate size={12} />
      </button>
      <button
        className="tab-close"
        title="Close tab"
        onClick={(e) => {
          e.stopPropagation();
          p.onClose();
        }}
      >
        <IconClose size={12} />
      </button>
    </div>
  );
}
