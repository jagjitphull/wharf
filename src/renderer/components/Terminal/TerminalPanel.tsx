import { useAppStore } from "../../state/store";
import { TerminalView } from "./Terminal";
import "./TerminalPanel.css";

export function TerminalPanel() {
  const { tabs, activeTabId, setActiveTab, closeTerminal } = useAppStore();

  if (tabs.length === 0) {
    return (
      <div className="terminal-empty">
        <p>No open sessions.</p>
        <p className="hint">Double-click a host in the sidebar (or hit ▶) to connect.</p>
      </div>
    );
  }

  return (
    <div className="terminal-panel">
      <div className="tab-bar">
        {tabs.map((tab) => (
          <div
            key={tab.sessionId}
            className={`tab ${tab.sessionId === activeTabId ? "active" : ""} ${tab.closed ? "closed" : ""}`}
            onClick={() => setActiveTab(tab.sessionId)}
            title={tab.closeError}
          >
            <span>{tab.title}</span>
            {tab.closed && <span className="tab-dot" />}
            <button
              className="tab-close"
              onClick={(e) => {
                e.stopPropagation();
                closeTerminal(tab.sessionId);
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <div className="terminal-stack">
        {tabs.map((tab) => (
          <TerminalView key={tab.sessionId} sessionId={tab.sessionId} visible={tab.sessionId === activeTabId} />
        ))}
      </div>
    </div>
  );
}
