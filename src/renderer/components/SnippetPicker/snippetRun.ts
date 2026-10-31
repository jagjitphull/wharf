import { renderSnippet, usesClipboard, type SnippetBuiltins } from "@shared/snippetTemplate";
import { wharf } from "../../api/wharf";
import { useAppStore } from "../../state/store";

/** The session of the focused pane of the current tab, if it is still live. */
export function activeSessionId(): string | null {
  const { tabs, activeTabId, paneMeta } = useAppStore.getState();
  const tab = tabs.find((t) => t.tabId === activeTabId);
  if (!tab) return null;
  const meta = paneMeta[tab.activePaneId];
  return meta && !meta.closed ? tab.activePaneId : null;
}

/** What the built-in variables mean in `sessionId`'s terminal. */
async function builtinsFor(sessionId: string, needClipboard: boolean): Promise<SnippetBuiltins> {
  const { paneMeta, hosts } = useAppStore.getState();
  const meta = paneMeta[sessionId];
  const host = meta?.hostId ? hosts.find((h) => h.id === meta.hostId) : undefined;
  return {
    host: host?.name ?? meta?.title ?? "",
    hostname: host?.hostname ?? "localhost",
    user: host?.username ?? "",
    now: new Date(),
    clipboard: needClipboard ? await wharf.clipboard.readText().catch(() => "") : "",
  };
}

/** The snippet's command for `sessionId`, with the asked-for `values` and the built-ins filled in. */
export async function renderForSession(command: string, values: Record<string, string>, sessionId: string): Promise<string> {
  return renderSnippet(command, values, await builtinsFor(sessionId, usesClipboard(command)));
}
