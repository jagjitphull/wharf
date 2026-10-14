import { describe, expect, it } from "vitest";
import { isOnscreen } from "./windowBounds";

const primary = { x: 0, y: 0, width: 1920, height: 1080 };
// A second monitor to the right, and one above-left using negative coordinates
// (multi-monitor layouts routinely put displays at negative x/y).
const right = { x: 1920, y: 0, width: 1280, height: 1024 };
const aboveLeft = { x: -1600, y: -900, width: 1600, height: 900 };

const win = (x: number, y: number, width = 1280, height = 800) => ({ x, y, width, height });

describe("isOnscreen", () => {
  it("accepts a window fully inside a display", () => {
    expect(isOnscreen(win(100, 100), [primary])).toBe(true);
  });

  it("accepts a window that only partly overlaps a display", () => {
    expect(isOnscreen(win(1800, 900), [primary])).toBe(true);
    expect(isOnscreen(win(-1000, -700), [primary])).toBe(true);
  });

  it("rejects a window fully off to the right, below, left or above", () => {
    expect(isOnscreen(win(9000, 100), [primary])).toBe(false);
    expect(isOnscreen(win(100, 9000), [primary])).toBe(false);
    expect(isOnscreen(win(-5000, 100), [primary])).toBe(false);
    expect(isOnscreen(win(100, -5000), [primary])).toBe(false);
  });

  it("treats merely touching a display's edge as off-screen", () => {
    expect(isOnscreen(win(1920, 0), [primary])).toBe(false);
    expect(isOnscreen(win(-1280, 0), [primary])).toBe(false);
    expect(isOnscreen(win(0, 1080), [primary])).toBe(false);
    expect(isOnscreen(win(0, -800), [primary])).toBe(false);
  });

  it("is the unplugged-second-monitor case: valid with it connected, off-screen once it's gone", () => {
    const savedOnSecondMonitor = win(2200, 100);
    expect(isOnscreen(savedOnSecondMonitor, [primary, right])).toBe(true);
    expect(isOnscreen(savedOnSecondMonitor, [primary])).toBe(false);
  });

  it("handles displays at negative coordinates", () => {
    expect(isOnscreen(win(-1500, -800), [primary, aboveLeft])).toBe(true);
    expect(isOnscreen(win(-1500, -800), [primary])).toBe(false);
  });

  it("is on-screen if any one of several displays shows it", () => {
    expect(isOnscreen(win(2000, 50), [primary, right, aboveLeft])).toBe(true);
  });

  it("is off-screen when there are no displays to show it", () => {
    expect(isOnscreen(win(0, 0), [])).toBe(false);
  });

  it("accepts a window larger than the display as long as it overlaps", () => {
    expect(isOnscreen(win(-200, -200, 4000, 3000), [primary])).toBe(true);
  });
});
