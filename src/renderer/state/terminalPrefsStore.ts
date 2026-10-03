import { create } from "zustand";
import { DEFAULT_TERMINAL_THEME_ID, TERMINAL_THEME_PRESETS } from "./terminalThemes";

const FONT_SIZE_KEY = "wharf-terminal-font-size";
const FONT_FAMILY_KEY = "wharf-terminal-font-family";
const TERMINAL_THEME_KEY = "wharf-terminal-theme";

export const DEFAULT_FONT_SIZE = 13;
export const MIN_FONT_SIZE = 9;
export const MAX_FONT_SIZE = 28;

/**
 * Everything from "JetBrains Mono" down is bundled as actual font files
 * (see styles/fonts.css + assets/fonts/) rather than just a CSS name — the
 * earlier list relied entirely on whatever happened to already be
 * installed on the user's system, so on a fresh Linux install most of
 * these silently fell back to a plain generic monospace regardless of
 * which one was picked, and the picker didn't actually change much of
 * anything. "System default" and the three below it still name real
 * system fonts on purpose, for anyone who prefers matching their OS.
 */
export const FONT_FAMILY_PRESETS = [
  { name: "System default", value: "'SF Mono', Menlo, Consolas, monospace" },
  { name: "Menlo", value: "Menlo, monospace" },
  { name: "Consolas", value: "Consolas, monospace" },
  { name: "Ubuntu Mono", value: "'Ubuntu Mono', monospace" },
  { name: "JetBrains Mono", value: "'JetBrains Mono', monospace" },
  { name: "Fira Code", value: "'Fira Code', monospace" },
  { name: "Cascadia Code", value: "'Cascadia Code', monospace" },
  { name: "IBM Plex Mono", value: "'IBM Plex Mono', monospace" },
  { name: "Source Code Pro", value: "'Source Code Pro', monospace" },
  { name: "Roboto Mono", value: "'Roboto Mono', monospace" },
  { name: "Inconsolata", value: "'Inconsolata', monospace" },
  { name: "Space Mono", value: "'Space Mono', monospace" },
] as const;

const DEFAULT_FONT_FAMILY = FONT_FAMILY_PRESETS[0].value;

function readStoredFontSize(): number {
  try {
    const v = Number(localStorage.getItem(FONT_SIZE_KEY));
    if (v >= MIN_FONT_SIZE && v <= MAX_FONT_SIZE) return v;
  } catch {
    /* localStorage unavailable */
  }
  return DEFAULT_FONT_SIZE;
}

function readStoredFontFamily(): string {
  try {
    return localStorage.getItem(FONT_FAMILY_KEY) || DEFAULT_FONT_FAMILY;
  } catch {
    return DEFAULT_FONT_FAMILY;
  }
}

function readStoredTerminalTheme(): string {
  try {
    const v = localStorage.getItem(TERMINAL_THEME_KEY);
    if (v && TERMINAL_THEME_PRESETS.some((p) => p.id === v)) return v;
  } catch {
    /* localStorage unavailable */
  }
  return DEFAULT_TERMINAL_THEME_ID;
}

interface TerminalPrefsState {
  fontSize: number;
  fontFamily: string;
  terminalThemeId: string;
  setFontSize(size: number): void;
  increaseFontSize(): void;
  decreaseFontSize(): void;
  resetFontSize(): void;
  setFontFamily(family: string): void;
  setTerminalThemeId(id: string): void;
}

export const useTerminalPrefsStore = create<TerminalPrefsState>((set, get) => ({
  fontSize: readStoredFontSize(),
  fontFamily: readStoredFontFamily(),
  terminalThemeId: readStoredTerminalTheme(),

  setFontSize(size) {
    const clamped = Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, Math.round(size)));
    try {
      localStorage.setItem(FONT_SIZE_KEY, String(clamped));
    } catch {
      /* best-effort persistence only */
    }
    set({ fontSize: clamped });
  },

  increaseFontSize() {
    get().setFontSize(get().fontSize + 1);
  },

  decreaseFontSize() {
    get().setFontSize(get().fontSize - 1);
  },

  resetFontSize() {
    get().setFontSize(DEFAULT_FONT_SIZE);
  },

  setFontFamily(family) {
    try {
      localStorage.setItem(FONT_FAMILY_KEY, family);
    } catch {
      /* best-effort persistence only */
    }
    set({ fontFamily: family });
  },

  setTerminalThemeId(id) {
    try {
      localStorage.setItem(TERMINAL_THEME_KEY, id);
    } catch {
      /* best-effort persistence only */
    }
    set({ terminalThemeId: id });
  },
}));
