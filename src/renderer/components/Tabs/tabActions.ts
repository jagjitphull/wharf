import { flattenPanes, useAppStore } from "../../state/store";
import { toast } from "../../state/toastStore";
import { ipcErrorMessage } from "../../api/wharf";

/** Reconnects the tab's dropped panes; with none dropped, the active pane
 * (after asking, since that ends whatever is running in it). Shared by the
 * tab's right-click menu and the command palette. */
export async function reconnectTab(tabId: string): Promise<void> {
  const { tabs, paneMeta, reconnectPanes } = useAppStore.getState();
  const tab = tabs.find((t) => t.tabId === tabId);
  if (!tab) return;
  const dropped = flattenPanes(tab.layout).filter((id) => paneMeta[id]?.closed);
  const targets = dropped.length > 0 ? dropped : [tab.activePaneId];
  if (dropped.length === 0) {
    const title = paneMeta[tab.activePaneId]?.title ?? "this session";
    if (!confirm(`"${title}" is still connected. Reconnecting ends whatever is running in it and starts a new session. Continue?`)) return;
  }
  try {
    await reconnectPanes(tab.tabId, targets);
    toast.success(targets.length === 1 ? "Reconnected" : `Reconnected ${targets.length} panes`);
  } catch (err) {
    toast.error(`Couldn't reconnect: ${ipcErrorMessage(err)}`);
  }
}
