import { create } from "zustand";

export type ThemeMode = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const MODE_KEY = "wharf-theme-mode";
const ACCENT_KEY = "wharf-accent-color";

export const ACCENT_PRESETS = [
  { name: "Blue", value: "#5b8def" },
  { name: "Teal", value: "#2bb3a3" },
  { name: "Purple", value: "#8b6cef" },
  { name: "Green", value: "#35c76e" },
  { name: "Orange", value: "#e08a3c" },
  { name: "Pink", value: "#e0619f" },
] as const;

const DEFAULT_ACCENT = ACCENT_PRESETS[0].value;

function readStoredMode(): ThemeMode {
  try {
    const v = localStorage.getItem(MODE_KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {
    /* localStorage unavailable — fall through to default */
  }
  return "system";
}

function readStoredAccent(): string {
  try {
    return localStorage.getItem(ACCENT_KEY) || DEFAULT_ACCENT;
  } catch {
    return DEFAULT_ACCENT;
  }
}

function systemPrefersDark(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;
}

function resolve(mode: ThemeMode): ResolvedTheme {
  return mode === "system" ? (systemPrefersDark() ? "dark" : "light") : mode;
}

function applyToDocument(resolved: ResolvedTheme, accent: string): void {
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.setProperty("--accent-color", accent);
}

interface ThemeState {
  mode: ThemeMode;
  resolved: ResolvedTheme;
  accent: string;
  setMode(mode: ThemeMode): void;
  setAccent(accent: string): void;
}

const initialMode = readStoredMode();
const initialAccent = readStoredAccent();
const initialResolved = resolve(initialMode);
// Applied synchronously at module load (before React renders) so there's no
// flash of the wrong theme on startup.
applyToDocument(initialResolved, initialAccent);

export const useThemeStore = create<ThemeState>((set) => ({
  mode: initialMode,
  resolved: initialResolved,
  accent: initialAccent,

  setMode(mode) {
    const resolved = resolve(mode);
    try {
      localStorage.setItem(MODE_KEY, mode);
    } catch {
      /* best-effort persistence only */
    }
    applyToDocument(resolved, useThemeStore.getState().accent);
    set({ mode, resolved });
  },

  setAccent(accent) {
    try {
      localStorage.setItem(ACCENT_KEY, accent);
    } catch {
      /* best-effort persistence only */
    }
    applyToDocument(useThemeStore.getState().resolved, accent);
    set({ accent });
  },
}));

// Live-update when the OS theme changes while mode === "system".
if (typeof matchMedia === "function") {
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    const { mode, accent } = useThemeStore.getState();
    if (mode !== "system") return;
    const resolved = resolve(mode);
    applyToDocument(resolved, accent);
    useThemeStore.setState({ resolved });
  });
}
