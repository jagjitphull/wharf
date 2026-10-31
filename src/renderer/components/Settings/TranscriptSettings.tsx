import { useEffect, useState } from "react";
import type { TranscriptSettings as Settings } from "@shared/types";
import { DEFAULT_TRANSCRIPT_SETTINGS, RETENTION_CHOICES } from "../../../shared/transcripts";
import { wharf } from "../../api/wharf";
import { toast } from "../../state/toastStore";
import { useHistoryTab } from "../../state/historyTab";
import { useAppStore } from "../../state/store";

const RETENTION_LABEL: Record<number, string> = { 0: "Until I delete them", 7: "7 days", 30: "30 days", 90: "90 days", 365: "1 year" };

export function TranscriptSettings() {
  const setActiveView = useAppStore((s) => s.setActiveView);
  const setHistoryTab = useHistoryTab((s) => s.setTab);
  const [settings, setSettings] = useState<Settings | null>(null); // null while loading

  useEffect(() => {
    void wharf.transcripts.getSettings().then(setSettings);
  }, []);

  async function save(next: Settings) {
    setSettings(next); // optimistic
    setSettings(await wharf.transcripts.setSettings(next));
  }

  async function clearAll() {
    if (!confirm("Delete all session transcripts? This can't be undone.")) return;
    await wharf.transcripts.clear();
    toast.success("Transcripts deleted");
  }

  const s = settings ?? DEFAULT_TRANSCRIPT_SETTINGS;
  const disabled = settings === null;

  return (
    <div className="ai-settings">
      <div className="appearance-row">
        <span className="appearance-label">Record session output</span>
        <label className="toggle-switch">
          <input type="checkbox" checked={s.enabled} disabled={disabled} onChange={(e) => void save({ ...s, enabled: e.target.checked })} />
          <span className="toggle-switch-track" />
        </label>
      </div>
      <p className="hint">
        Keeps the text each new SSH or local terminal session prints, so you can search it later from History. Output is whatever the
        terminal showed — including anything a command printed, such as a secret from <code>cat .env</code>. It is stored on this computer
        only (readable by your user only, and sealed with the master password if you set one). Typed passwords aren&apos;t echoed, so they
        aren&apos;t in it. Full-screen programs and Mosh sessions are not recorded.
      </p>

      <div className="appearance-row">
        <span className="appearance-label">Keep transcripts for</span>
        <select
          className="font-family-select"
          value={s.retentionDays}
          disabled={disabled}
          onChange={(e) => void save({ ...s, retentionDays: Number(e.target.value) })}
        >
          {RETENTION_CHOICES.map((d) => (
            <option key={d} value={d}>
              {RETENTION_LABEL[d]}
            </option>
          ))}
        </select>
      </div>

      <div className="appearance-row">
        <span className="appearance-label">Recorded sessions</span>
        <span className="transcript-settings-actions">
          <button
            className="btn ghost small"
            onClick={() => {
              setHistoryTab("transcripts");
              setActiveView("history");
            }}
          >
            Search…
          </button>
          <button className="btn ghost small" onClick={() => void clearAll()}>
            Delete all…
          </button>
        </span>
      </div>
    </div>
  );
}
