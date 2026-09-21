import { create } from "zustand";

const SIDEBAR_COLLAPSED_KEY = "wharf-sidebar-collapsed";
const UI_ZOOM_KEY = "wharf-ui-zoom";

export const DEFAULT_UI_ZOOM = 1;
export const MIN_UI_ZOOM = 0.85;
export const MAX_UI_ZOOM = 1.4;
const UI_ZOOM_STEP = 0.1;

function readStoredCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

function readStoredUiZoom(): number {
  try {
    const v = Number(localStorage.getItem(UI_ZOOM_KEY));
    if (v >= MIN_UI_ZOOM && v <= MAX_UI_ZOOM) return v;
  } catch {
    /* localStorage unavailable */
  }
  return DEFAULT_UI_ZOOM;
}

// Everything but the terminal's own pane content (title bar, sidebar, tab
// bar, dialogs, Settings/SFTP/Tunnels/History) lives under .app-root and
// scales with it; .terminal-stack carries the inverse zoom in global.css
// specifically to cancel this back out, so a session's actual terminal
// size/rendering is never affected — only the app's own chrome text/controls.
function applyToDocument(zoom: number): void {
  document.documentElement.style.setProperty("--ui-zoom", String(zoom));
}

interface UiPrefsState {
  sidebarCollapsed: boolean;
  uiZoom: number;
  toggleSidebar(): void;
  setSidebarCollapsed(collapsed: boolean): void;
  setUiZoom(zoom: number): void;
  increaseUiZoom(): void;
  decreaseUiZoom(): void;
  resetUiZoom(): void;
}

const initialUiZoom = readStoredUiZoom();
// Applied synchronously at module load (before React renders), same as
// themeStore's theme/accent — avoids a flash of default-size chrome.
applyToDocument(initialUiZoom);

export const useUiPrefsStore = create<UiPrefsState>((set, get) => ({
  sidebarCollapsed: readStoredCollapsed(),
  uiZoom: initialUiZoom,

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

  setUiZoom(zoom) {
    const clamped = Math.min(MAX_UI_ZOOM, Math.max(MIN_UI_ZOOM, Math.round(zoom * 100) / 100));
    try {
      localStorage.setItem(UI_ZOOM_KEY, String(clamped));
    } catch {
      /* best-effort persistence only */
    }
    applyToDocument(clamped);
    set({ uiZoom: clamped });
  },

  increaseUiZoom() {
    get().setUiZoom(get().uiZoom + UI_ZOOM_STEP);
  },

  decreaseUiZoom() {
    get().setUiZoom(get().uiZoom - UI_ZOOM_STEP);
  },

  resetUiZoom() {
    get().setUiZoom(DEFAULT_UI_ZOOM);
  },
}));
