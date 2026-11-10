import { useState } from "react";
import type { ContextMenuItem, ContextMenuState } from "./ContextMenu";

/** Local per-component context-menu state: `open(event, items)` on a
 * onContextMenu handler, render `<ContextMenu menu={menu} onClose={close} />`
 * once alongside it. */
export function useContextMenu() {
  const [menu, setMenu] = useState<ContextMenuState | null>(null);

  function open(e: React.MouseEvent, items: ContextMenuItem[]) {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, items });
  }

  function close() {
    setMenu(null);
  }

  return { menu, open, close };
}
