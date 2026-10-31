import { accentFor, normalizeAccent } from "../../state/accentColors";
import { ACCENT_PRESETS, useThemeStore, type ThemeMode } from "../../state/themeStore";
import { FONT_FAMILY_PRESETS, MAX_FONT_SIZE, MIN_FONT_SIZE, useTerminalPrefsStore } from "../../state/terminalPrefsStore";
import { MAX_UI_ZOOM, MIN_UI_ZOOM, useUiPrefsStore, type Density, type TabLayout } from "../../state/uiPrefsStore";
import { TERMINAL_THEME_PRESETS } from "../../state/terminalThemes";
import { useRestoreTabsPrefsStore } from "../../state/restoreTabsPrefsStore";
import { wharf } from "../../api/wharf";
import { KeywordHighlightSettings } from "./KeywordHighlightSettings";
import { CommandBlocksSettings } from "./CommandBlocksSettings";
import { HistorySettings } from "./HistorySettings";
import { TranscriptSettings } from "./TranscriptSettings";
import { BackupSettings } from "./BackupSettings";
import { GhostSuggestionSettings } from "./GhostSuggestionSettings";
import { AiAutocompleteSettings } from "./AiAutocompleteSettings";
import { NotificationSettings } from "./NotificationSettings";
import { UpdateSettings } from "./UpdateSettings";
import { SecretStorageSettings } from "./SecretStorageSettings";
import { TerminalPreview } from "./TerminalPreview";
import { IconMinus, IconPlus } from "../Icons/Icons";
import "../../styles/dialog.css";
import "./Settings.css";

const isMac = wharf.window.platform === "darwin";
const MOD = isMac ? "Cmd" : "Ctrl";

const MODES: { mode: ThemeMode; label: string }[] = [
  { mode: "light", label: "Light" },
  { mode: "dark", label: "Dark" },
  { mode: "system", label: "System" },
];

const DENSITIES: { density: Density; label: string }[] = [
  { density: "comfortable", label: "Comfortable" },
  { density: "compact", label: "Compact" },
];

const TAB_LAYOUTS: { layout: TabLayout; label: string }[] = [
  { layout: "top", label: "Top" },
  { layout: "side", label: "Side" },
];

export function Settings({ onOpenShortcuts }: { onOpenShortcuts: () => void }) {
  const { mode, resolved, accent, setMode, setAccent } = useThemeStore();
  const { fontSize, fontFamily, terminalThemeId, increaseFontSize, decreaseFontSize, setFontFamily, setTerminalThemeId } =
    useTerminalPrefsStore();
  const { uiZoom, setUiZoom, increaseUiZoom, decreaseUiZoom, resetUiZoom, density, setDensity, tabLayout, setTabLayout } =
    useUiPrefsStore();
  const { enabled: restoreTabsEnabled, setEnabled: setRestoreTabsEnabled } = useRestoreTabsPrefsStore();

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
          <span className="appearance-label">Layout density</span>
          <div className="mode-switch" role="group" aria-label="Layout density">
            {DENSITIES.map((d) => (
              <button
                key={d.density}
                className={`mode-btn ${density === d.density ? "active" : ""}`}
                aria-pressed={density === d.density}
                onClick={() => setDensity(d.density)}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>
        <p className="hint">Compact narrows the icon rail and tightens the sidebar and tabs, to leave more room for terminals.</p>

        <div className="appearance-row">
          <span className="appearance-label">Tab layout</span>
          <div className="mode-switch" role="group" aria-label="Tab layout">
            {TAB_LAYOUTS.map((l) => (
              <button
                key={l.layout}
                className={`mode-btn ${tabLayout === l.layout ? "active" : ""}`}
                aria-pressed={tabLayout === l.layout}
                onClick={() => setTabLayout(l.layout)}
              >
                {l.label}
              </button>
            ))}
          </div>
        </div>
        <p className="hint">
          Top keeps the tabs across the title bar. Side lists them in a panel next to the icon rail, which you can collapse to just numbers
          and expand to full names.
        </p>

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
        <BackupSettings />

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
        <p className="hint">
          Press <code>{MOD}+K</code> to jump to a host or run any action, or <code>{MOD}+/</code> for the full list of shortcuts, from
          anywhere in the app.
        </p>
        <div>
          <button className="btn small" onClick={onOpenShortcuts}>
            View all keyboard shortcuts
          </button>
        </div>
      </div>
    </div>
  );
}
