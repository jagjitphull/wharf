import { useEffect, useState } from "react";
import { ipcErrorMessage, wharf } from "../../api/wharf";
import { useThemeStore } from "../../state/themeStore";
import { useUiPrefsStore } from "../../state/uiPrefsStore";
import { toast } from "../../state/toastStore";
import { useAppStore } from "../../state/store";
import { IconAnchor, IconDuplicate, IconHome, IconKeyboard, IconMoon, IconPlus, IconSearch, IconSun } from "../Icons/Icons";
import { TabStrip } from "../Tabs/TabStrip";
import { ContextMenu, useContextMenu } from "../ContextMenu/ContextMenu";
import "./TitleBar.css";

const isMac = wharf.window.platform === "darwin";

interface Props {
  onOpenShortcuts(): void;
  onOpenPalette(): void;
}

export function TitleBar({ onOpenShortcuts, onOpenPalette }: Props) {
  const [maximized, setMaximized] = useState(false);
  const resolvedTheme = useThemeStore((s) => s.resolved);
  const setMode = useThemeStore((s) => s.setMode);
  const sidebarCollapsed = useUiPrefsStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useUiPrefsStore((s) => s.toggleSidebar);
  const activeView = useAppStore((s) => s.activeView);
  const setActiveView = useAppStore((s) => s.setActiveView);
  const openLocalShell = useAppStore((s) => s.openLocalShell);
  const { menu, open: openMenu, close: closeMenu } = useContextMenu();

  useEffect(() => {
    wharf.window.isMaximized().then(setMaximized);
    return wharf.window.onMaximizedChange(setMaximized);
  }, []);

  // Buttons in the bar must not start a window drag or toggle maximize.
  const swallow = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    fn();
  };

  // Window controls are mouse-only chrome, like a native title bar's: clicking one shouldn't
  // take focus from the terminal or leave a focus ring on the button.
  const keepFocus = (e: React.MouseEvent) => e.preventDefault();

  return (
    <div className={`title-bar ${isMac ? "mac" : ""}`} onDoubleClick={() => wharf.window.toggleMaximize()}>
      <span className="title-bar-brand">
        <IconAnchor size={18} /> Wharf
      </span>

      <div className="title-bar-tabs" onDoubleClick={(e) => e.stopPropagation()}>
        <button
          className={`tab home-tab ${activeView === "home" ? "active" : ""}`}
          style={activeView === "home" ? { boxShadow: "inset 0 2px 0 var(--accent)" } : undefined}
          onClick={() => setActiveView("home")}
        >
          <IconHome size={15} /> Home
        </button>
        <TabStrip />
        <button
          className="title-bar-icon-btn title-bar-new-tab"
          title="New tab"
          aria-label="New tab"
          onClick={(e) =>
            openMenu(e, [
              {
                label: "New Local Shell",
                onClick: () => {
                  openLocalShell().catch((err) => toast.error(ipcErrorMessage(err)));
                },
              },
              { label: "Command Palette…", onClick: onOpenPalette },
            ])
          }
        >
          <IconPlus size={15} />
        </button>
      </div>

      <div className="title-bar-actions">
        <button
          className="title-bar-palette"
          title="Search hosts and actions"
          aria-label="Open the command palette"
          onClick={swallow(onOpenPalette)}
        >
          <IconSearch size={13} />
          <span className="title-bar-palette-label">Search</span>
          <kbd>{isMac ? "⌘K" : "Ctrl K"}</kbd>
        </button>
        <button
          className="title-bar-icon-btn"
          title={sidebarCollapsed ? "Show sidebar (Ctrl/Cmd+B)" : "Hide sidebar (Ctrl/Cmd+B)"}
          onClick={swallow(toggleSidebar)}
        >
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
            <rect x="1" y="2.5" width="14" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
            <line x1="6" y1="2.5" x2="6" y2="13.5" stroke="currentColor" strokeWidth="1.3" />
            {sidebarCollapsed && <rect x="8.5" y="5.5" width="4" height="5" fill="currentColor" opacity="0.5" />}
          </svg>
        </button>
        <button className="title-bar-icon-btn" title="New Window" onClick={swallow(() => wharf.window.newWindow())}>
          <IconDuplicate size={14} />
        </button>
        <button
          className="title-bar-icon-btn"
          title={resolvedTheme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          onClick={swallow(() => setMode(resolvedTheme === "dark" ? "light" : "dark"))}
        >
          {resolvedTheme === "dark" ? <IconSun size={15} /> : <IconMoon size={15} />}
        </button>
        <button
          className="title-bar-icon-btn"
          title={`Keyboard shortcuts (${isMac ? "Cmd" : "Ctrl"}+/)`}
          onClick={swallow(onOpenShortcuts)}
        >
          <IconKeyboard size={15} />
        </button>
      </div>

      {!isMac && (
        <div className="title-bar-controls">
          <button className="win-btn" tabIndex={-1} onMouseDown={keepFocus} title="Minimize" onClick={() => wharf.window.minimize()}>
            <span className="win-btn-dot win-btn-minimize">
              <svg className="win-btn-glyph" width="8" height="8" viewBox="0 0 8 8">
                <rect x="0" y="3.3" width="8" height="1.3" fill="currentColor" />
              </svg>
            </span>
          </button>
          <button
            className="win-btn"
            tabIndex={-1}
            onMouseDown={keepFocus}
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
          <button className="win-btn" tabIndex={-1} onMouseDown={keepFocus} title="Close" onClick={() => wharf.window.close()}>
            <span className="win-btn-dot win-btn-close">
              <svg className="win-btn-glyph" width="8" height="8" viewBox="0 0 8 8">
                <line x1="0" y1="0" x2="8" y2="8" stroke="currentColor" strokeWidth="1.2" />
                <line x1="8" y1="0" x2="0" y2="8" stroke="currentColor" strokeWidth="1.2" />
              </svg>
            </span>
          </button>
        </div>
      )}
      <ContextMenu menu={menu} onClose={closeMenu} />
    </div>
  );
}
