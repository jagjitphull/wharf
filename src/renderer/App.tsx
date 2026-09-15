import { useEffect, useState } from "react";
import { TitleBar } from "./components/TitleBar/TitleBar";
import { Sidebar } from "./components/Sidebar/Sidebar";
import { TerminalPanel } from "./components/Terminal/TerminalPanel";
import { SftpBrowser } from "./components/SftpBrowser/SftpBrowser";
import { Tunnels } from "./components/Tunnels/Tunnels";
import { Settings } from "./components/Settings/Settings";
import { QuickConnect } from "./components/QuickConnect/QuickConnect";
import { StatusBar } from "./components/StatusBar/StatusBar";
import { useAppStore } from "./state/store";
import { useTerminalPrefsStore } from "./state/terminalPrefsStore";
import { useUiPrefsStore } from "./state/uiPrefsStore";
import { ipcErrorMessage } from "./api/wharf";

export default function App() {
  const { activeView, hosts, groups, loadAll, openTerminal, setContextHostId, setActiveView } = useAppStore();
  const sidebarCollapsed = useUiPrefsStore((s) => s.sidebarCollapsed);
  const [quickConnectOpen, setQuickConnectOpen] = useState(false);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;

      if (e.key.toLowerCase() === "k") {
        e.preventDefault();
        setQuickConnectOpen(true);
        return;
      }

      if (e.key.toLowerCase() === "b") {
        e.preventDefault();
        useUiPrefsStore.getState().toggleSidebar();
        return;
      }

      if (e.key === "=" || e.key === "+") {
        e.preventDefault();
        useTerminalPrefsStore.getState().increaseFontSize();
        return;
      }
      if (e.key === "-") {
        e.preventDefault();
        useTerminalPrefsStore.getState().decreaseFontSize();
        return;
      }
      if (e.key === "0") {
        e.preventDefault();
        useTerminalPrefsStore.getState().resetFontSize();
        return;
      }

      // Tab switching (Ctrl/Cmd+1..9 jump to tab N, Ctrl/Cmd+Tab cycles) reads
      // fresh state via getState() rather than closing over it, so this
      // listener can stay registered once instead of re-binding on every
      // tab change.
      const { tabs, activeTabId, setActiveTab } = useAppStore.getState();
      if (tabs.length === 0) return;

      if (e.key >= "1" && e.key <= "9") {
        const tab = tabs[Number(e.key) - 1];
        if (tab) {
          e.preventDefault();
          setActiveTab(tab.tabId);
          setActiveView("hosts");
        }
        return;
      }

      if (e.key === "Tab") {
        e.preventDefault();
        const idx = tabs.findIndex((t) => t.tabId === activeTabId);
        const nextIdx = e.shiftKey ? (idx - 1 + tabs.length) % tabs.length : (idx + 1) % tabs.length;
        setActiveTab(tabs[nextIdx].tabId);
        setActiveView("hosts");
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [setActiveView]);

  async function handleQuickConnect(host: (typeof hosts)[number]) {
    setQuickConnectOpen(false);
    setContextHostId(host.id);
    try {
      await openTerminal(host);
    } catch (err) {
      // Quick Connect has no inline error surface of its own; a native
      // alert is acceptable for this rare failure path (e.g. bad host key).
      alert(ipcErrorMessage(err));
    }
  }

  return (
    <div className="app-root">
      <TitleBar />
      <div className="app-shell">
        {!sidebarCollapsed && <Sidebar onOpenQuickConnect={() => setQuickConnectOpen(true)} />}
        <main className="app-main">
          {/* Always mounted (display:none rather than unmounted) — switching
              to Settings/SFTP/Tunnels and back must not tear down and
              recreate every open terminal, which would destroy scrollback. */}
          <TerminalPanel hidden={activeView !== "hosts"} />
          {activeView === "sftp" && <SftpBrowser />}
          {activeView === "tunnels" && <Tunnels />}
          {activeView === "settings" && <Settings />}
        </main>
      </div>
      <StatusBar />

      {quickConnectOpen && (
        <QuickConnect
          hosts={hosts}
          groups={groups}
          onClose={() => setQuickConnectOpen(false)}
          onConnect={handleQuickConnect}
        />
      )}
    </div>
  );
}
