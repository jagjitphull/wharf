// A small SSH server for the e2e scenarios that need a real remote host: password
// auth, a shell that prints a prompt and echoes what it is sent. The app is told to
// trust its host key by writing the line `knownHostsLine()` into ~/.ssh/known_hosts.

import ssh2 from "ssh2";

const { Server, utils } = ssh2;

export const SSH_USER = "tester";
export const SSH_PASSWORD = "correct-horse";

export async function startSshServer() {
  const { private: hostKey } = utils.generateKeyPairSync("ed25519");
  const parsed = utils.parseKey(hostKey);
  const blob = (Array.isArray(parsed) ? parsed[0] : parsed).getPublicSSH();
  const sockets = new Set();

  const server = new Server({ hostKeys: [hostKey] }, (client) => {
    client.on("authentication", (ctx) => {
      if (ctx.method === "password" && ctx.username === SSH_USER && ctx.password === SSH_PASSWORD) ctx.accept();
      else ctx.reject(["password"]);
    });
    client.on("ready", () => {
      client.on("session", (accept) => {
        const session = accept();
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
    /** The line that makes the app trust this server's host key. */
    knownHostsLine: () => `[127.0.0.1]:${port} ssh-ed25519 ${blob.toString("base64")}\n`,
    async close() {
      for (const s of sockets) s.destroy();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
