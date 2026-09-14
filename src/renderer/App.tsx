import { useEffect } from "react";
import { TitleBar } from "./components/TitleBar/TitleBar";
import { Sidebar } from "./components/Sidebar/Sidebar";
import { TerminalPanel } from "./components/Terminal/TerminalPanel";
import { SftpBrowser } from "./components/SftpBrowser/SftpBrowser";
import { Tunnels } from "./components/Tunnels/Tunnels";
import { Settings } from "./components/Settings/Settings";
import { useAppStore } from "./state/store";

export default function App() {
  const { activeView, loadAll } = useAppStore();

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  return (
    <div className="app-root">
      <TitleBar />
      <div className="app-shell">
        <Sidebar />
        <main className="app-main">
          {activeView === "hosts" && <TerminalPanel />}
          {activeView === "sftp" && <SftpBrowser />}
          {activeView === "tunnels" && <Tunnels />}
          {activeView === "settings" && <Settings />}
        </main>
      </div>
    </div>
  );
}
