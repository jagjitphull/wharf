import { create } from "zustand";
import type { GroupRecord, HostInput, HostRecord, SnippetRecord, TunnelRecord, WorkspaceNode, WorkspaceRecord, WorkspaceTab } from "@shared/types";
import { wharf } from "../api/wharf";

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
}

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
    metasOut[sessionId] = meta;
    return { type: "leaf", sessionId };
  }
  const children: PaneNode[] = [];
  for (const child of node.children) {
    children.push(await connectWorkspaceNode(child, hosts, localShellOrdinal, metasOut));
  }
  return { type: "split", id: crypto.randomUUID(), direction: node.direction, children };
}

function paneNodeToWorkspaceNode(node: PaneNode, paneMeta: Record<string, PaneMeta>): WorkspaceNode {
  if (node.type === "leaf") return { type: "leaf", hostId: paneMeta[node.sessionId]?.hostId ?? null };
  return { type: "split", direction: node.direction, children: node.children.map((c) => paneNodeToWorkspaceNode(c, paneMeta)) };
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
    const hosts = get().hosts;
    const localShellOrdinal = { count: 0 };
    for (const workspaceTab of workspace.tabs) {
      const metas: Record<string, PaneMeta> = {};
      const layout = await connectWorkspaceNode(workspaceTab.layout, hosts, localShellOrdinal, metas);
      const activePaneId = flattenPanes(layout)[0];
      const tab: TerminalTab = { tabId: crypto.randomUUID(), layout, activePaneId };
      set((s) => ({
        tabs: [...s.tabs, tab],
        activeTabId: tab.tabId,
        paneMeta: { ...s.paneMeta, ...metas },
      }));
    }
    set({ activeView: "hosts" });
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
      return { tabs, activeTabId, paneMeta };
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

  setActiveView(view) {
    set({ activeView: view });
  },

  setContextHostId(hostId) {
    set({ contextHostId: hostId });
  },
}));

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
