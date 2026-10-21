export const name = "auto-lock";

// WHARF_E2E_TIME_SCALE shrinks the idle time so "5 minutes" is 15 seconds here.
export async function run(t, start) {
  const app = await start({ env: { WHARF_E2E_TIME_SCALE: "0.05" } });
  await app.until(() => app.q(".home"), 15_000);
  const call = (expr) =>
    app.ev(`(async () => { try { return { ok: await (${expr}) }; } catch (e) { return { err: String(e.message || e) }; } })()`);
  const state = async () => (await call("window.wharf.secrets.status()")).ok.masterPassword;

  await call(`window.wharf.secrets.setMasterPassword("correct horse battery")`);
  t.ok("a master password is set and unlocked", (await state()) === "unlocked");
  await call("window.wharf.secrets.setAutoLock(5)");

  // Keep working for longer than the idle time: it must stay unlocked.
  const until = Date.now() + 22_000;
  while (Date.now() < until) {
    await app.press("Shift");
    await app.sleep(2000);
  }
  t.ok("it stays unlocked while there is activity, past the idle time", (await state()) === "unlocked");

  // Now do nothing.
  const locked = await app.until(async () => (await state()) === "locked", 40_000, 500);
  t.ok("it locks itself once idle", !!locked, await state());
  t.ok("…and the lock screen appears without a restart", await app.until(() => app.q(".lock-screen"), 5000));
  await app.shot("auto-locked");

  await app.setInput(".lock-dialog input", "correct horse battery");
  await app.click(".lock-dialog button[type=submit]");
  await app.until(async () => !(await app.q(".lock-screen")), 10_000);
  t.ok("unlocking from that screen works", (await state()) === "unlocked" && !(await app.q(".lock-screen")));
  await app.sleep(4000);
  t.ok("unlocking counts as activity, so it doesn't lock again at once", (await state()) === "unlocked");

  await call("window.wharf.secrets.setAutoLock(0)");
  await app.sleep(20_000);
  t.ok("with auto-lock set to Never it stays unlocked", (await state()) === "unlocked");
}
