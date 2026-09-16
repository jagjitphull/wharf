import { create } from "zustand";

// Default on: it's a no-op until an API key is actually configured (Terminal.tsx
// checks hasApiKey() before firing a request), so there's nothing to opt into
// until Settings has a key saved.
const AI_ENABLED_KEY = "wharf-ai-autocomplete-enabled";

function readStoredEnabled(): boolean {
  try {
    const v = localStorage.getItem(AI_ENABLED_KEY);
    return v === null ? true : v === "1";
  } catch {
    return true;
  }
}

interface AiPrefsState {
  enabled: boolean;
  toggleEnabled(): void;
  setEnabled(enabled: boolean): void;
}

export const useAiPrefsStore = create<AiPrefsState>((set, get) => ({
  enabled: readStoredEnabled(),

  toggleEnabled() {
    get().setEnabled(!get().enabled);
  },

  setEnabled(enabled) {
    try {
      localStorage.setItem(AI_ENABLED_KEY, enabled ? "1" : "0");
    } catch {
      /* best-effort persistence only */
    }
    set({ enabled });
  },
}));
