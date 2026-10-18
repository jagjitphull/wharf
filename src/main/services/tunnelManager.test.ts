import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import net from "node:net";
import { IPC, type HostRecord, type TunnelInput, type TunnelRecord } from "../../shared/types";
import { freePort, startEchoServer, startTestSshServer, testHost, type TestSshServer } from "../testing/sshTestServer";

const h = vi.hoisted(() => ({
  hosts: [] as HostRecord[],
  tunnels: [] as TunnelRecord[],
  sent: [] as { channel: string; payload: any }[],
  /** Awaited inside the host-key check, so a test can hold a connection attempt open. */
  gate: Promise.resolve() as Promise<void>,
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
vi.mock("./knownHosts", () => ({
  verifyHostKeyInteractive: async () => {
    await h.gate;
    return true;
  },
}));
vi.mock("electron-log/main", () => ({ default: { warn: () => {}, error: () => {}, info: () => {} } }));

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
  h.gate = Promise.resolve();
  echo.stats.connections = 0;
  server.stats.forwards.length = 0;
  server.stats.forwardRequests.length = 0;
  server.stats.cancelledForwards.length = 0;
  vi.resetModules();
  tunnels = await import("./tunnelManager");
  ssh = await import("./sshManager");
  pool = await import("./connectionPool");
  tunnels.reconnectPolicy.baseMs = 40;
  tunnels.reconnectPolicy.maxMs = 160;
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

  it("comes back by itself after the SSH connection dropped underneath it", async () => {
    const t = await makeTunnel({ srcPort: await freePort() });
    await tunnels.start(t.id);
    server.dropConnections();
    await until(() => statesOf(t.id).includes("reconnecting"), "the tunnel to notice the drop");
    await until(() => tunnels.isRunning(t.id), "the tunnel to reconnect");
    expect((await exchange(t.srcPort, "after the drop")).toString()).toBe("after the drop");
    expect(statesOf(t.id).at(-1)).toBe("running");
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

describe("reconnecting", () => {
  it("keeps retrying while the host is unreachable, then recovers", async () => {
    const t = await makeTunnel({ srcPort: await freePort() });
    await tunnels.start(t.id);
    const realPort = h.hosts[0].port;
    h.hosts = [{ ...h.hosts[0], port: await freePort() }]; // nothing listens there
    server.dropConnections();
    await until(() => statesOf(t.id).filter((x) => x === "reconnecting").length >= 3, "several failed attempts");
    expect(tunnels.isRunning(t.id)).toBe(false);
    expect(tunnels.statuses().find((s) => s.tunnelId === t.id)!.error).toMatch(/Couldn't reconnect/);
    h.hosts = [{ ...h.hosts[0], port: realPort }];
    await until(() => tunnels.isRunning(t.id), "the tunnel to recover");
    expect((await exchange(t.srcPort, "back")).toString()).toBe("back");
  });

  it("backs off between attempts, up to the cap", async () => {
    const t = await makeTunnel({ srcPort: await freePort() });
    await tunnels.start(t.id);
    h.hosts = [{ ...h.hosts[0], port: await freePort() }];
    server.dropConnections();
    await until(() => statesOf(t.id).filter((x) => x === "reconnecting").length >= 5, "five attempts");
    const waits = h.sent
      .filter((e) => e.channel === IPC.tunnels.onState && e.payload.status === "reconnecting")
      .map((e) => /Retrying in (\d+)s/.exec(e.payload.error)![1]);
    expect(waits.length).toBeGreaterThanOrEqual(5);
    tunnels.stop(t.id);
  });

  it("stops retrying when the user stops the tunnel", async () => {
    const t = await makeTunnel({ srcPort: await freePort() });
    await tunnels.start(t.id);
    h.hosts = [{ ...h.hosts[0], port: await freePort() }];
    server.dropConnections();
    await until(() => tunnels.isReconnecting(t.id), "the retry to be scheduled");
    tunnels.stop(t.id);
    expect(tunnels.isReconnecting(t.id)).toBe(false);
    expect(statesOf(t.id).at(-1)).toBe("stopped");
    const before = h.sent.length;
    await new Promise((r) => setTimeout(r, 400));
    expect(h.sent.length).toBe(before); // nothing more happened
    expect(tunnels.isRunning(t.id)).toBe(false);
  });

  it("a stop that lands while an attempt is in flight doesn't leave the tunnel running", async () => {
    const t = await makeTunnel({ srcPort: await freePort() });
    await tunnels.start(t.id);
    // Hold the next connection attempt open at the host-key check.
    let release!: () => void;
    h.gate = new Promise<void>((resolve) => (release = resolve));
    server.dropConnections();
    await until(() => statesOf(t.id).filter((x) => x === "starting").length >= 2, "the retry to be in flight");
    tunnels.stop(t.id);
    release();
    h.gate = Promise.resolve();
    await new Promise((r) => setTimeout(r, 400));
    expect(tunnels.isRunning(t.id)).toBe(false);
    expect(tunnels.isReconnecting(t.id)).toBe(false);
    expect(await canConnect(t.srcPort)).toBe(false);
    expect(statesOf(t.id).at(-1)).toBe("stopped");
  });

  it("a manual start while waiting replaces the pending retry", async () => {
    const t = await makeTunnel({ srcPort: await freePort() });
    await tunnels.start(t.id);
    tunnels.reconnectPolicy.baseMs = 60_000;
    tunnels.reconnectPolicy.maxMs = 60_000;
    server.dropConnections();
    await until(() => tunnels.isReconnecting(t.id), "the retry to be scheduled");
    await tunnels.start(t.id);
    expect(tunnels.isReconnecting(t.id)).toBe(false);
    expect(tunnels.isRunning(t.id)).toBe(true);
    expect((await exchange(t.srcPort, "manual")).toString()).toBe("manual");
  });

  it("gives up when the login is refused, rather than hammering the server", async () => {
    const t = await makeTunnel({ srcPort: await freePort() });
    await tunnels.start(t.id);
    h.hosts = [{ ...h.hosts[0], secretId: "wrong" }];
    server.dropConnections();
    await until(() => statesOf(t.id).at(-1) === "error", "the failed login to be reported");
    const attempts = server.stats.total;
    await new Promise((r) => setTimeout(r, 400));
    expect(server.stats.total).toBe(attempts);
    expect(tunnels.isReconnecting(t.id)).toBe(false);
    expect(tunnels.statuses().find((s) => s.tunnelId === t.id)!.error).toMatch(/authentication/i);
  });

  it("every tunnel on a dropped shared connection comes back, over one new connection", async () => {
    const a = await makeTunnel({ srcPort: await freePort() });
    const b = await makeTunnel({ srcPort: await freePort() });
    await tunnels.start(a.id);
    await tunnels.start(b.id);
    const before = server.stats.total;
    server.dropConnections();
    await until(() => statesOf(a.id).includes("reconnecting") && statesOf(b.id).includes("reconnecting"), "both to notice the drop");
    await until(() => tunnels.isRunning(a.id) && tunnels.isRunning(b.id), "both tunnels to reconnect");
    expect(server.stats.total - before).toBe(1);
    expect((await exchange(a.srcPort, "a")).toString()).toBe("a");
    expect((await exchange(b.srcPort, "b")).toString()).toBe("b");
  });
});

describe("auto-start", () => {
  it("starts exactly the tunnels marked to start on launch", async () => {
    const auto = await makeTunnel({ srcPort: await freePort(), autoStart: true });
    const manual = await makeTunnel({ srcPort: await freePort() });
    await tunnels.startAutoStartTunnels();
    expect(tunnels.isRunning(auto.id)).toBe(true);
    expect(tunnels.isRunning(manual.id)).toBe(false);
    expect((await exchange(auto.srcPort, "hello")).toString()).toBe("hello");
    expect(await canConnect(manual.srcPort)).toBe(false);
  });

  it("does nothing when no tunnel is marked", async () => {
    await makeTunnel({ srcPort: await freePort() });
    await tunnels.startAutoStartTunnels();
    expect(server.stats.open).toBe(0);
    expect(tunnels.statuses()).toEqual([]);
  });

  it("starts the rest when one fails, and reports that one's error", async () => {
    const taken = net.createServer();
    await new Promise<void>((r) => taken.listen(0, "127.0.0.1", r));
    const takenPort = (taken.address() as net.AddressInfo).port;
    try {
      const bad = await makeTunnel({ srcPort: takenPort, autoStart: true });
      const good = await makeTunnel({ srcPort: await freePort(), autoStart: true });
      await expect(tunnels.startAutoStartTunnels()).resolves.toBeUndefined();
      expect(tunnels.isRunning(good.id)).toBe(true);
      expect(tunnels.isRunning(bad.id)).toBe(false);
      const byId = new Map(tunnels.statuses().map((s) => [s.tunnelId, s]));
      expect(byId.get(good.id)!.status).toBe("running");
      expect(byId.get(bad.id)!.status).toBe("error");
      expect(byId.get(bad.id)!.error).toMatch(/EADDRINUSE/);
    } finally {
      taken.close();
    }
  });

  it("tunnels on the same host started together share one SSH connection", async () => {
    const a = await makeTunnel({ srcPort: await freePort(), autoStart: true });
    const b = await makeTunnel({ srcPort: await freePort(), autoStart: true });
    const c = await makeTunnel({ srcPort: await freePort(), autoStart: true });
    const before = server.stats.total;
    await tunnels.startAutoStartTunnels();
    expect([a, b, c].every((t) => tunnels.isRunning(t.id))).toBe(true);
    expect(server.stats.total - before).toBe(1);
    expect(pool.poolRefCount("a")).toBe(3);
    // Letting go of all three must actually close that connection: with
    // duplicate dials one of them would have been left open and untracked.
    tunnels.stopAll();
    await until(() => server.stats.open === 0, "the shared connection to close");
  });

  it("setAutoStart turns it on and off and keeps the rest of the tunnel", async () => {
    const t = await makeTunnel({ srcPort: await freePort() });
    tunnels.setAutoStart(t.id, true);
    expect(tunnels.list()[0]).toEqual({ ...t, autoStart: true });
    tunnels.setAutoStart(t.id, false);
    expect(tunnels.list()[0].autoStart).toBe(false);
    await tunnels.startAutoStartTunnels();
    expect(tunnels.isRunning(t.id)).toBe(false);
  });

  it("setAutoStart rejects a tunnel that doesn't exist", () => {
    expect(() => tunnels.setAutoStart("nope", true)).toThrow(/not found/);
  });
});

describe("statuses", () => {
  it("reports the latest state of each tunnel, including after it stops", async () => {
    const t = await makeTunnel({ srcPort: await freePort() });
    expect(tunnels.statuses()).toEqual([]);
    await tunnels.start(t.id);
    expect(tunnels.statuses()).toEqual([{ tunnelId: t.id, status: "running", error: undefined }]);
    tunnels.stop(t.id);
    expect(tunnels.statuses().map((s) => s.status)).toEqual(["stopped"]);
  });

  it("forgets a tunnel once it is removed", async () => {
    const t = await makeTunnel({ srcPort: await freePort() });
    await tunnels.start(t.id);
    tunnels.remove(t.id);
    expect(tunnels.statuses()).toEqual([]);
  });
});
