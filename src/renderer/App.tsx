import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { TitleBar } from "./components/TitleBar/TitleBar";
import { Sidebar } from "./components/Sidebar/Sidebar";
import { SidebarResizeHandle } from "./components/Sidebar/SidebarResizeHandle";
import { TerminalPanel } from "./components/Terminal/TerminalPanel";
import { StatusBar } from "./components/StatusBar/StatusBar";
import { useAppStore } from "./state/store";
import { useTerminalPrefsStore } from "./state/terminalPrefsStore";
import { useUiPrefsStore } from "./state/uiPrefsStore";
import { useRestoreTabsPrefsStore } from "./state/restoreTabsPrefsStore";
import { ipcErrorMessage, wharf } from "./api/wharf";
import { LockScreen } from "./components/LockScreen/LockScreen";

// Lazy: each is its own chunk, fetched only the first time its view/modal
// is actually opened, rather than all bundled into the one chunk the whole
// app has to load before it can show anything. TerminalPanel (the view
// almost every session actually uses first) stays a static import above —
// no reason to add a loading flash to the one thing that should feel
// instant. .then(...) adapts each module's named export to the default
// export lazy() requires, since nothing else in this codebase uses default
// exports and these don't need to be the exception.
const SftpBrowser = lazy(() => import("./components/SftpBrowser/SftpBrowser").then((m) => ({ default: m.SftpBrowser })));
const Tunnels = lazy(() => import("./components/Tunnels/Tunnels").then((m) => ({ default: m.Tunnels })));
const CommandHistory = lazy(() => import("./components/CommandHistory/CommandHistory").then((m) => ({ default: m.CommandHistory })));
const Workspaces = lazy(() => import("./components/Workspaces/Workspaces").then((m) => ({ default: m.Workspaces })));
const Settings = lazy(() => import("./components/Settings/Settings").then((m) => ({ default: m.Settings })));
const QuickConnect = lazy(() => import("./components/QuickConnect/QuickConnect").then((m) => ({ default: m.QuickConnect })));
const KeyboardShortcuts = lazy(() =>
  import("./components/KeyboardShortcuts/KeyboardShortcuts").then((m) => ({ default: m.KeyboardShortcuts })),
);

export default function App() {
  const { activeView, hosts, groups, loadAll, openTerminal, setContextHostId, setActiveView } = useAppStore();
  const sidebarCollapsed = useUiPrefsStore((s) => s.sidebarCollapsed);
  const [quickConnectOpen, setQuickConnectOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  // Guards restoreLastSession() against React 18 StrictMode's dev-only
  // double-invoke of mount effects: unlike loadAll()'s refreshX calls
  // (each just overwrites its slice wholesale, so a second call is a
  // harmless no-op), restoreLastSession() *appends* tabs every time it's
  // called — run twice in the same mount, it opens every restored tab
  // twice. The ref itself (not something async-derived) is what makes the
  // guard correct regardless of which of the two overlapping loadAll()
  // calls' .then() happens to resolve first.
  const restoredRef = useRef(false);
  // Restoring tabs reconnects hosts, which needs saved passwords, so with a
  // master password set it waits for the lock screen to be answered.
  const [lock, setLock] = useState<"checking" | "locked" | "open">("checking");
  useEffect(() => {
    wharf.secrets
      .status()
      .then((s) => setLock(s.masterPassword === "locked" ? "locked" : "open"))
      .catch(() => setLock("open"));
  }, []);

  useEffect(() => {
    if (lock === "checking" || lock === "locked") return;
    void loadAll().then(() => {
      if (restoredRef.current) return;
      restoredRef.current = true;
      // Needs hosts already loaded (above) so a saved tab referencing a host
      // can look it up — restoreLastSession() itself no-ops if there's
      // nothing saved, so this is always safe to call.
      if (useRestoreTabsPrefsStore.getState().enabled) {
        void useAppStore.getState().restoreLastSession();
      }
    });
  }, [loadAll, lock]);

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

      if (e.key === "/") {
        e.preventDefault();
        setShortcutsOpen(true);
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
      <TitleBar onOpenShortcuts={() => setShortcutsOpen(true)} />
      {lock === "locked" && <LockScreen onDone={() => setLock("open")} />}
      <div className="app-shell">
        {!sidebarCollapsed && (
          <>
            <Sidebar onOpenQuickConnect={() => setQuickConnectOpen(true)} />
            <SidebarResizeHandle />
          </>
        )}
        <main className="app-main">
          {/* Always mounted (display:none rather than unmounted) — switching
              to Settings/SFTP/Tunnels and back must not tear down and
              recreate every open terminal, which would destroy scrollback.
              Kept outside the Suspense below on purpose: a lazy view's
              chunk loading must never hide an already-open terminal. */}
          <TerminalPanel hidden={activeView !== "hosts"} />
          <Suspense fallback={<ViewLoadingFallback />}>
            {activeView === "sftp" && <SftpBrowser />}
            {activeView === "tunnels" && <Tunnels />}
            {activeView === "history" && <CommandHistory />}
            {activeView === "workspaces" && <Workspaces />}
            {activeView === "settings" && <Settings />}
          </Suspense>
        </main>
      </div>
      <StatusBar />

      {/* Independent fallback={null}: these pop in, each on its own
          chunk — a one-frame delay before a modal appears isn't worth a
          visible loading state, and each needs its own boundary since
          both can in principle be open at once. */}
      {quickConnectOpen && (
        <Suspense fallback={null}>
          <QuickConnect hosts={hosts} groups={groups} onClose={() => setQuickConnectOpen(false)} onConnect={handleQuickConnect} />
        </Suspense>
      )}

      {shortcutsOpen && (
        <Suspense fallback={null}>
          <KeyboardShortcuts onClose={() => setShortcutsOpen(false)} />
        </Suspense>
      )}
    </div>
  );
}

/** Shown only while a lazy view's chunk is actually being fetched — on
 * local disk that's well under a frame in practice, but Suspense still
 * needs a fallback, and a blank panel would read as a broken view switch. */
function ViewLoadingFallback() {
  return (
    <div
      style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--text-dim)", fontSize: 13 }}
    >
      Loading…
    </div>
  );
}
