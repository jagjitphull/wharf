export { AUTO_LOCK_CHOICES, normalizeAutoLockMinutes } from "../../shared/autoLock";

interface Deps {
  /** Minutes of inactivity before locking; 0 = never. Read on every check, so a change applies at once. */
  minutes(): number;
  /** Whether there is anything to lock (a master password is set and entered). */
  isUnlocked(): boolean;
  lock(): void;
  /** Runs after it locked, e.g. to tell the windows to show the lock screen. */
  onLocked(): void;
  now(): number;
}

/**
 * Locks the master password after a period without activity. Windows report
 * activity (typing, clicking) with `touch()`; a timer calls `check()`.
 */
export function createAutoLock(deps: Deps) {
  let lastActivity = deps.now();
  return {
    touch(): void {
      lastActivity = deps.now();
    },

    /** Locks if it has been idle too long; returns whether it did. */
    check(): boolean {
      const minutes = deps.minutes();
      if (minutes <= 0 || !deps.isUnlocked()) return false;
      if (deps.now() - lastActivity < minutes * 60_000) return false;
      deps.lock();
      deps.onLocked();
      return true;
    },
  };
}
