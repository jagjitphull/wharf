import { beforeEach, describe, expect, it } from "vitest";
import { AUTO_LOCK_CHOICES, createAutoLock, normalizeAutoLockMinutes } from "./autoLock";

const MIN = 60_000;
let now: number;
let minutes: number;
let unlocked: boolean;
let locks: number;
let notified: number;
let autoLock: ReturnType<typeof createAutoLock>;

beforeEach(() => {
  now = 1_000_000;
  minutes = 15;
  unlocked = true;
  locks = 0;
  notified = 0;
  autoLock = createAutoLock({
    minutes: () => minutes,
    isUnlocked: () => unlocked,
    lock: () => {
      locks++;
      unlocked = false;
    },
    onLocked: () => notified++,
    now: () => now,
  });
});

describe("auto-lock", () => {
  it("does nothing before the idle time is up", () => {
    now += 14 * MIN + 59_000;
    expect(autoLock.check()).toBe(false);
    expect(locks).toBe(0);
  });

  it("locks once the idle time is up, and tells the windows", () => {
    now += 15 * MIN;
    expect(autoLock.check()).toBe(true);
    expect([locks, notified]).toEqual([1, 1]);
  });

  it("activity pushes the deadline back", () => {
    now += 14 * MIN;
    autoLock.touch();
    now += 14 * MIN;
    expect(autoLock.check()).toBe(false);
    now += 1 * MIN;
    expect(autoLock.check()).toBe(true);
  });

  it("never locks when set to 0", () => {
    minutes = 0;
    now += 1000 * MIN;
    expect(autoLock.check()).toBe(false);
  });

  it("does nothing when there is nothing to lock (no master password, or already locked)", () => {
    unlocked = false;
    now += 1000 * MIN;
    expect(autoLock.check()).toBe(false);
    expect(locks).toBe(0);
  });

  it("unlocking is activity, so it doesn't lock again at once", () => {
    now += 20 * MIN;
    autoLock.check();
    unlocked = true; // the user entered the password…
    autoLock.touch(); // …which the caller reports as activity
    expect(autoLock.check()).toBe(false);
  });

  it("follows a changed setting straight away", () => {
    now += 6 * MIN;
    expect(autoLock.check()).toBe(false);
    minutes = 5;
    expect(autoLock.check()).toBe(true);
  });
});

describe("normalizeAutoLockMinutes", () => {
  it("keeps the offered choices and falls back to never for anything else", () => {
    for (const c of AUTO_LOCK_CHOICES) expect(normalizeAutoLockMinutes(c)).toBe(c);
    expect(normalizeAutoLockMinutes(7)).toBe(0);
    expect(normalizeAutoLockMinutes("15")).toBe(15);
    expect(normalizeAutoLockMinutes(undefined)).toBe(0);
    expect(normalizeAutoLockMinutes(-5)).toBe(0);
  });
});
