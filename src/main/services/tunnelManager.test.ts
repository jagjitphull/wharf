import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import net from "node:net";
import { IPC, type HostRecord, type TunnelInput, type TunnelRecord } from "../../shared/types";
import { freePort, startEchoServer, startTestSshServer, testHost, type TestSshServer } from "../testing/sshTestServer";

const h = vi.hoisted(() => ({
  hosts: [] as HostRecord[],
  tunnels: [] as TunnelRecord[],
  sent: [] as { channel: string; payload: any }[],
}));
vi.mock("electron", () => ({
  BrowserWindow: {
    getAllWindows: () => [{ webContents: { send: (channel: string, payload: unknown) => h.sent.push({ channel, payload }) } }],
  },
}));
vi.mock("./store", () => ({
  getHosts: () => h.hosts,
  getTunnels: () => h.tunnels,
  setTunnels: (t: TunnelRecord[]) => {
    h.tunnels = t;
  },
  getCommandBlocksEnabled: () => false,
}));
vi.mock("./secretStore", async () => {
  const { TEST_PASSWORD } = await import("../testing/sshTestServer");
  return { readSecret: (id: string | null) => (id === "pw" ? TEST_PASSWORD : null) };
});
vi.mock("./knownHosts", () => ({ verifyHostKeyInteractive: async () => true }));

let server: TestSshServer;
let echo: Awaited<ReturnType<typeof startEchoServer>>;
let tunnels: typeof import("./tunnelManager");
let pool: typeof import("./connectionPool");
let ssh: typeof import("./sshManager");

const statesOf = (tunnelId: string) =>
  h.sent.filter((e) => e.channel === IPC.tunnels.onState && e.payload.tunnelId === tunnelId).map((e) => e.payload.status as string);

async function until(check: () => boolean, what: string, timeoutMs = 8000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

/** Opens a TCP connection, sends `payload`, and resolves with the first reply. */
function exchange(port: number, payload: Buffer | string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1", () => socket.write(payload));
    socket.once("data", (d: Buffer) => {
      socket.destroy();
      resolve(d);
    });
    socket.once("error", reject);
    socket.setTimeout(5000, () => {
      socket.destroy();
      reject(new Error("no reply"));
    });
  });
}
const canConnect = (port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const s = net.connect(port, "127.0.0.1", () => {
      s.destroy();
      resolve(true);
    });
    s.once("error", () => resolve(false));
  });

async function makeTunnel(over: Partial<TunnelInput> & { srcPort: number }): Promise<TunnelRecord> {
  return tunnels.create({
    hostId: "a",
    name: "t",
    type: "local",
    srcHost: "127.0.0.1",
    dstHost: "127.0.0.1",
    dstPort: echo.port,
    ...over,
  });
}

beforeAll(async () => {
  server = await startTestSshServer();
  echo = await startEchoServer();
});
afterAll(async () => {
  await echo.close();
  await server.close();
});

beforeEach(async () => {
  h.hosts = [testHost(server.port, { id: "a" })];
  h.tunnels = [];
  h.sent = [];
  echo.stats.connections = 0;
  server.stats.forwards.length = 0;
  server.stats.forwardRequests.length = 0;
  server.stats.cancelledForwards.length = 0;
  vi.resetModules();
  tunnels = await import("./tunnelManager");
  ssh = await import("./sshManager");
  pool = await import("./connectionPool");
});
afterEach(async () => {
  tunnels.stopAll();
  await until(() => server.stats.open === 0, "connections to close");
});

describe("local forwarding", () => {
  it("carries traffic from a local port through SSH to the destination and back", async () => {
    const t = await makeTunnel({ srcPort: await freePort() });
    await tunnels.start(t.id);
    expect(tunnels.isRunning(t.id)).toBe(true);
    expect((await exchange(t.srcPort, "ping through the tunnel")).toString()).toBe("ping through the tunnel");
    expect(server.stats.forwards).toContain(`127.0.0.1:${echo.port}`);
  });

  it("handles several connections at once, each independent", async () => {
    const t = await makeTunnel({ srcPort: await freePort() });
    await tunnels.start(t.id);
    const replies = await Promise.all(["one", "two", "three"].map((m) => exchange(t.srcPort, m)));
    expect(replies.map(String)).toEqual(["one", "two", "three"]);
  });

  it("reports starting then running, and stopped on stop", async () => {
    const t = await makeTunnel({ srcPort: await freePort() });
    await tunnels.start(t.id);
    tunnels.stop(t.id);
    expect(statesOf(t.id)).toEqual(["starting", "running", "stopped"]);
  });

  it("stops listening and lets go of the SSH connection when stopped", async () => {
    const t = await makeTunnel({ srcPort: await freePort() });
    await tunnels.start(t.id);
    expect(await canConnect(t.srcPort)).toBe(true);
    tunnels.stop(t.id);
    await until(() => server.stats.open === 0, "the connection to close");
    expect(await canConnect(t.srcPort)).toBe(false);
    expect(tunnels.isRunning(t.id)).toBe(false);
  });

  it("starting a running tunnel again is a no-op", async () => {
    const t = await makeTunnel({ srcPort: await freePort() });
    await tunnels.start(t.id);
    await tunnels.start(t.id);
    expect(pool.poolRefCount("a")).toBe(1);
  });

  it("fails clearly when the local port is already taken, and cleans up", async () => {
    const taken = net.createServer();
    await new Promise<void>((r) => taken.listen(0, "127.0.0.1", r));
    const port = (taken.address() as net.AddressInfo).port;
    try {
      const t = await makeTunnel({ srcPort: port });
      await expect(tunnels.start(t.id)).rejects.toThrow(/EADDRINUSE/);
      expect(statesOf(t.id)).toEqual(["starting", "error"]);
      expect(h.sent.find((e) => e.payload.status === "error")!.payload.error).toMatch(/EADDRINUSE/);
      expect(tunnels.isRunning(t.id)).toBe(false);
      await until(() => server.stats.open === 0, "the unused connection to be released");
    } finally {
      taken.close();
    }
  });

  it("fails cleanly for a tunnel whose host no longer exists", async () => {
    const t = await makeTunnel({ srcPort: await freePort(), hostId: "ghost" });
    await expect(tunnels.start(t.id)).rejects.toThrow(/not found/i);
    expect(statesOf(t.id)).toEqual(["starting", "error"]);
  });

  it("rejects starting a tunnel that doesn't exist", async () => {
    await expect(tunnels.start("nope")).rejects.toThrow(/not found/i);
  });

  it("can be started again after it was stopped", async () => {
    const t = await makeTunnel({ srcPort: await freePort() });
    await tunnels.start(t.id);
    tunnels.stop(t.id);
    await until(() => server.stats.open === 0, "the connection to close");
    await tunnels.start(t.id);
    expect((await exchange(t.srcPort, "again")).toString()).toBe("again");
  });

  it("can be started again after the SSH connection dropped underneath it", async () => {
    const t = await makeTunnel({ srcPort: await freePort() });
    await tunnels.start(t.id);
    server.dropConnections();
    await until(() => statesOf(t.id).at(-1) === "stopped", "the tunnel to notice the drop");
    await tunnels.start(t.id);
    expect((await exchange(t.srcPort, "after the drop")).toString()).toBe("after the drop");
  });
});

describe("dynamic (SOCKS5) forwarding", () => {
  async function socks(): Promise<number> {
    const t = await makeTunnel({ type: "dynamic", srcPort: await freePort(), dstHost: undefined, dstPort: undefined });
    await tunnels.start(t.id);
    return t.srcPort;
  }

  /** Runs a SOCKS5 exchange: greeting, then `request`; collects the two replies. */
  function handshake(port: number, request: Buffer, thenSend?: string): Promise<{ method: Buffer; reply: Buffer; echoed?: string }> {
    return new Promise((resolve, reject) => {
      const socket = net.connect(port, "127.0.0.1");
      const chunks: Buffer[] = [];
      let stage = 0;
      let method: Buffer;
      let reply: Buffer;
      socket.on("connect", () => socket.write(Buffer.from([5, 1, 0])));
      socket.on("data", (d: Buffer) => {
        if (stage === 0) {
          method = d;
          stage = 1;
          socket.write(request);
        } else if (stage === 1) {
          reply = d.subarray(0, 10);
          stage = 2;
          if (thenSend && d[1] === 0) socket.write(thenSend);
          else {
            socket.destroy();
            resolve({ method, reply });
          }
        } else {
          chunks.push(d);
          socket.destroy();
          resolve({ method, reply, echoed: Buffer.concat(chunks).toString() });
        }
      });
      socket.on("error", reject);
      socket.setTimeout(5000, () => {
        socket.destroy();
        reject(new Error("SOCKS handshake timed out"));
      });
    });
  }
  const ipv4Connect = (port: number) => Buffer.from([5, 1, 0, 1, 127, 0, 0, 1, port >> 8, port & 255]);

  it("negotiates no-auth and relays a CONNECT to an IPv4 address", async () => {
    const r = await handshake(await socks(), ipv4Connect(echo.port), "socks payload");
    expect([...r.method]).toEqual([5, 0]);
    expect(r.reply[0]).toBe(5);
    expect(r.reply[1]).toBe(0); // succeeded
    expect(r.echoed).toBe("socks payload");
    expect(server.stats.forwards).toContain(`127.0.0.1:${echo.port}`);
  });

  it("relays a CONNECT given a domain name", async () => {
    const name = Buffer.from("localhost");
    const req = Buffer.concat([Buffer.from([5, 1, 0, 3, name.length]), name, Buffer.from([echo.port >> 8, echo.port & 255])]);
    const r = await handshake(await socks(), req, "by name");
    expect(r.reply[1]).toBe(0);
    expect(r.echoed).toBe("by name");
    expect(server.stats.forwards).toContain(`localhost:${echo.port}`);
  });

  it("answers 'connection refused' when the destination isn't reachable", async () => {
    const r = await handshake(await socks(), ipv4Connect(await freePort()));
    expect(r.reply[1]).toBe(5);
  });

  it("answers 'command not supported' for anything but CONNECT (e.g. BIND)", async () => {
    const bind = Buffer.from([5, 2, 0, 1, 127, 0, 0, 1, 0, 80]);
    expect((await handshake(await socks(), bind)).reply[1]).toBe(7);
  });

  it("answers 'address type not supported' for an unknown address type", async () => {
    const odd = Buffer.from([5, 1, 0, 9, 0, 0, 0, 0, 0, 80]);
    expect((await handshake(await socks(), odd)).reply[1]).toBe(8);
  });

  it("copes with the greeting and request arriving in one TCP segment", async () => {
    const port = await socks();
    const both = Buffer.concat([Buffer.from([5, 1, 0]), ipv4Connect(echo.port)]);
    const reply = await exchange(port, both);
    expect([...reply.subarray(0, 2)]).toEqual([5, 0]);
  });
});

describe("remote forwarding", () => {
  const remoteTunnel = async (srcPort: number) => makeTunnel({ type: "remote", srcPort, dstHost: "127.0.0.1", dstPort: echo.port });

  it("asks the server to listen and relays connections it receives to the local destination", async () => {
    const port = await freePort();
    const t = await remoteTunnel(port);
    await tunnels.start(t.id);
    expect(server.stats.forwardRequests).toContain(`127.0.0.1:${port}`);
    expect(await server.connectInbound(port, "from the far side")).toBe("from the far side");
  });

  it("stops forwarding when stopped: the server is told to cancel and the client ignores late connections", async () => {
    const port = await freePort();
    const t = await remoteTunnel(port);
    await tunnels.start(t.id);
    // Keep the shared connection alive past stop(), so a lingering listener would matter.
    const keepAlive = await ssh.connect("a", 80, 24);
    try {
      tunnels.stop(t.id);
      await until(() => server.stats.cancelledForwards.includes(`127.0.0.1:${port}`), "the forward to be cancelled");
      await expect(server.connectInbound(port, "late", { force: true })).rejects.toThrow();
    } finally {
      ssh.disconnect(keepAlive);
    }
  });

  it("two remote tunnels on one connection each get only their own connections", async () => {
    const [p1, p2] = [await freePort(), await freePort()];
    const secondEcho = await startEchoServer();
    try {
      const t1 = await remoteTunnel(p1);
      const t2 = await makeTunnel({ type: "remote", srcPort: p2, dstHost: "127.0.0.1", dstPort: secondEcho.port });
      await tunnels.start(t1.id);
      await tunnels.start(t2.id);
      expect(server.stats.open).toBe(1);

      expect(await server.connectInbound(p1, "to the first")).toBe("to the first");
      await new Promise((r) => setTimeout(r, 150)); // let a wrongly-duplicated connection show up
      expect(echo.stats.connections).toBe(1);
      expect(secondEcho.stats.connections).toBe(0);

      expect(await server.connectInbound(p2, "to the second")).toBe("to the second");
      await new Promise((r) => setTimeout(r, 150));
      expect(secondEcho.stats.connections).toBe(1);
      expect(echo.stats.connections).toBe(1);
    } finally {
      await secondEcho.close();
    }
  });

  it("can be restarted after being stopped", async () => {
    const port = await freePort();
    const t = await remoteTunnel(port);
    await tunnels.start(t.id);
    tunnels.stop(t.id);
    await until(() => server.stats.open === 0, "the connection to close");
    await tunnels.start(t.id);
    expect(await server.connectInbound(port, "round two")).toBe("round two");
  });
});

describe("management", () => {
  it("creates, lists and removes tunnels, stopping a running one on removal", async () => {
    const t = await makeTunnel({ srcPort: await freePort() });
    expect(tunnels.list().map((x) => x.id)).toEqual([t.id]);
    await tunnels.start(t.id);
    tunnels.remove(t.id);
    expect(tunnels.list()).toEqual([]);
    expect(tunnels.isRunning(t.id)).toBe(false);
    await until(() => server.stats.open === 0, "the connection to close");
  });

  it("stopAll stops every running tunnel", async () => {
    const a = await makeTunnel({ srcPort: await freePort() });
    const b = await makeTunnel({ srcPort: await freePort() });
    await tunnels.start(a.id);
    await tunnels.start(b.id);
    expect(pool.poolRefCount("a")).toBe(2); // two tunnels share one connection
    expect(server.stats.open).toBe(1);
    tunnels.stopAll();
    expect(tunnels.isRunning(a.id) || tunnels.isRunning(b.id)).toBe(false);
    await until(() => server.stats.open === 0, "the shared connection to close");
  });
});
