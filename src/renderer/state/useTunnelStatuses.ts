import { useEffect, useState } from "react";
import type { TunnelStatus } from "@shared/types";
import { wharf } from "../api/wharf";

export type TunnelStatuses = Record<string, { status: TunnelStatus; error?: string }>;

/** Live state of every tunnel by id: what the main process already knows, then each change as it happens. */
export function useTunnelStatuses(): TunnelStatuses {
  const [statuses, setStatuses] = useState<TunnelStatuses>({});
  useEffect(() => {
    const off = wharf.tunnels.onState(({ tunnelId, status, error }) => setStatuses((prev) => ({ ...prev, [tunnelId]: { status, error } })));
    void wharf.tunnels.statuses().then((known) => {
      setStatuses((prev) => {
        const next = { ...prev };
        for (const { tunnelId, status, error } of known) next[tunnelId] ??= { status, error }; // a newer event wins
        return next;
      });
    });
    return off;
  }, []);
  return statuses;
}

/** Whether a tunnel in this state is up or on its way (as opposed to stopped or failed). */
export const isTunnelLive = (status: TunnelStatus | undefined): boolean =>
  status === "running" || status === "starting" || status === "reconnecting";
