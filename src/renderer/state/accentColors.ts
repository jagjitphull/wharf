export type ResolvedTheme = "light" | "dark";

export interface AccentPreset {
  name: string;
  /** Stable id persisted in localStorage — equal to the dark-theme colour. */
  value: string;
  dark: string;
  light: string;
}

// Each accent has two tuned variants: a bright one for Harbor Night and a
// deeper one for Sea Glass, so text/controls in the accent keep their contrast
// on either surface.
export const ACCENT_PRESETS: readonly AccentPreset[] = [
  { name: "Teal", value: "#2dd4bf", dark: "#2dd4bf", light: "#0b7f74" },
  { name: "Blue", value: "#5b9dff", dark: "#5b9dff", light: "#2c68d8" },
  { name: "Purple", value: "#a78bfa", dark: "#a78bfa", light: "#6d4fd6" },
  { name: "Green", value: "#3ddc97", dark: "#3ddc97", light: "#0f7a50" },
  { name: "Amber", value: "#f5b544", dark: "#f5b544", light: "#9c6305" },
  { name: "Pink", value: "#f472b6", dark: "#f472b6", light: "#c2457f" },
];

export const DEFAULT_ACCENT = ACCENT_PRESETS[0].value;

// Hex values the pre-Harbor presets stored, mapped onto their successors.
const LEGACY_ACCENTS: Record<string, string> = {
  "#5b8def": "#5b9dff",
  "#2bb3a3": "#2dd4bf",
  "#8b6cef": "#a78bfa",
  "#35c76e": "#3ddc97",
  "#e08a3c": "#f5b544",
  "#e0619f": "#f472b6",
};

/** Map whatever is stored (current preset, legacy hex, custom hex) to the value to keep. */
export function normalizeAccent(stored: string | null | undefined): string {
  const v = (stored ?? "").trim().toLowerCase();
  if (!v) return DEFAULT_ACCENT;
  return LEGACY_ACCENTS[v] ?? v;
}

/** The concrete colour to paint for a stored accent under the given theme. */
export function accentFor(resolved: ResolvedTheme, stored: string): string {
  const v = normalizeAccent(stored);
  const preset = ACCENT_PRESETS.find((p) => p.value === v);
  if (!preset) return v; // custom colour: used as-is in both themes
  return resolved === "light" ? preset.light : preset.dark;
}
