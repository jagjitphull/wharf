import { useAppStore } from "../../state/store";
import { useHistoryTab } from "../../state/historyTab";
import { useThemeStore } from "../../state/themeStore";
import { useUiPrefsStore } from "../../state/uiPrefsStore";
import { useTerminalPrefsStore } from "../../state/terminalPrefsStore";
import { toast } from "../../state/toastStore";
import { ipcErrorMessage, wharf } from "../../api/wharf";
import { reconnectTab } from "../Tabs/tabActions";
import type { PaletteAction } from "./paletteModel";

const MOD = wharf.window.platform === "darwin" ? "Cmd" : "Ctrl";

interface Context {
  openShortcuts(): void;
}

/**
 * Everything the palette can do besides connecting to a host. Built fresh each
 * time the palette opens, so actions that depend on the open tabs (reconnect,
 * duplicate, close, next/previous) only exist when there is a tab to act on.
 * Each `run` reads the stores at the moment it is chosen.
 */
export function buildPaletteActions(ctx: Context): PaletteAction[] {
  const { tabs, activeTabId, activeView } = useAppStore.getState();
  const activeTab = tabs.find((t) => t.tabId === activeTabId) ?? null;
  const go = (view: Parameters<ReturnType<typeof useAppStore.getState>["setActiveView"]>[0]) => () =>
    useAppStore.getState().setActiveView(view);
  const focusTab = (tabId: string) => {
    useAppStore.getState().setActiveTab(tabId);
    useAppStore.getState().setActiveView("hosts");
  };
  const cycle = (delta: 1 | -1) => () => {
    if (tabs.length === 0) return;
    const i = tabs.findIndex((t) => t.tabId === activeTabId);
    focusTab(tabs[(i + delta + tabs.length) % tabs.length].tabId);
  };

  const actions: PaletteAction[] = [];

  if (activeTab) {
    actions.push(
      {
        id: "tab.reconnect",
        title: "Reconnect tab",
        subtitle: "Starts a new session in the active tab; dropped panes first",
        keywords: "restart resume disconnect",
        featured: true,
        run: () => void reconnectTab(activeTab.tabId),
      },
      {
        id: "tab.duplicate",
        title: "Duplicate tab",
        subtitle: "Open another session like this one",
        keywords: "clone copy",
        featured: true,
        run: () =>
          void useAppStore
            .getState()
            .duplicateTab(activeTab.tabId)
            .catch((e) => toast.error(ipcErrorMessage(e))),
      },
      {
        id: "tab.close",
        title: "Close tab",
        subtitle: "End the active tab's sessions",
        run: () => void useAppStore.getState().closeTab(activeTab.tabId),
      },
    );
  }
  if (tabs.length > 1) {
    actions.push(
      { id: "tab.next", title: "Next tab", keys: `${MOD} Tab`, run: cycle(1) },
      { id: "tab.prev", title: "Previous tab", keys: `${MOD} Shift Tab`, run: cycle(-1) },
    );
  }

  actions.push(
    {
      id: "shell.local",
      title: "New local shell",
      subtitle: "Open a terminal on this computer",
      keywords: "terminal tab",
      featured: true,
      run: () =>
        void useAppStore
          .getState()
          .openLocalShell()
          .catch((e) => toast.error(ipcErrorMessage(e))),
    },
    { id: "go.home", title: "Go to Home", subtitle: "All your hosts", keywords: "hosts", featured: activeView !== "home", run: go("home") },
    { id: "go.tunnels", title: "Go to Tunnels", run: go("tunnels") },
    {
      id: "go.keys",
      title: "Go to SSH keys",
      subtitle: "Generate, copy and install keys",
      keywords: "ssh key generate ed25519 authorized_keys",
      run: go("keys"),
    },
    { id: "go.workspaces", title: "Go to Workspaces", run: go("workspaces") },
    { id: "go.history", title: "Go to History", subtitle: "Commands you've run", run: go("history") },
    {
      id: "go.transcripts",
      title: "Search session output",
      subtitle: "Find text your terminal sessions printed",
      keywords: "transcript recording log find history",
      run: () => {
        useHistoryTab.getState().setTab("transcripts");
        go("history")();
      },
    },
    { id: "go.settings", title: "Go to Settings", keywords: "preferences options", run: go("settings") },
    {
      id: "theme.toggle",
      title: "Toggle theme",
      subtitle: "Switch between Harbor Night and Sea Glass",
      keywords: "dark light mode appearance",
      featured: true,
      run: () => {
        const { resolved, setMode } = useThemeStore.getState();
        setMode(resolved === "dark" ? "light" : "dark");
      },
    },
    {
      id: "sidebar.toggle",
      title: "Show or hide sidebar",
      keys: `${MOD} B`,
      keywords: "host tree",
      run: () => useUiPrefsStore.getState().toggleSidebar(),
    },
    {
      id: "density.toggle",
      title: useUiPrefsStore.getState().density === "compact" ? "Use comfortable layout" : "Use compact layout",
      subtitle: "Switch the icon rail, sidebar and tabs between roomy and compact",
      keywords: "density narrow slim tight spacing sidebar rail",
      run: () => {
        const { density, setDensity } = useUiPrefsStore.getState();
        setDensity(density === "compact" ? "comfortable" : "compact");
      },
    },
    {
      id: "tabs.layout",
      title: useUiPrefsStore.getState().tabLayout === "side" ? "Move tabs to the top" : "Move tabs to the side",
      subtitle: "Switch the terminal tabs between the title bar and a side panel",
      keywords: "tab layout vertical horizontal panel warp",
      run: () => {
        const { tabLayout, setTabLayout } = useUiPrefsStore.getState();
        setTabLayout(tabLayout === "side" ? "top" : "side");
      },
    },
    ...(useUiPrefsStore.getState().tabLayout === "side" && tabs.length > 0
      ? [
          {
            id: "tabs.panel",
            title: useUiPrefsStore.getState().tabPanelCollapsed ? "Expand tab panel" : "Collapse tab panel",
            subtitle: "Show full tab names, or only their numbers",
            keywords: "tabs side collapse expand narrow",
            run: () => {
              const { tabPanelCollapsed, setTabPanelCollapsed } = useUiPrefsStore.getState();
              setTabPanelCollapsed(!tabPanelCollapsed);
            },
          },
        ]
      : []),
    { id: "shortcuts", title: "Keyboard shortcuts", keys: `${MOD} /`, keywords: "keys help", run: ctx.openShortcuts },
    {
      id: "font.up",
      title: "Increase terminal font size",
      keys: `${MOD} =`,
      run: () => useTerminalPrefsStore.getState().increaseFontSize(),
    },
    {
      id: "font.down",
      title: "Decrease terminal font size",
      keys: `${MOD} -`,
      run: () => useTerminalPrefsStore.getState().decreaseFontSize(),
    },
    { id: "font.reset", title: "Reset terminal font size", keys: `${MOD} 0`, run: () => useTerminalPrefsStore.getState().resetFontSize() },
    { id: "window.new", title: "New window", run: () => wharf.window.newWindow() },
  );
  return actions;
}
