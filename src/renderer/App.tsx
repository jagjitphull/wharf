import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { TitleBar } from "./components/TitleBar/TitleBar";
import { Sidebar } from "./components/Sidebar/Sidebar";
import { SidebarResizeHandle } from "./components/Sidebar/SidebarResizeHandle";
import { TerminalPanel } from "./components/Terminal/TerminalPanel";
import { StatusBar } from "./components/StatusBar/StatusBar";
import { IconRail } from "./components/IconRail/IconRail";
import { HomeView } from "./components/Home/HomeView";
import { useAppStore } from "./state/store";
import { useTerminalPrefsStore } from "./state/terminalPrefsStore";
import { useUiPrefsStore } from "./state/uiPrefsStore";
import { useRestoreTabsPrefsStore } from "./state/restoreTabsPrefsStore";
import { ipcErrorMessage, wharf } from "./api/wharf";
import { buildPaletteActions } from "./components/CommandPalette/actions";
import { Toaster } from "./components/Toaster/Toaster";
import { toast } from "./state/toastStore";
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
const HistoryView = lazy(() => import("./components/CommandHistory/HistoryView").then((m) => ({ default: m.HistoryView })));
const Workspaces = lazy(() => import("./components/Workspaces/Workspaces").then((m) => ({ default: m.Workspaces })));
const Settings = lazy(() => import("./components/Settings/Settings").then((m) => ({ default: m.Settings })));
const CommandPalette = lazy(() => import("./components/CommandPalette/CommandPalette").then((m) => ({ default: m.CommandPalette })));
const KeyboardShortcuts = lazy(() =>
  import("./components/KeyboardShortcuts/KeyboardShortcuts").then((m) => ({ default: m.KeyboardShortcuts })),
);

export default function App() {
  const { activeView, hosts, groups, loadAll, openTerminal, setContextHostId, setActiveView } = useAppStore();
  const sidebarCollapsed = useUiPrefsStore((s) => s.sidebarCollapsed);
  const tabCount = useAppStore((s) => s.tabs.length);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  // Rebuilt each time the palette opens, so tab-dependent actions reflect the tabs that exist then.
  const paletteActions = useMemo(
    () => (paletteOpen ? buildPaletteActions({ openShortcuts: () => setShortcutsOpen(true) }) : []),
    [paletteOpen],
  );

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
  // The master password locked itself (idle) or was locked from Settings: ask for it again.
  useEffect(() => wharf.secrets.onLocked(() => setLock("locked")), []);
  // …and unlocked from elsewhere (another window, Settings): a lock screen still up has nothing left to ask.
  useEffect(() => wharf.secrets.onUnlocked(() => setLock((l) => (l === "locked" ? "open" : l))), []);

  // Tell the main process the user is around, so idle auto-lock doesn't fire under them.
  useEffect(() => {
    let last = 0;
    const report = () => {
      const now = Date.now();
      if (now - last < 3000) return;
      last = now;
      wharf.secrets.reportActivity();
    };
    const events = ["keydown", "pointerdown", "wheel"] as const;
    for (const e of events) window.addEventListener(e, report, { capture: true, passive: true });
    return () => {
      for (const e of events) window.removeEventListener(e, report, { capture: true });
    };
  }, []);

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

  // Closing the last terminal leaves nothing to show on the terminal view; Home is the landing page.
  useEffect(() => {
    if (tabCount === 0 && activeView === "hosts") setActiveView("home");
  }, [tabCount, activeView, setActiveView]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;

      if (e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(true);
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

  async function handlePaletteConnect(host: (typeof hosts)[number]) {
    setPaletteOpen(false);
    setContextHostId(host.id);
    try {
      await openTerminal(host);
    } catch (err) {
      // The palette has already closed, so there's no inline place for this.
      toast.error(ipcErrorMessage(err));
    }
  }

  return (
    <div className="app-root">
      <TitleBar onOpenShortcuts={() => setShortcutsOpen(true)} onOpenPalette={() => setPaletteOpen(true)} />
      {lock === "locked" && <LockScreen onDone={() => setLock("open")} />}
      <div className="app-shell">
        <IconRail />
        {/* Home lists every host as a card, so the tree beside it would only repeat it. */}
        {!sidebarCollapsed && activeView !== "home" && (
          <>
            <Sidebar onOpenPalette={() => setPaletteOpen(true)} />
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
          {activeView === "home" && <HomeView />}
          <Suspense fallback={<ViewLoadingFallback />}>
            {/* Keyed by view so each one eases in when you switch to it. */}
            {activeView === "sftp" && (
              <div className="view-enter" key="sftp">
                <SftpBrowser />
              </div>
            )}
            {activeView === "tunnels" && (
              <div className="view-enter" key="tunnels">
                <Tunnels />
              </div>
            )}
            {activeView === "history" && (
              <div className="view-enter" key="history">
                <HistoryView />
              </div>
            )}
            {activeView === "workspaces" && (
              <div className="view-enter" key="workspaces">
                <Workspaces />
              </div>
            )}
            {activeView === "settings" && (
              <div className="view-enter" key="settings">
                <Settings />
              </div>
            )}
          </Suspense>
        </main>
      </div>
      <StatusBar />
      <Toaster />

      {/* Independent fallback={null}: these pop in, each on its own
          chunk — a one-frame delay before a modal appears isn't worth a
          visible loading state, and each needs its own boundary since
          both can in principle be open at once. */}
      {paletteOpen && (
        <Suspense fallback={null}>
          <CommandPalette
            hosts={hosts}
            groups={groups}
            actions={paletteActions}
            onClose={() => setPaletteOpen(false)}
            onConnect={handlePaletteConnect}
          />
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
