import { ACCENT_PRESETS, useThemeStore, type ThemeMode } from "../../state/themeStore";
import "./Settings.css";

const MODES: { mode: ThemeMode; label: string }[] = [
  { mode: "light", label: "Light" },
  { mode: "dark", label: "Dark" },
  { mode: "system", label: "System" },
];

export function Settings() {
  const { mode, accent, setMode, setAccent } = useThemeStore();

  return (
    <div className="settings-panel">
      <h2>Appearance</h2>

      <div className="appearance-row">
        <span className="appearance-label">Theme</span>
        <div className="mode-switch">
          {MODES.map((m) => (
            <button
              key={m.mode}
              className={`mode-btn ${mode === m.mode ? "active" : ""}`}
              onClick={() => setMode(m.mode)}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <div className="appearance-row">
        <span className="appearance-label">Accent color</span>
        <div className="accent-swatches">
          {ACCENT_PRESETS.map((preset) => (
            <button
              key={preset.value}
              className={`accent-swatch ${accent === preset.value ? "active" : ""}`}
              style={{ background: preset.value }}
              title={preset.name}
              onClick={() => setAccent(preset.value)}
            />
          ))}
        </div>
      </div>

      <h2>About</h2>
      <p className="hint">
        Wharf — a personal SSH/SFTP client. Save hosts and groups, connect via password, private key, or SSH agent,
        chain through jump hosts, and set up local/remote port forwarding.
      </p>
    </div>
  );
}
