import { LONG_COMMAND_THRESHOLD_MS, useNotificationPrefsStore } from "../../state/notificationPrefsStore";

export function NotificationSettings() {
  const { notifyOnLongCommand, setNotifyOnLongCommand } = useNotificationPrefsStore();

  return (
    <div className="ai-settings">
      <div className="appearance-row">
        <span className="appearance-label">Notify when a long command finishes</span>
        <label className="toggle-switch">
          <input type="checkbox" checked={notifyOnLongCommand} onChange={(e) => setNotifyOnLongCommand(e.target.checked)} />
          <span className="toggle-switch-track" />
        </label>
      </div>
      <p className="hint">
        A desktop notification when a command running at least {LONG_COMMAND_THRESHOLD_MS / 1000}s finishes on a
        pane you're not currently looking at — click it to jump straight back to that tab. Needs Command Blocks
        (above) to know when a command actually finishes.
      </p>
    </div>
  );
}
