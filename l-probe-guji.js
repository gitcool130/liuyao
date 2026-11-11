/* 复现：古籍卦例库「装入排盘」点了没反应 */
const { chromium } = require('playwright-core');
const EXE = 'C:/Users/ABC/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe';
const BASE = process.argv[2] || 'http://127.0.0.1:8932';

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  page.on('dialog', async d => { errs.push('DIALOG: ' + d.message()); await d.dismiss(); });

  await page.goto(BASE + '/index.html?local=1', { waitUntil: 'networkidle' });

  // 展开古籍卦例库
  await page.$eval('#toolCard .tb-btn[data-k="guji"]', el => el.click());
  await page.waitForTimeout(600);
  const books = await page.$$eval('#gujiBook option', e => e.map(x => x.textContent.trim()));
  console.log('书目', books.length, books.slice(0, 4));

  // 选「独门易卦秘典 · 卦例全解」
  const target = books.find(b => b.indexOf('卦例全解') >= 0) || books[0];
  await page.selectOption('#gujiBook', { label: target });
  await page.waitForTimeout(1500);
  const items = await page.$$eval('#gujiList .guji-item', e => e.map(x => x.innerText.replace(/\s+/g, ' ').slice(0, 30)));
  console.log('选书:', target, '条目', items.length, items.slice(0, 3));

  await page.$$eval('#gujiList .guji-item', e => e[0].click());
  await page.waitForTimeout(800);
  const btn = await page.$('#btnGujiLoad');
  console.log('有装入排盘按钮:', !!btn, '禁用:', btn ? await btn.isDisabled() : 'n/a');

  const before = await page.evaluate(() => ({
    castCardHidden: document.getElementById('castCard').hidden,
    gzCardHidden: document.getElementById('gzCard').hidden,
    panHidden: document.getElementById('panCard').hidden,
    ben: (document.getElementById('gzBen') || {}).value
  }));
  console.log('点击前:', JSON.stringify(before));

  await page.click('#btnGujiLoad');
  await page.waitForTimeout(1500);
  const after = await page.evaluate(() => ({
    castCardHidden: document.getElementById('castCard').hidden,
    gzCardHidden: document.getElementById('gzCard').hidden,
    panHidden: document.getElementById('panCard').hidden,
    ben: (document.getElementById('gzBen') || {}).value,
    bian: (document.getElementById('gzBian') || {}).value,
    month: (document.getElementById('gzMonth') || {}).value,
    day: (document.getElementById('gzDay') || {}).value,
    classic: (document.getElementById('classicText').textContent || '').split('\n').slice(0, 2).join(' / '),
    priceBox: !!document.querySelector('#panBody .gz-meta'),
    hint: (document.querySelector('#gujiDetail') || {}).innerText ? 'detail ok' : 'no detail'
  }));
  console.log('点击后:', JSON.stringify(after, null, 1));
  console.log('错误/弹窗:', errs.length ? errs : '（无）');
  await browser.close();
})();
