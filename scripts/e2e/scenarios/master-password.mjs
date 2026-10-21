import { readFileSync, statSync } from "node:fs";
import path from "node:path";

export const name = "master-password";

export async function run(t, start) {
  let app = await start();
  await app.until(() => app.q(".home"), 15_000);
  /** Calls an IPC method and returns { ok } or { err }. */
  const call = (expr) =>
    app.ev(`(async () => { try { return { ok: await (${expr}) }; } catch (e) { return { err: String(e.message || e) }; } })()`);
  const status = async () => (await call("window.wharf.secrets.status()")).ok;
  const dataPath = () => path.join(app.profile, "wharf-data.json");

  t.ok("starts with no master password", (await status()).masterPassword === "none");

  const host = await call(
    `window.wharf.hosts.create({ name: "h", hostname: "example.invalid", port: 22, username: "u", authMethod: "password", password: "hunter2-secret", groupId: null })`,
  );
  t.ok("a host with a saved password is created", !!host.ok?.id, JSON.stringify(host).slice(0, 120));
  t.ok("the password is not in the data file in plain text", !readFileSync(dataPath(), "utf8").includes("hunter2-secret"));

  let r = await call(`window.wharf.secrets.setMasterPassword("short")`);
  t.ok("a short master password is refused", /at least 8/.test(r.err ?? ""), r.err);
  r = await call(`window.wharf.secrets.setMasterPassword("correct horse battery")`);
  t.ok("a master password can be set", r.err === undefined, r.err);
  const st = await status();
  t.ok("it is unlocked for this run", st.masterPassword === "unlocked" && st.encrypted === true, JSON.stringify(st));
  const file = readFileSync(dataPath(), "utf8");
  t.ok(
    "the data file holds a sealed secret, no plain text, no password",
    file.includes('"mp:') && !file.includes("hunter2-secret") && !file.includes("correct horse battery"),
  );
  t.ok("the data file is still owner-only", (statSync(dataPath()).mode & 0o077) === 0);

  // --- locking by hand shows the lock screen
  await call("window.wharf.secrets.lock()");
  t.ok("lock() locks it", (await status()).masterPassword === "locked");
  t.ok("…and the lock screen appears in every window", await app.until(() => app.q(".lock-screen"), 3000));
  t.ok(
    "a wrong password is refused",
    /Wrong master password/.test((await call(`window.wharf.secrets.unlock("wrong password!")`)).err ?? ""),
  );
  t.ok("the right password unlocks", (await call(`window.wharf.secrets.unlock("correct horse battery")`)).err === undefined);
  t.ok(
    "…and an open lock screen goes away when it is unlocked from elsewhere",
    await app.until(async () => !(await app.q(".lock-screen")), 3000),
  );

  // --- auto-lock
  t.ok("auto-lock defaults to never", (await call("window.wharf.secrets.getAutoLock()")).ok === 0);
  t.ok("an unknown idle time is not accepted", (await call("window.wharf.secrets.setAutoLock(7)")).ok === 0);
  t.ok("a listed idle time is saved", (await call("window.wharf.secrets.setAutoLock(5)")).ok === 5);
  await app.rail("Settings");
  const idleChoices = () =>
    app.evJson(`[...document.querySelectorAll('select.font-family-select')].map((s) => [...s.options].map((o) => o.textContent)).flat()`);
  await app.until(async () => (await idleChoices()).includes("After 15 minutes"), 8000);
  const choices = await idleChoices();
  t.ok(
    "Settings offers the idle choices",
    choices.includes("After 15 minutes") && choices.includes("Never"),
    JSON.stringify(choices.slice(-8)),
  );
  await app.ev(
    `document.querySelector('select.font-family-select option[value="15"]')?.closest('.appearance-row')?.scrollIntoView({ block: "center" })`,
  );
  await app.sleep(300);
  await app.shot("auto-lock-settings");
  await call("window.wharf.secrets.setAutoLock(0)");

  // --- restart: it must come up locked
  await app.stop();
  const { profile, home } = app;
  app = await start({ profile, home });
  await app.until(() => app.q(".lock-screen"), 15_000);
  t.ok("after a restart it is locked", (await status()).masterPassword === "locked");
  const dom = await app.evJson(
    `({ lock: !!document.querySelector('.lock-screen'), input: !!document.querySelector('.lock-dialog input[type=password]'), titlebar: !!document.querySelector('.title-bar') })`,
  );
  t.ok("the lock screen is showing and the title bar is still there", dom.lock && dom.input && dom.titlebar, JSON.stringify(dom));
  await app.shot("lock-screen");

  await app.setInput(".lock-dialog input", "nope nope nope");
  await app.click(".lock-dialog button[type=submit]");
  await app.until(() => app.q(".lock-dialog .dialog-error"), 5000);
  t.ok(
    "a wrong password shows an error and keeps the screen",
    /Wrong master password/.test((await app.q(".lock-dialog .dialog-error", "(e) => e?.textContent")) ?? ""),
  );
  await app.setInput(".lock-dialog input", "correct horse battery");
  await app.click(".lock-dialog button[type=submit]");
  await app.until(async () => !(await app.q(".lock-screen")), 10_000);
  t.ok("the right password dismisses it", !(await app.q(".lock-screen")));
  t.ok("…and unlocks", (await status()).masterPassword === "unlocked");

  // --- change and remove
  t.ok(
    "it can be changed",
    (await call(`window.wharf.secrets.changeMasterPassword("correct horse battery", "a different one 99")`)).err === undefined,
  );
  t.ok(
    "removing with the wrong password is refused",
    /Wrong/.test((await call(`window.wharf.secrets.removeMasterPassword("not it at all")`)).err ?? ""),
  );
  t.ok("it can be removed", (await call(`window.wharf.secrets.removeMasterPassword("a different one 99")`)).err === undefined);
  t.ok("status is none again", (await status()).masterPassword === "none");
  const after = readFileSync(dataPath(), "utf8");
  t.ok(
    "the secret went back to keyring or base64 storage, and the password is gone",
    !after.includes('"mp:') && !after.includes("hunter2-secret"),
  );
}
