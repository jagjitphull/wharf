import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PaneMeta, TerminalTab } from "./store";

const calls = vi.hoisted(() => ({
  disconnected: [] as string[],
  created: [] as { name: string; tabs: unknown[] }[],
}));

const noop = () => () => {};
const wharfStub = {
  ssh: {
    disconnect: async (id: string) => {
      calls.disconnected.push(id);
    },
    onClosed: noop,
    onReconnecting: noop,
    onReconnected: noop,
  },
  workspaces: {
    create: async (input: { name: string; tabs: unknown[] }) => {
      calls.created.push(input);
    },
    list: async () => [],
  },
  session: { saveLast: async () => {}, onFlushRequest: noop, flushed: () => {} },
};

let store: typeof import("./store");

const tab = (id: string, over: Partial<TerminalTab> = {}): TerminalTab => ({
  tabId: id,
  layout: { type: "leaf", sessionId: `s-${id}` },
  activePaneId: `s-${id}`,
  ...over,
});
const pane = (title: string): PaneMeta => ({ hostId: null, title, connectedAt: 1 });
const ids = (tabs: TerminalTab[]) => tabs.map((t) => t.tabId);
const state = () => store.useAppStore.getState();
const load = (tabs: TerminalTab[]) =>
  store.useAppStore.setState({
    tabs,
    activeTabId: tabs[0]?.tabId ?? null,
    paneMeta: Object.fromEntries(tabs.map((t) => [`s-${t.tabId}`, pane(`title ${t.tabId}`)])),
  });

beforeEach(async () => {
  calls.disconnected = [];
  calls.created = [];
  vi.useFakeTimers(); // the store starts a 30s save interval at import
  vi.stubGlobal("window", { wharf: wharfStub });
  vi.resetModules();
  store = await import("./store");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("reorderForPin", () => {
  const tabs = [tab("a"), tab("b"), tab("c"), tab("d")];

  it("pins a tab to the end of the pinned block", () => {
    const one = store.reorderForPin(tabs, "c", true);
    expect(ids(one)).toEqual(["c", "a", "b", "d"]);
    const two = store.reorderForPin(one, "d", true);
    expect(ids(two)).toEqual(["c", "d", "a", "b"]);
    expect(two.filter((t) => t.pinned).map((t) => t.tabId)).toEqual(["c", "d"]);
  });

  it("unpinning puts the tab first among the unpinned ones", () => {
    const pinned = store.reorderForPin(store.reorderForPin(tabs, "c", true), "d", true); // c d a b
    const result = store.reorderForPin(pinned, "c", false);
    expect(ids(result)).toEqual(["d", "c", "a", "b"]);
    expect(result.find((t) => t.tabId === "c")!.pinned).toBeUndefined();
  });

  it("takes a pinned tab out of its group, and leaves the input alone", () => {
    const grouped = [tab("a"), tab("b", { groupId: "g" })];
    const result = store.reorderForPin(grouped, "b", true);
    expect(result[0].groupId).toBeUndefined();
    expect(grouped[1].groupId).toBe("g");
    expect(ids(grouped)).toEqual(["a", "b"]);
  });

  it("ignores a tab that doesn't exist", () => {
    expect(store.reorderForPin(tabs, "zzz", true)).toBe(tabs);
  });
});

describe("moveTabBy", () => {
  it("swaps with the neighbour in either direction", () => {
    const tabs = [tab("a"), tab("b"), tab("c")];
    expect(ids(store.moveTabBy(tabs, "b", 1))).toEqual(["a", "c", "b"]);
    expect(ids(store.moveTabBy(tabs, "b", -1))).toEqual(["b", "a", "c"]);
  });

  it("does nothing at either end", () => {
    const tabs = [tab("a"), tab("b")];
    expect(store.moveTabBy(tabs, "a", -1)).toBe(tabs);
    expect(store.moveTabBy(tabs, "b", 1)).toBe(tabs);
  });

  it("won't carry a tab across the pinned boundary", () => {
    const tabs = [tab("p", { pinned: true }), tab("a"), tab("b")];
    expect(store.moveTabBy(tabs, "a", -1)).toBe(tabs);
    expect(store.moveTabBy(tabs, "p", 1)).toBe(tabs);
    expect(ids(store.moveTabBy(tabs, "a", 1))).toEqual(["p", "b", "a"]);
  });
});

describe("tab actions", () => {
  it("setTabPinned pins, unpins, and drops a group that loses its only member", () => {
    load([tab("a"), tab("b", { groupId: "g" })]);
    store.useAppStore.setState({ tabGroups: [{ id: "g", name: "G", color: "#fff", collapsed: false }] });
    state().setTabPinned("b", true);
    expect(ids(state().tabs)).toEqual(["b", "a"]);
    expect(state().tabs[0]).toMatchObject({ pinned: true, groupId: undefined });
    expect(state().tabGroups).toEqual([]);
    state().setTabPinned("b", false);
    expect(state().tabs.find((t) => t.tabId === "b")!.pinned).toBeUndefined();
  });

  it("setTabPinned keeps a group that still has other members", () => {
    load([tab("a", { groupId: "g" }), tab("b", { groupId: "g" })]);
    store.useAppStore.setState({ tabGroups: [{ id: "g", name: "G", color: "#fff", collapsed: false }] });
    state().setTabPinned("a", true);
    expect(state().tabGroups).toHaveLength(1);
    expect(state().tabs.find((t) => t.tabId === "b")!.groupId).toBe("g");
  });

  it("renameTab sets a trimmed name and clears it when blank", () => {
    load([tab("a")]);
    state().renameTab("a", "  prod db  ");
    expect(state().tabs[0].customTitle).toBe("prod db");
    state().renameTab("a", "   ");
    expect(state().tabs[0].customTitle).toBeUndefined();
  });

  it("renamePane renames one pane and ignores a blank name", () => {
    load([tab("a")]);
    state().renamePane("s-a", " web 2 ");
    expect(state().paneMeta["s-a"].title).toBe("web 2");
    state().renamePane("s-a", "  ");
    expect(state().paneMeta["s-a"].title).toBe("web 2");
    state().renamePane("ghost", "x"); // no such pane: nothing happens
    expect(Object.keys(state().paneMeta)).toEqual(["s-a"]);
  });

  it("moveTab moves within the block and leaves the array alone otherwise", () => {
    load([tab("a"), tab("b"), tab("c")]);
    state().moveTab("a", "right");
    expect(ids(state().tabs)).toEqual(["b", "a", "c"]);
    const before = state().tabs;
    state().moveTab("b", "left");
    expect(state().tabs).toBe(before);
  });

  it("setTabColor sets and clears", () => {
    load([tab("a"), tab("b")]);
    state().setTabColor("a", "#e0575f");
    expect(state().tabs.map((t) => t.color)).toEqual(["#e0575f", undefined]);
    state().setTabColor("a", undefined);
    expect(state().tabs[0].color).toBeUndefined();
  });

  it("closeTabsToRight closes only the unpinned tabs after this one", async () => {
    load([tab("a"), tab("b"), tab("c"), tab("d"), tab("e")]);
    state().setTabPinned("e", true); // e a b c d
    await state().closeTabsToRight("a");
    expect(ids(state().tabs)).toEqual(["e", "a"]);
    expect(calls.disconnected.sort()).toEqual(["s-b", "s-c", "s-d"]);
  });

  it("closeTabsToRight from a pinned tab spares the other pinned ones", async () => {
    load([tab("a"), tab("b"), tab("c")]);
    state().setTabPinned("a", true);
    state().setTabPinned("b", true); // a b c
    await state().closeTabsToRight("a");
    expect(ids(state().tabs)).toEqual(["a", "b"]);
  });

  it("closeTabsToRight on the last tab does nothing", async () => {
    load([tab("a"), tab("b")]);
    await state().closeTabsToRight("b");
    expect(ids(state().tabs)).toEqual(["a", "b"]);
    expect(calls.disconnected).toEqual([]);
  });

  it("dragging can't reorder a tab across the pinned boundary", () => {
    load([tab("p", { pinned: true }), tab("a"), tab("b")]);
    state().reorderTab("a", "p");
    expect(ids(state().tabs)).toEqual(["p", "a", "b"]);
    state().reorderTab("b", "a");
    expect(ids(state().tabs)).toEqual(["p", "b", "a"]);
  });

  it("saving one tab as a workspace stores just that tab; with no list it stores all", async () => {
    load([tab("a"), tab("b"), tab("c")]);
    await state().saveCurrentAsWorkspace("only b", ["b"]);
    expect(calls.created[0]).toEqual({ name: "only b", tabs: [{ layout: { type: "leaf", hostId: null } }] });
    await state().saveCurrentAsWorkspace("everything");
    expect(calls.created[1].tabs).toHaveLength(3);
  });
});
