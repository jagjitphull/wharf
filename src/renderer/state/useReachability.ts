import { useEffect, useState } from "react";
import type { HostRecord } from "@shared/types";
import { wharf } from "../api/wharf";

export type Reachability = "checking" | "online" | "offline";

/**
 * Live reachability of each host: a raw TCP probe of hostname:port (no SSH
 * handshake, so it can never trigger a host-key prompt or an auth attempt —
 * just "did something answer"). Probes fresh on mount and whenever the host
 * list changes, rather than caching, since the point is current status.
 */
export function useReachability(hosts: HostRecord[]): Record<string, Reachability> {
  const [state, setState] = useState<Record<string, Reachability>>({});

  useEffect(() => {
    let cancelled = false;
    setState(Object.fromEntries(hosts.map((h) => [h.id, "checking" as const])));
    for (const host of hosts) {
      void wharf.hosts.checkReachable(host.hostname, host.port).then((reachable) => {
        if (cancelled) return;
        setState((prev) => ({ ...prev, [host.id]: reachable ? "online" : "offline" }));
      });
    }
    return () => {
      cancelled = true;
    };
  }, [hosts]);

  return state;
}

export const REACHABILITY_LABEL: Record<Reachability, string> = {
  checking: "Checking…",
  online: "Online",
  offline: "Offline / unreachable",
};
