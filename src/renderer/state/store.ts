import { create } from "zustand";
import type { GroupRecord, HostRecord, SnippetRecord, TunnelRecord } from "@shared/types";
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
  | { type: "split"; direction: "row" | "column"; children: PaneNode[] };

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
}

export type ActiveView = "hosts" | "sftp" | "tunnels" | "history" | "settings";

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
    return { type: "split", direction, children: [node, { type: "leaf", sessionId: newSessionId }] };
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
  const children = node.children.map((c) => removeNode(c, targetSessionId)).filter((c): c is PaneNode => c !== null);
  if (children.length === 0) return null;
  if (children.length === 1) return children[0];
  return { ...node, children };
}

interface AppState {
  hosts: HostRecord[];
  groups: GroupRecord[];
  tunnels: TunnelRecord[];
  snippets: SnippetRecord[];

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
  setActivePane(tabId: string, sessionId: string): void;
  setPaneThemeId(sessionId: string, themeId: string | undefined): void;
  setPaneLogPath(sessionId: string, logPath: string | undefined): void;

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

export const useAppStore = create<AppState>((set, get) => ({
  hosts: [],
  groups: [],
  tunnels: [],
  snippets: [],

  tabs: [],
  activeTabId: null,
  paneMeta: {},

  activeView: "hosts",
  contextHostId: null,

  async loadAll() {
    await Promise.all([get().refreshHosts(), get().refreshGroups(), get().refreshTunnels(), get().refreshSnippets()]);
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

  setActivePane(tabId, sessionId) {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.tabId === tabId ? { ...t, activePaneId: sessionId } : t)),
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
