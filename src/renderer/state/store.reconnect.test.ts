import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HostRecord } from "../../shared/types";
import type { PaneMeta, PaneNode, TerminalTab } from "./store";

const calls = vi.hoisted(() => ({
  sshConnect: [] as string[],
  localConnect: 0,
  disconnected: [] as string[],
  nextId: 1,
  failHosts: new Set<string>(),
  /** Called inside ssh.connect, so a test can change state while a connection is in flight. */
  duringConnect: null as null | (() => void),
}));

const noop = () => () => {};
const wharfStub = {
  ssh: {
    connect: async (hostId: string) => {
      calls.sshConnect.push(hostId);
      calls.duringConnect?.();
      if (calls.failHosts.has(hostId)) throw new Error("Error invoking remote method 'ssh:connect': Error: connection refused");
      return { sessionId: `new-${calls.nextId++}` };
    },
    disconnect: async (id: string) => {
      calls.disconnected.push(id);
    },
    onClosed: noop,
    onReconnecting: noop,
    onReconnected: noop,
  },
  localShell: {
    connect: async () => {
      calls.localConnect++;
      return { sessionId: `new-${calls.nextId++}` };
    },
  },
  session: { saveLast: async () => {}, onFlushRequest: noop, flushed: () => {} },
};

let store: typeof import("./store");
let scrollback: typeof import("../components/Terminal/scrollbackRegistry");

const host = (id: string, name: string): HostRecord =>
  ({ id, name, hostname: `${id}.example`, port: 22, username: "u", authMethod: "agent" }) as HostRecord;
const leaf = (sessionId: string): PaneNode => ({ type: "leaf", sessionId });
const meta = (over: Partial<PaneMeta> = {}): PaneMeta => ({ hostId: "h1", title: "web", connectedAt: 1, ...over });

function setState(tabs: TerminalTab[], paneMeta: Record<string, PaneMeta>, hosts = [host("h1", "web"), host("h2", "db")]) {
  store.useAppStore.setState({ tabs, paneMeta, hosts, activeTabId: tabs[0]?.tabId ?? null });
}
const state = () => store.useAppStore.getState();

beforeEach(async () => {
  calls.sshConnect = [];
  calls.localConnect = 0;
  calls.disconnected = [];
  calls.nextId = 1;
  calls.failHosts = new Set();
  calls.duringConnect = null;
  vi.useFakeTimers(); // the store starts a 30s save interval at import
  vi.stubGlobal("window", { wharf: wharfStub });
  vi.resetModules();
  store = await import("./store");
  scrollback = await import("../components/Terminal/scrollbackRegistry");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("replaceLeaf", () => {
  it("swaps one leaf in place, keeping the tree's shape and sizes", () => {
    const tree: PaneNode = {
      type: "split",
      id: "root",
      direction: "row",
      sizes: [1, 3],
      children: [leaf("a"), { type: "split", id: "inner", direction: "column", children: [leaf("b"), leaf("c")] }],
    };
    expect(store.replaceLeaf(tree, "b", "z")).toEqual({
      ...tree,
      children: [leaf("a"), { type: "split", id: "inner", direction: "column", children: [leaf("z"), leaf("c")] }],
    });
  });

  it("returns an equal tree when the session isn't in it", () => {
    const tree: PaneNode = { type: "split", id: "s", direction: "row", children: [leaf("a"), leaf("b")] };
    expect(store.replaceLeaf(tree, "nope", "z")).toEqual(tree);
    expect(store.replaceLeaf(leaf("a"), "a", "z")).toEqual(leaf("z"));
  });
});

describe("reconnectPanes", () => {
  it("replaces a dropped pane with a fresh session to the same host, keeping its history and theme", async () => {
    setState([{ tabId: "t1", layout: leaf("old"), activePaneId: "old" }], {
      old: meta({ closed: true, closeError: "reset", themeId: "nord", logPath: "/tmp/x.log" }),
    });
    const unregister = scrollback.registerScrollbackSource("old", () => "SCREEN CONTENT");
    await state().reconnectPanes("t1", ["old"]);
    unregister();

    expect(calls.sshConnect).toEqual(["h1"]);
    expect(calls.disconnected).toEqual(["old"]);
    const tab = state().tabs[0];
    expect(tab.layout).toEqual(leaf("new-1"));
    expect(tab.activePaneId).toBe("new-1");
    expect(state().paneMeta.old).toBeUndefined();
    const fresh = state().paneMeta["new-1"];
    expect(fresh).toMatchObject({
      hostId: "h1",
      title: "web",
      themeId: "nord",
      restoredScrollback: "SCREEN CONTENT",
      restoreNotice: "Reconnected to web",
    });
    expect(fresh.closed).toBeUndefined();
    expect(fresh.closeError).toBeUndefined();
    expect(fresh.logPath).toBeUndefined(); // logging belonged to the old session
    expect(fresh.restoredScrollbackCapturedAt).toBeGreaterThan(0);
  });

  it("reconnects a local shell with a new local shell, under its old title", async () => {
    setState([{ tabId: "t1", layout: leaf("old"), activePaneId: "old" }], {
      old: meta({ hostId: null, title: "Local Shell 2", closed: true }),
    });
    await state().reconnectPanes("t1", ["old"]);
    expect(calls.localConnect).toBe(1);
    expect(calls.sshConnect).toEqual([]);
    expect(state().paneMeta["new-1"]).toMatchObject({ hostId: null, title: "Local Shell 2" });
  });

  it("with no scrollback to carry over, just says it reconnected", async () => {
    setState([{ tabId: "t1", layout: leaf("old"), activePaneId: "old" }], { old: meta({ closed: true }) });
    await state().reconnectPanes("t1", ["old"]);
    const fresh = state().paneMeta["new-1"];
    expect(fresh.restoredScrollback).toBeUndefined();
    expect(fresh.restoredScrollbackCapturedAt).toBeUndefined();
    expect(fresh.restoreNotice).toBe("Reconnected to web");
  });

  it("only touches the panes it's given, leaving the rest of a split tab alone", async () => {
    const layout: PaneNode = { type: "split", id: "s", direction: "row", sizes: [2, 1], children: [leaf("p1"), leaf("p2")] };
    setState([{ tabId: "t1", layout, activePaneId: "p1", broadcastInput: true }], {
      p1: meta({ title: "web" }),
      p2: meta({ hostId: "h2", title: "db", closed: true }),
    });
    await state().reconnectPanes("t1", ["p2"]);
    expect(calls.sshConnect).toEqual(["h2"]);
    expect(calls.disconnected).toEqual(["p2"]);
    const tab = state().tabs[0];
    expect(tab.layout).toEqual({ ...layout, children: [leaf("p1"), leaf("new-1")] });
    expect(tab.activePaneId).toBe("p1");
    expect(tab.broadcastInput).toBe(true);
    expect(state().paneMeta.p1).toEqual(meta({ title: "web" }));
  });

  it("reconnects several panes one after another", async () => {
    const layout: PaneNode = { type: "split", id: "s", direction: "column", children: [leaf("p1"), leaf("p2")] };
    setState([{ tabId: "t1", layout, activePaneId: "p2" }], {
      p1: meta({ closed: true }),
      p2: meta({ hostId: "h2", title: "db", closed: true }),
    });
    await state().reconnectPanes("t1", ["p1", "p2"]);
    expect(calls.sshConnect).toEqual(["h1", "h2"]);
    expect(state().tabs[0].layout).toEqual({ ...layout, children: [leaf("new-1"), leaf("new-2")] });
    expect(state().tabs[0].activePaneId).toBe("new-2");
  });

  it("keeps the old pane and reports which one failed, while still reconnecting the others", async () => {
    const layout: PaneNode = { type: "split", id: "s", direction: "row", children: [leaf("p1"), leaf("p2")] };
    setState([{ tabId: "t1", layout, activePaneId: "p1" }], {
      p1: meta({ closed: true }),
      p2: meta({ hostId: "h2", title: "db", closed: true }),
    });
    calls.failHosts.add("h1");
    await expect(state().reconnectPanes("t1", ["p1", "p2"])).rejects.toThrow(/web: connection refused/);
    expect(state().tabs[0].layout).toEqual({ ...layout, children: [leaf("p1"), leaf("new-1")] });
    expect(state().paneMeta.p1.closed).toBe(true);
    expect(calls.disconnected).toEqual(["p2"]); // the failed pane's old session was never touched
  });

  it("fails clearly when the pane's host was deleted, without connecting anything", async () => {
    setState([{ tabId: "t1", layout: leaf("old"), activePaneId: "old" }], { old: meta({ closed: true }) }, []);
    await expect(state().reconnectPanes("t1", ["old"])).rejects.toThrow(/web: this host was deleted/);
    expect(calls.sshConnect).toEqual([]);
    expect(state().tabs[0].layout).toEqual(leaf("old"));
  });

  it("drops the new session if the pane was closed while it was connecting", async () => {
    setState([{ tabId: "t1", layout: leaf("old"), activePaneId: "old" }], { old: meta({ closed: true }) });
    calls.duringConnect = () => state().tabs.length && store.useAppStore.setState({ tabs: [] });
    await state().reconnectPanes("t1", ["old"]);
    expect(calls.disconnected).toEqual(["new-1"]);
    expect(state().tabs).toEqual([]);
    expect(state().paneMeta["new-1"]).toBeUndefined();
  });

  it("ignores a session id that isn't open any more", async () => {
    setState([{ tabId: "t1", layout: leaf("a"), activePaneId: "a" }], { a: meta() });
    await state().reconnectPanes("t1", ["ghost"]);
    expect(calls.sshConnect).toEqual([]);
  });

  it("can reconnect a pane that is still connected (a hung one)", async () => {
    setState([{ tabId: "t1", layout: leaf("old"), activePaneId: "old" }], { old: meta() });
    await state().reconnectPanes("t1", ["old"]);
    expect(calls.disconnected).toEqual(["old"]);
    expect(state().tabs[0].layout).toEqual(leaf("new-1"));
  });
});
