import net from "node:net";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { SSH_PASSWORD, SSH_USER, startSshServer } from "../sshServer.mjs";

export const name = "host-tunnel";

/** A TCP server that answers every connection with `reply` once it has received a line. */
function startReplyServer(reply) {
  return new Promise((resolve) => {
    const server = net.createServer((sock) => {
      sock.on("data", () => sock.end(reply));
      sock.on("error", () => {});
    });
    server.listen(0, "127.0.0.1", () => resolve({ port: server.address().port, close: () => new Promise((r) => server.close(r)) }));
  });
}

/** Connects to 127.0.0.1:port, sends a line, and returns what comes back. */
function ask(port) {
  return new Promise((resolve) => {
    const sock = net.connect(port, "127.0.0.1", () => sock.write("hello\n"));
    let got = "";
    sock.on("data", (d) => (got += d));
    sock.on("close", () => resolve(got));
    sock.on("error", () => resolve(null));
    setTimeout(() => {
      sock.destroy();
      resolve(got || null);
    }, 4000);
  });
}

// "Port forward…" on a host card: create a tunnel and start it, without visiting the Tunnels page.
export async function run(t, start) {
  const server = await startSshServer();
  const service = await startReplyServer("service-says-hi");
  try {
    const app = await start();
    await app.until(() => app.q(".home"), 15_000);
    mkdirSync(path.join(app.home, ".ssh"), { recursive: true });
    writeFileSync(path.join(app.home, ".ssh", "known_hosts"), server.knownHostsLine());
    await app.ev(
      `window.wharf.hosts.create(${JSON.stringify({ name: "lab-ssh", hostname: "127.0.0.1", port: server.port, username: SSH_USER, authMethod: "password", secret: SSH_PASSWORD, groupId: null })})`,
    );
    await app.reload();
    await app.until(() => app.q(".host-card"), 10_000);
    const statuses = () => app.evJson(`window.wharf.tunnels.statuses()`);

    // --- the entry points
    t.ok("the card has a Port forward button", !!(await app.q(`.host-card-actions button[aria-label="Port forward"]`)));
    await app.rightClick(".host-card");
    t.ok(
      "…and the right-click menu has Port forward…",
      (await app.menuItems()).includes("Port forward…"),
      JSON.stringify(await app.menuItems()),
    );
    await app.clickText(".context-menu-item", "Port forward…");
    await app.until(() => app.q(".tunnel-dialog"), 3000);
    t.ok("the dialog opens for that host", /lab-ssh/.test((await app.q(".tunnel-dialog h2", "(e) => e.textContent")) ?? ""));

    // --- defaults and presets
    const field = (sel) => app.q(sel, "(e) => e.value");
    t.ok(
      "it starts as a local forward to PostgreSQL, listening on the same port",
      (await field(`input[aria-label="Listening port"]`)) === "5432",
    );
    await app.ev(`[...document.querySelectorAll('.tunnel-preset')].find((b) => b.textContent.startsWith('Web'))?.click()`);
    t.ok("choosing Web shifts the listening port off the privileged 80", (await field(`input[aria-label="Listening port"]`)) === "8080");
    t.ok(
      "the name follows the ports",
      (await app.evJson(
        `[...document.querySelectorAll('.tunnel-dialog label')].find((l) => l.firstChild.textContent === 'Name').querySelector('input').value`,
      )) === "lab-ssh: 8080 → 80",
    );
    await app.shot("host-tunnel-dialog");

    // --- invalid input is stopped before anything is saved
    await app.ev(
      `(() => { const i = document.querySelector('input[aria-label="Listening port"]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, '70000'); i.dispatchEvent(new Event('input', { bubbles: true })); })()`,
    );
    await app.click(`.tunnel-dialog button[type=submit]`);
    await app.until(() => app.q(".tunnel-dialog .dialog-error"), 3000);
    t.ok(
      "a port out of range is refused with a message",
      /1 to 65535/.test((await app.q(".tunnel-dialog .dialog-error", "(e) => e.textContent")) ?? ""),
    );
    t.ok("…and nothing was saved", (await app.evJson(`window.wharf.tunnels.list()`)).length === 0);

    // --- a real tunnel to a real service
    const listenPort = service.port + 1000 > 65000 ? service.port - 1000 : service.port + 1000;
    const setValue = (selector, value) =>
      app.ev(
        `(() => { const i = document.querySelector(${JSON.stringify(selector)}); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, ${JSON.stringify(String(value))}); i.dispatchEvent(new Event('input', { bubbles: true })); })()`,
      );
    await setValue(`input[aria-label="Listening port"]`, listenPort);
    await app.ev(
      `(() => { const row = [...document.querySelectorAll('.tunnel-dialog .dialog-row')][0]; const port = row.querySelector('input[type=number]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(port, ${service.port}); port.dispatchEvent(new Event('input', { bubbles: true })); })()`,
    );
    await app.click(`.tunnel-dialog button[type=submit]`);
    await app.until(async () => !(await app.q(".tunnel-dialog")), 15_000);
    const saved = await app.evJson(`window.wharf.tunnels.list()`);
    t.ok(
      "the tunnel is saved against the host with the chosen ports",
      saved.length === 1 && saved[0].type === "local" && saved[0].srcPort === listenPort && saved[0].dstPort === service.port,
      JSON.stringify(saved),
    );
    await app.until(async () => (await statuses()).some((s) => s.status === "running"), 10_000);
    t.ok(
      "…and it is running",
      (await statuses()).some((s) => s.status === "running"),
    );
    t.ok("traffic to the local port reaches the remote service", (await ask(listenPort)) === "service-says-hi");
    t.ok("a toast says it is running", /Tunnel running/.test((await app.q(".toast", "(e) => e?.textContent")) ?? ""));
    await app.until(() => app.q(".host-card-tunnels"), 5000);
    t.ok("the host card shows a tunnel mark", (await app.q(".host-card-tunnels", "(e) => e.textContent")) === "⇄ 1");
    await app.shot("host-tunnel-card");

    // --- a port that is taken: saved, but the failure is reported
    const blocker = net.createServer().listen(0, "127.0.0.1");
    await new Promise((r) => blocker.once("listening", r));
    const busyPort = blocker.address().port;
    await app.rightClick(".host-card");
    await app.clickText(".context-menu-item", "Port forward…");
    await app.until(() => app.q(".tunnel-dialog"), 3000);
    await setValue(`input[aria-label="Listening port"]`, busyPort);
    await app.click(`.tunnel-dialog button[type=submit]`);
    await app.until(async () => !(await app.q(".tunnel-dialog")), 15_000);
    await app.until(
      async () =>
        /couldn't start/.test((await app.evJson(`[...document.querySelectorAll('.toast')].map((e) => e.textContent).join('|')`)) ?? ""),
      5000,
    );
    t.ok(
      "a port already in use is reported, and the tunnel is still saved",
      (await app.evJson(`window.wharf.tunnels.list()`)).length === 2,
    );
    blocker.close();

    // --- the same listening port twice is caught in the dialog
    await app.rightClick(".host-card");
    await app.clickText(".context-menu-item", "Port forward…");
    await app.until(() => app.q(".tunnel-dialog"), 3000);
    await setValue(`input[aria-label="Listening port"]`, listenPort);
    await app.sleep(200);
    t.ok("a port another tunnel already listens on is flagged", !!(await app.q(".tunnel-clash")));
    await app.click(`.tunnel-dialog button[type=submit]`);
    await app.sleep(300);
    t.ok("…and can't be created", !!(await app.q(".tunnel-dialog")) && (await app.evJson(`window.wharf.tunnels.list()`)).length === 2);
    await app.press("Escape");
  } finally {
    await service.close();
    await server.close();
  }
}
