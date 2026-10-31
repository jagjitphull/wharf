// A small SSH server for the e2e scenarios that need a real remote host: password
// auth, a shell that prints a prompt and echoes what it is sent, and local port
// forwarding (direct-tcpip, to any port on this machine), and `exec` (run by sh with HOME
// set to `server.home`, so nothing touches the real home). The app is told to
// trust its host key by writing the line `knownHostsLine()` into ~/.ssh/known_hosts.

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import ssh2 from "ssh2";

const { Server, utils } = ssh2;

export const SSH_USER = "tester";
export const SSH_PASSWORD = "correct-horse";

export async function startSshServer() {
  const { private: hostKey } = utils.generateKeyPairSync("ed25519");
  const parsed = utils.parseKey(hostKey);
  const blob = (Array.isArray(parsed) ? parsed[0] : parsed).getPublicSSH();
  const sockets = new Set();
  const home = mkdtempSync(path.join(tmpdir(), "wharf-e2e-remote-"));

  const server = new Server({ hostKeys: [hostKey] }, (client) => {
    client.on("authentication", (ctx) => {
      if (ctx.method === "password" && ctx.username === SSH_USER && ctx.password === SSH_PASSWORD) ctx.accept();
      else ctx.reject(["password"]);
    });
    client.on("ready", () => {
      client.on("tcpip", (accept, reject, info) => {
        const upstream = net.connect(info.destPort, info.destIP, () => {
          const channel = accept();
          channel.pipe(upstream).pipe(channel);
          channel.on("close", () => upstream.destroy());
        });
        upstream.on("error", () => reject());
      });
      client.on("session", (accept) => {
        const session = accept();
        session.on("exec", (acceptExec, _reject, info) => {
          const stream = acceptExec();
          const child = spawn("sh", ["-c", info.command], { cwd: home, env: { ...process.env, HOME: home } });
          child.stdout.on("data", (d) => stream.write(d));
          child.stderr.on("data", (d) => stream.stderr.write(d));
          child.on("close", (code) => {
            stream.exit(code ?? 1);
            stream.end();
          });
        });
        session.on("pty", (acceptPty) => acceptPty());
        session.on("window-change", (acceptWindow) => acceptWindow?.());
        session.on("shell", (acceptShell) => {
          const stream = acceptShell();
          stream.write("e2e-remote$ ");
          stream.on("data", (d) => stream.write(String(d).replace(/\r/g, "\r\n")));
        });
      });
    });
    client.on("error", () => {});
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  return {
    port,
    /** The remote side's home directory (where `exec` commands run). */
    home,
    /** The line that makes the app trust this server's host key. */
    knownHostsLine: () => `[127.0.0.1]:${port} ssh-ed25519 ${blob.toString("base64")}\n`,
    async close() {
      for (const s of sockets) typeof s.destroy === "function" ? s.destroy() : s.end(); // an ssh2 Connection ends, a socket is destroyed
      await new Promise((resolve) => server.close(resolve));
      rmSync(home, { recursive: true, force: true });
    },
  };
}
