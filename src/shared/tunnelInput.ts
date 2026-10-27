import type { TunnelInput } from "./types";

const validPort = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 65535;

/** Why `input` can't be made into a tunnel, or null when it can. Shared by the dialog (to say so early) and the main process (which doesn't trust the dialog). */
export function validateTunnelInput(input: TunnelInput): string | null {
  if (!input.name?.trim()) return "Give the tunnel a name.";
  if (!input.hostId) return "Pick the host to tunnel through.";
  if (input.type !== "local" && input.type !== "remote" && input.type !== "dynamic") return "Unknown tunnel type.";
  if (!input.srcHost?.trim()) return "The address to listen on is empty.";
  if (!validPort(input.srcPort)) return "The listening port must be a number from 1 to 65535.";
  if (input.type !== "dynamic") {
    if (!input.dstHost?.trim()) return "The destination host is empty.";
    if (!validPort(input.dstPort)) return "The destination port must be a number from 1 to 65535.";
  }
  return null;
}
