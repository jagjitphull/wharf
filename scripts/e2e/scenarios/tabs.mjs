export const name = "tabs";

export async function run(t, start) {
  const app = await start();
  await app.until(() => app.q(".home"), 15_000);

  const tabs = () =>
    app.evJson(`[...document.querySelectorAll('.tab-strip .tab')].map((tab) => ({
      title: tab.querySelector('.tab-title')?.textContent,
      pinned: tab.classList.contains('pinned'),
      shadow: tab.style.boxShadow,
      hasClose: getComputedStyle(tab.querySelector('.tab-close')).display !== 'none' && !!tab.querySelector('.tab-close'),
    }))`);
  const titles = async () => (await tabs()).map((x) => x.title);
  const items = () =>
    app.evJson(
      `[...document.querySelectorAll('.context-menu-item')].map((i) => ({ t: i.textContent, disabled: i.hasAttribute('disabled') || i.classList.contains('disabled') || i.getAttribute('aria-disabled') === 'true' }))`,
    );
  const menuClick = async (label) => {
    await app.ev(`[...document.querySelectorAll('.context-menu-item')].find((x) => x.textContent === ${JSON.stringify(label)})?.click()`);
    await app.sleep(300);
  };
  const fillDialog = async (value) => {
    await app.until(() => app.q(".dialog input"), 3000);
    await app.setInput(".dialog input", value);
    await app.sleep(150);
    await app.click(".dialog button.primary, .dialog button[type=submit]");
    await app.until(async () => !(await app.q(".dialog")), 3000);
  };

  await app.newLocalShell();
  await app.newLocalShell();
  await app.newLocalShell();
  t.ok("three tabs open", (await titles()).length === 3, JSON.stringify(await titles()));

  await app.rightClick(".tab-strip .tab", 1);
  const menu = (await items()).map((i) => i.t);
  t.ok(
    "the tab menu has the extra items",
    [
      "Rename Tab…",
      "Pin Tab",
      "Move Tab Left",
      "Move Tab Right",
      "Copy Tab Title",
      "Save Tab as Workspace…",
      "Close Tabs to the Right",
    ].every((l) => menu.includes(l)),
    JSON.stringify(menu),
  );
  await app.shot("tab-menu");

  await menuClick("Rename Tab…");
  await fillDialog("prod db");
  t.ok("Rename Tab shows the new name", (await titles())[1] === "prod db", JSON.stringify(await titles()));

  await app.rightClick(".tab-strip .tab", 1);
  await menuClick("Copy Tab Title");
  t.ok("Copy Tab Title puts the name on the clipboard", (await app.ev(`window.wharf.clipboard.readText()`)) === "prod db");
  t.ok("…and says so in a toast", await app.until(() => app.q(".toast.success"), 3000));

  await app.rightClick(".tab-strip .tab", 2);
  await menuClick("Pin Tab");
  let list = await tabs();
  t.ok(
    "Pin Tab moves it to the front, pinned, without a close button",
    list[0].pinned && !list[0].hasClose && list.slice(1).every((x) => !x.pinned),
    JSON.stringify(list.map((x) => [x.title, x.pinned])),
  );

  await app.rightClick(".tab-strip .tab", 0);
  const pinnedMenu = (await items()).map((i) => i.t);
  t.ok(
    "a pinned tab's menu says Unpin and has no group entries",
    pinnedMenu.includes("Unpin Tab") && !pinnedMenu.includes("New Tab Group…"),
    JSON.stringify(pinnedMenu),
  );
  await app.press("Escape");

  await app.rightClick(".tab-strip .tab", 1);
  const left = (await items()).find((i) => i.t === "Move Tab Left");
  await menuClick("Move Tab Right");
  const order = await titles();
  t.ok("Move Tab Right swaps the unpinned tab with the next one", order[1] === "prod db" && order[2] !== "prod db", JSON.stringify(order));
  t.ok("Move Tab Left is disabled against the pinned block", !!left && left.disabled === true, JSON.stringify(left));

  await app.rightClick(".tab-strip .tab", 1);
  await menuClick("Close Tabs to the Right");
  await app.until(async () => (await titles()).length === 2, 5000);
  t.ok(
    "Close Tabs to the Right closes the one after it and keeps the pinned tab",
    (await titles()).length === 2 && (await tabs())[0].pinned,
    JSON.stringify(await titles()),
  );

  await app.rightClick(".tab-strip .tab", 1);
  await menuClick("Close Others");
  await app.sleep(800);
  t.ok("Close Others leaves the pinned tab alone", (await titles()).length === 2, JSON.stringify(await titles()));

  await app.rightClick(".tab-strip .tab", 1);
  await app.click('.context-menu .term-theme-swatch-dot[title="#e0575f"]');
  await app.sleep(300);
  t.ok("Tab color tints the tab's top bar", /224, 87, 95|e0575f/i.test((await tabs())[1].shadow), (await tabs())[1].shadow);

  await app.rightClick(".tab-strip .tab", 1);
  await menuClick("Save Tab as Workspace…");
  await fillDialog("my workspace");
  const workspaces = await app.evJson(`window.wharf.workspaces.list().then((l) => l.map((w) => ({ name: w.name, tabs: w.tabs.length })))`);
  t.ok(
    "Save Tab as Workspace stores a one-tab workspace",
    workspaces.length === 1 && workspaces[0].name === "my workspace" && workspaces[0].tabs === 1,
    JSON.stringify(workspaces),
  );

  await app.rightClick(".tab-strip .tab", 0);
  await menuClick("Unpin Tab");
  t.ok(
    "Unpin Tab brings the close button back",
    (await tabs()).every((x) => !x.pinned && x.hasClose),
  );
}
