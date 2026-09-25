import { useEffect, useState } from "react";
import { wharf } from "../../api/wharf";

export function CommandBlocksSettings() {
  const [enabled, setEnabled] = useState<boolean | null>(null); // null while loading

  useEffect(() => {
    void wharf.commandBlocks.getEnabled().then(setEnabled);
  }, []);

  async function toggle(next: boolean) {
    setEnabled(next);
    await wharf.commandBlocks.setEnabled(next);
  }

  return (
    <div className="ai-settings">
      <div className="appearance-row">
        <span className="appearance-label">Command Blocks</span>
        <label className="toggle-switch">
          <input type="checkbox" checked={enabled ?? true} disabled={enabled === null} onChange={(e) => toggle(e.target.checked)} />
          <span className="toggle-switch-track" />
        </label>
      </div>
      <p className="hint">
        Groups each command with its own output for easy copy/re-run/bookmark, and knows a command's real exit code
        (powering the AI's "Explain &amp; Fix" action on failed commands) — via a small, standard shell-integration
        script (the same OSC 133 protocol iTerm2/VS Code/Warp use) sent to bash or zsh sessions when they connect.
        Sessions running any other shell, or opened before you change this, aren't affected either way. Turning this
        off skips sending it to new sessions.
      </p>
    </div>
  );
}
