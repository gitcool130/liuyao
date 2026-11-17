/* 真机验证：C# 壳里的系统 OCR 通道（浏览器里验不了，只能连真 exe 的 CDP） */
const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.connectOverCDP('http://127.0.0.1:9240');
  const ctx = b.contexts()[0];
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.waitForTimeout(2000);

  console.log('① 壳通道可用:', await page.evaluate(() => !!(window.LY_FS && window.LY_FS.available)));
  console.log('   导出目录:', await page.evaluate(() => window.LY_FS.exportDir().catch(e => 'ERR ' + e.message)));

  // 直接对一张图跑系统 OCR（不弹选图框）
  const img = 'D://AI//2026-11-06-21-12-19//ocr-try//pan1.jpg';
  const r = await page.evaluate(async (p) => {
    try {
      const t0 = Date.now();
      const out = await window.LY_FS.ocr(p);
      return { ok: true, ms: Date.now() - t0, len: String(out).length, head: String(out).split('\n').slice(0, 4) };
    } catch (e) { return { ok: false, err: (e && e.message) || String(e) }; }
  }, img);
  console.log('② 系统 OCR:', JSON.stringify(r, null, 1));

  if (r.ok) {
    // 把 OCR 结果直接喂给解析器，看能不能认出盘
    const parsed = await page.evaluate((raw) => {
      const lines = String(raw).split('\n').filter(l => l && !/^SIZE\t/.test(l));
      const res = window.__lyOcrText(lines.join('\n'), 'pan1.jpg');
      return { fed: lines.length };
    }, r.head ? String(r.head) : '');
  }

  // ③ 神煞开关
  await page.click('#btnModeDate');
  await page.waitForTimeout(400);
  await page.fill('#guaNameInput', '雷水解');
  await page.fill('#guaDongInput', '2,4');
  await page.click('#btnByName');
  await page.waitForTimeout(1200);
  const ss = await page.evaluate(() => {
    const c = document.getElementById('panShensha');
    c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true }));
    return null;
  });
  await page.waitForTimeout(600);
  console.log('③ 神煞行:', await page.evaluate(() =>
    document.getElementById('classicText').textContent.split('\n').filter(l => l.indexOf('神煞') >= 0 || /^\u3000/.test(l)).join(' / ')));

  // ④ 分类标签
  await page.evaluate(() => document.querySelector('#sideRail .tb-btn[data-k="lib"]').click());
  await page.waitForTimeout(500);
  await page.evaluate(() => document.getElementById('btnLib').click());
  await page.waitForTimeout(1500);
  console.log('④ 分类标签:', await page.evaluate(() =>
    Array.from(document.querySelectorAll('#libCats .lib-cat')).map(e => e.textContent.trim())));
  await page.screenshot({ path: 'l-shot-exe-final.png', clip: { x: 0, y: 0, width: 1180, height: 800 } });
  await b.close();
})();
