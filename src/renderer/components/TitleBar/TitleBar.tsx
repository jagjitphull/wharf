import { useEffect, useState } from "react";
import { wharf } from "../../api/wharf";
import { useThemeStore } from "../../state/themeStore";
import { useUiPrefsStore } from "../../state/uiPrefsStore";
import { useAppStore, type ActiveView } from "../../state/store";
import { IconAnchor, IconChevronDown, IconChevronUp, IconDuplicate } from "../Icons/Icons";
import "./TitleBar.css";

const isMac = wharf.window.platform === "darwin";

interface Props {
  onOpenShortcuts(): void;
}

export function TitleBar({ onOpenShortcuts }: Props) {
  const [maximized, setMaximized] = useState(false);
  const resolvedTheme = useThemeStore((s) => s.resolved);
  const setMode = useThemeStore((s) => s.setMode);
  const sidebarCollapsed = useUiPrefsStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useUiPrefsStore((s) => s.toggleSidebar);
  const topNavCollapsed = useUiPrefsStore((s) => s.topNavCollapsed);
  const toggleTopNav = useUiPrefsStore((s) => s.toggleTopNav);
  const activeView = useAppStore((s) => s.activeView);
  const setActiveView = useAppStore((s) => s.setActiveView);

  useEffect(() => {
    wharf.window.isMaximized().then(setMaximized);
    return wharf.window.onMaximizedChange(setMaximized);
  }, []);

  const navItem = (view: ActiveView, label: string) => (
    <button
      key={view}
      className={`title-bar-nav-item ${activeView === view ? "active" : ""}`}
      onClick={(e) => {
        e.stopPropagation();
        setActiveView(view);
      }}
    >
      {label}
    </button>
  );

  return (
    <div
      className={`title-bar ${isMac ? "mac" : ""}`}
      onDoubleClick={() => wharf.window.toggleMaximize()}
    >
      <div className="title-bar-left">
        <button
          className="title-bar-icon-btn"
          title={sidebarCollapsed ? "Show sidebar (Ctrl/Cmd+B)" : "Hide sidebar (Ctrl/Cmd+B)"}
          onClick={(e) => {
            e.stopPropagation();
            toggleSidebar();
          }}
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
            <rect x="1" y="2.5" width="14" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
            <line x1="6" y1="2.5" x2="6" y2="13.5" stroke="currentColor" strokeWidth="1.3" />
            {sidebarCollapsed && <rect x="8.5" y="5.5" width="4" height="5" fill="currentColor" opacity="0.5" />}
          </svg>
        </button>
        <span className="title-bar-brand">
          <IconAnchor size={13} /> Wharf
        </span>
        <button
          className="title-bar-icon-btn"
          title="New Window"
          onClick={(e) => {
            e.stopPropagation();
            wharf.window.newWindow();
          }}
        >
          <IconDuplicate size={12} />
        </button>
        <button
          className="title-bar-icon-btn"
          title={resolvedTheme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          onClick={(e) => {
            e.stopPropagation();
            setMode(resolvedTheme === "dark" ? "light" : "dark");
          }}
        >
          {resolvedTheme === "dark" ? (
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.3" />
              <path
                d="M8 1v1.5M8 13.5V15M15 8h-1.5M2.5 8H1M12.7 3.3l-1.1 1.1M4.4 11.6l-1.1 1.1M12.7 12.7l-1.1-1.1M4.4 4.4L3.3 3.3"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
              />
            </svg>
          ) : (
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
              <path
                d="M13.5 9.5A6 6 0 1 1 6.5 2.5a5 5 0 0 0 7 7z"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </button>
        <button
          className="title-bar-icon-btn"
          title={`Keyboard shortcuts (${isMac ? "Cmd" : "Ctrl"}+/)`}
          onClick={(e) => {
            e.stopPropagation();
            onOpenShortcuts();
          }}
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.3" />
            <path
              d="M6 6.2a2 2 0 0 1 3.7-1 1.8 1.8 0 0 1-.9 2.6c-.6.3-.8.6-.8 1.2v.3"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
              fill="none"
            />
            <circle cx="8" cy="11.3" r="0.7" fill="currentColor" />
          </svg>
        </button>
      </div>

      <div className="title-bar-nav-wrap">
        <button
          className="title-bar-icon-btn"
          title={topNavCollapsed ? "Show navigation" : "Hide navigation"}
          onClick={(e) => {
            e.stopPropagation();
            toggleTopNav();
          }}
        >
          {topNavCollapsed ? <IconChevronDown size={12} /> : <IconChevronUp size={12} />}
        </button>
        {!topNavCollapsed && (
          <nav className="title-bar-nav">
            {navItem("hosts", "Hosts")}
            {navItem("tunnels", "Tunnels")}
            {navItem("workspaces", "Workspaces")}
            {navItem("history", "History")}
            {navItem("settings", "Settings")}
          </nav>
        )}
      </div>

      {!isMac && (
        <div className="title-bar-controls">
          <button className="win-btn" title="Minimize" onClick={() => wharf.window.minimize()}>
            <span className="win-btn-dot win-btn-minimize">
              <svg className="win-btn-glyph" width="8" height="8" viewBox="0 0 8 8">
                <rect x="0" y="3.3" width="8" height="1.3" fill="currentColor" />
              </svg>
            </span>
          </button>
          <button
            className="win-btn"
            title={maximized ? "Restore" : "Maximize"}
            onClick={() => wharf.window.toggleMaximize()}
          >
            <span className="win-btn-dot win-btn-maximize">
              {maximized ? (
                <svg className="win-btn-glyph" width="8" height="8" viewBox="0 0 8 8">
                  <rect x="1.6" y="0" width="6.4" height="6.4" fill="none" stroke="currentColor" strokeWidth="1.1" />
                  <rect x="0" y="1.6" width="6.4" height="6.4" fill="none" stroke="currentColor" strokeWidth="1.1" />
                </svg>
              ) : (
                <svg className="win-btn-glyph" width="8" height="8" viewBox="0 0 8 8">
                  <rect x="0" y="0" width="7.4" height="7.4" fill="none" stroke="currentColor" strokeWidth="1.1" />
                </svg>
              )}
            </span>
          </button>
          <button className="win-btn" title="Close" onClick={() => wharf.window.close()}>
            <span className="win-btn-dot win-btn-close">
              <svg className="win-btn-glyph" width="8" height="8" viewBox="0 0 8 8">
                <line x1="0" y1="0" x2="8" y2="8" stroke="currentColor" strokeWidth="1.2" />
                <line x1="8" y1="0" x2="0" y2="8" stroke="currentColor" strokeWidth="1.2" />
              </svg>
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
