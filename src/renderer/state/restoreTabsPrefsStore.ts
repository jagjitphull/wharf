import { create } from "zustand";

const RESTORE_TABS_ENABLED_KEY = "wharf-restore-tabs-enabled";

function readStoredEnabled(): boolean {
  try {
    const v = localStorage.getItem(RESTORE_TABS_ENABLED_KEY);
    return v === null ? true : v === "1";
  } catch {
    return true;
  }
}

interface RestoreTabsPrefsState {
  enabled: boolean;
  setEnabled(enabled: boolean): void;
}

export const useRestoreTabsPrefsStore = create<RestoreTabsPrefsState>((set) => ({
  enabled: readStoredEnabled(),

  setEnabled(enabled) {
    try {
      localStorage.setItem(RESTORE_TABS_ENABLED_KEY, enabled ? "1" : "0");
    } catch {
      /* best-effort persistence only */
    }
    set({ enabled });
  },
}));
