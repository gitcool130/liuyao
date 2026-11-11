const { chromium } = require('playwright-core');
const EXE = 'C:/Users/ABC/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe';
(async () => {
  const b = await chromium.launch({ executablePath: EXE, headless: true });
  const page = await b.newPage({ viewport: { width: 1400, height: 950 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto('http://127.0.0.1:8932/index.html?local=1', { waitUntil: 'networkidle' });
  await page.$eval('#btnModeGz', el => el.click());
  await page.waitForTimeout(400);
  await page.selectOption('#gzYear', '42');
  await page.selectOption('#gzMonth', '11');
  await page.selectOption('#gzDay', '24');
  await page.selectOption('#gzBian', '天风姤');
  await page.waitForTimeout(300);
  await page.click('#btnGzPaipan');
  await page.waitForTimeout(1200);
  const st = await page.evaluate(() => {
    const cb = document.getElementById('classicBox');
    const bc = document.getElementById('btnClassic');
    const pc = document.getElementById('panCard');
    const mv = document.getElementById('mainView');
    const r = bc.getBoundingClientRect();
    return {
      panHidden: pc.hidden, classicHidden: cb.hidden, mainHidden: mv.hidden,
      btnRect: [Math.round(r.width), Math.round(r.height)],
      btnDisplay: getComputedStyle(bc).display,
      parentChain: (function () { let n = bc, out = []; while (n && out.length < 6) { out.push(n.id || n.className); n = n.parentElement; } return out; })(),
      text: (document.getElementById('classicText').textContent || '').split('\n')[0]
    };
  });
  console.log(JSON.stringify(st, null, 1));
  console.log('errors:', errs);
  await b.close();
})();
