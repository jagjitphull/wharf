export const name = "tab-layout";

// Pinned tabs shrink to a chip, and the tabs can live in a collapsible side panel instead of the title bar.
export async function run(t, start) {
  const app = await start();
  await app.until(() => app.q(".home"), 15_000);
  const width = (selector, index = 0) =>
    app.ev(`document.querySelectorAll(${JSON.stringify(selector)})[${index}]?.getBoundingClientRect().width ?? -1`);
  const shown = (selector, index = 0) =>
    app.ev(
      `(() => { const e = document.querySelectorAll(${JSON.stringify(selector)})[${index}]; return !!e && getComputedStyle(e).display !== 'none'; })()`,
    );
  const storage = (key) => app.ev(`localStorage.getItem(${JSON.stringify(key)})`);

  await app.newLocalShell();
  await app.newLocalShell();
  const normal = await width(".tab-strip .tab", 1);
  t.ok("an ordinary tab keeps its usual width", normal >= 100, String(normal));

  // --- pinned tabs shrink
  await app.rightClick(".tab-strip .tab", 1);
  await app.clickText(".context-menu-item", "Pin Tab");
  await app.until(async () => (await app.ev(`document.querySelector('.tab-strip .tab.pinned') !== null`)) === true, 3000);
  const pinned = await width(".tab-strip .tab.pinned");
  t.ok("a pinned tab shrinks to a narrow chip", pinned > 0 && pinned <= 70 && pinned < normal / 1.5, `${pinned} vs ${normal}`);
  t.ok("…without its name on the tab", !(await shown(".tab-strip .tab.pinned .tab-title")));
  t.ok(
    "…but with the pin, and the name as its tooltip",
    (await shown(".tab-strip .tab.pinned .tab-pin")) && !!(await app.ev(`document.querySelector('.tab-strip .tab.pinned').title`)),
  );
  t.ok("…and it is still first", await app.ev(`document.querySelector('.tab-strip .tab').classList.contains('pinned')`));
  await app.shot("tabs-pinned-chip");

  // --- side layout
  await app.rail("Settings");
  await app.until(() => app.q('[aria-label="Tab layout"]'), 10_000);
  t.ok(
    "Settings offers Top and Side",
    JSON.stringify(await app.evJson(`[...document.querySelectorAll('[aria-label="Tab layout"] .mode-btn')].map((b) => b.textContent)`)) ===
      '["Top","Side"]',
  );
  t.ok("the tabs start in the title bar", !!(await app.q(".title-bar .tab-strip")) && !(await app.q(".tab-panel")));
  await app.clickText('[aria-label="Tab layout"] .mode-btn', "Side");
  await app.until(() => app.q(".tab-panel"), 3000);
  t.ok(
    "choosing Side moves the tabs into a panel",
    !(await app.q(".title-bar .tab-strip")) && !!(await app.q(".tab-panel .tab-strip.vertical")),
  );
  t.ok("…listing both tabs", (await app.evJson(`document.querySelectorAll('.tab-panel .tab').length`)) === 2);
  const open = await width(".tab-panel");
  t.ok("the panel is wide enough for names", open >= 190, String(open));
  t.ok("a pinned tab keeps its name in the panel", await shown(".tab-panel .tab.pinned .tab-title"));
  await app.shot("tabs-side-expanded");

  await app.click(".tab-panel .tab:not(.pinned)");
  await app.until(() => app.q(".tab-panel .tab.active"), 3000);
  t.ok("clicking a tab in the panel opens it", !!(await app.q(".tab-panel .tab.active")) && !(await app.q(".settings-panel")));

  // --- collapse and expand
  await app.click(".tab-panel-toggle");
  await app.sleep(350);
  const shrunk = await width(".tab-panel");
  t.ok("collapsing narrows the panel to a strip", shrunk > 0 && shrunk <= 56, String(shrunk));
  t.ok("…hiding the names but keeping the numbers", !(await shown(".tab-panel .tab-title")) && (await shown(".tab-panel .tab-number")));
  t.ok("…with each name as the tab's tooltip", !!(await app.ev(`document.querySelector('.tab-panel .tab').title`)));
  await app.shot("tabs-side-collapsed");
  t.ok("the choice is saved", (await storage("wharf-tab-layout")) === "side" && (await storage("wharf-tab-panel-collapsed")) === "1");
  await app.click(".tab-panel-toggle");
  await app.sleep(350);
  t.ok("expanding brings the names back", (await width(".tab-panel")) >= 190 && (await shown(".tab-panel .tab-title")));

  // --- back to the top, from the palette
  await app.press("k", { ctrl: true });
  await app.until(() => app.q(".palette"), 3000);
  await app.ev(`document.querySelector('.palette-input input').focus()`);
  await app.send("Input.insertText", { text: "tabs to the top" });
  await app.until(
    async () => /Move tabs to the top/.test((await app.q(".palette-row .palette-title", "(e) => e?.textContent")) ?? ""),
    3000,
  );
  await app.press("Enter");
  await app.until(() => app.q(".title-bar .tab-strip"), 3000);
  t.ok("the palette moves them back to the title bar", !(await app.q(".tab-panel")) && !!(await app.q(".title-bar .tab-strip")));
  t.ok("…and the pinned tab is still a chip", (await width(".tab-strip .tab.pinned")) <= 70);
}
