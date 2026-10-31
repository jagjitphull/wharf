export const name = "density";

// Layout density: Comfortable (default) or Compact narrows the icon rail and tightens the sidebar and tabs.
export async function run(t, start) {
  const app = await start();
  await app.until(() => app.q(".home"), 15_000);
  const size = (selector) =>
    app.evJson(
      `(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { w: r.width, h: r.height }; })()`,
    );
  const density = () => app.ev(`document.documentElement.dataset.density`);

  t.ok("starts comfortable", (await density()) === "comfortable", await density());
  const railBefore = (await size(".icon-rail")).w;
  const btnBefore = (await size(".rail-btn")).w;
  const titleBefore = (await size(".title-bar")).h;
  t.ok("the rail is 64px wide with 42px buttons", railBefore === 64 && btnBefore === 42, `${railBefore} / ${btnBefore}`);

  await app.rail("Settings");
  await app.until(() => app.q(".mode-switch"), 10_000);
  t.ok(
    "Settings offers Comfortable and Compact",
    JSON.stringify(
      await app.evJson(`[...document.querySelectorAll('[aria-label="Layout density"] .mode-btn')].map((b) => b.textContent)`),
    ) === '["Comfortable","Compact"]',
  );
  await app.clickText('[aria-label="Layout density"] .mode-btn', "Compact");
  await app.sleep(300);
  t.ok("choosing Compact sets it", (await density()) === "compact");
  const railAfter = (await size(".icon-rail")).w;
  const btnAfter = (await size(".rail-btn")).w;
  t.ok("the rail is narrower, with smaller buttons", railAfter === 46 && btnAfter === 34, `${railAfter} / ${btnAfter}`);
  t.ok("the title bar is shorter", (await size(".title-bar")).h < titleBefore, `${(await size(".title-bar")).h} vs ${titleBefore}`);
  t.ok(
    "the active marker still sits on the rail's left edge",
    await app.evJson(
      `(() => { const b = document.querySelector('.rail-btn.active'); const m = getComputedStyle(b, '::before'); return parseFloat(m.left) < 0 && parseFloat(m.height) > 8; })()`,
    ),
  );
  await app.shot("density-compact");

  await app.reload();
  await app.until(() => app.q(".icon-rail"), 15_000);
  t.ok("it is remembered after a restart", (await density()) === "compact" && (await size(".icon-rail")).w === 46);

  // The palette can switch it back.
  await app.press("k", { ctrl: true });
  await app.until(() => app.q(".palette"), 3000);
  await app.ev(`document.querySelector('.palette-input input').focus()`);
  await app.send("Input.insertText", { text: "comfortable" });
  await app.until(
    async () => /comfortable layout/i.test((await app.q(".palette-row .palette-title", "(e) => e?.textContent")) ?? ""),
    3000,
  );
  await app.press("Enter");
  await app.until(async () => (await density()) === "comfortable", 3000);
  t.ok("the palette's Use comfortable layout switches back", (await size(".icon-rail")).w === 64);
}
