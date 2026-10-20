import { useRef, useState } from "react";
import { useAppStore, type PaneNode } from "../../state/store";
import { TerminalView } from "./Terminal";
import { IconClose, IconTerminal } from "../Icons/Icons";
import { EmptyState } from "../EmptyState/EmptyState";
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
 * alive exactly like before splits existed.
 *
 * `multiPane` (true once the tab's root is a split, same for every pane in
 * it) gates the per-pane close button — a lone pane closes via the tab's own
 * close button, so it doesn't need a second one sitting on top of it. */
function PaneTree({
  node,
  tabVisible,
  activePaneId,
  tabId,
  multiPane,
}: {
  node: PaneNode;
  tabVisible: boolean;
  activePaneId: string;
  tabId: string;
  multiPane: boolean;
}) {
  const setActivePane = useAppStore((s) => s.setActivePane);
  const closeTerminal = useAppStore((s) => s.closeTerminal);

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
        {multiPane && (
          <button
            className="pane-close-btn"
            title="Close pane"
            onClick={(e) => {
              e.stopPropagation();
              closeTerminal(node.sessionId);
            }}
          >
            <IconClose size={11} />
          </button>
        )}
      </div>
    );
  }

  const sizes = node.sizes ?? node.children.map(() => 1);

  return (
    <PaneSplitRow node={node} sizes={sizes} tabId={tabId}>
      {node.children.map((child, i) => {
        // The active-pane highlight lives on this wrapper (not .pane-leaf
        // itself) because .pane-leaf's xterm canvas fills it edge-to-edge —
        // an outline/shadow on .pane-leaf gets fully covered. This wrapper's
        // background shows through the small margin .pane-leaf leaves around
        // itself instead (see the CSS), which nothing paints over.
        const isActiveBranch = child.type === "leaf" && child.sessionId === activePaneId;
        return (
          <div className={`pane-split-child ${isActiveBranch ? "active" : ""}`} style={{ flex: `${sizes[i]} 1 0%` }} key={i}>
            <PaneTree node={child} tabVisible={tabVisible} activePaneId={activePaneId} tabId={tabId} multiPane={multiPane} />
          </div>
        );
      })}
    </PaneSplitRow>
  );
}

/** The split container plus its draggable resize handles, one between each
 * pair of adjacent children. Split out from PaneTree mainly so the drag
 * math (which needs the container's live pixel size) has a single ref to
 * work with instead of threading one through PaneTree's recursion. */
function PaneSplitRow({
  node,
  sizes,
  tabId,
  children,
}: {
  node: Extract<PaneNode, { type: "split" }>;
  sizes: number[];
  tabId: string;
  children: React.ReactNode[];
}) {
  const resizeSplit = useAppStore((s) => s.resizeSplit);
  const containerRef = useRef<HTMLDivElement>(null);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);

  function startResize(e: React.MouseEvent, index: number) {
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const totalPx = node.direction === "row" ? rect.width : rect.height;
    const startPos = node.direction === "row" ? e.clientX : e.clientY;
    const startSizes = [...sizes];
    const total = startSizes.reduce((a, b) => a + b, 0);

    setDraggingIndex(index);
    document.body.style.cursor = node.direction === "row" ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";

    function onMove(ev: MouseEvent) {
      const pos = node.direction === "row" ? ev.clientX : ev.clientY;
      const deltaFrac = ((pos - startPos) / totalPx) * total;
      const minSize = total * 0.1;
      let a = startSizes[index] + deltaFrac;
      let b = startSizes[index + 1] - deltaFrac;
      if (a < minSize) {
        b -= minSize - a;
        a = minSize;
      }
      if (b < minSize) {
        a -= minSize - b;
        b = minSize;
      }
      const next = [...startSizes];
      next[index] = a;
      next[index + 1] = b;
      resizeSplit(tabId, node.id, next);
    }
    function onUp() {
      setDraggingIndex(null);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  const items: React.ReactNode[] = [];
  children.forEach((child, i) => {
    items.push(child);
    if (i < children.length - 1) {
      items.push(
        <div
          key={`handle-${i}`}
          className={`pane-resize-handle pane-resize-handle-${node.direction} ${draggingIndex === i ? "dragging" : ""}`}
          onMouseDown={(e) => startResize(e, i)}
        />,
      );
    }
  });

  return (
    <div className={`pane-split pane-split-${node.direction}`} ref={containerRef}>
      {items}
    </div>
  );
}

/** Thin wrapper pulling this one pane's PaneMeta (theme/logPath) out of the
 * store, so PaneTree itself doesn't need to thread that through. */
function PaneLeafView({ sessionId, visible, tabId }: { sessionId: string; visible: boolean; tabId: string }) {
  const meta = useAppStore((s) => s.paneMeta[sessionId]);
  if (!meta) return null;
  return <TerminalView sessionId={sessionId} visible={visible} themeOverrideId={meta.themeId} logPath={meta.logPath} tabId={tabId} />;
}

export function TerminalPanel({ hidden }: Props) {
  const tabs = useAppStore((s) => s.tabs);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const openLocalShell = useAppStore((s) => s.openLocalShell);

  if (tabs.length === 0) {
    return (
      <div style={hidden ? { display: "none", height: "100%" } : { height: "100%" }}>
        <EmptyState
          icon={<IconTerminal size={40} />}
          title="No open sessions"
          hint="Double-click a host in the sidebar (or hit ▶) to connect."
        >
          <button className="btn ghost small" onClick={() => openLocalShell()}>
            Open Local Shell
          </button>
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="terminal-panel" style={hidden ? { display: "none" } : undefined}>
      <div className="terminal-stack">
        {tabs.map((tab) => (
          <div
            key={tab.tabId}
            className={`tab-pane-container ${tab.broadcastInput ? "broadcasting" : ""}`}
            style={{ display: !hidden && tab.tabId === activeTabId ? "flex" : "none" }}
          >
            <PaneTree
              node={tab.layout}
              tabVisible={!hidden && tab.tabId === activeTabId}
              activePaneId={tab.activePaneId}
              tabId={tab.tabId}
              multiPane={tab.layout.type === "split"}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
