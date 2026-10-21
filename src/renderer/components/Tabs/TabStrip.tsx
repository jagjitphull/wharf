import { useEffect, useRef, useState } from "react";
import { useAppStore, flattenPanes, TAB_COLORS, TAB_GROUP_COLORS, type TabGroup, type TerminalTab } from "../../state/store";
import { useTerminalPrefsStore } from "../../state/terminalPrefsStore";
import { getTerminalThemePreset } from "../../state/terminalThemes";
import { ipcErrorMessage, wharf } from "../../api/wharf";
import { reconnectTab } from "./tabActions";
import { toast } from "../../state/toastStore";
import { ContextMenu, useContextMenu } from "../ContextMenu/ContextMenu";
import { buildTerminalThemeMenuItems } from "../Terminal/TerminalThemeSwatches";
import { PromptDialog } from "../PromptDialog/PromptDialog";
import { IconBroadcast, IconChevronDown, IconChevronUp, IconClose, IconDuplicate, IconPin } from "../Icons/Icons";
import "./TabStrip.css";

const isMac = wharf.window.platform === "darwin";
const TAB_JUMP_MOD = isMac ? "Cmd" : "Ctrl";

/** The terminal tabs, drawn inside the title bar (see TitleBar). Owns every
 * tab action and its dialogs — rename, pin, move, colour, groups, logging,
 * save as workspace — so the terminal panel itself is only the panes. */
export function TabStrip() {
  const {
    tabs,
    tabGroups,
    activeTabId,
    activeView,
    setActiveView,
    paneMeta,
    setActiveTab,
    closeTab,
    duplicateTab,
    setTabPinned,
    renameTab,
    renamePane,
    moveTab,
    closeTabsToRight,
    setTabColor,
    saveCurrentAsWorkspace,
    reorderTab,
    setPaneThemeId,
    setPaneLogPath,
    createTabGroup,
    addTabToGroup,
    removeTabFromGroup,
    renameTabGroup,
    setTabGroupColor,
    toggleTabGroupCollapsed,
    ungroupTabs,
    closeTabGroup,
  } = useAppStore();
  const globalTerminalThemeId = useTerminalPrefsStore((s) => s.terminalThemeId);
  const { menu, open: openMenu, close: closeMenu } = useContextMenu();
  const stripRef = useRef<HTMLDivElement>(null);

  // With more tabs than fit, the strip scrolls; a tab you just opened or switched to
  // must never be the one that's out of sight.
  useEffect(() => {
    stripRef.current?.querySelector(".tab.active")?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [activeTabId, activeView, tabs.length]);

  /** A plain mouse wheel only turns vertically; over the strip, make it scroll the tabs. */
  function scrollSideways(e: React.WheelEvent<HTMLDivElement>) {
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) e.currentTarget.scrollLeft += e.deltaY;
  }
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [newGroupTabId, setNewGroupTabId] = useState<string | null>(null);
  const [renamingGroupId, setRenamingGroupId] = useState<string | null>(null);
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null);
  const [renamingPaneTabId, setRenamingPaneTabId] = useState<string | null>(null);
  const [savingTabId, setSavingTabId] = useState<string | null>(null);

  // Pinned tabs survive the bulk closes; they're closed one at a time, on purpose.
  async function closeOthers(tabId: string) {
    for (const tab of tabs) {
      if (tab.tabId !== tabId && !tab.pinned) await closeTab(tab.tabId);
    }
  }

  async function closeAll() {
    for (const tab of tabs) {
      if (!tab.pinned) await closeTab(tab.tabId);
    }
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

  /** Whether the tab has a neighbour in that direction within its own (pinned or unpinned) block. */
  function canMove(tab: TerminalTab, delta: -1 | 1): boolean {
    const neighbour = tabs[tabs.indexOf(tab) + delta];
    return !!neighbour && !!neighbour.pinned === !!tab.pinned;
  }

  function renderTabButton(tab: TerminalTab) {
    const activeMeta = paneMeta[tab.activePaneId];
    // Position in the flat tab order, 1-based — matches exactly what
    // Ctrl/Cmd+1..9 (App.tsx) jumps to, grouping aside, so the number shown
    // is always the number that actually gets you there.
    const tabNumber = tabs.indexOf(tab) + 1;
    return (
      <TabButton
        key={tab.tabId}
        tabId={tab.tabId}
        tabNumber={tabNumber}
        title={tab.customTitle ?? activeMeta?.title ?? "…"}
        pinned={!!tab.pinned}
        color={tab.color}
        isSplit={tab.layout.type === "split"}
        canMoveLeft={canMove(tab, -1)}
        canMoveRight={canMove(tab, 1)}
        hasTabsToClose={tabs.slice(tabs.indexOf(tab) + 1).some((t) => !t.pinned)}
        hostId={activeMeta?.hostId ?? null}
        closed={activeMeta?.closed ?? false}
        anyPaneClosed={flattenPanes(tab.layout).some((id) => paneMeta[id]?.closed)}
        closeError={activeMeta?.closeError}
        logPath={activeMeta?.logPath}
        themeId={activeMeta?.themeId}
        broadcasting={!!tab.broadcastInput}
        isActive={activeView === "hosts" && tab.tabId === activeTabId}
        draggingId={draggingId}
        dropTargetId={dropTargetId}
        tabCount={tabs.length}
        globalTerminalThemeId={globalTerminalThemeId}
        groupId={tab.groupId}
        tabGroups={tabGroups}
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
        onClick={() => {
          setActiveTab(tab.tabId);
          setActiveView("hosts");
        }}
        onDuplicate={() => duplicateTab(tab.tabId)}
        onReconnect={() => reconnectTab(tab.tabId)}
        onRename={() => setRenamingTabId(tab.tabId)}
        onRenamePane={() => setRenamingPaneTabId(tab.tabId)}
        onTogglePin={() => setTabPinned(tab.tabId, !tab.pinned)}
        onMove={(dir) => moveTab(tab.tabId, dir)}
        onCopyTitle={() => {
          void wharf.clipboard.writeText(tab.customTitle ?? activeMeta?.title ?? "");
          toast.success("Tab title copied");
        }}
        onSaveWorkspace={() => setSavingTabId(tab.tabId)}
        onCloseRight={() => closeTabsToRight(tab.tabId)}
        onSetColor={(c) => setTabColor(tab.tabId, c)}
        onClose={() => closeTab(tab.tabId)}
        onCloseOthers={() => closeOthers(tab.tabId)}
        onCloseAll={closeAll}
        onToggleLogging={() => activeMeta && toggleLogging(tab.activePaneId, activeMeta.logPath)}
        onSetTheme={(id) => setPaneThemeId(tab.activePaneId, id)}
        onNewGroup={() => setNewGroupTabId(tab.tabId)}
        onAddToGroup={(groupId) => addTabToGroup(tab.tabId, groupId)}
        onRemoveFromGroup={() => removeTabFromGroup(tab.tabId)}
        openMenu={openMenu}
      />
    );
  }

  // Chrome/Edge-style tab groups: a "segment" is one maximal run of
  // *consecutive* tabs sharing the same group (or no group at all). This is
  // computed fresh from tab order on every render rather than stored
  // separately — a group is only ever whatever's currently contiguous, so
  // dragging a tab out of its group's run visually splits it into two
  // same-colored clusters instead of needing special-cased drag handling to
  // keep membership and position in sync.
  const segments: { group: TabGroup | null; tabs: TerminalTab[] }[] = [];
  for (const tab of tabs) {
    const group = tab.groupId ? (tabGroups.find((g) => g.id === tab.groupId) ?? null) : null;
    const last = segments[segments.length - 1];
    if (last && last.group?.id === group?.id) last.tabs.push(tab);
    else segments.push({ group, tabs: [tab] });
  }

  return (
    <>
      <div className="tab-strip" ref={stripRef} onWheel={scrollSideways}>
        {segments.map((seg, i) =>
          seg.group ? (
            <div
              className="tab-group"
              key={`group-${seg.group.id}-${i}`}
              style={{ "--tab-group-color": seg.group.color } as React.CSSProperties}
            >
              <button
                className="tab-group-label"
                title={seg.group.collapsed ? "Expand group" : "Collapse group"}
                onClick={() => toggleTabGroupCollapsed(seg.group!.id)}
                onContextMenu={(e) =>
                  openMenu(e, [
                    { label: "Rename group…", onClick: () => setRenamingGroupId(seg.group!.id) },
                    { separator: true },
                    {
                      custom: (close) => (
                        <div className="term-theme-swatches">
                          <div className="term-theme-swatches-label">Group color</div>
                          <div className="term-theme-swatches-grid">
                            {TAB_GROUP_COLORS.map((c) => (
                              <button
                                key={c}
                                className={`term-theme-swatch-dot ${seg.group!.color === c ? "active" : ""}`}
                                style={{ background: c }}
                                title={c}
                                onClick={() => {
                                  setTabGroupColor(seg.group!.id, c);
                                  close();
                                }}
                              />
                            ))}
                          </div>
                        </div>
                      ),
                    },
                    { separator: true },
                    { label: "Ungroup", onClick: () => ungroupTabs(seg.group!.id) },
                    { label: "Close group", danger: true, onClick: () => closeTabGroup(seg.group!.id) },
                  ])
                }
              >
                {seg.group.collapsed ? <IconChevronDown size={10} /> : <IconChevronUp size={10} />}
                <span className="tab-group-name">{seg.group.name}</span>
                {seg.group.collapsed && <span className="tab-group-count">{seg.tabs.length}</span>}
              </button>
              {!seg.group.collapsed && seg.tabs.map(renderTabButton)}
            </div>
          ) : (
            seg.tabs.map(renderTabButton)
          ),
        )}
      </div>
      <ContextMenu menu={menu} onClose={closeMenu} />
      {newGroupTabId && (
        <PromptDialog
          title="New tab group"
          label="Name"
          placeholder="e.g. Production"
          confirmLabel="Create"
          onCancel={() => setNewGroupTabId(null)}
          onSubmit={(name) => {
            createTabGroup(newGroupTabId, name);
            setNewGroupTabId(null);
          }}
        />
      )}
      {renamingTabId && (
        <PromptDialog
          title="Rename tab"
          label="Name (leave empty to use the session's own name)"
          defaultValue={
            tabs.find((t) => t.tabId === renamingTabId)?.customTitle ??
            paneMeta[tabs.find((t) => t.tabId === renamingTabId)?.activePaneId ?? ""]?.title
          }
          confirmLabel="Rename"
          onCancel={() => setRenamingTabId(null)}
          onSubmit={(name) => {
            renameTab(renamingTabId, name);
            setRenamingTabId(null);
          }}
        />
      )}
      {renamingPaneTabId && (
        <PromptDialog
          title="Rename active pane"
          label="Name"
          defaultValue={paneMeta[tabs.find((t) => t.tabId === renamingPaneTabId)?.activePaneId ?? ""]?.title}
          confirmLabel="Rename"
          onCancel={() => setRenamingPaneTabId(null)}
          onSubmit={(name) => {
            const pane = tabs.find((t) => t.tabId === renamingPaneTabId)?.activePaneId;
            if (pane) renamePane(pane, name);
            setRenamingPaneTabId(null);
          }}
        />
      )}
      {savingTabId && (
        <PromptDialog
          title="Save tab as workspace"
          label="Workspace name"
          defaultValue={
            tabs.find((t) => t.tabId === savingTabId)?.customTitle ??
            paneMeta[tabs.find((t) => t.tabId === savingTabId)?.activePaneId ?? ""]?.title
          }
          confirmLabel="Save"
          onCancel={() => setSavingTabId(null)}
          onSubmit={(name) => {
            const tabId = savingTabId;
            setSavingTabId(null);
            if (name.trim()) {
              saveCurrentAsWorkspace(name.trim(), [tabId])
                .then(() => toast.success(`Saved workspace “${name.trim()}”`))
                .catch((err) => toast.error(`Couldn't save the workspace: ${ipcErrorMessage(err)}`));
            }
          }}
        />
      )}
      {renamingGroupId && (
        <PromptDialog
          title="Rename tab group"
          label="Name"
          defaultValue={tabGroups.find((g) => g.id === renamingGroupId)?.name}
          confirmLabel="Rename"
          onCancel={() => setRenamingGroupId(null)}
          onSubmit={(name) => {
            renameTabGroup(renamingGroupId, name);
            setRenamingGroupId(null);
          }}
        />
      )}
    </>
  );
}

interface TabButtonProps {
  tabId: string;
  tabNumber: number;
  title: string;
  hostId: string | null;
  closed: boolean;
  /** Any pane of this tab (not just the active one) has dropped. */
  anyPaneClosed: boolean;
  closeError?: string;
  logPath?: string;
  themeId?: string;
  broadcasting: boolean;
  isActive: boolean;
  draggingId: string | null;
  dropTargetId: string | null;
  tabCount: number;
  globalTerminalThemeId: string;
  groupId?: string;
  tabGroups: TabGroup[];
  onDragStart(): void;
  onDragEnd(): void;
  onDragOver(): void;
  onDrop(): void;
  onClick(): void;
  onDuplicate(): void;
  onReconnect(): void;
  pinned: boolean;
  color?: string;
  /** The tab has several panes (so "Rename pane" means something). */
  isSplit: boolean;
  canMoveLeft: boolean;
  canMoveRight: boolean;
  /** There is at least one unpinned tab to this tab's right. */
  hasTabsToClose: boolean;
  onRename(): void;
  onRenamePane(): void;
  onTogglePin(): void;
  onMove(direction: "left" | "right"): void;
  onCopyTitle(): void;
  onSaveWorkspace(): void;
  onCloseRight(): void;
  onSetColor(color: string | undefined): void;
  onClose(): void;
  onCloseOthers(): void;
  onCloseAll(): void;
  onToggleLogging(): void;
  onSetTheme(id: string): void;
  onNewGroup(): void;
  onAddToGroup(groupId: string): void;
  onRemoveFromGroup(): void;
  openMenu: ReturnType<typeof useContextMenu>["open"];
}

function TabButton(p: TabButtonProps) {
  const hosts = useAppStore((s) => s.hosts);
  // A color picked for this tab wins over its host's.
  const hostColor = p.color ?? hosts.find((h) => h.id === p.hostId)?.color;
  // undefined for the "Match App Theme" preset (the default for every tab
  // until someone deliberately picks one from the tab's right-click menu),
  // so tabs nobody has assigned a color theme to keep the plain look below
  // — only a tab someone actually colored gets a tinted background.
  const themeBg = getTerminalThemePreset(p.themeId ?? p.globalTerminalThemeId).theme?.background;

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
      className={`tab ${p.isActive ? "active" : ""} ${p.closed ? "closed" : ""} ${p.pinned ? "pinned" : ""} ${
        p.tabId === p.draggingId ? "dragging" : ""
      } ${p.tabId === p.dropTargetId ? "drop-target" : ""}`}
      // A host color used to draw the exact same top bar whether or not the tab
      // was active, which drowned out the active indicator entirely once more than
      // one tab shared a color — worse, EVERY tab got that same fixed 2px line
      // regardless of state, so the active tab had nothing left to stand out with
      // besides a barely-different background. Now the active tab's line is
      // thicker and full strength (falling back to the theme accent when the tab
      // has no host color of its own, matching .tab.active's old default), while
      // every inactive tab's line — host-colored or not — is thin and faint, so
      // it still hints at which host a tab belongs to without competing for
      // attention with whichever tab is actually active.
      style={
        {
          boxShadow: p.isActive ? `inset 0 2px 0 ${hostColor ?? "var(--accent)"}` : hostColor ? `inset 0 1px 0 ${hostColor}55` : undefined,
          // A tab's own color theme tints its background too (not just the
          // small tab-theme-dot), so tabs on different themes are
          // distinguishable at a glance without hovering or opening each one.
          // This can't just set `background` directly: an inline style always
          // wins over a stylesheet rule regardless of specificity or pseudo-
          // classes, which would permanently defeat .tab:hover and .tab.active's
          // own CSS rules the moment a theme was set. Setting only these custom
          // properties instead lets TerminalPanel.css's rules for each state
          // (rest/hover/active) consume whichever one applies via var(), same
          // as any other background they'd otherwise fall back to. Most of
          // these presets are deliberately dark, muted palettes (see
          // terminalThemes.ts), so a subtle tint gets swallowed entirely by the
          // app's own near-black chrome — needs a strong mix for a theme's
          // actual hue (Dracula's purple, Nord's blue-gray, Solarized's teal,
          // ...) to read as a distinct tab color rather than just a
          // barely-different shade of black.
          ...(themeBg
            ? {
                "--tab-theme-bg": `color-mix(in srgb, var(--bg-panel) 70%, ${themeBg} 30%)`,
                "--tab-theme-hover-bg": `color-mix(in srgb, var(--bg-hover) 55%, ${themeBg} 45%)`,
                "--tab-theme-active-bg": `color-mix(in srgb, var(--bg) 45%, ${themeBg} 55%)`,
              }
            : {}),
        } as React.CSSProperties
      }
      onClick={p.onClick}
      onContextMenu={(e) =>
        p.openMenu(e, [
          { label: p.anyPaneClosed ? "Reconnect" : "Reconnect…", onClick: p.onReconnect },
          { label: "Duplicate", onClick: p.onDuplicate },
          { separator: true },
          { label: "Rename Tab…", onClick: p.onRename },
          ...(p.isSplit ? [{ label: "Rename Active Pane…", onClick: p.onRenamePane }] : []),
          { label: p.pinned ? "Unpin Tab" : "Pin Tab", onClick: p.onTogglePin },
          { label: "Move Tab Left", disabled: !p.canMoveLeft, onClick: () => p.onMove("left") },
          { label: "Move Tab Right", disabled: !p.canMoveRight, onClick: () => p.onMove("right") },
          { separator: true },
          { label: "Copy Tab Title", onClick: p.onCopyTitle },
          { label: "Save Tab as Workspace…", onClick: p.onSaveWorkspace },
          { separator: true },
          { label: "Close", onClick: p.onClose },
          { label: "Close Others", disabled: p.tabCount < 2, onClick: p.onCloseOthers },
          { label: "Close Tabs to the Right", disabled: !p.hasTabsToClose, onClick: p.onCloseRight },
          { label: "Close All", onClick: p.onCloseAll },
          { separator: true },
          { label: p.logPath ? "Stop Logging" : "Start Logging…", onClick: p.onToggleLogging },
          ...buildTerminalThemeMenuItems(p.themeId ?? p.globalTerminalThemeId, p.onSetTheme),
          { separator: true },
          // A pinned tab doesn't belong to a group (pinning takes it out of one).
          ...(p.pinned
            ? []
            : p.groupId
              ? [{ label: "Remove from group", onClick: p.onRemoveFromGroup }]
              : [
                  ...p.tabGroups.map((g) => ({ label: `Add to "${g.name}"`, onClick: () => p.onAddToGroup(g.id) })),
                  { label: "New Tab Group…", onClick: p.onNewGroup },
                ]),
          { separator: true },
          {
            custom: (close) => (
              <div className="term-theme-swatches">
                <div className="term-theme-swatches-label">Tab color</div>
                <div className="term-theme-swatches-grid">
                  <button
                    className={`term-theme-swatch-dot tab-color-none ${p.color ? "" : "active"}`}
                    title="No color"
                    onClick={() => {
                      p.onSetColor(undefined);
                      close();
                    }}
                  />
                  {TAB_COLORS.map((c) => (
                    <button
                      key={c}
                      className={`term-theme-swatch-dot ${p.color === c ? "active" : ""}`}
                      style={{ background: c }}
                      title={c}
                      onClick={() => {
                        p.onSetColor(c);
                        close();
                      }}
                    />
                  ))}
                </div>
              </div>
            ),
          },
        ])
      }
      title={p.closeError}
    >
      <span className="tab-number" title={p.tabNumber <= 9 ? `${TAB_JUMP_MOD}+${p.tabNumber}` : undefined}>
        {p.tabNumber}
      </span>
      {hostColor && <span className="tab-color-dot" style={{ background: hostColor }} />}
      {p.logPath && <span className="tab-logging-dot" title={`Logging to ${p.logPath}`} />}
      {p.broadcasting && (
        <span className="tab-broadcast-badge" title="Broadcasting input to every pane in this tab">
          <IconBroadcast size={11} />
        </span>
      )}
      {p.themeId && (
        <span
          className="tab-theme-dot"
          title={`Color theme: ${getTerminalThemePreset(p.themeId).name}`}
          style={{ background: getTerminalThemePreset(p.themeId).theme?.background ?? "var(--term-bg)" }}
        />
      )}
      {p.pinned && (
        <span className="tab-pin" title="Pinned">
          <IconPin size={11} />
        </span>
      )}
      <span className="tab-title">{p.title}</span>
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
