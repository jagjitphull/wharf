import type { TunnelType } from "@shared/types";

/** Services people tunnel to most, offered as one-click destinations. */
export const SERVICE_PRESETS = [
  { label: "PostgreSQL", port: 5432 },
  { label: "MySQL", port: 3306 },
  { label: "Redis", port: 6379 },
  { label: "MongoDB", port: 27017 },
  { label: "Web", port: 80 },
  { label: "HTTPS", port: 443 },
  { label: "RDP", port: 3389 },
  { label: "VNC", port: 5900 },
] as const;

/**
 * The port to listen on locally for a service on `remotePort`: the same number
 * when it is an ordinary one (so `localhost:5432` stays Postgres), shifted up
 * for privileged ports (80 → 8080, 443 → 8443), and nudged past any in `used`.
 */
export function suggestLocalPort(remotePort: number, used: readonly number[]): number {
  let port = remotePort >= 1024 ? remotePort : remotePort === 80 ? 8080 : remotePort === 443 ? 8443 : 8000 + remotePort;
  const taken = new Set(used);
  while (taken.has(port) && port < 65535) port++;
  return port;
}

const isLoopback = (host: string): boolean => host === "127.0.0.1" || host === "localhost" || host === "::1";

/** A readable default name for a tunnel, so the form only needs a name typed when the default isn't enough. */
export function suggestTunnelName(hostName: string, type: TunnelType, srcPort: number, dstHost: string, dstPort: number): string {
  if (type === "dynamic") return `${hostName}: SOCKS proxy on ${srcPort}`;
  const target = isLoopback(dstHost) ? `${dstPort}` : `${dstHost}:${dstPort}`;
  return type === "local" ? `${hostName}: ${srcPort} → ${target}` : `${hostName}: remote ${srcPort} → ${target}`;
}

/** The sentence a finished tunnel is announced with. */
export function describeTunnel(type: TunnelType, srcHost: string, srcPort: number, dstHost: string, dstPort: number): string {
  if (type === "dynamic") return `SOCKS5 proxy on ${srcHost}:${srcPort}`;
  return type === "local"
    ? `${srcHost}:${srcPort} → ${dstHost}:${dstPort}`
    : `remote ${srcHost}:${srcPort} → ${dstHost}:${dstPort} on this computer`;
}
