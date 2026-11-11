const { chromium } = require('playwright-core');
const EXE = 'C:/Users/ABC/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe';
(async () => {
  const b = await chromium.launch({ executablePath: EXE, headless: true });
  const page = await b.newPage({ viewport: { width: 1536, height: 864 } });
  await page.goto('http://127.0.0.1:8932/index.html?local=1', { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  console.log(JSON.stringify(await page.evaluate(() => {
    const mv = document.getElementById('mainView');
    const cs = getComputedStyle(mv);
    const t = document.getElementById('timeCard').getBoundingClientRect();
    const c = document.getElementById('castCard').getBoundingClientRect();
    return {
      display: cs.display, cols: cs.gridTemplateColumns, gap: cs.gap,
      timeCard: [Math.round(t.left), Math.round(t.top), Math.round(t.width), Math.round(t.height)],
      castCard: [Math.round(c.left), Math.round(c.top), Math.round(c.width), Math.round(c.height)],
      wrapW: Math.round(document.querySelector('.wrap').getBoundingClientRect().width),
      children: Array.prototype.map.call(mv.children, e => e.id || e.tagName)
    };
  }), null, 1));
  await b.close();
})();
