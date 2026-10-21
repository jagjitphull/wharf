/** Idle choices offered in Settings, in minutes; 0 means never lock by itself. */
export const AUTO_LOCK_CHOICES = [0, 5, 15, 30, 60, 240] as const;

/** Accepts whatever was stored and returns a value that is safe to use (0 = never). */
export function normalizeAutoLockMinutes(raw: unknown): number {
  const n = Number(raw);
  return (AUTO_LOCK_CHOICES as readonly number[]).includes(n) ? n : 0;
}
