import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { IPC, type HostRecord } from "../../shared/types";
import { startTestSshServer, testHost, TEST_PASSWORD, type TestSshServer } from "../testing/sshTestServer";

// Everything below the app's own seams is real: ssh2 client, the connection
// pool, sshManager's session/reconnect logic, talking over TCP to an ssh2
// server running in this process. Only Electron's windows, the saved-host
// store, the secret store and the interactive host-key prompt are stubbed.
const h = vi.hoisted(() => ({
  hosts: [] as HostRecord[],
  sent: [] as { channel: string; payload: any }[],
  acceptHostKey: true,
  transcripts: {
    begin: vi.fn(),
    feed: vi.fn(),
    end: vi.fn(),
  },
}));
vi.mock("electron", () => ({
  BrowserWindow: {
    getAllWindows: () => [{ webContents: { send: (channel: string, payload: unknown) => h.sent.push({ channel, payload }) } }],
  },
}));
vi.mock("./store", () => ({ getHosts: () => h.hosts, getCommandBlocksEnabled: () => false }));
vi.mock("./secretStore", async () => {
  const { TEST_PASSWORD } = await import("../testing/sshTestServer");
  return { readSecret: (id: string | null) => (id === "pw" ? TEST_PASSWORD : id === "wrong" ? "not-the-password" : null) };
});
vi.mock("./knownHosts", () => ({ verifyHostKeyInteractive: async () => h.acceptHostKey }));
vi.mock("./transcripts", () => ({ transcripts: h.transcripts }));

let server: TestSshServer;
let ssh: typeof import("./sshManager");
let pool: typeof import("./connectionPool");
const opened: string[] = [];

const output = (sessionId: string) =>
  h.sent
    .filter((e) => e.channel === IPC.ssh.onData && e.payload.sessionId === sessionId)
    .map((e) => e.payload.chunk as string)
    .join("");
const eventsOf = (channel: string) => h.sent.filter((e) => e.channel === channel).map((e) => e.payload);

async function until(check: () => boolean, what: string, timeoutMs = 8000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

async function open(hostId = "host-1"): Promise<string> {
  const id = await ssh.connect(hostId, 80, 24);
  opened.push(id);
  return id;
}

beforeAll(async () => {
  server = await startTestSshServer();
});
afterAll(async () => {
  await server.close();
});

beforeEach(async () => {
  h.hosts = [testHost(server.port)];
  h.sent = [];
  h.acceptHostKey = true;
  for (const fn of Object.values(h.transcripts)) fn.mockClear();
  server.stats.shellInput.length = 0;
  server.stats.windowChanges.length = 0;
  server.stats.forwards.length = 0;
  vi.resetModules();
  ssh = await import("./sshManager");
  pool = await import("./connectionPool");
});
afterEach(async () => {
  for (const id of opened.splice(0)) ssh.disconnect(id);
  await until(() => server.stats.open === 0, "all connections to close");
});

describe("shell sessions", () => {
  it("opens a shell on a real SSH server and streams its output", async () => {
    const id = await open();
    await until(() => output(id).includes("welcome"), "the server's banner");
  });

  it("hands a session's output to its transcript from open to close", async () => {
    const id = await open();
    expect(h.transcripts.begin).toHaveBeenCalledWith(id, { hostId: "host-1", hostName: h.hosts[0].name });
    await until(() => output(id).includes("welcome"), "the server's banner");
    const fed = h.transcripts.feed.mock.calls.filter(([sid]) => sid === id).map(([, text]) => text as string);
    expect(fed.join("")).toBe(output(id));
    ssh.disconnect(id);
    expect(h.transcripts.end).toHaveBeenCalledWith(id);
  });

  it("sends typed input to the remote shell and shows its reply", async () => {
    const id = await open();
    ssh.write(id, "ls -la\r");
    await until(() => output(id).includes("got:ls -la\r"), "the echoed command");
    expect(server.stats.shellInput.join("")).toContain("ls -la\r");
  });

  it("forwards terminal resizes to the server", async () => {
    const id = await open();
    ssh.resize(id, 132, 43);
    await until(() => server.stats.windowChanges.length > 0, "the window-change request");
    expect(server.stats.windowChanges.at(-1)).toEqual({ cols: 132, rows: 43 });
  });

  it("disconnect closes the connection and later writes are ignored", async () => {
    const id = await open();
    await until(() => server.stats.open === 1, "the connection to open");
    ssh.disconnect(id);
    await until(() => server.stats.open === 0, "the connection to close");
    expect(() => ssh.write(id, "ignored\r")).not.toThrow();
    expect(pool.hasPooledClient("host-1")).toBe(false);
  });
});

describe("connecting can fail cleanly", () => {
  it("rejects a wrong password and leaves nothing pooled", async () => {
    h.hosts = [testHost(server.port, { secretId: "wrong" })];
    await expect(ssh.connect("host-1", 80, 24)).rejects.toThrow(/authentication/i);
    expect(pool.hasPooledClient("host-1")).toBe(false);
  });

  it("refuses a host whose key the user didn't trust", async () => {
    h.acceptHostKey = false;
    await expect(ssh.connect("host-1", 80, 24)).rejects.toThrow();
    expect(pool.hasPooledClient("host-1")).toBe(false);
  });

  it("rejects a host that isn't saved", async () => {
    await expect(ssh.connect("nope", 80, 24)).rejects.toThrow(/not found/i);
  });

  it("rejects with a connection error when nothing is listening", async () => {
    h.hosts = [testHost(1, { port: 1 })];
    await expect(ssh.connect("host-1", 80, 24)).rejects.toThrow(/ECONNREFUSED/);
  });
});

describe("connection sharing", () => {
  it("serves two sessions to one host over a single SSH connection", async () => {
    const a = await open();
    const b = await open();
    expect(a).not.toBe(b);
    expect(server.stats.total).toBeGreaterThanOrEqual(1);
    expect(server.stats.open).toBe(1);
    expect(pool.poolRefCount("host-1")).toBe(2);

    ssh.write(b, "from-b\r");
    await until(() => output(b).includes("got:from-b"), "session b's echo");
    expect(output(a)).not.toContain("from-b"); // independent channels
  });

  it("keeps the shared connection open until the last session lets go", async () => {
    const a = await open();
    const b = await open();
    ssh.disconnect(a);
    await new Promise((r) => setTimeout(r, 200));
    expect(server.stats.open).toBe(1);
    expect(pool.poolRefCount("host-1")).toBe(1);
    ssh.disconnect(b);
    await until(() => server.stats.open === 0, "the shared connection to close");
  });
});

describe("jump hosts", () => {
  it("reaches a host through another saved host", async () => {
    // The "bastion" and the target are the same test server, so the target is
    // reached by tunnelling a second SSH handshake through the first connection.
    h.hosts = [testHost(server.port, { id: "bastion" }), testHost(server.port, { id: "inner", jumpHostId: "bastion" })];
    const before = server.stats.total;
    const id = await open("inner");
    expect(server.stats.total - before).toBe(2);
    expect(server.stats.forwards).toContain(`127.0.0.1:${server.port}`);
    ssh.write(id, "via-jump\r");
    await until(() => output(id).includes("got:via-jump"), "an echo through the jump host");
  });

  it("fails clearly when the jump host doesn't exist", async () => {
    h.hosts = [testHost(server.port, { id: "inner", jumpHostId: "ghost" })];
    await expect(ssh.connect("inner", 80, 24)).rejects.toThrow(/jump host/i);
  });
});

describe("reconnect on drop", () => {
  it("reconnects an unexpectedly dropped session and keeps it usable", async () => {
    const id = await open();
    await until(() => output(id).includes("welcome"), "the first banner");

    server.dropConnections();
    await until(() => eventsOf(IPC.ssh.onReconnecting).length > 0, "a reconnect attempt to be announced");
    expect(eventsOf(IPC.ssh.onReconnecting)[0]).toMatchObject({ sessionId: id, attempt: 1 });

    await until(() => eventsOf(IPC.ssh.onReconnected).length > 0, "the session to reconnect", 15_000);
    expect(eventsOf(IPC.ssh.onReconnected)[0]).toEqual({ sessionId: id });

    ssh.write(id, "after-drop\r");
    await until(() => output(id).includes("got:after-drop"), "an echo on the reconnected session");
  }, 25_000);

  it("does not reconnect a session the user closed on purpose", async () => {
    const id = await open();
    ssh.disconnect(id);
    await new Promise((r) => setTimeout(r, 500));
    expect(eventsOf(IPC.ssh.onReconnecting)).toHaveLength(0);
  });
});

describe("password handling", () => {
  it("the real password reaches the server only via the secret store, never the saved host", () => {
    expect(JSON.stringify(h.hosts)).not.toContain(TEST_PASSWORD);
  });
});
