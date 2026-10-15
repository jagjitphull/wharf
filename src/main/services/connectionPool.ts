import type { Client } from "ssh2";
import { getHosts } from "./store";
import { connectHostClient, type EstablishedClient } from "./sshConnect";

/**
 * Real SSH connection multiplexing (the practical benefit of OpenSSH's
 * ControlMaster, implemented natively rather than by shelling out to the
 * system `ssh` and its control socket — this project talks SSH directly
 * via ssh2, which has no such concept built in): a second terminal tab, an
 * SFTP browse, or a tunnel against a host that's already connected reuses
 * that one authenticated transport (opening just a new channel on it)
 * instead of paying for a fresh TCP handshake + auth round trip.
 *
 * Scope, deliberately: this pools connections, not recovery. A drop means
 * the shared transport is dead, and each session/SFTP-pool/tunnel that was
 * using it detects that independently (ssh2's Client is a plain
 * EventEmitter; every listener on the same "error"/"close" fires for
 * everyone) and reconnects on its own backoff schedule (sshManager's
 * attemptReconnect goes back through acquireClient, so whoever retries
 * first dials and the others share that connection). Generalizing
 * reconnect itself to fan out across every dependent of a shared transport
 * would be a much bigger change for a benefit (fast reconnects) the
 * per-session backoff already provides. What this pool guarantees is the
 * common case that actually matters day to day: opening more sessions to
 * a host you're already connected to is instant.
 */

interface PooledConnection extends EstablishedClient {
  refCount: number;
}

const pool = new Map<string, PooledConnection>();

/** Dials currently in progress, by host. Without this, two callers asking for
 * the same not-yet-connected host at the same moment (two tunnels starting
 * together at launch, two tabs opened in quick succession) each dial their
 * own connection — two host-key prompts, and the second registration
 * replaces the first in `pool`, leaving that connection open but untracked,
 * so nothing would ever close it. */
const connecting = new Map<string, Promise<EstablishedClient>>();

/**
 * Returns a live, authenticated connection for `hostId` — an existing
 * pooled one if another caller already has one open, or a freshly
 * established one (registered here for the next caller to find). Callers
 * that arrive while a dial to the same host is still in progress wait for
 * it and share the result.
 *
 * Every successful call MUST be paired with exactly one `release(hostId)`
 * once the caller is done with it (on disconnect/stop/etc.) — the
 * underlying connection is only actually torn down once every acquirer
 * has released it.
 */
export async function acquireClient(hostId: string): Promise<EstablishedClient> {
  const existing = pool.get(hostId);
  if (existing) {
    existing.refCount++;
    return { client: existing.client, jumpClient: existing.jumpClient };
  }

  const inFlight = connecting.get(hostId);
  if (inFlight) {
    // If that dial failed, so does this call. Otherwise the connection is
    // pooled by now, and the recursive call just takes a reference to it.
    await inFlight;
    return acquireClient(hostId);
  }

  const host = getHosts().find((h) => h.id === hostId);
  if (!host) throw new Error(`Host ${hostId} not found`);

  const dial = connectHostClient(host)
    .then((established) => {
      const entry: PooledConnection = { ...established, refCount: 1 };
      pool.set(hostId, entry);

      established.client.on("close", () => {
        // Only remove this exact entry: by the time this fires, a later
        // acquireClient() call (e.g. a session that reconnected and happened
        // to re-register) may already have replaced it in the map, and that
        // one is very much still alive.
        if (pool.get(hostId) === entry) pool.delete(hostId);
      });

      return established;
    })
    .finally(() => connecting.delete(hostId));
  connecting.set(hostId, dial);
  return dial;
}

/** Releases one reference acquired via acquireClient for this host. */
export function releaseClient(hostId: string): void {
  const entry = pool.get(hostId);
  if (!entry) return;
  entry.refCount--;
  if (entry.refCount <= 0) {
    pool.delete(hostId);
    entry.client.end();
    entry.jumpClient?.end();
  }
}

/** Whether a live, shareable connection is currently pooled for this host — used for diagnostics/tests only, never to decide behavior. */
export function hasPooledClient(hostId: string): boolean {
  return pool.has(hostId);
}

/** Current reference count for a pooled host (0 if none) — diagnostics/tests only. */
export function poolRefCount(hostId: string): number {
  return pool.get(hostId)?.refCount ?? 0;
}

/** For a session's reference to be identifiably "the pooled one" (so
 * disconnect can tell whether to call releaseClient at all — a session
 * whose connection came from a reconnect, not the pool, must not release
 * a pool slot it never acquired). */
export function isPooledClient(hostId: string, client: Client): boolean {
  return pool.get(hostId)?.client === client;
}
