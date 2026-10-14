import type { IDecoration, Terminal as XTerm } from "@xterm/xterm";
import type { KeywordRule } from "../../state/keywordHighlightStore";

export interface CompiledRule {
  color: string;
  regex: RegExp;
}

/** Compiles enabled rules into ready-to-run regexes, silently dropping any
 * whose pattern is empty or isn't valid regex syntax (a bad custom pattern
 * shouldn't be able to crash the terminal — it just won't highlight). */
export function compileRules(rules: KeywordRule[]): CompiledRule[] {
  const compiled: CompiledRule[] = [];
  for (const rule of rules) {
    if (!rule.enabled || !rule.pattern.trim()) continue;
    try {
      compiled.push({ color: rule.color, regex: new RegExp(rule.pattern, "gi") });
    } catch {
      continue;
    }
  }
  return compiled;
}

export interface HighlightScanState {
  /** Absolute buffer row index last scanned, so scanAfterWrite only looks at what's new. */
  lastScannedAbsRow: number;
  decorationsByRow: Map<number, IDecoration[]>;
}

export function createHighlightState(): HighlightScanState {
  return { lastScannedAbsRow: -1, decorationsByRow: new Map() };
}

export function disposeAllDecorations(state: HighlightScanState): void {
  for (const decorations of state.decorationsByRow.values()) {
    for (const d of decorations) d.dispose();
  }
  state.decorationsByRow.clear();
  state.lastScannedAbsRow = -1;
}

function scanRow(term: XTerm, absRow: number, rules: CompiledRule[], state: HighlightScanState): void {
  // Re-scanning a row (e.g. a `\r`-redrawn progress line, or a rule change)
  // always starts from a clean slate for that row rather than layering more
  // decorations on top of stale ones.
  const existing = state.decorationsByRow.get(absRow);
  if (existing) {
    for (const d of existing) d.dispose();
    state.decorationsByRow.delete(absRow);
  }
  if (rules.length === 0) return;

  const line = term.buffer.active.getLine(absRow);
  if (!line) return;
  const text = line.translateToString(true);
  if (!text) return;

  const offset = absRow - (term.buffer.active.baseY + term.buffer.active.cursorY);
  const created: IDecoration[] = [];
  for (const rule of rules) {
    rule.regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = rule.regex.exec(text))) {
      const len = match[0].length;
      if (len === 0) {
        rule.regex.lastIndex++;
        continue;
      }
      const marker = term.registerMarker(offset);
      if (!marker) continue;
      const decoration = term.registerDecoration({
        marker,
        x: match.index,
        width: len,
        backgroundColor: rule.color,
        layer: "bottom", // paint behind the glyphs, like a highlighter pen, not over them
      });
      if (decoration) created.push(decoration);
      else marker.dispose();
    }
  }
  if (created.length > 0) state.decorationsByRow.set(absRow, created);
}

/** Caps how many rows a single write's worth of new output can trigger a
 * scan over — a `cat` of a huge file shouldn't synchronously regex-scan
 * thousands of lines in one go. Falls back to just the most recent rows. */
const MAX_ROWS_PER_SCAN = 300;

/** Called after each `term.write()` completes: scans every row that became
 * "new" since the last scan (capped), plus the row the cursor is currently
 * on (its content may have changed without the cursor moving to a new row —
 * e.g. output with no trailing newline yet). */
export function scanAfterWrite(term: XTerm, rules: CompiledRule[], state: HighlightScanState): void {
  if (rules.length === 0) return;
  const buf = term.buffer.active;
  const currentAbsRow = buf.baseY + buf.cursorY;
  const from = Math.max(state.lastScannedAbsRow + 1, currentAbsRow - MAX_ROWS_PER_SCAN + 1);
  for (let row = Math.min(from, currentAbsRow); row <= currentAbsRow; row++) {
    scanRow(term, row, rules, state);
  }
  state.lastScannedAbsRow = currentAbsRow;
}

/** Rescans just the visible viewport — used when the ruleset itself changes
 * (a rule toggled, recolored, or edited), so what's on screen updates
 * immediately without re-scanning the whole, potentially large, scrollback
 * (off-screen rows pick up the new ruleset next time they're scrolled past
 * new output, or reappear via scanAfterWrite). */
export function rescanViewport(term: XTerm, rules: CompiledRule[], state: HighlightScanState): void {
  disposeAllDecorations(state);
  if (rules.length === 0) return;
  const buf = term.buffer.active;
  for (let row = buf.viewportY; row <= buf.viewportY + term.rows - 1; row++) {
    scanRow(term, row, rules, state);
  }
  state.lastScannedAbsRow = buf.baseY + buf.cursorY;
}
