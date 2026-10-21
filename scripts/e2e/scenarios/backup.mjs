import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { SSH_PASSWORD, SSH_USER, startSshServer } from "../sshServer.mjs";

export const name = "backup";

// Export from one Wharf, import into a fresh one: records, settings and (sealed) passwords arrive, and
// importing the same file again adds nothing.
export async function run(t, start) {
  const server = await startSshServer();
  const dir = mkdtempSync(path.join(tmpdir(), "wharf-backup-e2e-"));
  const backupFile = path.join(dir, "backup.json");
  const PASS = "a long backup passphrase";
  try {
    // --- app A: some data, then Settings → Export backup…
    let app = await start({ env: { WHARF_E2E_BACKUP_FILE: backupFile } });
    await app.until(() => app.q(".home"), 15_000);
    mkdirSync(path.join(app.home, ".ssh"), { recursive: true });
    writeFileSync(path.join(app.home, ".ssh", "known_hosts"), server.knownHostsLine());
    const group = await app.evJson(`window.wharf.groups.create({ name: "Lab", parentId: null })`);
    const hostA = await app.evJson(
      `window.wharf.hosts.create(${JSON.stringify({ name: "lab-ssh", hostname: "127.0.0.1", port: server.port, username: SSH_USER, authMethod: "password", secret: SSH_PASSWORD, groupId: group.id, mosh: false })})`,
    );
    await app.ev(
      `window.wharf.hosts.create(${JSON.stringify({ name: "bastion", hostname: "bastion.example", port: 2200, username: "ops", authMethod: "agent", groupId: null })})`,
    );
    await app.ev(
      `window.wharf.tunnels.create(${JSON.stringify({ hostId: hostA.id, name: "web", type: "local", srcHost: "127.0.0.1", srcPort: 18080, dstHost: "127.0.0.1", dstPort: 80, autoStart: true })})`,
    );
    await app.ev(`window.wharf.snippets.create({ name: "Disk", command: "df -h {{path:/}}", run: true })`);
    await app.ev(
      `window.wharf.workspaces.create({ name: "Lab view", tabs: [{ layout: { type: "leaf", hostId: ${JSON.stringify(hostA.id)}, scrollback: "SECRET-SCROLLBACK" } }] })`,
    );
    await app.ev(`localStorage.setItem("wharf-accent-color", "rose")`);

    await app.rail("Settings");
    await app.until(() => app.q(".backup-actions"), 8000);
    await app.ev(`document.querySelector('.backup-actions')?.scrollIntoView({ block: "center" })`);
    await app.clickText(".backup-actions button", "Export backup…");
    await app.until(() => app.q(".backup-dialog"), 3000);
    t.ok(
      "Export offers the parts, with hosts and groups always in",
      (await app.evJson(`[...document.querySelectorAll('.backup-dialog .backup-check')].map((l) => l.textContent.trim())`)).length === 6,
    );
    // passwords are opt-in: nothing asks for a passphrase until it's ticked
    t.ok("no passphrase field until saved passwords are ticked", !(await app.q(`.backup-dialog input[type=password]`)));
    await app.ev(`document.querySelector('.backup-secrets-toggle input').click()`);
    await app.until(() => app.q(`.backup-dialog input[type=password]`), 3000);
    await app.ev(`document.querySelectorAll('.backup-dialog input[type=password]')[0].focus()`);
    await app.send("Input.insertText", { text: PASS });
    await app.ev(`document.querySelectorAll('.backup-dialog input[type=password]')[1].focus()`);
    await app.send("Input.insertText", { text: "something different" });
    await app.click(".backup-dialog button[type=submit]");
    await app.until(() => app.q(".backup-dialog .dialog-error"), 3000);
    t.ok(
      "mismatched passphrases are refused",
      /don't match/.test((await app.q(".backup-dialog .dialog-error", "(e) => e.textContent")) ?? "") && !readFileExists(backupFile),
    );
    await app.ev(`(() => { const i = document.querySelectorAll('.backup-dialog input[type=password]')[1]; i.focus(); i.select(); })()`);
    await app.send("Input.insertText", { text: PASS });
    await app.shot("backup-export");
    await app.click(".backup-dialog button[type=submit]");
    await app.until(async () => !(await app.q(".backup-dialog")), 15_000);
    const text = readFileSync(backupFile, "utf8");
    const parsed = JSON.parse(text);
    t.ok(
      "the file has the hosts, group, tunnel, snippet, workspace and settings",
      parsed.version === 2 &&
        parsed.hosts.length === 2 &&
        parsed.groups.length === 1 &&
        parsed.tunnels.length === 1 &&
        parsed.snippets.length === 1 &&
        parsed.workspaces.length === 1 &&
        parsed.settings?.renderer?.["wharf-accent-color"] === "rose",
    );
    t.ok("saved passwords are in it only as sealed text", !text.includes(SSH_PASSWORD) && Object.keys(parsed.secrets.items).length === 1);
    t.ok("…and no terminal scrollback", !text.includes("SECRET-SCROLLBACK") && !text.includes(PASS));
    t.ok("the file is private to the user", (statSync(backupFile).mode & 0o077) === 0);
    await app.close();

    // --- app B: fresh, import it
    app = await start({ env: { WHARF_E2E_BACKUP_FILE: backupFile } });
    await app.until(() => app.q(".home"), 15_000);
    mkdirSync(path.join(app.home, ".ssh"), { recursive: true });
    writeFileSync(path.join(app.home, ".ssh", "known_hosts"), server.knownHostsLine());
    await app.rail("Settings");
    await app.until(() => app.q(".backup-actions"), 8000);
    await app.clickText(".backup-actions button", "Import backup…");
    await app.until(() => app.q(".backup-dialog"), 5000);
    const labels = await app.evJson(`[...document.querySelectorAll('.backup-dialog .backup-check')].map((l) => l.textContent.trim())`);
    t.ok(
      "the import dialog says what is in the file",
      labels[0] === "2 hosts and 1 group" &&
        labels.some((l) => l === "1 tunnel") &&
        labels.some((l) => l === "1 snippet") &&
        labels.some((l) => l === "1 workspace"),
      JSON.stringify(labels),
    );
    t.ok(
      "App settings are not ticked by default",
      (await app.evJson(`[...document.querySelectorAll('.backup-dialog .backup-check input')].map((i) => i.checked)`)).includes(false),
    );
    await app.shot("backup-import");

    await app.click(".backup-dialog button[type=submit]");
    await app.sleep(300);
    t.ok(
      "without the passphrase the import is refused and nothing is added",
      /passphrase/.test((await app.q(".backup-dialog .dialog-error", "(e) => e?.textContent")) ?? "") &&
        (await app.evJson(`window.wharf.hosts.list()`)).length === 0,
    );
    await app.ev(`document.querySelector('.backup-dialog input[type=password]').focus()`);
    await app.send("Input.insertText", { text: "wrong passphrase!" });
    await app.click(".backup-dialog button[type=submit]");
    await app.until(
      async () => /Wrong backup passphrase/.test((await app.q(".backup-dialog .dialog-error", "(e) => e?.textContent")) ?? ""),
      5000,
    );
    t.ok("a wrong passphrase is refused and nothing is added", (await app.evJson(`window.wharf.hosts.list()`)).length === 0);
    await app.ev(`(() => { const i = document.querySelector('.backup-dialog input[type=password]'); i.focus(); i.select(); })()`);
    await app.send("Input.insertText", { text: PASS });
    await app.click(".backup-dialog button[type=submit]");
    await app.until(async () => (await app.evJson(`window.wharf.hosts.list()`)).length === 2, 10_000);
    t.ok("the right passphrase imports the hosts", (await app.evJson(`window.wharf.hosts.list()`)).length === 2);
    const hosts = await app.evJson(`window.wharf.hosts.list()`);
    const lab = hosts.find((h) => h.name === "lab-ssh");
    const groups = await app.evJson(`window.wharf.groups.list()`);
    t.ok("the host is back in its group, under a new id", groups.length === 1 && lab.groupId === groups[0].id && lab.id !== hostA.id);
    t.ok("…with a saved password again", typeof lab.secretId === "string" && lab.secretId.length > 0);
    const tunnels = await app.evJson(`window.wharf.tunnels.list()`);
    t.ok("the tunnel points at the new host id", tunnels.length === 1 && tunnels[0].hostId === lab.id && tunnels[0].autoStart === true);
    t.ok("the snippet keeps its run setting", (await app.evJson(`window.wharf.snippets.list()`))[0]?.run === true);
    const ws = await app.evJson(`window.wharf.workspaces.list()`);
    t.ok(
      "the workspace points at the new host and has no scrollback",
      ws.length === 1 && ws[0].tabs[0].layout.hostId === lab.id && !JSON.stringify(ws).includes("SECRET"),
    );
    t.ok("a toast reports what was imported", /Imported 2 hosts/.test((await app.q(".toast", "(e) => e?.textContent")) ?? ""));

    // The restored password really works.
    await app.rail("Hosts");
    await app.until(() => app.q(".host-card"), 8000);
    await app.ev(`[...document.querySelectorAll('.host-card')].find((c) => c.textContent.includes('lab-ssh')).click()`);
    t.ok("connecting with the restored password works", await app.waitScreen(/e2e-remote\$/, 20_000));
    await app.click(".tab-strip .tab-close");

    // --- importing again changes nothing
    await app.rail("Settings");
    await app.until(() => app.q(".backup-actions"), 8000);
    await app.clickText(".backup-actions button", "Import backup…");
    await app.until(() => app.q(".backup-dialog"), 5000);
    await app.ev(`document.querySelector('.backup-dialog input[type=password]').focus()`);
    await app.send("Input.insertText", { text: PASS });
    await app.click(".backup-dialog button[type=submit]");
    await app.until(async () => !(await app.q(".backup-dialog")), 10_000);
    t.ok(
      "importing the same file again adds nothing",
      (await app.evJson(`window.wharf.hosts.list()`)).length === 2 &&
        (await app.evJson(`window.wharf.tunnels.list()`)).length === 1 &&
        (await app.evJson(`window.wharf.snippets.list()`)).length === 1 &&
        (await app.evJson(`window.wharf.workspaces.list()`)).length === 1 &&
        (await app.evJson(`window.wharf.groups.list()`)).length === 1,
    );

    // --- settings ride along only when ticked, and the window reloads to apply them
    t.ok("before that, the accent is not the backup's", (await app.ev(`localStorage.getItem("wharf-accent-color")`)) !== "rose");
    await app.clickText(".backup-actions button", "Import backup…");
    await app.until(() => app.q(".backup-dialog"), 5000);
    await app.ev(`document.querySelector('.backup-dialog input[type=password]').focus()`);
    await app.send("Input.insertText", { text: PASS });
    await app.ev(
      `[...document.querySelectorAll('.backup-dialog .backup-check')].find((l) => l.textContent.includes('App settings')).querySelector('input').click()`,
    );
    await app.click(".backup-dialog button[type=submit]");
    await app.until(async () => (await app.ev(`localStorage.getItem("wharf-accent-color")`)) === "rose", 10_000);
    t.ok("the backup's window preferences are applied", (await app.ev(`localStorage.getItem("wharf-accent-color")`)) === "rose");
    await app.sleep(2500); // the window reloads itself so the theme takes effect
    await app.until(() => app.q(".home, .settings-layout"), 15_000);

    // --- a file that isn't a backup
    writeFileSync(backupFile, JSON.stringify({ hello: "world" }));
    await app.rail("Settings");
    await app.until(() => app.q(".backup-actions"), 8000);
    await app.clickText(".backup-actions button", "Import backup…");
    await app.until(() => app.q(".toast.error, .toast"), 5000);
    t.ok(
      "a file that isn't a backup is refused with a message",
      /Wharf backup/.test((await app.evJson(`[...document.querySelectorAll('.toast')].map((e) => e.textContent).join('|')`)) ?? ""),
    );
    await app.close();
  } finally {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

function readFileExists(file) {
  try {
    statSync(file);
    return true;
  } catch {
    return false;
  }
}
