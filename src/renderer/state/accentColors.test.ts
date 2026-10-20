import { describe, expect, it } from "vitest";
import { ACCENT_PRESETS, DEFAULT_ACCENT, accentFor, normalizeAccent } from "./accentColors";

describe("accent colours", () => {
  it("defaults to teal", () => {
    expect(normalizeAccent(null)).toBe("#2dd4bf");
    expect(normalizeAccent("")).toBe(DEFAULT_ACCENT);
  });

  it("picks the variant for the resolved theme", () => {
    expect(accentFor("dark", "#2dd4bf")).toBe("#2dd4bf");
    expect(accentFor("light", "#2dd4bf")).toBe("#0b7f74");
    for (const p of ACCENT_PRESETS) {
      expect(accentFor("dark", p.value)).toBe(p.dark);
      expect(accentFor("light", p.value)).toBe(p.light);
    }
  });

  it("migrates every legacy preset to its successor", () => {
    expect(normalizeAccent("#5b8def")).toBe("#5b9dff");
    expect(normalizeAccent("#2BB3A3")).toBe("#2dd4bf");
    expect(accentFor("light", "#e0619f")).toBe("#c2457f");
  });

  it("leaves custom colours alone in both themes", () => {
    expect(accentFor("dark", "#123456")).toBe("#123456");
    expect(accentFor("light", "#123456")).toBe("#123456");
  });

  it("has unique ids", () => {
    expect(new Set(ACCENT_PRESETS.map((p) => p.value)).size).toBe(ACCENT_PRESETS.length);
  });
});
