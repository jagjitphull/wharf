import { useHistoryTab, type HistoryTab } from "../../state/historyTab";
import { CommandHistory } from "./CommandHistory";
import { Transcripts } from "../Transcripts/Transcripts";
import "./HistoryView.css";

const TABS: { id: HistoryTab; label: string }[] = [
  { id: "commands", label: "Commands" },
  { id: "transcripts", label: "Session output" },
];

/** The History page: what you ran, and (when recording is on) what the sessions printed. */
export function HistoryView() {
  const tab = useHistoryTab((s) => s.tab);
  const setTab = useHistoryTab((s) => s.setTab);
  return (
    <div className="history-view">
      <div className="history-tabs" role="tablist" aria-label="History">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={`history-tab ${tab === t.id ? "active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="history-view-body">{tab === "commands" ? <CommandHistory /> : <Transcripts />}</div>
    </div>
  );
}
