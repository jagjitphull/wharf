import { useState } from "react";
import { DEFAULT_SIDEBAR_WIDTH, useUiPrefsStore } from "../../state/uiPrefsStore";

/** Draggable divider between the sidebar and the main content area — mirrors
 * the split-pane resize handle in TerminalPanel.tsx (same drag mechanics,
 * same visual treatment). Dragging past uiPrefsStore's
 * SIDEBAR_COLLAPSE_THRESHOLD snaps the sidebar fully closed (handled inside
 * setSidebarWidth), so this never needs to know about collapsing itself. */
export function SidebarResizeHandle() {
  const sidebarWidth = useUiPrefsStore((s) => s.sidebarWidth);
  const setSidebarWidth = useUiPrefsStore((s) => s.setSidebarWidth);
  const [dragging, setDragging] = useState(false);

  function startResize(e: React.MouseEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = sidebarWidth;

    setDragging(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    function onMove(ev: MouseEvent) {
      setSidebarWidth(startWidth + (ev.clientX - startX));
    }
    function onUp() {
      setDragging(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  return (
    <div
      className={`sidebar-resize-handle ${dragging ? "dragging" : ""}`}
      onMouseDown={startResize}
      onDoubleClick={() => setSidebarWidth(DEFAULT_SIDEBAR_WIDTH)}
      title="Drag to resize (double-click to reset)"
    />
  );
}
