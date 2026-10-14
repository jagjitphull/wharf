import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { generateKeyPairSync } from "node:crypto";
import { Server, utils, type Connection, type SFTPWrapper } from "ssh2";
import type { HostRecord } from "../../shared/types";

/**
 * A real SSH server running inside the test process, so the app's actual
 * ssh2 client code (sshManager, sftpManager, tunnelManager, the connection
 * pool) runs against genuine protocol traffic instead of mocks. It supports
 * exactly what those tests need: password auth, a PTY shell that echoes,
 * SFTP over a real directory, and direct-tcpip port forwarding. Not
 * included in the packaged app (see tsconfig.main.json).
 */

export const TEST_USER = "tester";
export const TEST_PASSWORD = "correct-horse";

const { STATUS_CODE, flagsToString } = utils.sftp;

export interface TestSshServer {
  port: number;
  /** Directory the SFTP server exposes as "/". */
  root: string;
  /** Connections currently open / ever opened. */
  stats: {
    open: number;
    total: number;
    shellInput: string[];
    windowChanges: { cols: number; rows: number }[];
    /** direct-tcpip destinations clients asked us to connect to. */
    forwards: string[];
    /** Remote-forward listeners clients asked us to open / later cancelled, as "addr:port". */
    forwardRequests: string[];
    cancelledForwards: string[];
  };
  /**
   * Plays the part of someone connecting to a remote-forward listener: opens
   * a forwarded channel back to the client that asked for `bindPort`, sends
   * `payload`, and resolves with the first reply. Rejects if the client
   * refuses the channel. With `force`, goes to the client that last requested
   * the port even if it has since cancelled the forward.
   */
  connectInbound(bindPort: number, payload: string, opts?: { force?: boolean }): Promise<string>;
  /** Gracefully ends every open connection (looks like a dropped link to a client). */
  dropConnections(): void;
  close(): Promise<void>;
}

function statusFor(err: unknown): number {
  const code = (err as NodeJS.ErrnoException)?.code;
  if (code === "ENOENT") return STATUS_CODE.NO_SUCH_FILE;
  if (code === "EACCES" || code === "EPERM") return STATUS_CODE.PERMISSION_DENIED;
  return STATUS_CODE.FAILURE;
}

function toAttrs(st: fs.Stats) {
  return {
    mode: st.mode,
    uid: st.uid,
    gid: st.gid,
    size: st.size,
    atime: Math.floor(st.atimeMs / 1000),
    mtime: Math.floor(st.mtimeMs / 1000),
  };
}

function serveSftp(sftp: SFTPWrapper, root: string): void {
  // Client paths are POSIX paths rooted at "/", mapped into `root`; anything
  // that would climb out of it is refused.
  const real = (p: string): string => {
    const resolved = path.resolve(root, "." + path.posix.resolve("/", p));
    if (resolved !== root && !resolved.startsWith(root + path.sep)) throw Object.assign(new Error("outside root"), { code: "EACCES" });
    return resolved;
  };
  const files = new Map<number, number>(); // handle -> fd
  const dirs = new Map<number, { entries: fs.Dirent[]; dir: string; sent: boolean }>();
  let next = 1;
  const handleBuf = (n: number): Buffer => {
    const b = Buffer.alloc(4);
    b.writeUInt32BE(n, 0);
    return b;
  };
  const fail = (reqid: number, err: unknown) => sftp.status(reqid, statusFor(err));

  sftp
    .on("REALPATH", (reqid, p) => {
      const abs = path.posix.resolve("/", p);
      sftp.name(reqid, [{ filename: abs, longname: abs, attrs: {} as never }]);
    })
    .on("STAT", (reqid, p) => {
      try {
        sftp.attrs(reqid, toAttrs(fs.statSync(real(p))));
      } catch (e) {
        fail(reqid, e);
      }
    })
    .on("LSTAT", (reqid, p) => {
      try {
        sftp.attrs(reqid, toAttrs(fs.lstatSync(real(p))));
      } catch (e) {
        fail(reqid, e);
      }
    })
    .on("FSTAT", (reqid, handle) => {
      const fd = files.get(handle.readUInt32BE(0));
      if (fd === undefined) return sftp.status(reqid, STATUS_CODE.FAILURE);
      try {
        sftp.attrs(reqid, toAttrs(fs.fstatSync(fd)));
      } catch (e) {
        fail(reqid, e);
      }
    })
    .on("OPENDIR", (reqid, p) => {
      try {
        const dir = real(p);
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        const id = next++;
        dirs.set(id, { entries, dir, sent: false });
        sftp.handle(reqid, handleBuf(id));
      } catch (e) {
        fail(reqid, e);
      }
    })
    .on("READDIR", (reqid, handle) => {
      const d = dirs.get(handle.readUInt32BE(0));
      if (!d) return sftp.status(reqid, STATUS_CODE.FAILURE);
      if (d.sent) return sftp.status(reqid, STATUS_CODE.EOF);
      d.sent = true;
      const names = d.entries.map((e) => ({
        filename: e.name,
        longname: e.name,
        attrs: toAttrs(fs.lstatSync(path.join(d.dir, e.name))),
      }));
      if (names.length === 0) return sftp.status(reqid, STATUS_CODE.EOF);
      sftp.name(reqid, names);
    })
    .on("OPEN", (reqid, filename, flags) => {
      try {
        const fd = fs.openSync(real(filename), flagsToString(flags) ?? "r");
        const id = next++;
        files.set(id, fd);
        sftp.handle(reqid, handleBuf(id));
      } catch (e) {
        fail(reqid, e);
      }
    })
    .on("READ", (reqid, handle, offset, length) => {
      const fd = files.get(handle.readUInt32BE(0));
      if (fd === undefined) return sftp.status(reqid, STATUS_CODE.FAILURE);
      try {
        const buf = Buffer.alloc(length);
        const n = fs.readSync(fd, buf, 0, length, offset);
        if (n === 0) return sftp.status(reqid, STATUS_CODE.EOF);
        sftp.data(reqid, buf.subarray(0, n));
      } catch (e) {
        fail(reqid, e);
      }
    })
    .on("WRITE", (reqid, handle, offset, data) => {
      const fd = files.get(handle.readUInt32BE(0));
      if (fd === undefined) return sftp.status(reqid, STATUS_CODE.FAILURE);
      try {
        fs.writeSync(fd, data, 0, data.length, offset);
        sftp.status(reqid, STATUS_CODE.OK);
      } catch (e) {
        fail(reqid, e);
      }
    })
    .on("CLOSE", (reqid, handle) => {
      const id = handle.readUInt32BE(0);
      const fd = files.get(id);
      if (fd !== undefined) {
        fs.closeSync(fd);
        files.delete(id);
      }
      dirs.delete(id);
      sftp.status(reqid, STATUS_CODE.OK);
    })
    .on("MKDIR", (reqid, p) => {
      try {
        fs.mkdirSync(real(p));
        sftp.status(reqid, STATUS_CODE.OK);
      } catch (e) {
        fail(reqid, e);
      }
    })
    .on("RMDIR", (reqid, p) => {
      try {
        fs.rmdirSync(real(p));
        sftp.status(reqid, STATUS_CODE.OK);
      } catch (e) {
        fail(reqid, e);
      }
    })
    .on("REMOVE", (reqid, p) => {
      try {
        fs.unlinkSync(real(p));
        sftp.status(reqid, STATUS_CODE.OK);
      } catch (e) {
        fail(reqid, e);
      }
    })
    .on("RENAME", (reqid, from, to) => {
      try {
        fs.renameSync(real(from), real(to));
        sftp.status(reqid, STATUS_CODE.OK);
      } catch (e) {
        fail(reqid, e);
      }
    })
    .on("SETSTAT", (reqid) => sftp.status(reqid, STATUS_CODE.OK))
    .on("FSETSTAT", (reqid) => sftp.status(reqid, STATUS_CODE.OK));
}

export async function startTestSshServer(): Promise<TestSshServer> {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TMPDIR ?? "/tmp"), "wharf-sshtest-"));
  const hostKey = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs1", format: "pem" },
    publicKeyEncoding: { type: "pkcs1", format: "pem" },
  }).privateKey;

  const stats: TestSshServer["stats"] = {
    open: 0,
    total: 0,
    shellInput: [],
    windowChanges: [],
    forwards: [],
    forwardRequests: [],
    cancelledForwards: [],
  };
  const listeners = new Map<number, Connection>(); // bindPort -> client that has an active remote forward
  const lastRequested = new Map<number, Connection>(); // ...including ones it later cancelled
  const connections = new Set<Connection>();
  const server = new Server({ hostKeys: [hostKey] }, (client) => {
    connections.add(client);
    stats.open++;
    stats.total++;
    client.on("close", () => {
      connections.delete(client);
      stats.open--;
    });
    client.on("error", () => {});

    client.on("authentication", (ctx) => {
      if (ctx.method === "password" && ctx.username === TEST_USER && ctx.password === TEST_PASSWORD) return ctx.accept();
      ctx.reject(["password"]);
    });

    client.on("ready", () => {
      client.on("session", (acceptSession) => {
        const session = acceptSession();
        session.on("pty", (accept) => accept());
        session.on("window-change", (accept, _reject, info) => {
          accept?.();
          stats.windowChanges.push({ cols: info.cols, rows: info.rows });
        });
        session.on("shell", (accept) => {
          const stream = accept();
          stream.write("welcome\r\n");
          stream.on("data", (chunk: Buffer) => {
            const text = chunk.toString("utf8");
            stats.shellInput.push(text);
            stream.write(`got:${text}`);
          });
        });
        session.on("sftp", (accept) => serveSftp(accept(), root));
      });

      client.on("request", (accept, reject, name, info) => {
        const forward = info as unknown as { bindAddr: string; bindPort: number };
        if (name === "tcpip-forward") {
          stats.forwardRequests.push(`${forward.bindAddr}:${forward.bindPort}`);
          listeners.set(forward.bindPort, client);
          lastRequested.set(forward.bindPort, client);
          (accept as (port?: number) => void)(forward.bindPort);
        } else if (name === "cancel-tcpip-forward") {
          stats.cancelledForwards.push(`${forward.bindAddr}:${forward.bindPort}`);
          listeners.delete(forward.bindPort);
          accept?.();
        } else {
          reject?.();
        }
      });

      client.on("tcpip", (accept, reject, info) => {
        stats.forwards.push(`${info.destIP}:${info.destPort}`);
        const socket = net.connect(info.destPort, info.destIP);
        socket.once("connect", () => {
          const channel = accept();
          channel.pipe(socket).pipe(channel);
          channel.on("close", () => socket.destroy());
        });
        socket.once("error", () => reject());
      });
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as net.AddressInfo).port;

  return {
    port,
    root,
    stats,
    connectInbound(bindPort, payload, opts) {
      const target = opts?.force ? lastRequested.get(bindPort) : listeners.get(bindPort);
      if (!target) return Promise.reject(new Error(`nothing is listening on remote port ${bindPort}`));
      return new Promise((resolve, reject) => {
        target.forwardOut("127.0.0.1", bindPort, "127.0.0.1", 50_000, (err, channel) => {
          if (err) return reject(err);
          channel.once("data", (d: Buffer) => {
            channel.end();
            resolve(d.toString("utf8"));
          });
          channel.on("error", reject);
          channel.write(payload);
        });
      });
    },
    dropConnections() {
      for (const c of connections) c.end();
    },
    async close() {
      for (const c of connections) c.end();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

/** A plain TCP echo server, as something for tunnels to forward to. `stats.connections` counts connections it has accepted. */
export async function startEchoServer(): Promise<{ port: number; stats: { connections: number }; close(): Promise<void> }> {
  const sockets = new Set<net.Socket>();
  const stats = { connections: 0 };
  const server = net.createServer((socket) => {
    stats.connections++;
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
    socket.pipe(socket);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    port: (server.address() as net.AddressInfo).port,
    stats,
    close: async () => {
      for (const s of sockets) s.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/** A port nothing is listening on right now. */
export async function freePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as net.AddressInfo).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

/** A saved password-auth host pointing at a test server (secret id "pw", see the tests' secretStore mock). */
export function testHost(port: number, overrides: Partial<HostRecord> = {}): HostRecord {
  return {
    id: "host-1",
    name: "test host",
    hostname: "127.0.0.1",
    port,
    username: TEST_USER,
    groupId: null,
    authMethod: "password",
    secretId: "pw",
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}
