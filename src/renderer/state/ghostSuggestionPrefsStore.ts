import { create } from "zustand";

const GHOST_SUGGESTION_ENABLED_KEY = "wharf-ghost-suggestion-enabled";

function readStoredEnabled(): boolean {
  try {
    const v = localStorage.getItem(GHOST_SUGGESTION_ENABLED_KEY);
    return v === null ? true : v === "1";
  } catch {
    return true;
  }
}

interface GhostSuggestionPrefsState {
  enabled: boolean;
  setEnabled(enabled: boolean): void;
}

export const useGhostSuggestionPrefsStore = create<GhostSuggestionPrefsState>((set) => ({
  enabled: readStoredEnabled(),

  setEnabled(enabled) {
    try {
      localStorage.setItem(GHOST_SUGGESTION_ENABLED_KEY, enabled ? "1" : "0");
    } catch {
      /* best-effort persistence only */
    }
    set({ enabled });
  },
}));
