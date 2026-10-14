export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * A saved x/y only means something if it still lands on a currently
 * connected display — e.g. the position was last saved while docked to a
 * second monitor that's since been unplugged. Restoring it verbatim then
 * plants the window fully off every connected screen: it opens and runs,
 * but the user can't see or reach it, with no built-in way back short of
 * editing the data file by hand.
 *
 * True if `bounds` overlaps any of the given display work areas by at
 * least a pixel (touching edges don't count).
 */
export function isOnscreen(bounds: Rect, workAreas: Rect[]): boolean {
  return workAreas.some(
    (area) =>
      bounds.x < area.x + area.width &&
      bounds.x + bounds.width > area.x &&
      bounds.y < area.y + area.height &&
      bounds.y + bounds.height > area.y,
  );
}
