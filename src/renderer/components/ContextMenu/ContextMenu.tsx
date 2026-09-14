import { useEffect, useRef, useState } from "react";
import "./ContextMenu.css";

export interface ContextMenuItem {
  label?: string;
  onClick?(): void;
  danger?: boolean;
  disabled?: boolean;
  separator?: boolean;
  /** Renders arbitrary content in place of the default label button (e.g. a
   * swatch grid) — a lightweight substitute for submenus, which this
   * component doesn't otherwise support. The custom content is responsible
   * for its own click handling and closing the menu (via the `close`
   * callback it receives). */
  custom?(close: () => void): React.ReactNode;
}

export interface ContextMenuState {
  x: number;
  y: number;
  items: ContextMenuItem[];
}

interface Props {
  menu: ContextMenuState | null;
  onClose(): void;
}

export function ContextMenu({ menu, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    function onDocMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    // Capture phase + next tick so the same right-click that opened the
    // menu doesn't immediately trigger the outside-click close handler.
    const id = setTimeout(() => document.addEventListener("mousedown", onDocMouseDown));
    document.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(id);
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menu, onClose]);

  if (!menu) return null;

  const estimatedHeight = menu.items.reduce((h, item) => h + (item.custom ? 46 : 30), 8);
  const style: React.CSSProperties = {
    left: Math.min(menu.x, window.innerWidth - 200),
    top: Math.min(menu.y, window.innerHeight - estimatedHeight),
  };

  return (
    <div className="context-menu" style={style} ref={ref}>
      {menu.items.map((item, i) =>
        item.separator ? (
          <div className="context-menu-separator" key={i} />
        ) : item.custom ? (
          <div className="context-menu-custom" key={i}>
            {item.custom(onClose)}
          </div>
        ) : (
          <button
            key={i}
            className={`context-menu-item ${item.danger ? "danger" : ""}`}
            disabled={item.disabled}
            onClick={() => {
              item.onClick?.();
              onClose();
            }}
          >
            {item.label}
          </button>
        ),
      )}
    </div>
  );
}

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
