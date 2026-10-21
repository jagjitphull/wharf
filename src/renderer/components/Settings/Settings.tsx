import { useState } from "react";
import { accentFor, normalizeAccent } from "../../state/accentColors";
import { ACCENT_PRESETS, useThemeStore, type ThemeMode } from "../../state/themeStore";
import { FONT_FAMILY_PRESETS, MAX_FONT_SIZE, MIN_FONT_SIZE, useTerminalPrefsStore } from "../../state/terminalPrefsStore";
import { MAX_UI_ZOOM, MIN_UI_ZOOM, useUiPrefsStore } from "../../state/uiPrefsStore";
import { TERMINAL_THEME_PRESETS } from "../../state/terminalThemes";
import { useAppStore } from "../../state/store";
import { useRestoreTabsPrefsStore } from "../../state/restoreTabsPrefsStore";
import { ipcErrorMessage, wharf } from "../../api/wharf";
import { KeywordHighlightSettings } from "./KeywordHighlightSettings";
import { CommandBlocksSettings } from "./CommandBlocksSettings";
import { HistorySettings } from "./HistorySettings";
import { TranscriptSettings } from "./TranscriptSettings";
import { GhostSuggestionSettings } from "./GhostSuggestionSettings";
import { AiAutocompleteSettings } from "./AiAutocompleteSettings";
import { NotificationSettings } from "./NotificationSettings";
import { UpdateSettings } from "./UpdateSettings";
import { SecretStorageSettings } from "./SecretStorageSettings";
import { TerminalPreview } from "./TerminalPreview";
import { GROUPS as SHORTCUT_GROUPS } from "../KeyboardShortcuts/KeyboardShortcuts";
import { IconMinus, IconPlus } from "../Icons/Icons";
import "../../styles/dialog.css";
import "../KeyboardShortcuts/KeyboardShortcuts.css";
import "./Settings.css";

const isMac = wharf.window.platform === "darwin";
const MOD = isMac ? "Cmd" : "Ctrl";
/** The preview pane's own quick-reference is just these two groups
 * (app-wide navigation + terminal-specific) — SFTP editor and picker
 * shortcuts are less useful to have on hand while in Settings, and the
 * full list is one keypress away regardless (see the hint below). */
const PREVIEW_SHORTCUT_GROUPS = SHORTCUT_GROUPS.filter((g) => g.title === "Global" || g.title === "Terminal");

const MODES: { mode: ThemeMode; label: string }[] = [
  { mode: "light", label: "Light" },
  { mode: "dark", label: "Dark" },
  { mode: "system", label: "System" },
];

export function Settings() {
  const { mode, resolved, accent, setMode, setAccent } = useThemeStore();
  const { fontSize, fontFamily, terminalThemeId, increaseFontSize, decreaseFontSize, setFontFamily, setTerminalThemeId } =
    useTerminalPrefsStore();
  const { uiZoom, setUiZoom, increaseUiZoom, decreaseUiZoom, resetUiZoom } = useUiPrefsStore();
  const { loadAll } = useAppStore();
  const { enabled: restoreTabsEnabled, setEnabled: setRestoreTabsEnabled } = useRestoreTabsPrefsStore();
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
    <div className="settings-layout">
      <div className="settings-panel">
        <h2>Appearance</h2>

        <div className="appearance-row">
          <span className="appearance-label">Theme</span>
          <div className="mode-switch">
            {MODES.map((m) => (
              <button key={m.mode} className={`mode-btn ${mode === m.mode ? "active" : ""}`} onClick={() => setMode(m.mode)}>
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
                className={`accent-swatch ${normalizeAccent(accent) === preset.value ? "active" : ""}`}
                style={{ background: accentFor(resolved, preset.value) }}
                title={preset.name}
                onClick={() => setAccent(preset.value)}
              />
            ))}
          </div>
        </div>

        <div className="appearance-row">
          <span className="appearance-label">Interface size</span>
          <div className="ui-size-control">
            <button className="btn ghost small icon" title="Smaller" onClick={decreaseUiZoom} disabled={uiZoom <= MIN_UI_ZOOM}>
              <IconMinus size={12} />
            </button>
            <input
              className="ui-size-slider"
              type="range"
              min={MIN_UI_ZOOM}
              max={MAX_UI_ZOOM}
              step={0.05}
              value={uiZoom}
              aria-label="Interface size"
              onChange={(e) => setUiZoom(Number(e.target.value))}
            />
            <button className="btn ghost small icon" title="Larger" onClick={increaseUiZoom} disabled={uiZoom >= MAX_UI_ZOOM}>
              <IconPlus size={12} />
            </button>
            <span className="font-size-value">{Math.round(uiZoom * 100)}%</span>
            <button className="btn ghost small" onClick={resetUiZoom} disabled={uiZoom === 1}>
              Reset
            </button>
          </div>
        </div>
        <p className="hint">
          Scales the whole interface — text, icons, sidebar, tabs, menus and dialogs. The terminal's own font size (below) is separate and
          is not affected.
        </p>

        <h2>Terminal</h2>

        <div className="appearance-row">
          <span className="appearance-label">Font size</span>
          <div className="font-size-stepper">
            <button className="btn ghost small icon" title="Smaller" onClick={decreaseFontSize} disabled={fontSize <= MIN_FONT_SIZE}>
              <IconMinus size={12} />
            </button>
            <span className="font-size-value">{fontSize}px</span>
            <button className="btn ghost small icon" title="Larger" onClick={increaseFontSize} disabled={fontSize >= MAX_FONT_SIZE}>
              <IconPlus size={12} />
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
          <code>Ctrl/Cmd +</code>/<code>−</code> to resize on the fly, <code>Ctrl/Cmd 0</code> to reset · applies to every open terminal.
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
                      {[swatch.red, swatch.green, swatch.yellow, swatch.blue, swatch.magenta, swatch.cyan].map((c, i) => (
                        <span key={i} className="term-theme-dot" style={{ background: c }} />
                      ))}
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

        <h2>Command History</h2>
        <HistorySettings />

        <h2>Session Transcripts</h2>
        <TranscriptSettings />

        <h2>Notifications</h2>
        <NotificationSettings />

        <h2>Inline Suggestions</h2>
        <GhostSuggestionSettings />

        <h2>AI Autocomplete</h2>
        <AiAutocompleteSettings />

        <h2>Startup</h2>
        <div className="appearance-row">
          <span className="appearance-label">Restore tabs on launch</span>
          <label className="toggle-switch">
            <input type="checkbox" checked={restoreTabsEnabled} onChange={(e) => setRestoreTabsEnabled(e.target.checked)} />
            <span className="toggle-switch-track" />
          </label>
        </div>
        <p className="hint">
          Reopens whatever hosts and local shells were open last time, reconnecting each automatically — only hosts with a saved
          password/key (no interactive prompt needed) will come back cleanly, same as Reconnect on Drop. Each pane also replays its recent
          scrollback above a "Previous session…" divider, Warp-style, so a restart feels like resuming rather than a blank prompt — a
          snapshot refreshed periodically while the app runs, not a full transcript.
        </p>

        <h2>Backup</h2>
        <p className="hint">
          Export your hosts and groups to a JSON file, or import one back in. For security, passwords and key passphrases are never included
          — re-enter them via Edit after importing.
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
          Wharf — a personal SSH/SFTP client. Save hosts and groups, connect via password, private key, or SSH agent, chain through jump
          hosts, and set up local/remote port forwarding.
        </p>
        <UpdateSettings />
        <SecretStorageSettings />
        <p className="hint">
          Wharf keeps a log file of app activity and errors — useful to find if something goes wrong and you need to report it.
        </p>
        <div className="backup-actions">
          <button className="btn ghost small" onClick={() => void wharf.shell.openLogsFolder()}>
            Open logs folder
          </button>
        </div>
      </div>

      <div className="settings-preview-pane">
        <span className="settings-preview-label">Terminal preview</span>
        <TerminalPreview themeId={terminalThemeId} fontFamily={fontFamily} fontSize={fontSize} />
        <p className="hint">Live — reflects the theme and font picked under Terminal.</p>

        <span className="settings-preview-label">Keyboard shortcuts</span>
        <div className="shortcuts-groups settings-preview-shortcuts">
          {PREVIEW_SHORTCUT_GROUPS.map((group) => (
            <div key={group.title} className="shortcuts-group">
              <h3>{group.title}</h3>
              {group.shortcuts.map((s) => (
                <div key={s.keys} className="shortcut-row">
                  <kbd>{s.keys}</kbd>
                  <span>{s.description}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
        <p className="hint">
          <code>{MOD}+/</code> for the full shortcuts reference, from anywhere in the app.
        </p>
      </div>
    </div>
  );
}
