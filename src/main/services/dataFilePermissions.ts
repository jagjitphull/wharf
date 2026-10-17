import { chmodSync, existsSync, statSync } from "node:fs";

/**
 * Makes Wharf's data directory and data file readable and writable by the
 * owner only. The store library creates the file with mode 0666 (so, with a
 * typical 022 umask, world-readable), and that file holds every saved host
 * and — on a machine without an OS keyring — the saved passwords too. Anyone
 * else on the machine who could read it could take them; anyone who could
 * write it could repoint a saved host at a machine of their choosing.
 *
 * Existing installs get fixed on the next launch, and the mode is also passed
 * to the store so new writes keep it. Returns what it changed, for the log.
 * A filesystem that has no Unix permissions (or a path that can't be changed)
 * is left alone: this is a safeguard, not something startup should fail on.
 */
export function restrictToOwner(dir: string, file: string): string[] {
  const changed: string[] = [];
  const tighten = (target: string, mode: number) => {
    try {
      if (!existsSync(target)) return;
      if ((statSync(target).mode & 0o777) === mode) return;
      chmodSync(target, mode);
      changed.push(target);
    } catch {
      /* not ours to change, or no permission bits here */
    }
  };
  tighten(dir, 0o700);
  tighten(file, 0o600);
  return changed;
}
