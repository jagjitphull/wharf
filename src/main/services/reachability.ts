import { connect } from "node:net";

/**
 * Lightweight "is this host up" probe for the online/offline indicator in
 * Quick Connect — just whether `hostname:port` accepts a raw TCP connection
 * within `timeoutMs`, never a protocol handshake. Deliberately stops short
 * of anything SSH-specific (auth, host-key verification) so checking status
 * can never trigger a host-key prompt, log an auth attempt against the real
 * service, or otherwise have a side effect beyond the connection attempt
 * itself.
 */
export function checkReachable(hostname: string, port: number, timeoutMs = 2500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: hostname, port, timeout: timeoutMs });
    let settled = false;
    function finish(result: boolean) {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    }
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}
