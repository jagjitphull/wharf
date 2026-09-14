import { create } from "zustand";

const FONT_SIZE_KEY = "wharf-terminal-font-size";
const FONT_FAMILY_KEY = "wharf-terminal-font-family";

export const DEFAULT_FONT_SIZE = 13;
export const MIN_FONT_SIZE = 9;
export const MAX_FONT_SIZE = 28;

export const FONT_FAMILY_PRESETS = [
  { name: "System default", value: "'SF Mono', Menlo, Consolas, monospace" },
  { name: "Menlo", value: "Menlo, monospace" },
  { name: "Consolas", value: "Consolas, monospace" },
  { name: "Courier New", value: "'Courier New', monospace" },
  { name: "Fira Code", value: "'Fira Code', monospace" },
  { name: "JetBrains Mono", value: "'JetBrains Mono', monospace" },
  { name: "Cascadia Code", value: "'Cascadia Code', monospace" },
  { name: "Ubuntu Mono", value: "'Ubuntu Mono', monospace" },
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

interface TerminalPrefsState {
  fontSize: number;
  fontFamily: string;
  setFontSize(size: number): void;
  increaseFontSize(): void;
  decreaseFontSize(): void;
  resetFontSize(): void;
  setFontFamily(family: string): void;
}

export const useTerminalPrefsStore = create<TerminalPrefsState>((set, get) => ({
  fontSize: readStoredFontSize(),
  fontFamily: readStoredFontFamily(),

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
}));
