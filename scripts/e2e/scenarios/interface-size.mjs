export const name = "interface-size";

export async function run(t, start) {
  const app = await start();
  await app.until(() => app.q(".home"), 15_000);
  await app.newLocalShell();
  const measure = () =>
    app.evJson(`(() => {
      const pane = document.querySelector('.tab-pane-container[style*="flex"]');
      const row = pane.querySelector('.xterm-rows > div');
      return {
        dpr: devicePixelRatio, innerW: innerWidth, rowH: row.getBoundingClientRect().height,
        screenW: pane.querySelector('.xterm-screen').getBoundingClientRect().width,
        paneW: pane.querySelector('.terminal-pane, .xterm').parentElement.getBoundingClientRect().width,
        titleH: document.querySelector('.title-bar').getBoundingClientRect().height,
      };
    })()`);

  const m1 = await measure();
  t.ok("starts at 100%", Math.abs(m1.dpr - 1) < 0.01, JSON.stringify(m1));

  await app.rail("Settings");
  await app.until(() => app.q(".ui-size-slider"), 5000);
  await app.ev(
    `(() => { const i = document.querySelector('.ui-size-slider'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, '1.3'); i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); })()`,
  );
  await app.until(async () => (await app.q(".ui-size-control .font-size-value", "(e) => e?.textContent")) === "130%", 3000);
  t.ok("the slider shows 130%", (await app.q(".ui-size-control .font-size-value", "(e) => e?.textContent")) === "130%");

  await app.click(".tab-strip .tab");
  await app.until(async () => Math.abs((await measure()).dpr - 1.3) < 0.01, 5000);
  const m2 = await measure();
  t.ok(
    "the page is really zoomed (pixel ratio and CSS viewport)",
    Math.abs(m2.dpr - 1.3) < 0.01 && m2.innerW < m1.innerW * 0.8,
    JSON.stringify(m2),
  );
  t.ok(
    "terminal text stays the same physical size",
    Math.abs(m2.rowH * m2.dpr - m1.rowH * m1.dpr) < 1.5,
    `${m1.rowH}px@1.0 vs ${m2.rowH.toFixed(2)}px@1.3`,
  );
  t.ok("the terminal still fills its pane", m2.screenW > m2.paneW * 0.9, `${m2.screenW.toFixed(0)} of ${m2.paneW.toFixed(0)}`);

  const click = await app.rightClick(".tab-strip .tab", 0);
  const menu = await app.evJson(
    `(() => { const b = document.querySelector('.context-menu').getBoundingClientRect(); return { x: b.x, y: b.y, r: b.right, b: b.bottom, iw: innerWidth, ih: innerHeight }; })()`,
  );
  t.ok(
    "a context menu opens at the click and stays on screen",
    Math.abs(menu.x - click.x) < 6 && menu.y >= 0 && menu.b <= menu.ih + 1 && menu.r <= menu.iw + 1,
    JSON.stringify({ click, ...menu }),
  );
  await app.press("Escape");

  await app.reload();
  const m3 = await app.evJson(`({ dpr: devicePixelRatio, ls: localStorage.getItem('wharf-ui-zoom') })`);
  t.ok("still 130% after a reload (applied before first paint)", Math.abs(m3.dpr - 1.3) < 0.01 && m3.ls === "1.3", JSON.stringify(m3));

  await app.rail("Settings");
  await app.until(() => app.q(".ui-size-control"), 5000);
  await app.clickText(".ui-size-control button", "Reset");
  await app.until(async () => Math.abs((await app.evJson(`devicePixelRatio`)) - 1) < 0.01, 3000);
  t.ok("Reset returns to 100%", Math.abs((await app.evJson(`devicePixelRatio`)) - 1) < 0.01);
}
