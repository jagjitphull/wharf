import { create } from "zustand";
import type { GroupRecord, HostInput, HostRecord, SnippetRecord, TunnelRecord, WorkspaceNode, WorkspaceRecord, WorkspaceTab } from "@shared/types";
import { wharf } from "../api/wharf";
import { getScrollback } from "../components/Terminal/scrollbackRegistry";

/**
 * A tab's content is a binary tree of panes rather than a single session,
 * so a tab can be split (like tmux/iTerm) into several independent
 * terminals side by side. A plain single-pane tab is just a `leaf` root —
 * splitting nests it under a `split` node; closing back down to one pane
 * collapses the split away again (see splitNode/removeNode below).
 */
export type PaneNode =
  | { type: "leaf"; sessionId: string }
  | {
      type: "split";
      /** Stable id so a resize can target this exact split node without
       * needing to describe its position in the tree (which shifts as
       * sibling panes split/close around it). */
      id: string;
      direction: "row" | "column";
      children: PaneNode[];
      /** Relative sizes (flex-grow factors, not required to sum to 1) for
       * each child, parallel to `children`. Undefined means split evenly —
       * the common case, so a plain split doesn't need to carry an explicit
       * [0.5, 0.5] just to render. */
      sizes?: number[];
    };

/** Per-pane state, keyed by sessionId. Each pane is its own independent
 * SSH/local-shell session, so this is where everything that used to live
 * on TerminalTab directly (before splits existed) now lives. */
export interface PaneMeta {
  /** null for a local shell pane — it isn't connected to any saved host. */
  hostId: string | null;
  /** Host name, or "Local Shell" — used for the tab title (from the active pane) and StatusBar. */
  title: string;
  connectedAt: number;
  closed?: boolean;
  closeError?: string;
  /** Per-pane terminal color theme override (a TERMINAL_THEME_PRESETS id).
   * Undefined means "use the global terminal theme from Settings". */
  themeId?: string;
  /** Path this pane's raw output is currently being logged to, if any. */
  logPath?: string;
  /** Set while an automatic reconnect (after an unexpected drop) is in
   * progress; cleared on success or on giving up (the latter also sets
   * `closed`). */
  reconnecting?: { attempt: number; maxAttempts: number };
  /** Serialized content from this pane's previous incarnation, restored by
   * restoreLastSession() — TerminalView writes it into the fresh terminal
   * once on mount, then clears this field (see clearRestoredScrollback).
   * Never set outside that restore path. */
  restoredScrollback?: string;
  /** When restoredScrollback was captured — shown in the restore banner. */
  restoredScrollbackCapturedAt?: number;
}

export interface TerminalTab {
  tabId: string;
  layout: PaneNode;
  /** Which pane in this tab currently has keyboard focus / is highlighted. */
  activePaneId: string;
  /** While true, keystrokes typed into any pane of this tab are sent to
   * every pane in it (tmux/iTerm2 "broadcast input") — for running the
   * same command across several hosts split side by side. Off by default;
   * per-tab, not global, since it's easy to forget is on. */
  broadcastInput?: boolean;
  /** Which TabGroup (see below) this tab belongs to, if any. Membership is
   * just this id — the tab bar's visual bracket/label groups whichever
   * *consecutive* tabs currently share one, so dragging a tab out of its
   * group's run splits the group into two separate-looking clusters rather
   * than needing special-cased drag handling to keep it contiguous; they
   * re-merge visually the moment they're adjacent again. */
  groupId?: string;
}

/** A named, colored cluster of tabs in the tab bar (Chrome/Edge-style tab
 * groups) — purely a renderer-side grouping of already-open tabs, not
 * persisted, same as tabs themselves. */
export interface TabGroup {
  id: string;
  name: string;
  /** One of TAB_GROUP_COLORS. */
  color: string;
  collapsed: boolean;
}

/** Curated palette for tab group labels — deliberately separate from
 * HOST_COLOR_PRESETS (host identity) and the terminal theme presets (a
 * pane's own color scheme); this is just for telling groups of tabs apart
 * in the bar. */
export const TAB_GROUP_COLORS = [
  "#e0575f", // red
  "#e08a3c", // orange
  "#dbb642", // yellow
  "#35c76e", // green
  "#2bb3a3", // teal
  "#5b8def", // blue
  "#8b6cef", // purple
  "#e0619f", // pink
] as const;

export type ActiveView = "hosts" | "sftp" | "tunnels" | "history" | "settings" | "workspaces";

/** All leaf sessionIds under a pane node, in left-to-right/top-to-bottom order. */
export function flattenPanes(node: PaneNode): string[] {
  if (node.type === "leaf") return [node.sessionId];
  return node.children.flatMap(flattenPanes);
}

/** Nests `targetSessionId`'s leaf under a new split containing it and a
 * fresh leaf for `newSessionId`. No-op (returns node unchanged) if
 * `targetSessionId` isn't found anywhere in the tree. */
function splitNode(node: PaneNode, targetSessionId: string, newSessionId: string, direction: "row" | "column"): PaneNode {
  if (node.type === "leaf") {
    if (node.sessionId !== targetSessionId) return node;
    return { type: "split", id: crypto.randomUUID(), direction, children: [node, { type: "leaf", sessionId: newSessionId }] };
  }
  return { ...node, children: node.children.map((c) => splitNode(c, targetSessionId, newSessionId, direction)) };
}

/** Removes a leaf. A split left with exactly one remaining child collapses
 * into that child directly (so closing back down to one pane leaves a
 * plain leaf, not a pointless 1-child split). Returns null if the whole
 * (sub)tree became empty — the caller drops the tab entirely in that case. */
function removeNode(node: PaneNode, targetSessionId: string): PaneNode | null {
  if (node.type === "leaf") {
    return node.sessionId === targetSessionId ? null : node;
  }
  const survivingIndices: number[] = [];
  const children: PaneNode[] = [];
  node.children.forEach((c, i) => {
    const removed = removeNode(c, targetSessionId);
    if (removed !== null) {
      survivingIndices.push(i);
      children.push(removed);
    }
  });
  if (children.length === 0) return null;
  if (children.length === 1) return children[0];
  // Keep any custom sizes aligned to whichever children survived, so
  // closing one pane out of a three-way split doesn't silently reset the
  // other two back to an even split.
  const sizes = node.sizes ? survivingIndices.map((i) => node.sizes![i]) : undefined;
  return { ...node, children, sizes };
}

/** Walks the tree looking for the split node with `splitId` and replaces
 * its sizes — used by a resize-divider drag. No-op if the split is no
 * longer in the tree (e.g. a pane it contained was closed concurrently). */
function setSplitSizes(node: PaneNode, splitId: string, sizes: number[]): PaneNode {
  if (node.type === "leaf") return node;
  if (node.id === splitId) return { ...node, sizes };
  return { ...node, children: node.children.map((c) => setSplitSizes(c, splitId, sizes)) };
}

interface AppState {
  hosts: HostRecord[];
  groups: GroupRecord[];
  tunnels: TunnelRecord[];
  snippets: SnippetRecord[];
  workspaces: WorkspaceRecord[];

  tabs: TerminalTab[];
  activeTabId: string | null;
  /** Per-pane (per-session) state; see PaneMeta. */
  paneMeta: Record<string, PaneMeta>;
  tabGroups: TabGroup[];

  activeView: ActiveView;
  /** Host currently in focus for the SFTP/Tunnels panels (independent from which terminal tab is active). */
  contextHostId: string | null;

  loadAll(): Promise<void>;
  refreshHosts(): Promise<void>;
  refreshGroups(): Promise<void>;
  refreshTunnels(): Promise<void>;
  refreshSnippets(): Promise<void>;
  refreshWorkspaces(): Promise<void>;
  /** Saves the currently open tabs (and each one's split layout) as a named
   * workspace — each pane is stored as a reference to its host (or null for
   * a local shell), not its live session, so it can be reopened fresh. */
  saveCurrentAsWorkspace(name: string): Promise<void>;
  /** Reconnects every pane of every tab in a saved workspace and opens them
   * as new tabs alongside whatever's already open (existing tabs/sessions
   * are left alone). */
  openWorkspace(workspaceId: string): Promise<void>;
  /** Reopens whatever tabs were open when the app last quit (or last had its
   * tabs change) — same mechanism as openWorkspace, against the
   * automatically-kept-in-sync snapshot rather than a named workspace. A
   * tab that fails to reconnect (e.g. auth failure while unattended) is
   * skipped rather than aborting the rest — see its own doc comment. */
  restoreLastSession(): Promise<void>;
  /** Reassigns a saved host to a different group (or null to ungroup it) —
   * used by the sidebar's drag-and-drop. Sends the host's existing fields
   * back unchanged aside from groupId; wharf.hosts.update keeps its saved
   * credential untouched when HostInput.secret is left out. */
  moveHostToGroup(hostId: string, groupId: string | null): Promise<void>;

  openTerminal(host: HostRecord, themeId?: string): Promise<void>;
  openLocalShell(themeId?: string): Promise<void>;
  /** Closes one pane (disconnecting its session). If it's the tab's only
   * pane this closes the tab too; otherwise the tab's split tree collapses
   * around the removed pane. */
  closeTerminal(sessionId: string): Promise<void>;
  /** Closes every pane in a tab and removes the tab. */
  closeTab(tabId: string): Promise<void>;
  duplicateTab(tabId: string): Promise<void>;
  reorderTab(tabId: string, beforeTabId: string): void;
  /** Creates a new tab group containing just `tabId`, with a freshly-picked
   * color (round-robins TAB_GROUP_COLORS by how many groups already exist,
   * so successive new groups don't all start out the same color). */
  createTabGroup(tabId: string, name: string): void;
  /** Moves `tabId` into an existing group, reordering it to sit right after
   * that group's other tabs so it starts out contiguous with them. */
  addTabToGroup(tabId: string, groupId: string): void;
  /** Clears a tab's group membership; deletes the group entirely once its
   * last tab leaves it. */
  removeTabFromGroup(tabId: string): void;
  renameTabGroup(groupId: string, name: string): void;
  setTabGroupColor(groupId: string, color: string): void;
  toggleTabGroupCollapsed(groupId: string): void;
  /** Clears every one of the group's tabs' membership and deletes the
   * group, leaving the tabs themselves open. */
  ungroupTabs(groupId: string): void;
  /** Closes every tab currently in the group (which also deletes the group,
   * via closeTab's own now-empty cleanup). */
  closeTabGroup(groupId: string): Promise<void>;
  setActiveTab(tabId: string | null): void;
  /** Splits `sessionId`'s pane, opening a fresh session to the same host
   * alongside it (row = side by side, column = stacked). */
  splitPane(tabId: string, sessionId: string, direction: "row" | "column"): Promise<void>;
  /** Sets the relative sizes of a split's children (a resize-divider drag) —
   * see PaneNode.sizes. */
  resizeSplit(tabId: string, splitId: string, sizes: number[]): void;
  setActivePane(tabId: string, sessionId: string): void;
  setPaneThemeId(sessionId: string, themeId: string | undefined): void;
  setPaneLogPath(sessionId: string, logPath: string | undefined): void;
  /** Called once by TerminalView right after writing a pane's restored
   * scrollback (if any) into the fresh terminal — nothing re-reads this
   * field afterward, but leaving it set would be a stale, confusing leftover
   * in paneMeta for the rest of that pane's life. */
  clearRestoredScrollback(sessionId: string): void;
  toggleBroadcastInput(tabId: string): void;

  setActiveView(view: ActiveView): void;
  setContextHostId(hostId: string | null): void;
}

/** Shared by openTerminal/openLocalShell/splitPane: connects a fresh
 * session to `host` (or a local shell if null) and returns the PaneMeta a
 * brand-new pane starts with. */
async function connectSession(
  host: HostRecord | null,
  themeId: string | undefined,
  localShellOrdinal: number,
): Promise<{ sessionId: string; meta: PaneMeta }> {
  if (host) {
    const { sessionId } = await wharf.ssh.connect(host.id, 80, 24);
    return { sessionId, meta: { hostId: host.id, title: host.name, connectedAt: Date.now(), themeId } };
  }
  const { sessionId } = await wharf.localShell.connect(80, 24);
  const title = localShellOrdinal === 0 ? "Local Shell" : `Local Shell ${localShellOrdinal + 1}`;
  return { sessionId, meta: { hostId: null, title, connectedAt: Date.now(), themeId } };
}

/** Recursively (re)connects every leaf of a saved workspace tab, in order —
 * sequential rather than parallel so several hosts don't all auth at once,
 * which matters less for correctness than for not hammering several
 * connections open simultaneously. A leaf whose host was since deleted
 * falls back to a local shell rather than aborting the whole open, so one
 * stale reference doesn't cost you the rest of the layout. */
async function connectWorkspaceNode(
  node: WorkspaceNode,
  hosts: HostRecord[],
  localShellOrdinal: { count: number },
  metasOut: Record<string, PaneMeta>,
): Promise<PaneNode> {
  if (node.type === "leaf") {
    const host = node.hostId ? (hosts.find((h) => h.id === node.hostId) ?? null) : null;
    const ordinal = host ? 0 : localShellOrdinal.count++;
    const { sessionId, meta } = await connectSession(host, undefined, ordinal);
    metasOut[sessionId] = node.scrollback
      ? { ...meta, restoredScrollback: node.scrollback, restoredScrollbackCapturedAt: node.scrollbackCapturedAt }
      : meta;
    return { type: "leaf", sessionId };
  }
  const children: PaneNode[] = [];
  for (const child of node.children) {
    children.push(await connectWorkspaceNode(child, hosts, localShellOrdinal, metasOut));
  }
  return { type: "split", id: crypto.randomUUID(), direction: node.direction, children };
}

/** `includeScrollback` is only ever true for the automatic last-session
 * snapshot (see the module-level persist subscription below) — a named,
 * explicitly-saved Workspace never carries it (see WorkspaceNode's own doc
 * comment on `scrollback` for why). */
function paneNodeToWorkspaceNode(node: PaneNode, paneMeta: Record<string, PaneMeta>, includeScrollback = false): WorkspaceNode {
  if (node.type === "leaf") {
    const hostId = paneMeta[node.sessionId]?.hostId ?? null;
    const scrollback = includeScrollback ? getScrollback(node.sessionId) : undefined;
    return scrollback ? { type: "leaf", hostId, scrollback, scrollbackCapturedAt: Date.now() } : { type: "leaf", hostId };
  }
  return {
    type: "split",
    direction: node.direction,
    children: node.children.map((c) => paneNodeToWorkspaceNode(c, paneMeta, includeScrollback)),
  };
}

/** Shared by openWorkspace/restoreLastSession: (re)connects every tab of a
 * saved layout in order and hands each one to `onTabConnected` as it comes
 * up, so callers only differ in where the tabs come from and how a single
 * tab's connect failure should be handled. With `isolateFailures` a failed
 * tab is skipped (logged, not thrown) so the rest of an unattended restore
 * still comes up; without it a failure propagates, same as before this was
 * extracted (openWorkspace's own manual "Open" surfaces the error). */
async function connectSavedTabs(
  tabs: WorkspaceTab[],
  hosts: HostRecord[],
  onTabConnected: (tab: TerminalTab, metas: Record<string, PaneMeta>) => void,
  isolateFailures: boolean,
): Promise<void> {
  const localShellOrdinal = { count: 0 };
  for (const workspaceTab of tabs) {
    try {
      const metas: Record<string, PaneMeta> = {};
      const layout = await connectWorkspaceNode(workspaceTab.layout, hosts, localShellOrdinal, metas);
      const activePaneId = flattenPanes(layout)[0];
      const tab: TerminalTab = { tabId: crypto.randomUUID(), layout, activePaneId };
      onTabConnected(tab, metas);
    } catch (err) {
      if (!isolateFailures) throw err;
      console.warn("Skipped restoring a tab from the last session:", err);
    }
  }
}

export const useAppStore = create<AppState>((set, get) => ({
  hosts: [],
  groups: [],
  tunnels: [],
  snippets: [],
  workspaces: [],

  tabs: [],
  activeTabId: null,
  paneMeta: {},
  tabGroups: [],

  activeView: "hosts",
  contextHostId: null,

  async loadAll() {
    await Promise.all([
      get().refreshHosts(),
      get().refreshGroups(),
      get().refreshTunnels(),
      get().refreshSnippets(),
      get().refreshWorkspaces(),
    ]);
  },

  async refreshHosts() {
    set({ hosts: await wharf.hosts.list() });
  },

  async refreshGroups() {
    set({ groups: await wharf.groups.list() });
  },

  async refreshTunnels() {
    set({ tunnels: await wharf.tunnels.list() });
  },

  async refreshSnippets() {
    set({ snippets: await wharf.snippets.list() });
  },

  async refreshWorkspaces() {
    set({ workspaces: await wharf.workspaces.list() });
  },

  async saveCurrentAsWorkspace(name) {
    const { tabs, paneMeta } = get();
    const workspaceTabs: WorkspaceTab[] = tabs.map((t) => ({ layout: paneNodeToWorkspaceNode(t.layout, paneMeta) }));
    await wharf.workspaces.create({ name, tabs: workspaceTabs });
    await get().refreshWorkspaces();
  },

  async openWorkspace(workspaceId) {
    const workspace = get().workspaces.find((w) => w.id === workspaceId);
    if (!workspace) return;
    await connectSavedTabs(
      workspace.tabs,
      get().hosts,
      (tab, metas) =>
        set((s) => ({ tabs: [...s.tabs, tab], activeTabId: tab.tabId, paneMeta: { ...s.paneMeta, ...metas } })),
      false,
    );
    set({ activeView: "hosts" });
  },

  async restoreLastSession() {
    const savedTabs = await wharf.session.getLast();
    if (savedTabs.length === 0) return;
    await connectSavedTabs(
      savedTabs,
      get().hosts,
      (tab, metas) =>
        set((s) => ({ tabs: [...s.tabs, tab], activeTabId: tab.tabId, paneMeta: { ...s.paneMeta, ...metas } })),
      true,
    );
  },

  async moveHostToGroup(hostId, groupId) {
    const host = get().hosts.find((h) => h.id === hostId);
    if (!host || host.groupId === groupId) return;
    const input: HostInput = {
      name: host.name,
      hostname: host.hostname,
      port: host.port,
      username: host.username,
      groupId,
      authMethod: host.authMethod,
      privateKeyPath: host.privateKeyPath,
      color: host.color,
      tags: host.tags,
      jumpHostId: host.jumpHostId,
      mosh: host.mosh,
    };
    await wharf.hosts.update(hostId, input);
    await get().refreshHosts();
  },

  async openTerminal(host, themeId) {
    const { sessionId, meta } = await connectSession(host, themeId, 0);
    const tab: TerminalTab = { tabId: crypto.randomUUID(), layout: { type: "leaf", sessionId }, activePaneId: sessionId };
    set((s) => ({
      tabs: [...s.tabs, tab],
      activeTabId: tab.tabId,
      activeView: "hosts",
      paneMeta: { ...s.paneMeta, [sessionId]: meta },
    }));
  },

  async openLocalShell(themeId) {
    const existingLocalShells = Object.values(get().paneMeta).filter((m) => m.hostId === null).length;
    const { sessionId, meta } = await connectSession(null, themeId, existingLocalShells);
    const tab: TerminalTab = { tabId: crypto.randomUUID(), layout: { type: "leaf", sessionId }, activePaneId: sessionId };
    set((s) => ({
      tabs: [...s.tabs, tab],
      activeTabId: tab.tabId,
      activeView: "hosts",
      paneMeta: { ...s.paneMeta, [sessionId]: meta },
    }));
  },

  async closeTerminal(sessionId) {
    await wharf.ssh.disconnect(sessionId).catch(() => {});
    set((s) => {
      const tabs: TerminalTab[] = [];
      for (const tab of s.tabs) {
        if (!flattenPanes(tab.layout).includes(sessionId)) {
          tabs.push(tab);
          continue;
        }
        const newLayout = removeNode(tab.layout, sessionId);
        if (newLayout === null) continue; // tab's only pane — drop the tab
        const activePaneId = tab.activePaneId === sessionId ? flattenPanes(newLayout)[0] : tab.activePaneId;
        tabs.push({ ...tab, layout: newLayout, activePaneId });
      }
      const activeTabId = tabs.some((t) => t.tabId === s.activeTabId) ? s.activeTabId : (tabs.at(-1)?.tabId ?? null);
      const paneMeta = { ...s.paneMeta };
      delete paneMeta[sessionId];
      return { tabs, activeTabId, paneMeta };
    });
  },

  async closeTab(tabId) {
    const tab = get().tabs.find((t) => t.tabId === tabId);
    if (!tab) return;
    const sessionIds = flattenPanes(tab.layout);
    await Promise.all(sessionIds.map((id) => wharf.ssh.disconnect(id).catch(() => {})));
    set((s) => {
      const tabs = s.tabs.filter((t) => t.tabId !== tabId);
      const activeTabId = s.activeTabId === tabId ? (tabs.at(-1)?.tabId ?? null) : s.activeTabId;
      const paneMeta = { ...s.paneMeta };
      for (const id of sessionIds) delete paneMeta[id];
      // A tab group that's lost its last remaining tab to this close no
      // longer has anything to label — drop it too, rather than leaving a
      // named color with nothing under it around forever.
      const tabGroups = tab.groupId && !tabs.some((t) => t.groupId === tab.groupId)
        ? s.tabGroups.filter((g) => g.id !== tab.groupId)
        : s.tabGroups;
      return { tabs, activeTabId, paneMeta, tabGroups };
    });
  },

  async duplicateTab(tabId) {
    const tab = get().tabs.find((t) => t.tabId === tabId);
    if (!tab) return;
    const meta = get().paneMeta[tab.activePaneId];
    if (!meta) return;
    if (meta.hostId === null) {
      await get().openLocalShell(meta.themeId);
      return;
    }
    const host = get().hosts.find((h) => h.id === meta.hostId);
    if (!host) return;
    await get().openTerminal(host, meta.themeId);
  },

  reorderTab(tabId, beforeTabId) {
    if (tabId === beforeTabId) return;
    set((s) => {
      const tabs = [...s.tabs];
      const fromIdx = tabs.findIndex((t) => t.tabId === tabId);
      const toIdx = tabs.findIndex((t) => t.tabId === beforeTabId);
      if (fromIdx === -1 || toIdx === -1) return {};
      const [moved] = tabs.splice(fromIdx, 1);
      tabs.splice(toIdx, 0, moved);
      return { tabs };
    });
  },

  createTabGroup(tabId, name) {
    const id = crypto.randomUUID();
    set((s) => {
      const color = TAB_GROUP_COLORS[s.tabGroups.length % TAB_GROUP_COLORS.length];
      return {
        tabGroups: [...s.tabGroups, { id, name, color, collapsed: false }],
        tabs: s.tabs.map((t) => (t.tabId === tabId ? { ...t, groupId: id } : t)),
      };
    });
  },

  addTabToGroup(tabId, groupId) {
    set((s) => {
      const tabs = [...s.tabs];
      const fromIdx = tabs.findIndex((t) => t.tabId === tabId);
      if (fromIdx === -1) return {};
      const [moved] = tabs.splice(fromIdx, 1);
      // Insert right after the group's current last member so the moved tab
      // starts out contiguous with the rest of its new group — scanning from
      // the end rather than taking the first match, since the group's run
      // isn't necessarily at the front of the array.
      let lastMemberIdx = -1;
      for (let i = tabs.length - 1; i >= 0; i--) {
        if (tabs[i].groupId === groupId) {
          lastMemberIdx = i;
          break;
        }
      }
      const insertAt = lastMemberIdx === -1 ? tabs.length : lastMemberIdx + 1;
      tabs.splice(insertAt, 0, { ...moved, groupId });
      return { tabs };
    });
  },

  removeTabFromGroup(tabId) {
    set((s) => {
      const tab = s.tabs.find((t) => t.tabId === tabId);
      const groupId = tab?.groupId;
      const tabs = s.tabs.map((t) => (t.tabId === tabId ? { ...t, groupId: undefined } : t));
      const stillUsed = groupId && tabs.some((t) => t.groupId === groupId);
      const tabGroups = stillUsed ? s.tabGroups : s.tabGroups.filter((g) => g.id !== groupId);
      return { tabs, tabGroups };
    });
  },

  renameTabGroup(groupId, name) {
    set((s) => ({ tabGroups: s.tabGroups.map((g) => (g.id === groupId ? { ...g, name } : g)) }));
  },

  setTabGroupColor(groupId, color) {
    set((s) => ({ tabGroups: s.tabGroups.map((g) => (g.id === groupId ? { ...g, color } : g)) }));
  },

  toggleTabGroupCollapsed(groupId) {
    set((s) => {
      const group = s.tabGroups.find((g) => g.id === groupId);
      if (!group) return {};
      const collapsing = !group.collapsed;
      const tabGroups = s.tabGroups.map((g) => (g.id === groupId ? { ...g, collapsed: collapsing } : g));
      if (!collapsing) return { tabGroups };
      // Collapsing hides the group's tabs from the bar entirely — if the
      // active tab was one of them, switch to the nearest tab outside the
      // group (checking forward first, then back) so there's still a
      // highlighted tab whose content matches what's actually shown, rather
      // than leaving activeTabId pointing at one no longer visible.
      const activeIdx = s.tabs.findIndex((t) => t.tabId === s.activeTabId);
      if (activeIdx === -1 || s.tabs[activeIdx].groupId !== groupId) return { tabGroups };
      const next = s.tabs.slice(activeIdx + 1).find((t) => t.groupId !== groupId);
      let prev: TerminalTab | undefined;
      for (let i = activeIdx - 1; i >= 0; i--) {
        if (s.tabs[i].groupId !== groupId) {
          prev = s.tabs[i];
          break;
        }
      }
      return { tabGroups, activeTabId: (next ?? prev)?.tabId ?? null };
    });
  },

  ungroupTabs(groupId) {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.groupId === groupId ? { ...t, groupId: undefined } : t)),
      tabGroups: s.tabGroups.filter((g) => g.id !== groupId),
    }));
  },

  async closeTabGroup(groupId) {
    const memberIds = get()
      .tabs.filter((t) => t.groupId === groupId)
      .map((t) => t.tabId);
    for (const tabId of memberIds) await get().closeTab(tabId);
  },

  setActiveTab(tabId) {
    set({ activeTabId: tabId });
  },

  async splitPane(tabId, sessionId, direction) {
    const tab = get().tabs.find((t) => t.tabId === tabId);
    const meta = get().paneMeta[sessionId];
    if (!tab || !meta) return;
    const host = meta.hostId === null ? null : (get().hosts.find((h) => h.id === meta.hostId) ?? null);
    if (meta.hostId !== null && !host) return; // host was deleted out from under this pane
    const existingLocalShells = Object.values(get().paneMeta).filter((m) => m.hostId === null).length;
    const { sessionId: newSessionId, meta: newMeta } = await connectSession(host, meta.themeId, existingLocalShells);
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.tabId === tabId
          ? { ...t, layout: splitNode(t.layout, sessionId, newSessionId, direction), activePaneId: newSessionId }
          : t,
      ),
      paneMeta: { ...s.paneMeta, [newSessionId]: newMeta },
    }));
  },

  resizeSplit(tabId, splitId, sizes) {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.tabId === tabId ? { ...t, layout: setSplitSizes(t.layout, splitId, sizes) } : t)),
    }));
  },

  setActivePane(tabId, sessionId) {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.tabId === tabId ? { ...t, activePaneId: sessionId } : t)),
    }));
  },

  toggleBroadcastInput(tabId) {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.tabId === tabId ? { ...t, broadcastInput: !t.broadcastInput } : t)),
    }));
  },

  setPaneThemeId(sessionId, themeId) {
    set((s) => {
      const meta = s.paneMeta[sessionId];
      if (!meta) return {};
      return { paneMeta: { ...s.paneMeta, [sessionId]: { ...meta, themeId } } };
    });
  },

  setPaneLogPath(sessionId, logPath) {
    set((s) => {
      const meta = s.paneMeta[sessionId];
      if (!meta) return {};
      return { paneMeta: { ...s.paneMeta, [sessionId]: { ...meta, logPath } } };
    });
  },

  clearRestoredScrollback(sessionId) {
    set((s) => {
      const meta = s.paneMeta[sessionId];
      if (!meta?.restoredScrollback) return {};
      return { paneMeta: { ...s.paneMeta, [sessionId]: { ...meta, restoredScrollback: undefined } } };
    });
  },

  setActiveView(view) {
    set({ activeView: view });
  },

  setContextHostId(hostId) {
    set({ contextHostId: hostId });
  },
}));

// Keeps the main process's "last session" snapshot in sync with whatever
// tabs are actually open (including each pane's current scrollback — see
// WorkspaceNode's own doc comment), so restoreLastSession() always has an
// up-to-date layout *and* recent terminal content to bring back on the next
// launch, the same way a browser's "restore previous session" does.
function persistLastSession(): void {
  const { tabs, paneMeta } = useAppStore.getState();
  const workspaceTabs: WorkspaceTab[] = tabs.map((t) => ({ layout: paneNodeToWorkspaceNode(t.layout, paneMeta, true) }));
  void wharf.session.saveLast(workspaceTabs);
}

// Debounced since a workspace open or a run of quick tab actions can touch
// `tabs` several times in a row, and only the final state after they settle
// is worth persisting.
let persistSessionTimer: ReturnType<typeof setTimeout> | null = null;
useAppStore.subscribe((state, prevState) => {
  if (state.tabs === prevState.tabs) return;
  if (persistSessionTimer) clearTimeout(persistSessionTimer);
  persistSessionTimer = setTimeout(persistLastSession, 800);
});

// A long-running pane's scrollback otherwise only refreshes when the tab
// *structure* changes (open/close/split) — the debounced subscription above
// has no reason to fire just because a command finished — so this keeps the
// snapshot's terminal content from going stale for hours at a stretch.
setInterval(persistLastSession, 30_000);

// Registered once at module load: if a session dies on the backend (network
// drop, remote closed the connection, auth failure mid-session) reflect
// that in its pane immediately rather than leaving a dead terminal open.
wharf.ssh.onClosed(({ sessionId, error }) => {
  useAppStore.setState((s) => {
    const meta = s.paneMeta[sessionId];
    if (!meta) return {};
    return { paneMeta: { ...s.paneMeta, [sessionId]: { ...meta, closed: true, closeError: error, reconnecting: undefined } } };
  });
});

// A drop that's mid-reconnect isn't "closed" — the pane stays open and
// usable (and doesn't show a scary closed indicator) while sshManager
// retries with backoff; onClosed above only fires once it truly gives up.
wharf.ssh.onReconnecting(({ sessionId, attempt, maxAttempts }) => {
  useAppStore.setState((s) => {
    const meta = s.paneMeta[sessionId];
    if (!meta) return {};
    return { paneMeta: { ...s.paneMeta, [sessionId]: { ...meta, reconnecting: { attempt, maxAttempts } } } };
  });
});

wharf.ssh.onReconnected(({ sessionId }) => {
  useAppStore.setState((s) => {
    const meta = s.paneMeta[sessionId];
    if (!meta) return {};
    return { paneMeta: { ...s.paneMeta, [sessionId]: { ...meta, reconnecting: undefined } } };
  });
});
