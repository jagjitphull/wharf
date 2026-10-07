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
      <p className="hint">
        At an empty prompt, also predicts the next command the same way Warp does — the command that's most often
        followed whatever you just ran, ghosted in full and accepted the same way. This half needs bash/zsh with
        Command Blocks enabled (below): it relies on the shell's own signal for "waiting at a prompt right now" to
        avoid ever guessing while a command's output is still scrolling.
      </p>
    </div>
  );
}
