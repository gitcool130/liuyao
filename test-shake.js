// 摇卦流程实测：打开线上站点，点击 摇卦/落爻 各6次，记录硬币结果与控制台错误
const { chromium } = require('playwright-core');

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage();

  const errors = [];
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push('[' + m.type() + '] ' + m.text()); });
  page.on('pageerror', e => errors.push('[pageerror] ' + e.message));

  const url = process.argv[2] || 'https://liuyao.dhxlsfn.dpdns.org/';
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });

  // 初始状态
  const initCoins = await page.$$eval('.coin', els => els.map(e => e.textContent));
  console.log('初始硬币显示:', JSON.stringify(initCoins));

  const results = [];
  for (let i = 0; i < 6; i++) {
    await page.click('#btnRandom');
    await page.waitForTimeout(150);
    const during = await page.$$eval('.coin', els => els.map(e => e.textContent));
    await page.click('#btnConfirm');
    await page.waitForTimeout(150);
    const after = await page.$$eval(".coin", els => els.map(e => e.textContent));
    const stack = await page.$$eval('.yao-slot', els => els.map(e => e.textContent.trim()));
    results.push({ round: i + 1, duringToss: during, afterConfirm: after, slot: stack[i] || '' });
  }

  for (const r of results) console.log('第' + r.round + '爻 摇时:' + JSON.stringify(r.duringToss) + ' 落后:' + JSON.stringify(r.afterConfirm) + ' | ' + r.slot);

  // 摇出的 val 分布（从内部状态无法直接读，改为统计 stack 符号）
  const stackAll = await page.$$eval('.yao-slot', els => els.map(e => e.textContent.trim()));
  console.log('最终爻堆:', JSON.stringify(stackAll));

  // 排盘标题
  const title = await page.$eval('.hex-title', e => e.textContent).catch(() => '(未出现排盘)');
  console.log('排盘:', title);

  console.log('控制台错误/警告:', errors.length ? errors.join('\n') : '(无)');
  await browser.close();
})().catch(e => { console.error('SCRIPT FAIL:', e.message); process.exit(1); });
