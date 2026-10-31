import { useAppStore } from "../../state/store";
import { LONG_COMMAND_THRESHOLD_MS } from "../../state/notificationPrefsStore";
import type { CommandBlock } from "./commandBlocks";

/**
 * A desktop notification when a long-running command finishes on a pane you're
 * not currently looking at. Skipped for a pane/tab that's already visible and
 * focused, so it never fires for something you're watching complete in real
 * time. `enabled` and `visible` are read when called, not captured, because the
 * caller is a listener registered once at mount.
 */
export function notifyCommandFinished(
  block: CommandBlock,
  ctx: { sessionId: string; tabId: string; enabled: boolean; visible: boolean },
): void {
  if (!ctx.enabled) return;
  if (Date.now() - block.timestamp < LONG_COMMAND_THRESHOLD_MS) return;
  if (ctx.visible && !document.hidden && document.hasFocus()) return;
  if (typeof Notification === "undefined" || Notification.permission === "denied") return;

  const meta = useAppStore.getState().paneMeta[ctx.sessionId];
  const ok = block.exitCode === 0 || block.exitCode === null;
  const notification = new Notification(ok ? "Command finished" : `Command failed (exit ${block.exitCode})`, {
    body: `${meta?.title ?? "Terminal"} — ${block.command}`,
  });
  notification.onclick = () => {
    window.focus();
    const { setActiveTab, setActiveView } = useAppStore.getState();
    setActiveTab(ctx.tabId);
    setActiveView("hosts");
  };
}
