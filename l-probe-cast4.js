/* 验四种起卦：数字卦 / 报数卦 / 时间卦 / 电脑卦 */
const { chromium } = require('playwright-core');
const EXE = 'C:/Users/ABC/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe';
const BASE = process.argv[2] || 'http://127.0.0.1:8932';

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

  await page.goto(BASE + '/index.html?local=1', { waitUntil: 'networkidle' });
  const labels = await page.$$eval('#timeCard .btn-row .btn', e => e.map(x => x.textContent.trim()));
  console.log('占时区按钮:', labels);

  for (const [mode, setup] of [
    ['数字卦', async () => { await page.fill('#c4a', '7'); await page.fill('#c4b', '11'); }],
    ['报数卦', async () => { await page.fill('#c4nums', '3 8 5'); }],
    ['时间卦', async () => {}],
    ['电脑卦', async () => {}]
  ]) {
    const id = { 数字卦: 'num', 报数卦: 'bao', 时间卦: 'time', 电脑卦: 'rand' }[mode];
    await page.$eval('#btnMode' + id[0].toUpperCase() + id.slice(1), el => el.click());
    await page.waitForTimeout(350);
    const vis = await page.evaluate(() => ({
      c4: !document.getElementById('cast4Card').hidden,
      cast: !document.getElementById('castCard').hidden,
      title: document.getElementById('c4Title').textContent
    }));
    await setup();
    await page.click('#c4Go');
    await page.waitForTimeout(900);
    const r = await page.evaluate(() => ({
      pan: !document.getElementById('panCard').hidden,
      out: (document.getElementById('c4Out') || {}).innerText || '',
      classic: (document.getElementById('classicText').textContent || '').split('\n').slice(0, 2).join(' / ')
    }));
    console.log('\n【' + mode + '】卡片=' + vis.c4 + ' 标题=' + vis.title + ' 摇卦卡隐藏=' + !vis.cast);
    console.log('  结果:', r.out.replace(/\n/g, ' | '));
    console.log('  盘面:', r.pan ? r.classic : '（未出盘）');
  }

  // 电脑卦摇两次应不同
  await page.$eval('#btnModeRand', el => el.click());
  await page.waitForTimeout(300);
  await page.click('#c4Go'); await page.waitForTimeout(600);
  const a = await page.$eval('#classicText', e => (e.textContent || '').split('\n')[1] || '');
  await page.click('#c4Go'); await page.waitForTimeout(600);
  const b = await page.$eval('#classicText', e => (e.textContent || '').split('\n')[1] || '');
  console.log('\n电脑卦两次:', a, '||', b, '（不同 =', a !== b, '）');

  console.log('\n错误:', errs.length ? errs : '（无）');
  await browser.close();
})();
