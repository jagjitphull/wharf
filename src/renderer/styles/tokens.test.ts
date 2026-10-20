import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ACCENT_PRESETS } from "../state/accentColors";

const css = readFileSync(join(__dirname, "global.css"), "utf8");

function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`no ${selector} block in global.css`);
  const end = css.indexOf("\n}", start);
  const vars: Record<string, string> = {};
  for (const m of css.slice(start, end).matchAll(/(--[\w-]+):\s*([^;]+);/g)) vars[m[1]] = m[2].trim();
  return vars;
}

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * channel(n >> 16) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const THEMES = [
  { name: "Harbor Night", vars: block('[data-theme="dark"]'), accent: "dark" as const },
  { name: "Sea Glass", vars: block('[data-theme="light"]'), accent: "light" as const },
];

describe.each(THEMES)("$name tokens", ({ vars, accent }) => {
  const surfaces = ["--bg", "--bg-titlebar", "--bg-sidebar", "--bg-panel", "--bg-input", "--bg-hover", "--bg-active"];

  it("defines every surface as a plain hex colour", () => {
    for (const s of surfaces) expect(vars[s], s).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("body text is readable on every surface (AA)", () => {
    for (const s of surfaces) expect(contrast(vars["--text"], vars[s]), `--text on ${s}`).toBeGreaterThanOrEqual(4.5);
  });

  it("secondary text is readable on the main surfaces (AA)", () => {
    for (const s of ["--bg", "--bg-sidebar", "--bg-panel", "--bg-hover"])
      expect(contrast(vars["--text-dim"], vars[s]), `--text-dim on ${s}`).toBeGreaterThanOrEqual(4.5);
  });

  it("status colours are readable on panels", () => {
    for (const k of ["--success", "--warning", "--info", "--danger-text"])
      expect(contrast(vars[k], vars["--bg-panel"]), k).toBeGreaterThanOrEqual(4.5);
  });

  it("every accent preset reads on panels and carries its button text", () => {
    for (const p of ACCENT_PRESETS) {
      const colour = p[accent];
      expect(contrast(colour, vars["--bg-panel"]), `${p.name} on panel`).toBeGreaterThanOrEqual(3);
      expect(contrast(vars["--accent-fg"], colour), `accent-fg on ${p.name}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("terminal foreground is readable on the terminal background", () => {
    expect(contrast(vars["--term-fg"], vars["--term-bg"])).toBeGreaterThanOrEqual(7);
  });

  it("ANSI colours stay legible on the terminal background", () => {
    for (const k of ["red", "green", "yellow", "blue", "magenta", "cyan"])
      expect(contrast(vars[`--term-${k}`], vars["--term-bg"]), k).toBeGreaterThanOrEqual(4.5);
  });
});
