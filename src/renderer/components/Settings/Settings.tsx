import { useState } from "react";
import { ACCENT_PRESETS, useThemeStore, type ThemeMode } from "../../state/themeStore";
import { FONT_FAMILY_PRESETS, MAX_FONT_SIZE, MIN_FONT_SIZE, useTerminalPrefsStore } from "../../state/terminalPrefsStore";
import { TERMINAL_THEME_PRESETS } from "../../state/terminalThemes";
import { useAppStore } from "../../state/store";
import { ipcErrorMessage, wharf } from "../../api/wharf";
import { KeywordHighlightSettings } from "./KeywordHighlightSettings";
import { CommandBlocksSettings } from "./CommandBlocksSettings";
import { AiAutocompleteSettings } from "./AiAutocompleteSettings";
import "../../styles/dialog.css";
import "./Settings.css";

const MODES: { mode: ThemeMode; label: string }[] = [
  { mode: "light", label: "Light" },
  { mode: "dark", label: "Dark" },
  { mode: "system", label: "System" },
];

export function Settings() {
  const { mode, accent, setMode, setAccent } = useThemeStore();
  const { fontSize, fontFamily, terminalThemeId, increaseFontSize, decreaseFontSize, setFontFamily, setTerminalThemeId } =
    useTerminalPrefsStore();
  const { loadAll } = useAppStore();
  const [backupMessage, setBackupMessage] = useState<string | null>(null);
  const [backupError, setBackupError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleExport() {
    setBackupError(null);
    setBackupMessage(null);
    setBusy(true);
    try {
      const path = await wharf.backup.export();
      if (path) setBackupMessage(`Exported to ${path}`);
    } catch (err) {
      setBackupError(ipcErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleImport() {
    setBackupError(null);
    setBackupMessage(null);
    setBusy(true);
    try {
      const result = await wharf.backup.import();
      if (result) {
        setBackupMessage(
          `Imported ${result.importedHosts} host${result.importedHosts === 1 ? "" : "s"} and ` +
            `${result.importedGroups} group${result.importedGroups === 1 ? "" : "s"}. ` +
            `Passwords/passphrases weren't included in the export — re-enter them via Edit on each host.`,
        );
        await loadAll();
      }
    } catch (err) {
      setBackupError(ipcErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

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

      <h2>Terminal</h2>

      <div className="appearance-row">
        <span className="appearance-label">Font size</span>
        <div className="font-size-stepper">
          <button className="btn ghost small" onClick={decreaseFontSize} disabled={fontSize <= MIN_FONT_SIZE}>
            −
          </button>
          <span className="font-size-value">{fontSize}px</span>
          <button className="btn ghost small" onClick={increaseFontSize} disabled={fontSize >= MAX_FONT_SIZE}>
            +
          </button>
        </div>
      </div>

      <div className="appearance-row">
        <span className="appearance-label">Font family</span>
        <select className="font-family-select" value={fontFamily} onChange={(e) => setFontFamily(e.target.value)}>
          {FONT_FAMILY_PRESETS.map((preset) => (
            <option key={preset.value} value={preset.value}>
              {preset.name}
            </option>
          ))}
        </select>
      </div>

      <p className="hint">
        <code>Ctrl/Cmd +</code>/<code>−</code> to resize on the fly, <code>Ctrl/Cmd 0</code> to reset · applies to
        every open terminal.
      </p>

      <div className="appearance-row column">
        <span className="appearance-label">Terminal color theme</span>
        <div className="term-theme-grid">
          {TERMINAL_THEME_PRESETS.map((preset) => {
            const swatch = preset.theme;
            return (
              <button
                key={preset.id}
                className={`term-theme-card ${terminalThemeId === preset.id ? "active" : ""}`}
                style={
                  swatch
                    ? { background: swatch.background, color: swatch.foreground }
                    : { background: "var(--term-bg)", color: "var(--term-fg)" }
                }
                onClick={() => setTerminalThemeId(preset.id)}
                title={preset.blurb}
              >
                {swatch ? (
                  <span className="term-theme-dots">
                    {[swatch.red, swatch.green, swatch.yellow, swatch.blue, swatch.magenta, swatch.cyan].map(
                      (c, i) => (
                        <span key={i} className="term-theme-dot" style={{ background: c }} />
                      ),
                    )}
                  </span>
                ) : (
                  <span className="term-theme-dots term-theme-dots-app">Aa</span>
                )}
                <span className="term-theme-name">{preset.name}</span>
              </button>
            );
          })}
        </div>
        <p className="hint">{TERMINAL_THEME_PRESETS.find((p) => p.id === terminalThemeId)?.blurb}</p>
      </div>

      <h2>Keyword Highlighting</h2>
      <KeywordHighlightSettings />

      <h2>Command Blocks</h2>
      <CommandBlocksSettings />

      <h2>AI Autocomplete</h2>
      <AiAutocompleteSettings />

      <h2>Backup</h2>
      <p className="hint">
        Export your hosts and groups to a JSON file, or import one back in. For security, passwords and key
        passphrases are never included — re-enter them via Edit after importing.
      </p>
      <div className="backup-actions">
        <button className="btn ghost small" onClick={handleExport} disabled={busy}>
          Export hosts…
        </button>
        <button className="btn ghost small" onClick={handleImport} disabled={busy}>
          Import hosts…
        </button>
      </div>
      {backupMessage && <div className="backup-message">{backupMessage}</div>}
      {backupError && <div className="dialog-error">{backupError}</div>}

      <h2>About</h2>
      <p className="hint">
        Wharf — a personal SSH/SFTP client. Save hosts and groups, connect via password, private key, or SSH agent,
        chain through jump hosts, and set up local/remote port forwarding.
      </p>
    </div>
  );
}
