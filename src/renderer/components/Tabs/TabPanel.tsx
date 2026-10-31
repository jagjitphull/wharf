import { useAppStore } from "../../state/store";
import { useUiPrefsStore } from "../../state/uiPrefsStore";
import { IconChevronLeft, IconChevronRight } from "../Icons/Icons";
import { TabStrip } from "./TabStrip";
import "./TabPanel.css";

/** The terminal tabs as a column beside the icon rail (the "side" tab layout). Collapses to each tab's number and markers, expands to full names. */
export function TabPanel() {
  const collapsed = useUiPrefsStore((s) => s.tabPanelCollapsed);
  const setCollapsed = useUiPrefsStore((s) => s.setTabPanelCollapsed);
  const tabCount = useAppStore((s) => s.tabs.length);
  // Nothing to list yet: don't take a column for it.
  if (tabCount === 0) return null;

  return (
    <aside className={`tab-panel ${collapsed ? "collapsed" : ""}`} aria-label="Tabs">
      <div className="tab-panel-head">
        {!collapsed && <span className="tab-panel-title">Tabs</span>}
        <button
          className="tab-panel-toggle"
          title={collapsed ? "Expand tabs" : "Collapse tabs"}
          aria-label={collapsed ? "Expand tabs" : "Collapse tabs"}
          aria-expanded={!collapsed}
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? <IconChevronRight size={14} /> : <IconChevronLeft size={14} />}
        </button>
      </div>
      <TabStrip orientation="vertical" collapsed={collapsed} />
    </aside>
  );
}
