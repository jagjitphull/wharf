import { create } from "zustand";
import type { GroupRecord, HostRecord, SnippetRecord, TunnelRecord } from "@shared/types";
import { wharf } from "../api/wharf";

export interface TerminalTab {
  sessionId: string;
  hostId: string;
  title: string;
  connectedAt: number;
  closed?: boolean;
  closeError?: string;
  /** Per-tab terminal color theme override (a TERMINAL_THEME_PRESETS id).
   * Undefined means "use the global terminal theme from Settings". Not
   * persisted — tabs are ephemeral (a fresh sessionId per connection), so
   * this resets on reconnect same as everything else about the tab. */
  themeId?: string;
  /** Path this tab's raw output is currently being logged to, if any. */
  logPath?: string;
  /** Set while an automatic reconnect (after an unexpected drop) is in
   * progress; cleared on success or on giving up (the latter also sets
   * `closed`). */
  reconnecting?: { attempt: number; maxAttempts: number };
}

export type ActiveView = "hosts" | "sftp" | "tunnels" | "settings";

interface AppState {
  hosts: HostRecord[];
  groups: GroupRecord[];
  tunnels: TunnelRecord[];
  snippets: SnippetRecord[];

  tabs: TerminalTab[];
  activeTabId: string | null;

  activeView: ActiveView;
  /** Host currently in focus for the SFTP/Tunnels panels (independent from which terminal tab is active). */
  contextHostId: string | null;

  loadAll(): Promise<void>;
  refreshHosts(): Promise<void>;
  refreshGroups(): Promise<void>;
  refreshTunnels(): Promise<void>;
  refreshSnippets(): Promise<void>;

  openTerminal(host: HostRecord, themeId?: string): Promise<void>;
  closeTerminal(sessionId: string): Promise<void>;
  duplicateTab(sessionId: string): Promise<void>;
  reorderTab(sessionId: string, beforeSessionId: string): void;
  setActiveTab(sessionId: string | null): void;
  setTabThemeId(sessionId: string, themeId: string | undefined): void;
  setTabLogPath(sessionId: string, logPath: string | undefined): void;

  setActiveView(view: ActiveView): void;
  setContextHostId(hostId: string | null): void;
}

export const useAppStore = create<AppState>((set, get) => ({
  hosts: [],
  groups: [],
  tunnels: [],
  snippets: [],

  tabs: [],
  activeTabId: null,

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
    const { sessionId } = await wharf.ssh.connect(host.id, 80, 24);
    const tab: TerminalTab = { sessionId, hostId: host.id, title: host.name, connectedAt: Date.now(), themeId };
    set((s) => ({ tabs: [...s.tabs, tab], activeTabId: sessionId, activeView: "hosts" }));
  },

  async closeTerminal(sessionId) {
    await wharf.ssh.disconnect(sessionId).catch(() => {});
    set((s) => {
      const tabs = s.tabs.filter((t) => t.sessionId !== sessionId);
      const activeTabId = s.activeTabId === sessionId ? (tabs.at(-1)?.sessionId ?? null) : s.activeTabId;
      return { tabs, activeTabId };
    });
  },

  async duplicateTab(sessionId) {
    const tab = get().tabs.find((t) => t.sessionId === sessionId);
    if (!tab) return;
    const host = get().hosts.find((h) => h.id === tab.hostId);
    if (!host) return;
    await get().openTerminal(host, tab.themeId);
  },

  reorderTab(sessionId, beforeSessionId) {
    if (sessionId === beforeSessionId) return;
    set((s) => {
      const tabs = [...s.tabs];
      const fromIdx = tabs.findIndex((t) => t.sessionId === sessionId);
      const toIdx = tabs.findIndex((t) => t.sessionId === beforeSessionId);
      if (fromIdx === -1 || toIdx === -1) return {};
      const [moved] = tabs.splice(fromIdx, 1);
      tabs.splice(toIdx, 0, moved);
      return { tabs };
    });
  },

  setActiveTab(sessionId) {
    set({ activeTabId: sessionId });
  },

  setTabThemeId(sessionId, themeId) {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.sessionId === sessionId ? { ...t, themeId } : t)),
    }));
  },

  setTabLogPath(sessionId, logPath) {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.sessionId === sessionId ? { ...t, logPath } : t)),
    }));
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
// that in the tab immediately rather than leaving a dead terminal open.
wharf.ssh.onClosed(({ sessionId, error }) => {
  useAppStore.setState((s) => ({
    tabs: s.tabs.map((t) =>
      t.sessionId === sessionId ? { ...t, closed: true, closeError: error, reconnecting: undefined } : t,
    ),
  }));
});

// A drop that's mid-reconnect isn't "closed" — the tab stays open and
// usable (and doesn't show a scary closed indicator) while sshManager
// retries with backoff; onClosed above only fires once it truly gives up.
wharf.ssh.onReconnecting(({ sessionId, attempt, maxAttempts }) => {
  useAppStore.setState((s) => ({
    tabs: s.tabs.map((t) => (t.sessionId === sessionId ? { ...t, reconnecting: { attempt, maxAttempts } } : t)),
  }));
});

wharf.ssh.onReconnected(({ sessionId }) => {
  useAppStore.setState((s) => ({
    tabs: s.tabs.map((t) => (t.sessionId === sessionId ? { ...t, reconnecting: undefined } : t)),
  }));
});
