import { useEffect, useState } from "react";
import type { HistorySettings as Settings } from "@shared/types";
import { RETENTION_CHOICES, DEFAULT_HISTORY_SETTINGS } from "../../../shared/historyFilter";
import { wharf } from "../../api/wharf";
import { toast } from "../../state/toastStore";
import "./HistorySettings.css";

const RETENTION_LABEL: Record<number, string> = { 0: "Until I clear it", 7: "7 days", 30: "30 days", 90: "90 days", 365: "1 year" };

export function HistorySettings() {
  const [settings, setSettings] = useState<Settings | null>(null); // null while loading
  // Patterns are edited as text and saved on blur, so typing a half-finished line never reaches the main process.
  const [patternText, setPatternText] = useState("");

  useEffect(() => {
    void wharf.commandHistory.getSettings().then((s) => {
      setSettings(s);
      setPatternText(s.ignorePatterns.join("\n"));
    });
  }, []);

  async function save(next: Settings) {
    setSettings(next); // optimistic
    const saved = await wharf.commandHistory.setSettings(next);
    setSettings(saved);
  }

  async function clearAll() {
    if (!confirm("Clear all command history? This can't be undone.")) return;
    await wharf.commandHistory.clear();
    toast.success("Command history cleared");
  }

  const s = settings ?? DEFAULT_HISTORY_SETTINGS;
  const disabled = settings === null;

  return (
    <div className="ai-settings history-settings">
      <div className="appearance-row">
        <span className="appearance-label">Record command history</span>
        <label className="toggle-switch">
          <input type="checkbox" checked={s.enabled} disabled={disabled} onChange={(e) => void save({ ...s, enabled: e.target.checked })} />
          <span className="toggle-switch-track" />
        </label>
      </div>

      <div className="appearance-row">
        <span className="appearance-label">Skip commands that look like they contain a secret</span>
        <label className="toggle-switch">
          <input
            type="checkbox"
            checked={s.skipSecretLooking}
            disabled={disabled || !s.enabled}
            onChange={(e) => void save({ ...s, skipSecretLooking: e.target.checked })}
          />
          <span className="toggle-switch-track" />
        </label>
      </div>
      <p className="hint">
        Skips things like <code>--password=…</code>, <code>TOKEN=…</code>, <code>mysql -pSECRET</code>, <code>curl -u user:pass</code>,
        bearer tokens and well-known key formats. It is a safety net, not a guarantee — a secret in an unusual form is still recorded.
      </p>

      <div className="appearance-row">
        <span className="appearance-label">Keep history for</span>
        <select
          className="font-family-select"
          value={s.retentionDays}
          disabled={disabled || !s.enabled}
          onChange={(e) => void save({ ...s, retentionDays: Number(e.target.value) })}
        >
          {RETENTION_CHOICES.map((d) => (
            <option key={d} value={d}>
              {RETENTION_LABEL[d]}
            </option>
          ))}
        </select>
      </div>

      <div className="appearance-row column">
        <span className="appearance-label">Never record commands matching</span>
        <textarea
          className="history-patterns"
          rows={4}
          spellCheck={false}
          placeholder={"one pattern per line, * matches anything\nhistory *\nssh prod-db*"}
          value={patternText}
          disabled={disabled || !s.enabled}
          onChange={(e) => setPatternText(e.target.value)}
          onBlur={() => void save({ ...s, ignorePatterns: patternText.split("\n") })}
        />
      </div>

      <p className="hint">
        Passwords you type at a prompt (<code>sudo</code>, <code>ssh</code>, …) are never recorded. Start a command with a space to keep
        that one out of history too, as in your shell. Settings apply to new commands; the retention limit also applies to what is already
        stored.
      </p>

      <div className="appearance-row">
        <span className="appearance-label">Stored history</span>
        <button className="btn ghost small" onClick={() => void clearAll()}>
          Clear all history…
        </button>
      </div>
    </div>
  );
}
