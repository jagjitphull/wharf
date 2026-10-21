/**
 * The key derived from the master password, held only while unlocked. Lives in
 * its own module so secretStore.ts (saved passwords) and protectedData.ts
 * (History and workspaces) can share it without importing each other.
 */
let key: Buffer | null = null;

export function getUnlockedKey(): Buffer | null {
  return key;
}

export function setUnlockedKey(next: Buffer | null): void {
  key = next;
}
