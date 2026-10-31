import fs from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { HostRecord } from "../../shared/types";
import { startTestSshServer, testHost, type TestSshServer } from "../testing/sshTestServer";

const h = vi.hoisted(() => ({ hosts: [] as HostRecord[] }));
vi.mock("electron", () => ({ BrowserWindow: { getAllWindows: () => [] } }));
vi.mock("./store", () => ({ getHosts: () => h.hosts, getCommandBlocksEnabled: () => false }));
vi.mock("./secretStore", async () => {
  const { TEST_PASSWORD } = await import("../testing/sshTestServer");
  return { readSecret: (id: string | null) => (id === "pw" ? TEST_PASSWORD : null) };
});
vi.mock("./knownHosts", () => ({ verifyHostKeyInteractive: async () => true }));

const KEY = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOWnV0mYb3bGvJtLzPzZ4qS6Cw7tQ4mXy9aBcDeFgHiJ me@laptop";
const OTHER = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGJ1c3QgYW5vdGhlciBrZXkgZm9yIHRoZSB0ZXN0cw other@box";

let server: TestSshServer;
let install: typeof import("./installKey");
let pool: typeof import("./connectionPool");
const authorized = () => path.join(server.root, ".ssh", "authorized_keys");

beforeAll(async () => {
  server = await startTestSshServer();
});
afterAll(async () => {
  await server.close();
});
beforeEach(async () => {
  h.hosts = [testHost(server.port, { id: "a" })];
  server.stats.execs.length = 0;
  fs.rmSync(path.join(server.root, ".ssh"), { recursive: true, force: true });
  vi.resetModules();
  install = await import("./installKey");
  pool = await import("./connectionPool");
});
afterEach(async () => {
  expect(pool.poolRefCount("a")).toBe(0); // every call let go of the connection
});

describe("installPublicKey", () => {
  it("creates ~/.ssh and authorized_keys with safe permissions and adds the key", async () => {
    expect(await install.installPublicKey("a", KEY)).toEqual({ added: true });
    expect(fs.readFileSync(authorized(), "utf8")).toBe(KEY + "\n");
    if (process.platform !== "win32") {
      // (Windows has no POSIX permission bits to check.)
      expect(fs.statSync(path.join(server.root, ".ssh")).mode & 0o777).toBe(0o700);
      expect(fs.statSync(authorized()).mode & 0o777).toBe(0o600);
    }
  });

  it("adds a key only once", async () => {
    await install.installPublicKey("a", KEY);
    expect(await install.installPublicKey("a", KEY)).toEqual({ added: false });
    expect(fs.readFileSync(authorized(), "utf8")).toBe(KEY + "\n");
  });

  it("keeps the keys that are already there, and adds the new one on its own line", async () => {
    fs.mkdirSync(path.join(server.root, ".ssh"), { mode: 0o700 });
    fs.writeFileSync(authorized(), OTHER + "\n");
    expect(await install.installPublicKey("a", KEY)).toEqual({ added: true });
    expect(fs.readFileSync(authorized(), "utf8")).toBe(OTHER + "\n" + KEY + "\n");
  });

  it("refuses anything that isn't a plain key line, before connecting", async () => {
    const connectionsBefore = server.stats.total;
    await expect(install.installPublicKey("a", `${KEY}'; touch /tmp/pwned; echo '`)).rejects.toThrow(/public key/);
    await expect(install.installPublicKey("a", "not a key")).rejects.toThrow(/public key/);
    expect(server.stats.execs).toEqual([]);
    expect(server.stats.total).toBe(connectionsBefore);
  });

  it("surfaces a failure on the host", async () => {
    fs.mkdirSync(path.join(server.root, ".ssh"));
    fs.mkdirSync(authorized()); // a directory where the file should be
    await expect(install.installPublicKey("a", KEY)).rejects.toThrow();
  });

  it("fails clearly for a host that isn't saved", async () => {
    await expect(install.installPublicKey("missing", KEY)).rejects.toThrow(/not found/);
  });
});
