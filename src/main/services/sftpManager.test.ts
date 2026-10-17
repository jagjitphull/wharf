import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { IPC, type HostRecord } from "../../shared/types";
import { startTestSshServer, testHost, type TestSshServer } from "../testing/sshTestServer";

const h = vi.hoisted(() => ({ hosts: [] as HostRecord[], sent: [] as { channel: string; payload: any }[] }));
vi.mock("electron", () => ({
  BrowserWindow: {
    getAllWindows: () => [{ webContents: { send: (channel: string, payload: unknown) => h.sent.push({ channel, payload }) } }],
  },
}));
vi.mock("./store", () => ({ getHosts: () => h.hosts, getCommandBlocksEnabled: () => false }));
vi.mock("./secretStore", async () => {
  const { TEST_PASSWORD } = await import("../testing/sshTestServer");
  return { readSecret: (id: string | null) => (id === "pw" ? TEST_PASSWORD : null) };
});
vi.mock("./knownHosts", () => ({ verifyHostKeyInteractive: async () => true }));

let server: TestSshServer;
let sftp: typeof import("./sftpManager");
let ssh: typeof import("./sshManager");
let pool: typeof import("./connectionPool");
let local: string; // scratch directory on the "client" side

const remote = (...p: string[]) => path.join(server.root, ...p);
const progress = (transferId: string) =>
  h.sent.filter((e) => e.channel === IPC.sftp.onProgress && e.payload.transferId === transferId).map((e) => e.payload);

async function until(check: () => boolean, what: string, timeoutMs = 8000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}
const transferDone = async (id: string) => {
  await until(() => progress(id).some((p) => p.done), "the transfer to finish");
  return progress(id).find((p) => p.done)!;
};

beforeAll(async () => {
  server = await startTestSshServer();
});
afterAll(async () => {
  await server.close();
});

beforeEach(async () => {
  h.hosts = [testHost(server.port, { id: "a" }), testHost(server.port, { id: "b", name: "second" })];
  h.sent = [];
  for (const f of fs.readdirSync(server.root)) fs.rmSync(remote(f), { recursive: true, force: true });
  local = fs.mkdtempSync(path.join(os.tmpdir(), "wharf-sftptest-local-"));
  vi.resetModules();
  sftp = await import("./sftpManager");
  ssh = await import("./sshManager");
  pool = await import("./connectionPool");
});
afterEach(async () => {
  sftp.closeAllSftp();
  fs.rmSync(local, { recursive: true, force: true });
  await until(() => server.stats.open === 0, "connections to close");
});

describe("list", () => {
  it("lists a directory with types, sizes and permissions, directories first then by name", async () => {
    fs.mkdirSync(remote("zeta-dir"));
    fs.mkdirSync(remote("alpha-dir"));
    fs.writeFileSync(remote("b.txt"), "12345");
    fs.writeFileSync(remote("a.txt"), "");
    fs.chmodSync(remote("b.txt"), 0o640);

    const entries = await sftp.list("a", "/");
    expect(entries.map((e) => e.name)).toEqual(["alpha-dir", "zeta-dir", "a.txt", "b.txt"]);
    expect(entries.map((e) => e.type)).toEqual(["directory", "directory", "file", "file"]);
    const b = entries.find((e) => e.name === "b.txt")!;
    // (Windows files have no Unix permission bits to set, so only check them elsewhere.)
    expect(b).toMatchObject({ path: "/b.txt", size: 5, ...(process.platform === "win32" ? {} : { permissions: "-rw-r-----" }) });
    expect(entries[0].permissions.startsWith("d")).toBe(true);
  });

  it("joins nested paths with forward slashes", async () => {
    fs.mkdirSync(remote("one"));
    fs.writeFileSync(remote("one", "f.txt"), "x");
    expect((await sftp.list("a", "/one"))[0].path).toBe("/one/f.txt");
  });

  it("returns an empty list for an empty directory", async () => {
    expect(await sftp.list("a", "/")).toEqual([]);
  });

  it("rejects for a directory that doesn't exist", async () => {
    await expect(sftp.list("a", "/missing")).rejects.toThrow();
  });

  it("reports a symlink as a symlink", async () => {
    fs.writeFileSync(remote("real.txt"), "x");
    fs.symlinkSync("real.txt", remote("link.txt"));
    expect((await sftp.list("a", "/")).find((e) => e.name === "link.txt")!.type).toBe("symlink");
  });
});

describe("editing files in place", () => {
  it("reads and writes UTF-8 text, including multi-byte characters", async () => {
    const text = "héllo wörld — 日本語 🚢\nsecond line\n";
    await sftp.writeFile("a", "/note.txt", text);
    expect(fs.readFileSync(remote("note.txt"), "utf8")).toBe(text);
    expect(await sftp.readFile("a", "/note.txt")).toBe(text);
  });

  it("overwrites an existing file completely (no leftover tail from a longer old version)", async () => {
    fs.writeFileSync(remote("f.txt"), "a much longer original body");
    await sftp.writeFile("a", "/f.txt", "short");
    expect(fs.readFileSync(remote("f.txt"), "utf8")).toBe("short");
  });

  it("refuses to open a file over 2 MB for editing and says how big it is", async () => {
    fs.writeFileSync(remote("big.log"), Buffer.alloc(3 * 1024 * 1024, "x"));
    await expect(sftp.readFile("a", "/big.log")).rejects.toThrow(/too large.*3\.0 MB/);
  });

  it("rejects reading a file that doesn't exist", async () => {
    await expect(sftp.readFile("a", "/nope.txt")).rejects.toThrow();
  });
});

describe("file operations", () => {
  it("creates, renames and removes files and directories", async () => {
    await sftp.mkdir("a", "/newdir");
    expect(fs.statSync(remote("newdir")).isDirectory()).toBe(true);

    await sftp.writeFile("a", "/newdir/f.txt", "x");
    await sftp.rename("a", "/newdir/f.txt", "/newdir/g.txt");
    expect(fs.existsSync(remote("newdir", "f.txt"))).toBe(false);
    expect(fs.readFileSync(remote("newdir", "g.txt"), "utf8")).toBe("x");

    await sftp.unlink("a", "/newdir/g.txt");
    expect(fs.existsSync(remote("newdir", "g.txt"))).toBe(false);

    await sftp.rmdir("a", "/newdir");
    expect(fs.existsSync(remote("newdir"))).toBe(false);
  });

  it("refuses to remove a directory that still has files in it", async () => {
    fs.mkdirSync(remote("full"));
    fs.writeFileSync(remote("full", "keep.txt"), "x");
    await expect(sftp.rmdir("a", "/full")).rejects.toThrow();
    expect(fs.existsSync(remote("full", "keep.txt"))).toBe(true);
  });

  it("rejects operations on things that don't exist, and creating what already exists", async () => {
    await expect(sftp.unlink("a", "/ghost")).rejects.toThrow();
    await expect(sftp.rename("a", "/ghost", "/other")).rejects.toThrow();
    fs.mkdirSync(remote("exists"));
    await expect(sftp.mkdir("a", "/exists")).rejects.toThrow();
  });
});

describe("transfers", () => {
  it("uploads a multi-chunk file intact and reports progress ending in success", async () => {
    const data = Buffer.alloc(400 * 1024);
    for (let i = 0; i < data.length; i++) data[i] = i % 251;
    fs.writeFileSync(path.join(local, "up.bin"), data);

    const id = await sftp.upload("a", path.join(local, "up.bin"), "/up.bin");
    const done = await transferDone(id);
    expect(done.error).toBeUndefined();
    expect(done).toMatchObject({ direction: "upload", fileName: "up.bin", hostId: "a" });
    expect(fs.readFileSync(remote("up.bin")).equals(data)).toBe(true);
    expect(progress(id).some((p) => !p.done && p.bytesTransferred > 0)).toBe(true);
  });

  it("downloads a file intact", async () => {
    const data = Buffer.from("remote contents ".repeat(20_000));
    fs.writeFileSync(remote("down.txt"), data);
    const id = await sftp.download("a", "/down.txt", path.join(local, "down.txt"));
    const done = await transferDone(id);
    expect(done.error).toBeUndefined();
    expect(done.direction).toBe("download");
    expect(fs.readFileSync(path.join(local, "down.txt")).equals(data)).toBe(true);
  });

  it("reports a failed download through the same progress channel", async () => {
    const id = await sftp.download("a", "/not-there.txt", path.join(local, "x.txt"));
    const done = await transferDone(id);
    expect(done.error).toBeTruthy();
  });

  it("reports a failed upload (missing local file) instead of throwing", async () => {
    const id = await sftp.upload("a", path.join(local, "ghost.bin"), "/ghost.bin");
    expect((await transferDone(id)).error).toBeTruthy();
  });

  it("copies a file between two hosts without touching local disk", async () => {
    const data = Buffer.from("server to server ".repeat(5000));
    fs.writeFileSync(remote("src.txt"), data);
    fs.mkdirSync(remote("dest"));
    const id = await sftp.transferBetweenHosts("a", "/src.txt", "b", "/dest");
    const done = await transferDone(id);
    expect(done.error).toBeUndefined();
    expect(done).toMatchObject({ hostId: "b", fileName: "src.txt", direction: "upload" });
    expect(fs.readFileSync(remote("dest", "src.txt")).equals(data)).toBe(true);
    expect(fs.readdirSync(local)).toEqual([]);
  });
});

describe("search", () => {
  beforeEach(() => {
    fs.mkdirSync(remote("proj", "src", "deep"), { recursive: true });
    fs.writeFileSync(remote("proj", "README.md"), "");
    fs.writeFileSync(remote("proj", "src", "readme-notes.txt"), "");
    fs.writeFileSync(remote("proj", "src", "deep", "ReadMe.rst"), "");
    fs.writeFileSync(remote("proj", "src", "main.ts"), "");
  });

  it("finds matches at any depth, case-insensitively, by substring", async () => {
    const results = await sftp.search("a", "/", "readme");
    expect(results.map((r) => r.path).sort()).toEqual(["/proj/README.md", "/proj/src/deep/ReadMe.rst", "/proj/src/readme-notes.txt"]);
  });

  it("returns directories that match too, typed as directories", async () => {
    const results = await sftp.search("a", "/", "deep");
    expect(results).toEqual([expect.objectContaining({ path: "/proj/src/deep", type: "directory" })]);
  });

  it("returns nothing when nothing matches", async () => {
    expect(await sftp.search("a", "/", "zzz-no-such-name")).toEqual([]);
  });

  it("does not follow symlinks (a link back up the tree can't cause endless recursion)", async () => {
    fs.symlinkSync(remote("proj"), remote("proj", "src", "loop"));
    const results = await sftp.search("a", "/", "readme");
    expect(results).toHaveLength(3);
  });

  it("stops at 200 results", async () => {
    fs.mkdirSync(remote("many"));
    for (let i = 0; i < 260; i++) fs.writeFileSync(remote("many", `match-${i}.txt`), "");
    expect((await sftp.search("a", "/many", "match")).length).toBe(200);
  });
});

describe("connection handling", () => {
  it("reuses one connection for repeated browsing", async () => {
    await sftp.list("a", "/");
    await sftp.list("a", "/");
    await sftp.readFile("a", "/").catch(() => {});
    expect(server.stats.open).toBe(1);
    expect(pool.poolRefCount("a")).toBe(1);
  });

  it("shares a single SSH connection with an open terminal session on the same host", async () => {
    const sessionId = await ssh.connect("a", 80, 24);
    await sftp.list("a", "/");
    expect(server.stats.open).toBe(1);
    expect(pool.poolRefCount("a")).toBe(2);

    sftp.closeSftpForHost("a");
    expect(pool.poolRefCount("a")).toBe(1);
    expect(server.stats.open).toBe(1); // the terminal still needs it
    ssh.disconnect(sessionId);
  });

  it("closing the browser for a host releases its connection when nothing else uses it", async () => {
    await sftp.list("a", "/");
    sftp.closeSftpForHost("a");
    await until(() => server.stats.open === 0, "the idle connection to close");
  });

  it("reopens transparently after being closed", async () => {
    fs.writeFileSync(remote("f.txt"), "x");
    await sftp.list("a", "/");
    sftp.closeSftpForHost("a");
    await until(() => server.stats.open === 0, "the connection to close");
    expect((await sftp.list("a", "/")).map((e) => e.name)).toEqual(["f.txt"]);
  });

  it("rejects cleanly for a host that isn't saved", async () => {
    await expect(sftp.list("ghost", "/")).rejects.toThrow(/not found/i);
  });
});
