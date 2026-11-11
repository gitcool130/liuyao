/* 量首页是否一屏放得下 */
const { chromium } = require('playwright-core');
const EXE = 'C:/Users/ABC/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe';
const BASE = 'http://127.0.0.1:8932';

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true });
  for (const vp of [[1536, 864], [1366, 768], [1280, 720], [1600, 900], [1920, 1080]]) {
    const page = await browser.newPage({ viewport: { width: vp[0], height: vp[1] } });
    await page.goto(BASE + '/index.html?local=1', { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    const m = await page.evaluate(() => {
      const doc = document.documentElement;
      const row = document.querySelector('#timeCard .btn-row');
      const btns = Array.prototype.map.call(document.querySelectorAll('#timeCard .btn-row .btn'),
        b => Math.round(b.getBoundingClientRect().top));
      const uniqTops = Array.from(new Set(btns));
      const g = (id) => { const el = document.getElementById(id); return el ? Math.round(el.getBoundingClientRect().height) : null; };
      return {
        scroll: doc.scrollHeight, view: window.innerHeight,
        wrapW: Math.round(document.querySelector('.wrap').getBoundingClientRect().width),
        modeRows: uniqTops.length,
        hTime: g('timeCard'), hCast: g('castCard'), hPan: g('panCard'),
        hHeader: Math.round(document.querySelector('header').getBoundingClientRect().height)
      };
    });
    console.log(vp.join('x'), '→ 内容高', m.scroll, '视口', m.view, '溢出', m.scroll - m.view,
      '| 起卦按钮行数', m.modeRows, '| 占时', m.hTime, '起卦', m.hCast, '页头', m.hHeader, '| wrap宽', m.wrapW);
    await page.close();
  }
  await browser.close();
})();
