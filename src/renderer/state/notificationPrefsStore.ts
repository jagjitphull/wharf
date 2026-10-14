import { create } from "zustand";

const ENABLED_KEY = "wharf-notify-long-command";

/** A command has to run at least this long before finishing it is worth a
 * notification — short, everyday commands would otherwise fire one on
 * every pane you're not currently looking at. */
export const LONG_COMMAND_THRESHOLD_MS = 10_000;

function readStoredEnabled(): boolean {
  try {
    const v = localStorage.getItem(ENABLED_KEY);
    return v === null ? true : v === "1";
  } catch {
    return true;
  }
}

interface NotificationPrefsState {
  notifyOnLongCommand: boolean;
  setNotifyOnLongCommand(enabled: boolean): void;
}

export const useNotificationPrefsStore = create<NotificationPrefsState>((set) => ({
  notifyOnLongCommand: readStoredEnabled(),

  setNotifyOnLongCommand(enabled) {
    try {
      localStorage.setItem(ENABLED_KEY, enabled ? "1" : "0");
    } catch {
      /* best-effort persistence only */
    }
    set({ notifyOnLongCommand: enabled });
  },
}));
