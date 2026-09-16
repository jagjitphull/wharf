import { useGhostSuggestionPrefsStore } from "../../state/ghostSuggestionPrefsStore";

export function GhostSuggestionSettings() {
  const { enabled, setEnabled } = useGhostSuggestionPrefsStore();

  return (
    <div className="ai-settings">
      <div className="appearance-row">
        <span className="appearance-label">Inline Suggestions</span>
        <label className="toggle-switch">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          <span className="toggle-switch-track" />
        </label>
      </div>
      <p className="hint">
        As you type, shows the rest of the most recent matching command from this host's history as dimmed
        "ghost" text — press <code>→</code> or <code>End</code> to accept it into the line, or just keep typing
        to ignore it. Pure local history matching, same convention as fish/zsh-autosuggestions — no AI involved,
        nothing sent anywhere.
      </p>
    </div>
  );
}
