import { create } from "zustand";
import type { GroupRecord, HostRecord, LicenseState, TunnelRecord } from "@shared/types";
import { wharf } from "../api/wharf";

export interface TerminalTab {
  sessionId: string;
  hostId: string;
  title: string;
  closed?: boolean;
  closeError?: string;
}

export type ActiveView = "hosts" | "sftp" | "tunnels" | "settings";

interface AppState {
  hosts: HostRecord[];
  groups: GroupRecord[];
  tunnels: TunnelRecord[];
  license: LicenseState | null;

  tabs: TerminalTab[];
  activeTabId: string | null;

  activeView: ActiveView;
  /** Host currently in focus for the SFTP/Tunnels panels (independent from which terminal tab is active). */
  contextHostId: string | null;

  loadAll(): Promise<void>;
  refreshHosts(): Promise<void>;
  refreshGroups(): Promise<void>;
  refreshTunnels(): Promise<void>;
  refreshLicense(): Promise<void>;

  openTerminal(host: HostRecord): Promise<void>;
  closeTerminal(sessionId: string): Promise<void>;
  setActiveTab(sessionId: string | null): void;

  setActiveView(view: ActiveView): void;
  setContextHostId(hostId: string | null): void;
}

export const useAppStore = create<AppState>((set, get) => ({
  hosts: [],
  groups: [],
  tunnels: [],
  license: null,

  tabs: [],
  activeTabId: null,

  activeView: "hosts",
  contextHostId: null,

  async loadAll() {
    await Promise.all([get().refreshHosts(), get().refreshGroups(), get().refreshTunnels(), get().refreshLicense()]);
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

  async refreshLicense() {
    set({ license: await wharf.license.getState() });
  },

  async openTerminal(host) {
    const { sessionId } = await wharf.ssh.connect(host.id, 80, 24);
    const tab: TerminalTab = { sessionId, hostId: host.id, title: host.name };
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

  setActiveTab(sessionId) {
    set({ activeTabId: sessionId });
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
    tabs: s.tabs.map((t) => (t.sessionId === sessionId ? { ...t, closed: true, closeError: error } : t)),
  }));
});
