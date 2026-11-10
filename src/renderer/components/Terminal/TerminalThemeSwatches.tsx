import { TERMINAL_THEME_PRESETS } from "../../state/terminalThemes";
import "./TerminalThemeSwatches.css";

interface Props {
  activeId: string;
  onSelect(id: string): void;
}

/** Compact swatch grid for picking a terminal color theme from inside a
 * context menu (the tab bar's per-tab menu, and the terminal's own
 * right-click menu) — ContextMenu has no submenu support, so this renders
 * inline as a single custom item instead of a "Color Theme >" flyout. */
export function TerminalThemeSwatches({ activeId, onSelect }: Props) {
  return (
    <div className="term-theme-swatches">
      <div className="term-theme-swatches-label">Color theme</div>
      <div className="term-theme-swatches-grid">
        {TERMINAL_THEME_PRESETS.map((preset) => (
          <button
            key={preset.id}
            className={`term-theme-swatch-dot ${activeId === preset.id ? "active" : ""}`}
            style={{ background: preset.theme?.background ?? "var(--term-bg)" }}
            title={preset.name}
            onClick={() => onSelect(preset.id)}
          />
        ))}
      </div>
    </div>
  );
}
