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
import { ipcErrorMessage } from "./api/wharf";

export default function App() {
  const { activeView, hosts, groups, loadAll, openTerminal, setContextHostId, setActiveView } = useAppStore();
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
          setActiveTab(tab.sessionId);
          setActiveView("hosts");
        }
        return;
      }

      if (e.key === "Tab") {
        e.preventDefault();
        const idx = tabs.findIndex((t) => t.sessionId === activeTabId);
        const nextIdx = e.shiftKey ? (idx - 1 + tabs.length) % tabs.length : (idx + 1) % tabs.length;
        setActiveTab(tabs[nextIdx].sessionId);
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
        <Sidebar onOpenQuickConnect={() => setQuickConnectOpen(true)} />
        <main className="app-main">
          {activeView === "hosts" && <TerminalPanel />}
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
