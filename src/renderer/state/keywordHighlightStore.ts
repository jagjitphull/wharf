import { create } from "zustand";

export interface KeywordRule {
  id: string;
  label: string;
  /** Regex source, always matched case-insensitively. */
  pattern: string;
  /** Must be `#RRGGBB` — xterm.js decorations don't support any other format. */
  color: string;
  enabled: boolean;
  /** Built-in rules can be toggled/recolored but not renamed, re-patterned, or deleted. */
  builtIn: boolean;
}

export const BUILTIN_KEYWORD_RULES: KeywordRule[] = [
  { id: "error", label: "Error", pattern: "\\berror\\b", color: "#f2545b", enabled: true, builtIn: true },
  { id: "warning", label: "Warning", pattern: "\\bwarn(?:ing)?\\b", color: "#e8d44d", enabled: true, builtIn: true },
  {
    id: "ok",
    label: "OK",
    pattern: "\\b(?:ok|success(?:ful)?|passed)\\b",
    color: "#4fd88a",
    enabled: true,
    builtIn: true,
  },
  { id: "info", label: "Info", pattern: "\\binfo\\b", color: "#54d6e8", enabled: true, builtIn: true },
  { id: "debug", label: "Debug", pattern: "\\bdebug\\b", color: "#b18cf0", enabled: true, builtIn: true },
  {
    id: "ip-mac",
    label: "IP address & MAC",
    pattern: "\\b(?:(?:\\d{1,3}\\.){3}\\d{1,3}|(?:[0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2})\\b",
    color: "#f16fe0",
    enabled: true,
    builtIn: true,
  },
];

const STORAGE_KEY = "wharf-keyword-highlight";

interface PersistedShape {
  enabled: boolean;
  rules: KeywordRule[];
}

function readStored(): PersistedShape {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PersistedShape>;
      if (Array.isArray(parsed.rules)) {
        // Merge forward: keep the user's enabled/color choices for built-ins
        // that still exist, but always include every current built-in (so a
        // Wharf update that adds one doesn't silently omit it), followed by
        // whatever custom rules they'd added.
        const byId = new Map(parsed.rules.map((r) => [r.id, r]));
        const rules: KeywordRule[] = [
          ...BUILTIN_KEYWORD_RULES.map((def) => {
            const saved = byId.get(def.id);
            return saved ? { ...def, enabled: saved.enabled, color: saved.color || def.color } : def;
          }),
          ...parsed.rules.filter((r) => !r.builtIn && r.id && r.pattern),
        ];
        return { enabled: parsed.enabled ?? true, rules };
      }
    }
  } catch {
    /* localStorage unavailable or corrupt — fall through to defaults */
  }
  return { enabled: true, rules: BUILTIN_KEYWORD_RULES };
}

function persist(state: PersistedShape): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* best-effort persistence only */
  }
}

interface KeywordHighlightState extends PersistedShape {
  setEnabled(enabled: boolean): void;
  toggleRule(id: string): void;
  setRuleColor(id: string, color: string): void;
  addCustomRule(label: string, pattern: string, color: string): void;
  updateCustomRule(id: string, patch: Partial<Pick<KeywordRule, "label" | "pattern" | "color">>): void;
  removeRule(id: string): void;
}

const initial = readStored();

export const useKeywordHighlightStore = create<KeywordHighlightState>((set, get) => ({
  enabled: initial.enabled,
  rules: initial.rules,

  setEnabled(enabled) {
    persist({ enabled, rules: get().rules });
    set({ enabled });
  },

  toggleRule(id) {
    const rules = get().rules.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r));
    persist({ enabled: get().enabled, rules });
    set({ rules });
  },

  setRuleColor(id, color) {
    const rules = get().rules.map((r) => (r.id === id ? { ...r, color } : r));
    persist({ enabled: get().enabled, rules });
    set({ rules });
  },

  addCustomRule(label, pattern, color) {
    const rule: KeywordRule = {
      id: `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      label,
      pattern,
      color,
      enabled: true,
      builtIn: false,
    };
    const rules = [...get().rules, rule];
    persist({ enabled: get().enabled, rules });
    set({ rules });
  },

  updateCustomRule(id, patch) {
    const rules = get().rules.map((r) => (r.id === id && !r.builtIn ? { ...r, ...patch } : r));
    persist({ enabled: get().enabled, rules });
    set({ rules });
  },

  removeRule(id) {
    const rules = get().rules.filter((r) => r.id !== id || r.builtIn);
    persist({ enabled: get().enabled, rules });
    set({ rules });
  },
}));
