import { describe, expect, it } from "vitest";
import { FakeTerm } from "../../testing/fakeXterm";
import type { KeywordRule } from "../../state/keywordHighlightStore";
import { compileRules, createHighlightState, disposeAllDecorations, rescanViewport, scanAfterWrite } from "./keywordHighlight";

const rule = (over: Partial<KeywordRule> = {}): KeywordRule => ({
  id: "r",
  label: "R",
  pattern: "error",
  color: "#ff0000",
  enabled: true,
  builtIn: false,
  ...over,
});

describe("compileRules", () => {
  it("compiles enabled rules case-insensitively", () => {
    const [compiled] = compileRules([rule({ pattern: "error" })]);
    expect(compiled.color).toBe("#ff0000");
    expect(compiled.regex.test("An ERROR occurred")).toBe(true);
  });

  it("drops disabled, empty and invalid rules without throwing", () => {
    expect(compileRules([rule({ enabled: false }), rule({ pattern: "   " }), rule({ pattern: "(" }), rule({ pattern: "[" })])).toEqual([]);
  });

  it("keeps the valid rules around the bad ones", () => {
    expect(compileRules([rule({ pattern: "(" }), rule({ pattern: "ok" })])).toHaveLength(1);
  });
});

describe("scanAfterWrite", () => {
  it("decorates each match with its column and width", () => {
    const term = new FakeTerm();
    term.print("an error and another ERROR");
    const state = createHighlightState();
    scanAfterWrite(term.asXterm(), compileRules([rule()]), state);
    expect(term.liveDecorations.map((d) => [d.options.x, d.options.width, d.options.backgroundColor])).toEqual([
      [3, 5, "#ff0000"],
      [21, 5, "#ff0000"],
    ]);
  });

  it("only looks at rows added since the last scan", () => {
    const term = new FakeTerm();
    const rules = compileRules([rule()]);
    const state = createHighlightState();
    term.print("error one");
    scanAfterWrite(term.asXterm(), rules, state);
    term.print("error two");
    scanAfterWrite(term.asXterm(), rules, state);
    expect(term.liveDecorations).toHaveLength(2);
    expect(state.decorationsByRow.get(0)).toHaveLength(1);
    expect(state.decorationsByRow.get(1)).toHaveLength(1);
  });

  it("replaces, not stacks, decorations when the cursor row is rewritten", () => {
    const term = new FakeTerm();
    const rules = compileRules([rule()]);
    const state = createHighlightState();
    term.print("error");
    scanAfterWrite(term.asXterm(), rules, state);
    scanAfterWrite(term.asXterm(), rules, state); // same row again (e.g. a \r redraw)
    expect(term.liveDecorations).toHaveLength(1);
  });

  it("does nothing with no rules", () => {
    const term = new FakeTerm();
    term.print("error");
    const state = createHighlightState();
    scanAfterWrite(term.asXterm(), [], state);
    expect(term.decorations).toEqual([]);
    expect(state.lastScannedAbsRow).toBe(-1);
  });

  it("doesn't loop forever on a pattern that can match nothing", () => {
    const term = new FakeTerm();
    term.print("abc");
    scanAfterWrite(term.asXterm(), compileRules([rule({ pattern: "x*" })]), createHighlightState());
    expect(term.decorations).toEqual([]);
  });

  it("disposes the marker when xterm refuses a decoration", () => {
    const term = new FakeTerm();
    term.refuseDecorations = true;
    term.print("error");
    scanAfterWrite(term.asXterm(), compileRules([rule()]), createHighlightState());
    expect(term.markers.every((m) => m.isDisposed)).toBe(true);
  });

  it("scans only the most recent 300 rows after a huge write", () => {
    const term = new FakeTerm();
    term.print(...Array.from({ length: 1000 }, () => "error"));
    const state = createHighlightState();
    scanAfterWrite(term.asXterm(), compileRules([rule()]), state);
    expect(term.liveDecorations).toHaveLength(300);
    expect(state.lastScannedAbsRow).toBe(999);
  });
});

describe("rescanViewport / disposeAllDecorations", () => {
  it("clears old decorations and re-applies the new ruleset to the viewport", () => {
    const term = new FakeTerm();
    term.rows = 2;
    term.print("error", "warning", "error");
    term.viewportY = 1;
    const state = createHighlightState();
    scanAfterWrite(term.asXterm(), compileRules([rule()]), state);
    const before = term.decorations.slice();

    rescanViewport(term.asXterm(), compileRules([rule({ pattern: "warning", color: "#00ff00" })]), state);
    expect(before.every((d) => d.disposed)).toBe(true);
    expect(term.liveDecorations.map((d) => d.options.backgroundColor)).toEqual(["#00ff00"]);
  });

  it("leaves nothing behind when the ruleset becomes empty", () => {
    const term = new FakeTerm();
    term.print("error");
    const state = createHighlightState();
    scanAfterWrite(term.asXterm(), compileRules([rule()]), state);
    rescanViewport(term.asXterm(), [], state);
    expect(term.liveDecorations).toEqual([]);
  });

  it("disposeAllDecorations resets the scan position", () => {
    const term = new FakeTerm();
    term.print("error");
    const state = createHighlightState();
    scanAfterWrite(term.asXterm(), compileRules([rule()]), state);
    disposeAllDecorations(state);
    expect(term.liveDecorations).toEqual([]);
    expect(state.lastScannedAbsRow).toBe(-1);
  });
});
