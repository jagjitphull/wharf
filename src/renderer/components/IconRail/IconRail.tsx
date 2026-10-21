import type { ReactNode } from "react";
import { useAppStore, type ActiveView } from "../../state/store";
import { IconClock, IconKey, IconLayers, IconServer, IconSliders, IconTunnel } from "../Icons/Icons";
import "./IconRail.css";

interface Item {
  label: string;
  view: ActiveView;
  /** Other views that still belong to this item (a terminal or the file browser are "Hosts" too). */
  also?: ActiveView[];
  icon: ReactNode;
}

const TOP: Item[] = [
  { label: "Hosts", view: "home", also: ["hosts", "sftp"], icon: <IconServer size={20} /> },
  { label: "Tunnels", view: "tunnels", icon: <IconTunnel size={20} /> },
  { label: "SSH keys", view: "keys", icon: <IconKey size={20} /> },
  { label: "Workspaces", view: "workspaces", icon: <IconLayers size={20} /> },
  { label: "History", view: "history", icon: <IconClock size={20} /> },
];
const SETTINGS: Item = { label: "Settings", view: "settings", icon: <IconSliders size={20} /> };

export function IconRail() {
  const activeView = useAppStore((s) => s.activeView);
  const setActiveView = useAppStore((s) => s.setActiveView);

  const button = (item: Item) => {
    const active = activeView === item.view || !!item.also?.includes(activeView);
    return (
      <button
        key={item.view}
        className={`rail-btn ${active ? "active" : ""}`}
        title={item.label}
        aria-label={item.label}
        aria-current={active ? "page" : undefined}
        onClick={() => setActiveView(item.view)}
      >
        {item.icon}
      </button>
    );
  };

  return (
    <nav className="icon-rail" aria-label="Main">
      {TOP.map(button)}
      <span className="rail-spacer" />
      {button(SETTINGS)}
    </nav>
  );
}
