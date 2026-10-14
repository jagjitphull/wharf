import { describe, expect, it } from "vitest";
import { FakeTerm } from "../../testing/fakeXterm";
import { createCommandBlocksState, decodeOsc133CommandText, handleOsc133, notePendingCommand, readBlockOutput } from "./commandBlocks";

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");

describe("decodeOsc133CommandText", () => {
  it("decodes base64 UTF-8 text", () => {
    expect(decodeOsc133CommandText(b64("echo héllo ✓"))).toBe("echo héllo ✓");
  });

  it("returns undefined for a missing, empty or undecodable argument", () => {
    expect(decodeOsc133CommandText(undefined)).toBeUndefined();
    expect(decodeOsc133CommandText("")).toBeUndefined();
    expect(decodeOsc133CommandText("%%%not-base64%%%")).toBeUndefined();
    expect(decodeOsc133CommandText(b64(""))).toBeUndefined();
  });
});

describe("handleOsc133", () => {
  it("opens a block on C and closes it with the exit code on D", () => {
    const term = new FakeTerm();
    const state = createCommandBlocksState();

    const opened = handleOsc133(term.asXterm(), state, `C;${b64("ls")}`);
    expect(opened).toHaveLength(1);
    expect(opened![0]).toMatchObject({ command: "ls", exitCode: null, endMarker: null });
    expect(state.openBlockId).toBe(opened![0].id);

    const closed = handleOsc133(term.asXterm(), state, "D;2");
    expect(closed).toHaveLength(1);
    expect(closed![0]).toMatchObject({ command: "ls", exitCode: 2 });
    expect(closed![0].endMarker).not.toBeNull();
    expect(state.openBlockId).toBeNull();
  });

  it("makes no change on A and B", () => {
    const term = new FakeTerm();
    const state = createCommandBlocksState();
    expect(handleOsc133(term.asXterm(), state, "A")).toBeNull();
    expect(handleOsc133(term.asXterm(), state, "B")).toBeNull();
    expect(state.blocks).toEqual([]);
  });

  it("prefers the shell's own command text over the keystroke guess", () => {
    const term = new FakeTerm();
    const state = createCommandBlocksState();
    notePendingCommand(state, "gi\t");
    const blocks = handleOsc133(term.asXterm(), state, `C;${b64("git status")}`);
    expect(blocks![0].command).toBe("git status");
    expect(state.pendingCommand).toBeNull();
  });

  it("falls back to the keystroke guess for a bare C", () => {
    const term = new FakeTerm();
    const state = createCommandBlocksState();
    notePendingCommand(state, "uptime");
    expect(handleOsc133(term.asXterm(), state, "C")![0].command).toBe("uptime");
  });

  it("skips the shell's startup C/D before any real command", () => {
    const term = new FakeTerm();
    const state = createCommandBlocksState();
    expect(handleOsc133(term.asXterm(), state, "C")).toBeNull();
    expect(handleOsc133(term.asXterm(), state, "D;0")).toBeNull();
    expect(state.blocks).toEqual([]);
  });

  it("uses a placeholder for an unpaired C once a real command has run", () => {
    const term = new FakeTerm();
    const state = createCommandBlocksState();
    handleOsc133(term.asXterm(), state, `C;${b64("ls")}`);
    handleOsc133(term.asXterm(), state, "D;0");
    const blocks = handleOsc133(term.asXterm(), state, "C");
    expect(blocks).toHaveLength(2);
    expect(blocks![1].command).toBe("(unknown command)");
  });

  it("ignores a second C while a block is open, and a D with none open", () => {
    const term = new FakeTerm();
    const state = createCommandBlocksState();
    expect(handleOsc133(term.asXterm(), state, "D;0")).toBeNull();
    handleOsc133(term.asXterm(), state, `C;${b64("one")}`);
    expect(handleOsc133(term.asXterm(), state, `C;${b64("two")}`)).toBeNull();
    expect(state.blocks).toHaveLength(1);
  });

  it("records a null exit code for a D without one or with garbage", () => {
    const term = new FakeTerm();
    const state = createCommandBlocksState();
    handleOsc133(term.asXterm(), state, `C;${b64("a")}`);
    expect(handleOsc133(term.asXterm(), state, "D")![0].exitCode).toBeNull();
    handleOsc133(term.asXterm(), state, `C;${b64("b")}`);
    expect(handleOsc133(term.asXterm(), state, "D;abc")![1].exitCode).toBeNull();
  });

  it("keeps the newest 200 blocks and disposes the markers of those dropped", () => {
    const term = new FakeTerm();
    const state = createCommandBlocksState();
    for (let i = 0; i < 205; i++) {
      handleOsc133(term.asXterm(), state, `C;${b64(`cmd${i}`)}`);
      handleOsc133(term.asXterm(), state, "D;0");
    }
    expect(state.blocks).toHaveLength(200);
    expect(state.blocks[0].command).toBe("cmd5");
    expect(state.blocks[199].command).toBe("cmd204");
    // Markers are registered in order (start, end, start, end, ...): the first
    // five blocks' ten markers belong to the dropped blocks.
    expect(term.markers.slice(0, 10).every((m) => m.isDisposed)).toBe(true);
    expect(term.markers.slice(10).some((m) => m.isDisposed)).toBe(false);
  });
});

describe("readBlockOutput", () => {
  function runCommand(term: FakeTerm, outputRows: string[]) {
    const state = createCommandBlocksState();
    term.print("$ cmd"); // the echoed command row
    term.cursorY = term.lines.length; // cursor on the first output row when ;C fires
    handleOsc133(term.asXterm(), state, `C;${b64("cmd")}`);
    term.print(...outputRows);
    term.cursorY = term.lines.length; // prompt row after the output
    return state;
  }

  it("reads the rows between the start and end markers", () => {
    const term = new FakeTerm();
    const state = runCommand(term, ["line one", "line two"]);
    handleOsc133(term.asXterm(), state, "D;0");
    expect(readBlockOutput(term.asXterm(), state.blocks[0])).toBe("line one\nline two");
  });

  it("reads down to the last row while the command is still running", () => {
    const term = new FakeTerm();
    const state = runCommand(term, ["partial"]);
    expect(readBlockOutput(term.asXterm(), state.blocks[0])).toBe("partial");
  });

  it("trims blank rows below short output", () => {
    const term = new FakeTerm();
    const state = runCommand(term, ["out", "", ""]);
    handleOsc133(term.asXterm(), state, "D;0");
    expect(readBlockOutput(term.asXterm(), state.blocks[0])).toBe("out");
  });

  it("returns an empty string once the block has scrolled out of scrollback", () => {
    const term = new FakeTerm();
    const state = runCommand(term, ["out"]);
    state.blocks[0].startMarker.dispose();
    expect(readBlockOutput(term.asXterm(), state.blocks[0])).toBe("");
  });
});
