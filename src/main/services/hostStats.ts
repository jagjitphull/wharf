import type { Client } from "ssh2";
import { BrowserWindow } from "electron";
import { IPC, type HostStatsSnapshot } from "../../shared/types";
import { getClientForSession } from "./sshManager";

/**
 * Lightweight, periodic CPU-load/memory/disk readout for whichever SSH pane
 * currently has focus — polled via a plain `exec` on the session's already-
 * open connection (never touches the interactive shell channel, so it can't
 * interleave with or disturb anything the user is actually doing). Off by
 * default for every session; the renderer starts/stops it as focus moves
 * between panes (see StatusBar.tsx), so at most one host is ever polled.
 *
 * Linux-only commands (/proc/loadavg, `free`) — on a remote where either is
 * missing (macOS, a minimal container image, a restricted shell) that
 * particular field just comes back null rather than erroring the whole
 * poll; `df` is POSIX and works everywhere a real disk exists.
 */

const POLL_INTERVAL_MS = 5_000;
const timers = new Map<string, NodeJS.Timeout>();

function broadcast(sessionId: string, stats: HostStatsSnapshot | null, error?: string): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IPC.hostStats.onUpdate, { sessionId, stats, error });
  }
}

function execOnce(client: Client, command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    client.exec(command, (err, stream) => {
      if (err) return reject(err);
      let out = "";
      stream.on("data", (chunk: Buffer) => {
        out += chunk.toString("utf8");
      });
      stream.stderr.on("data", () => {
        /* command-not-found noise from a missing tool on this remote — the field just comes back null below */
      });
      stream.on("close", () => resolve(out));
      stream.on("error", reject);
    });
  });
}

// Each field is best-effort and independently optional — piped through `||
// true` so one missing tool doesn't blank out the fields after it. The '|'
// separators are fixed markers to split the combined output on.
const STATS_COMMAND = [
  "cat /proc/loadavg 2>/dev/null",
  "echo '|'",
  "(free -m 2>/dev/null | awk '/^Mem:/{print $2, $3}') || true",
  "echo '|'",
  "(df -P . 2>/dev/null | awk 'NR==2{print $5}') || true",
].join("; ");

function parseStats(raw: string): HostStatsSnapshot {
  const [loadPart = "", memPart = "", diskPart = ""] = raw.split("|").map((s) => s.trim());

  const loadMatch = loadPart.match(/^([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
  const loadAvg: HostStatsSnapshot["loadAvg"] = loadMatch
    ? [Number(loadMatch[1]), Number(loadMatch[2]), Number(loadMatch[3])]
    : null;

  const memMatch = memPart.match(/^(\d+)\s+(\d+)/);
  const memTotalMb = memMatch ? Number(memMatch[1]) : null;
  const memUsedMb = memMatch ? Number(memMatch[2]) : null;

  const diskMatch = diskPart.match(/(\d+)%/);
  const diskUsePercent = diskMatch ? Number(diskMatch[1]) : null;

  return { loadAvg, memTotalMb, memUsedMb, diskUsePercent };
}

async function poll(sessionId: string): Promise<void> {
  const client = getClientForSession(sessionId);
  if (!client) {
    stop(sessionId); // session ended without going through stop() — don't keep polling a dead id
    return;
  }
  try {
    const raw = await execOnce(client, STATS_COMMAND);
    broadcast(sessionId, parseStats(raw));
  } catch (err) {
    broadcast(sessionId, null, err instanceof Error ? err.message : String(err));
  }
}

export function start(sessionId: string): void {
  if (timers.has(sessionId)) return;
  void poll(sessionId);
  timers.set(
    sessionId,
    setInterval(() => void poll(sessionId), POLL_INTERVAL_MS),
  );
}

export function stop(sessionId: string): void {
  const timer = timers.get(sessionId);
  if (timer) {
    clearInterval(timer);
    timers.delete(sessionId);
  }
}

export function stopAll(): void {
  for (const timer of timers.values()) clearInterval(timer);
  timers.clear();
}
