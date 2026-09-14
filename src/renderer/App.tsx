import { useEffect, useState } from "react";
import { TitleBar } from "./components/TitleBar/TitleBar";
import { Sidebar } from "./components/Sidebar/Sidebar";
import { TerminalPanel } from "./components/Terminal/TerminalPanel";
import { SftpBrowser } from "./components/SftpBrowser/SftpBrowser";
import { Tunnels } from "./components/Tunnels/Tunnels";
import { Settings } from "./components/Settings/Settings";
import { QuickConnect } from "./components/QuickConnect/QuickConnect";
import { useAppStore } from "./state/store";
import { ipcErrorMessage } from "./api/wharf";

export default function App() {
  const { activeView, hosts, groups, loadAll, openTerminal, setContextHostId } = useAppStore();
  const [quickConnectOpen, setQuickConnectOpen] = useState(false);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setQuickConnectOpen(true);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

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
