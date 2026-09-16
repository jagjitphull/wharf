import { create } from "zustand";

const SIDEBAR_COLLAPSED_KEY = "wharf-sidebar-collapsed";

function readStoredCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

interface UiPrefsState {
  sidebarCollapsed: boolean;
  toggleSidebar(): void;
  setSidebarCollapsed(collapsed: boolean): void;
}

export const useUiPrefsStore = create<UiPrefsState>((set, get) => ({
  sidebarCollapsed: readStoredCollapsed(),

  toggleSidebar() {
    get().setSidebarCollapsed(!get().sidebarCollapsed);
  },

  setSidebarCollapsed(collapsed) {
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? "1" : "0");
    } catch {
      /* best-effort persistence only */
    }
    set({ sidebarCollapsed: collapsed });
  },
}));
