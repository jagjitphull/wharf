import { create } from "zustand";

const SIDEBAR_COLLAPSED_KEY = "wharf-sidebar-collapsed";
const SIDEBAR_WIDTH_KEY = "wharf-sidebar-width";
const UI_ZOOM_KEY = "wharf-ui-zoom";

export const DEFAULT_UI_ZOOM = 1;
export const MIN_UI_ZOOM = 0.85;
export const MAX_UI_ZOOM = 1.4;
const UI_ZOOM_STEP = 0.1;

export const DEFAULT_SIDEBAR_WIDTH = 280;
export const MIN_SIDEBAR_WIDTH = 200;
export const MAX_SIDEBAR_WIDTH = 480;
/** Dragging the resize handle to at or below this width snaps to fully
 * collapsed instead — the same "drag past a threshold to hide" gesture
 * most split-pane sidebars use, on top of the explicit collapse toggle. */
export const SIDEBAR_COLLAPSE_THRESHOLD = 160;

function readStoredCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

function readStoredSidebarWidth(): number {
  try {
    const v = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY));
    if (v >= MIN_SIDEBAR_WIDTH && v <= MAX_SIDEBAR_WIDTH) return v;
  } catch {
    /* localStorage unavailable */
  }
  return DEFAULT_SIDEBAR_WIDTH;
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
// scales with it; .tab-pane-container carries the inverse zoom in
// TerminalPanel.css specifically to cancel this back out, so a session's
// actual terminal size/rendering is never affected — only the app's own
// chrome text/controls.
function applyToDocument(zoom: number): void {
  document.documentElement.style.setProperty("--ui-zoom", String(zoom));
  // .tab-pane-container only pays for the counter-zoom's extra width/height
  // calc() (and the zoom property itself, which forces its own compositing
  // layer) while a non-default interface size is actually in effect — see
  // the .ui-zoom-active rule in TerminalPanel.css. At the default 1x most
  // users never touch, this keeps that element on the plainer, better-worn
  // `inset: 0` box it always used pre-Interface Size.
  document.documentElement.classList.toggle("ui-zoom-active", zoom !== DEFAULT_UI_ZOOM);
}

interface UiPrefsState {
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  uiZoom: number;
  toggleSidebar(): void;
  setSidebarCollapsed(collapsed: boolean): void;
  /** Sets the sidebar's dragged width. Values at or below
   * SIDEBAR_COLLAPSE_THRESHOLD collapse the sidebar instead (see
   * SIDEBAR_COLLAPSE_THRESHOLD) rather than clamping up to MIN_SIDEBAR_WIDTH
   * — so dragging the handle nearly shut acts like letting go of it, not
   * like hitting a wall partway there. */
  setSidebarWidth(width: number): void;
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
  sidebarWidth: readStoredSidebarWidth(),
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

  setSidebarWidth(width) {
    if (width <= SIDEBAR_COLLAPSE_THRESHOLD) {
      get().setSidebarCollapsed(true);
      return;
    }
    const clamped = Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, Math.round(width)));
    try {
      localStorage.setItem(SIDEBAR_WIDTH_KEY, String(clamped));
    } catch {
      /* best-effort persistence only */
    }
    set({ sidebarWidth: clamped });
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
