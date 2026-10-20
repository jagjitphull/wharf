import { wharf } from "../api/wharf";
import { create } from "zustand";

const SIDEBAR_COLLAPSED_KEY = "wharf-sidebar-collapsed";
const SIDEBAR_WIDTH_KEY = "wharf-sidebar-width";
const UI_ZOOM_KEY = "wharf-ui-zoom";
const COLLAPSED_GROUPS_KEY = "wharf-collapsed-groups";

export const DEFAULT_UI_ZOOM = 1;
export const MIN_UI_ZOOM = 0.85;
export const MAX_UI_ZOOM = 1.5;
const UI_ZOOM_STEP = 0.05;

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

function readStoredCollapsedGroups(): Set<string> {
  try {
    const raw = localStorage.getItem(COLLAPSED_GROUPS_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed.filter((id) => typeof id === "string")) : new Set();
  } catch {
    return new Set();
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

// Interface size is the page's real zoom (see preload.ts, which also applies
// the stored value before first paint). A zoomed page makes the terminal's
// own text bigger too, so Terminal.tsx divides its font size by this zoom to
// keep a session looking exactly as the separate Terminal font size says.
function applyToDocument(zoom: number): void {
  wharf.window.setZoomFactor(zoom);
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
  /** IDs of collapsed nodes in the sidebar's host tree — real group IDs,
   * plus the "__root__" sentinel for the top-level "Hosts" node itself. */
  collapsedGroupIds: Set<string>;
  toggleGroupCollapsed(id: string): void;
}

const initialUiZoom = readStoredUiZoom();

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

  collapsedGroupIds: readStoredCollapsedGroups(),

  toggleGroupCollapsed(id) {
    const next = new Set(get().collapsedGroupIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    try {
      localStorage.setItem(COLLAPSED_GROUPS_KEY, JSON.stringify([...next]));
    } catch {
      /* best-effort persistence only */
    }
    set({ collapsedGroupIds: next });
  },
}));
