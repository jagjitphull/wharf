import type { IDecoration, IDecorationOptions, IMarker, Terminal as XTerm } from "@xterm/xterm";

/** The slice of xterm's Terminal that commandBlocks.ts and keywordHighlight.ts
 * touch — enough to drive them without a DOM or a real renderer. Test-only;
 * nothing in the app imports it. */
export type FakeMarker = { -readonly [K in keyof IMarker]: IMarker[K] };

export interface FakeDecoration extends IDecoration {
  options: IDecorationOptions;
  disposed: boolean;
}

export class FakeTerm {
  /** Buffer contents, one string per row. */
  lines: string[] = [];
  rows = 24;
  baseY = 0;
  cursorY = 0;
  viewportY = 0;
  markers: FakeMarker[] = [];
  decorations: FakeDecoration[] = [];
  /** Makes registerDecoration return undefined, as xterm does for a marker that's off-screen. */
  refuseDecorations = false;

  // The scalar fields are live views (getters), so tests can move the cursor
  // or viewport after the terminal is created.
  readonly buffer = {
    active: Object.defineProperties(
      {
        getLine: (y: number) => {
          const text = this.lines[y];
          return text === undefined ? undefined : { translateToString: () => text };
        },
      },
      {
        baseY: { get: () => this.baseY },
        cursorY: { get: () => this.cursorY },
        viewportY: { get: () => this.viewportY },
      },
    ),
  };

  /** Appends output and leaves the cursor on the last row. */
  print(...rows: string[]): void {
    this.lines.push(...rows);
    this.cursorY = Math.max(0, this.lines.length - 1);
  }

  registerMarker(offset = 0): FakeMarker {
    const marker = {
      id: this.markers.length,
      line: this.baseY + this.cursorY + offset,
      isDisposed: false,
      onDispose: () => ({ dispose() {} }),
      dispose() {
        marker.isDisposed = true;
      },
    } as FakeMarker;
    this.markers.push(marker);
    return marker;
  }

  registerDecoration(options: IDecorationOptions): FakeDecoration | undefined {
    if (this.refuseDecorations) return undefined;
    const decoration = {
      options,
      disposed: false,
      dispose() {
        decoration.disposed = true;
      },
    } as unknown as FakeDecoration;
    this.decorations.push(decoration);
    return decoration;
  }

  get liveDecorations(): FakeDecoration[] {
    return this.decorations.filter((d) => !d.disposed);
  }

  asXterm(): XTerm {
    return this as unknown as XTerm;
  }
}
