/* 线上真人视图截图：摇卦 → 选「自定义」事由 → 断卦 → 等流结束 → 全页截图
 * 用法：node tools/shot.js [url] [outDir]
 * 目的：TODO P0#1 里「渲染、滚动、红字位置只有人看得出来」那部分，用截图交人确认。
 */
const { chromium } = require('playwright-core');
const path = require('path');

const BASE = process.argv[2] || 'https://liuyao.dhxlsfn.dpdns.org/';
const OUT = process.argv[3] || '/workspace';
const MODEL = process.env.SHOT_MODEL || 'gemini-3.8-flash';
const QUESTION = process.env.SHOT_Q || '此 liuyao 项目准确度如何，是否堪用';

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true }).catch(() => chromium.launch({ headless: true }));
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 1 });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForSelector('#btnRandom', { timeout: 30000 });

  // 摇满六爻
  for (let i = 0; i < 6; i++) {
    await page.click('#btnRandom');
    await page.waitForTimeout(80);
    await page.click('#btnConfirm');
    await page.waitForTimeout(80);
  }
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, 'shot-1-pan.png'), fullPage: false });
  console.log('已排盘，截图 shot-1-pan.png');

  // 选事由（自定义，便于带明确问题文本）
  await page.selectOption('#useSelect', '__custom__').catch(async () => {
    await page.selectOption('#useSelect', '父母');
  });
  const hasCustom = await page.$('#useCustom');
  if (hasCustom) await page.fill('#useCustom', QUESTION);

  // 选模型：只留 MODEL（默认选中含 gemini-3.6-flash，实测 46% 断在中途）
  for (let guard = 0; guard < 8; guard++) {
    const changed = await page.evaluate((want) => {
      const chips = Array.from(document.querySelectorAll('.mchip'));
      const target = chips.find(c => c.dataset.m === want);
      if (!target) return false;
      // 先确保目标被选中，再取消其他——反过来做会把选中项清零，页面不允许空选
      if (!target.classList.contains('on')) { target.click(); return true; }
      const others = chips.filter(c => c.classList.contains('on') && c.dataset.m !== want);
      if (others.length) { others[0].click(); return true; }
      return false;
    }, MODEL);
    if (!changed) break;
    await page.waitForTimeout(150);
  }
  const picked = await page.$$eval('.mchip.on', els => els.map(e => e.dataset.m));
  console.log('已选模型:', picked.join(','));

  const t0 = Date.now();
  await page.click('#btnAI');
  console.log('已点击断卦，等待流结束…');

  let done = false;
  const deadline = t0 + 180000;
  while (Date.now() < deadline) {
    const txt = await page.evaluate(() => {
      const el = document.querySelector('.ai-block');
      return el ? el.innerText : '';
    });
    if (/结[论局]\s*[:：]/.test(txt) || /未完篇/.test(txt)) { done = true; break; }
    await page.waitForTimeout(1000);
  }
  await page.waitForTimeout(1200);

  const info = await page.evaluate(() => {
    const blocks = Array.from(document.querySelectorAll('.ai-block'));
    const last = blocks.length ? blocks[blocks.length - 1].innerText : '';
    const warns = Array.from(document.querySelectorAll('.warn')).map(e => e.innerText);
    return {
      chars: last.length,
      warnCount: warns.length,
      warns: warns.map(w => w.slice(0, 160)),
      hasConclusion: /结[论局]\s*[:：]/.test(last),
      hasIncomplete: /未完篇/.test(last),
      tail: last.slice(-220)
    };
  });
  await page.screenshot({ path: path.join(OUT, 'shot-2-verdict.png'), fullPage: true });
  console.log(JSON.stringify({ model: MODEL, elapsedMs: Date.now() - t0, done: done, ...info, pageErrors: errs }, null, 1));
  await browser.close();
})();
