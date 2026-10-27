import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { SSH_PASSWORD, SSH_USER, startSshServer } from "../sshServer.mjs";

export const name = "last-connected";

export async function run(t, start) {
  const server = await startSshServer();
  try {
    let app = await start();
    await app.until(() => app.q(".home"), 15_000);
    // Trust the server's host key up front so connecting doesn't stop at the unknown-host prompt.
    mkdirSync(path.join(app.home, ".ssh"), { recursive: true });
    writeFileSync(path.join(app.home, ".ssh", "known_hosts"), server.knownHostsLine());

    const host = await app.evJson(
      `window.wharf.hosts.create(${JSON.stringify({ name: "lab-ssh", hostname: "127.0.0.1", port: server.port, username: SSH_USER, authMethod: "password", secret: SSH_PASSWORD, groupId: null })})`,
    );
    await app.reload();
    await app.until(() => app.q(".host-card"), 10_000);
    const sections = () => app.evJson(`[...document.querySelectorAll('.home-section h3')].map((h) => h.firstChild.textContent)`);
    const lastText = () => app.q(".host-card-last", "(e) => e?.textContent ?? null");

    t.ok("a host that never connected says so rather than showing a time", (await lastText()) === "Never connected");
    t.ok("…and there is no Recent section", !(await sections()).includes("Recent"), JSON.stringify(await sections()));

    await app.click(".host-card");
    t.ok("connecting opens a terminal on the remote host", await app.waitScreen(/e2e-remote\$/, 20_000));
    const stored = (await app.evJson(`window.wharf.hosts.list()`)).find((h) => h.id === host.id);
    t.ok(
      "the connection time is recorded on the host",
      typeof stored.lastConnectedAt === "number" && Date.now() - stored.lastConnectedAt < 30_000,
      JSON.stringify(stored.lastConnectedAt),
    );

    await app.click(".home-tab");
    await app.until(async () => (await lastText()) === "just now", 5000);
    t.ok("coming back to Home, the card says it connected just now", (await lastText()) === "just now", String(await lastText()));
    t.ok(
      "the live session has its own section, ahead of everything",
      (await sections())[0] === "Connected now",
      JSON.stringify(await sections()),
    );
    t.ok("…and Recent leaves out a host that is connected right now", !(await sections()).includes("Recent"));

    await app.click(".tab-strip .tab-close");
    await app.until(() => app.q(".home"), 5000);
    await app.until(async () => (await sections()).includes("Recent"), 5000);
    t.ok("after closing the session the host appears under Recent", (await sections())[0] === "Recent", JSON.stringify(await sections()));

    const update = await app.evJson(
      `window.wharf.hosts.update(${JSON.stringify(host.id)}, ${JSON.stringify({ name: "lab-ssh", hostname: "127.0.0.1", port: server.port, username: SSH_USER, authMethod: "password", groupId: null })})`,
    );
    t.ok(
      "editing the host keeps its last-connected time",
      update.lastConnectedAt === stored.lastConnectedAt,
      JSON.stringify(update.lastConnectedAt),
    );

    await app.shot("recent-row");
    const { profile, home } = app;
    await app.stop();
    app = await start({ profile, home });
    await app.until(() => app.q(".host-card"), 15_000);
    t.ok(
      "it survives a restart",
      (await app.evJson(`window.wharf.hosts.list()`)).find((h) => h.id === host.id).lastConnectedAt === stored.lastConnectedAt,
    );
  } finally {
    await server.close();
  }
}
