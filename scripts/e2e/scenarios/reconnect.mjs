export const name = "reconnect";

export async function run(t, start) {
  const app = await start();
  await app.until(() => app.q(".home"), 15_000);
  const tabClass = () => app.ev(`document.querySelector('.tab-strip .tab')?.className ?? ''`);
  const menuClick = async (label) => {
    await app.ev(`[...document.querySelectorAll('.context-menu-item')].find((x) => x.textContent === ${JSON.stringify(label)})?.click()`);
  };

  // A shell that has run something, then ended.
  await app.newLocalShell();
  await app.run("echo history-line-$((6*7))");
  await app.type("exit\n");
  await app.until(async () => /closed/.test(await tabClass()), 10_000);
  t.ok("the tab shows as closed once the shell exits", /closed/.test(await tabClass()), await tabClass());

  await app.rightClick(".tab-strip .tab", 0);
  t.ok(
    "the menu offers a plain Reconnect for a dropped session",
    (await app.menuItems()).includes("Reconnect"),
    JSON.stringify(await app.menuItems()),
  );
  await menuClick("Reconnect");

  await app.waitScreen(/Reconnected to Local Shell/, 15_000);
  t.ok("the tab is no longer closed", !/closed/.test(await tabClass()));
  t.ok("the earlier output stays on screen", /history-line-42/.test(await app.screen()));
  t.ok("a Reconnected notice is shown in the terminal", /Reconnected to Local Shell/.test(await app.screen()));
  await app.until(() => app.screen().then((s) => /[#$]\s*$/.test(s.trimEnd())), 10_000);
  await app.ev(`document.querySelector('.tab-pane-container[style*="flex"] .xterm-helper-textarea')?.focus()`);
  await app.run("echo after-reconnect-$((5*5))");
  t.ok("the new session runs commands", /after-reconnect-25/.test(await app.screen()));

  // A live session: Reconnect… asks first.
  await app.rightClick(".tab-strip .tab", 0);
  t.ok("a live session's item is Reconnect…", (await app.menuItems()).includes("Reconnect…"), JSON.stringify(await app.menuItems()));
  await app.ev(`window.__asked = []; window.confirm = (m) => { window.__asked.push(m); return false; }`);
  await menuClick("Reconnect…");
  await app.sleep(600);
  const asked = await app.evJson(`window.__asked`);
  t.ok(
    "declining the confirmation leaves the session alone",
    asked.length === 1 && /still connected/.test(asked[0]) && /after-reconnect-25/.test(await app.screen()),
    JSON.stringify(asked),
  );

  await app.rightClick(".tab-strip .tab", 0);
  await app.ev(`window.confirm = () => true`);
  await menuClick("Reconnect…");
  await app.until(async () => (await app.screen()).split("Reconnected to Local Shell").length > 2, 15_000);
  const text = await app.screen();
  t.ok(
    "confirming reconnects the live session and keeps earlier output",
    (text.match(/Reconnected to Local Shell/g) ?? []).length >= 2 && /after-reconnect-25/.test(text),
  );
}
