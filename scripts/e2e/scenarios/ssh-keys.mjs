import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import ssh2 from "ssh2";
import { SSH_PASSWORD, SSH_USER, startSshServer } from "../sshServer.mjs";

const { utils } = ssh2;

export const name = "ssh-keys";

const modeOf = (file) => (statSync(file).mode & 0o777).toString(8);

// The SSH keys page: list what is in ~/.ssh, generate keys (never overwriting), copy the public half,
// install it on a host, delete.
export async function run(t, start) {
  const server = await startSshServer();
  try {
    const app = await start();
    await app.until(() => app.q(".home"), 15_000);
    const sshDir = path.join(app.home, ".ssh");
    mkdirSync(sshDir, { recursive: true });
    writeFileSync(path.join(sshDir, "known_hosts"), server.knownHostsLine());
    writeFileSync(path.join(sshDir, "config"), "Host x\n  HostName example.invalid\n");
    await app.ev(`window.confirm = () => true`);
    const setValue = (selector, value) =>
      app.ev(
        `(() => { const i = document.querySelector(${JSON.stringify(selector)}); const proto = i.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(i, ${JSON.stringify(String(value))}); i.dispatchEvent(new Event(i.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); })()`,
      );
    const rows = () =>
      app.evJson(
        `[...document.querySelectorAll('.key-row')].map((r) => ({ name: r.querySelector('.key-title strong').textContent, badges: [...r.querySelectorAll('.key-badge')].map((b) => b.textContent), fp: r.querySelector('.key-fingerprint').textContent }))`,
      );
    const toasts = () => app.evJson(`[...document.querySelectorAll('.toast')].map((e) => e.textContent).join('|')`);

    // --- empty
    await app.rail("SSH keys");
    await app.until(() => app.q(".keys-panel"), 5000);
    await app.until(() => app.q(".keys-empty"), 5000);
    t.ok(
      "with no keys the page says so (config and known_hosts are not keys)",
      !!(await app.q(".keys-empty")) && (await rows()).length === 0,
    );

    // --- generate
    await app.click(".keys-header .btn.primary");
    await app.until(() => app.q(".keys-dialog"), 3000);
    t.ok("the suggested name follows ssh-keygen's", (await app.q(`input[aria-label="Key file name"]`, "(e) => e.value")) === "id_ed25519");
    await app.ev(`document.querySelectorAll('.keys-dialog input[type=password]')[0]?.focus()`);
    await app.send("Input.insertText", { text: "abc" });
    await app.click(".keys-dialog button[type=submit]");
    await app.until(() => app.q(".keys-dialog .dialog-error"), 3000);
    t.ok("a too-short passphrase is refused", /at least 5/.test((await app.q(".keys-dialog .dialog-error", "(e) => e.textContent")) ?? ""));
    await setValue(`.keys-dialog input[type=password]`, "");
    await setValue(`.keys-dialog input[aria-label="Key file name"]`, "work key");
    await app.click(".keys-dialog button[type=submit]");
    await app.sleep(300);
    t.ok(
      "a name with a space is refused",
      /letters, digits/.test((await app.q(".keys-dialog .dialog-error", "(e) => e?.textContent")) ?? ""),
    );
    await setValue(`.keys-dialog input[aria-label="Key file name"]`, "../escape");
    await app.click(".keys-dialog button[type=submit]");
    await app.sleep(300);
    t.ok(
      "a path-like name is refused, nothing written outside",
      !!(await app.q(".keys-dialog .dialog-error")) && !existsSync(path.join(app.home, "escape")),
    );

    await setValue(`.keys-dialog input[aria-label="Key file name"]`, "id_ed25519");
    await app.ev(
      `(() => { const c = [...document.querySelectorAll('.keys-dialog label')].find((l) => l.textContent.startsWith('Comment')).querySelector('input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(c, 'e2e@wharf'); c.dispatchEvent(new Event('input', { bubbles: true })); })()`,
    );
    await app.shot("keys-generate");
    await app.click(".keys-dialog button[type=submit]");
    await app.until(async () => !(await app.q(".keys-dialog")), 10_000);
    await app.until(async () => (await rows()).length === 1, 5000);
    const [first] = await rows();
    t.ok(
      "the new key is listed with its type and fingerprint",
      first.name === "id_ed25519" && first.badges.includes("Ed25519") && /^SHA256:[A-Za-z0-9+/]{43}$/.test(first.fp),
      JSON.stringify(first),
    );
    const priv = path.join(sshDir, "id_ed25519");
    t.ok(
      "files are private (0600) and public (0644)",
      modeOf(priv) === "600" && modeOf(priv + ".pub") === "644",
      `${modeOf(priv)} ${modeOf(priv + ".pub")}`,
    );
    t.ok("the public file has the comment", /^ssh-ed25519 \S+ e2e@wharf\n$/.test(readFileSync(priv + ".pub", "utf8")));
    try {
      const out = execFileSync("ssh-keygen", ["-lf", priv + ".pub"], { encoding: "utf8" });
      t.ok("the fingerprint is the one ssh-keygen prints", out.includes(first.fp), out.trim());
    } catch {
      t.info("ssh-keygen isn't installed here; fingerprint cross-check skipped");
    }

    // --- a second key; the name is taken now
    await app.click(".keys-header .btn.primary");
    await app.until(() => app.q(".keys-dialog"), 3000);
    t.ok(
      "the next suggestion skips the taken name",
      (await app.q(`input[aria-label="Key file name"]`, "(e) => e.value")) === "id_ed25519_2",
    );
    await setValue(`.keys-dialog input[aria-label="Key file name"]`, "id_ed25519");
    await app.click(".keys-dialog button[type=submit]");
    await app.until(() => app.q(".keys-dialog .dialog-error"), 3000);
    t.ok(
      "an existing name is refused, and the key is untouched",
      /already exists/.test((await app.q(".keys-dialog .dialog-error", "(e) => e.textContent")) ?? "") &&
        /^ssh-ed25519 /.test(readFileSync(priv + ".pub", "utf8")),
    );
    await setValue(`.keys-dialog select`, "rsa");
    await app.until(async () => (await app.evJson(`document.querySelectorAll('.keys-dialog select').length`)) === 2, 3000);
    await setValue(`.keys-dialog .narrow select`, "2048");
    await setValue(`.keys-dialog input[aria-label="Key file name"]`, "id_rsa_locked");
    await app.ev(`document.querySelectorAll('.keys-dialog input[type=password]')[0].focus()`);
    await app.send("Input.insertText", { text: "correct horse" });
    await app.until(async () => (await app.evJson(`document.querySelectorAll('.keys-dialog input[type=password]').length`)) === 2, 3000);
    await app.ev(`document.querySelectorAll('.keys-dialog input[type=password]')[1].focus()`);
    await app.send("Input.insertText", { text: "correct horse" });
    await app.click(".keys-dialog button[type=submit]");
    await app.until(async () => (await rows()).length === 2, 20_000);
    const rsa = (await rows()).find((r) => r.name === "id_rsa_locked");
    t.ok(
      "an RSA key with a passphrase is marked, and its fingerprint comes from the .pub",
      rsa.badges.includes("RSA 2048") && rsa.badges.includes("passphrase") && rsa.fp.startsWith("SHA256:"),
      JSON.stringify(rsa),
    );
    const lockedPem = readFileSync(path.join(sshDir, "id_rsa_locked"), "utf8");
    t.ok(
      "the protected key can't be used without its passphrase, and can with it",
      utils.parseKey(lockedPem) instanceof Error &&
        !(utils.parseKey(lockedPem, "correct horse") instanceof Error) &&
        utils.parseKey(lockedPem, "wrong") instanceof Error,
    );
    await app.shot("keys-list");

    // --- copy public key
    await app.ev(
      `[...document.querySelectorAll('.key-row')].find((r) => r.textContent.includes('id_ed25519')).querySelector('.key-actions button').click()`,
    );
    await app.until(async () => /copied/.test(await toasts()), 3000);
    t.ok(
      "Copy public key puts the .pub line on the clipboard",
      (await app.ev(`window.wharf.clipboard.readText()`)).trim() === readFileSync(priv + ".pub", "utf8").trim(),
    );

    // --- install on a host
    await app.ev(
      `window.wharf.hosts.create(${JSON.stringify({ name: "lab-ssh", hostname: "127.0.0.1", port: server.port, username: SSH_USER, authMethod: "password", secret: SSH_PASSWORD, groupId: null })})`,
    );
    await app.reload();
    await app.rail("SSH keys");
    await app.until(async () => (await rows()).length === 2, 8000);
    await app.ev(
      `[...document.querySelectorAll('.key-row')].find((r) => r.textContent.includes('id_ed25519')).querySelectorAll('.key-actions button')[1].click()`,
    );
    await app.until(() => app.q(".keys-dialog"), 3000);
    await app.click(".keys-dialog button[type=submit]");
    await app.until(async () => !(await app.q(".keys-dialog")), 20_000);
    const authorized = path.join(server.home, ".ssh", "authorized_keys");
    const pub = readFileSync(priv + ".pub", "utf8").trim();
    t.ok(
      "the key is added to the host's authorized_keys, with safe permissions",
      existsSync(authorized) &&
        readFileSync(authorized, "utf8") === pub + "\n" &&
        modeOf(authorized) === "600" &&
        modeOf(path.join(server.home, ".ssh")) === "700",
    );
    t.ok("a toast says so", /Added id_ed25519 to lab-ssh/.test(await toasts()), await toasts());
    await app.ev(
      `[...document.querySelectorAll('.key-row')].find((r) => r.textContent.includes('id_ed25519')).querySelectorAll('.key-actions button')[1].click()`,
    );
    await app.until(() => app.q(".keys-dialog"), 3000);
    await app.click(".keys-dialog button[type=submit]");
    await app.until(async () => /already has/.test(await toasts()), 20_000);
    t.ok("installing again adds nothing", readFileSync(authorized, "utf8") === pub + "\n");

    // --- the host dialog offers the keys
    await app.rail("Hosts");
    await app.until(() => app.q(".host-card"), 8000);
    await app.ev(`document.querySelector('.host-card-actions button[title="Edit host"]').click()`);
    await app.until(() => app.q(".dialog"), 3000);
    await app.ev(
      `(() => { const s = [...document.querySelectorAll('.dialog select')].find((x) => [...x.options].some((o) => o.value === 'privateKey')); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, 'privateKey'); s.dispatchEvent(new Event('change', { bubbles: true })); })()`,
    );
    await app.until(() => app.q("#ssh-key-paths"), 3000);
    const offered = await app.evJson(`[...document.querySelectorAll('#ssh-key-paths option')].map((o) => o.value)`);
    t.ok("the key path field suggests the keys in ~/.ssh", offered.includes(priv) && offered.length === 2, JSON.stringify(offered));
    await app.press("Escape");
    await app.ev(`[...document.querySelectorAll('.dialog button')].find((b) => b.textContent.trim() === 'Cancel')?.click()`);

    // --- delete (the reload above reset the window, so the confirm stand-in goes in again)
    await app.ev(`window.confirm = () => true`);
    await app.rail("SSH keys");
    await app.until(async () => (await rows()).length === 2, 8000);
    await app.ev(`document.querySelector('.key-row button[aria-label="Delete id_rsa_locked"]').click()`);
    await app.until(async () => (await rows()).length === 1, 5000);
    t.ok(
      "deleting removes the key and its .pub from disk",
      !existsSync(path.join(sshDir, "id_rsa_locked")) && !existsSync(path.join(sshDir, "id_rsa_locked.pub")) && existsSync(priv),
    );
    t.ok(
      "ssh config and known_hosts are untouched",
      existsSync(path.join(sshDir, "config")) && existsSync(path.join(sshDir, "known_hosts")),
    );
  } finally {
    await server.close();
  }
}
