/* 线上冒烟（真实浏览器 · 针对已部署站点）
   用法：node tools/smoke-prod.cjs https://liuyao.dhxlsfn.dpdns.org/
   覆盖：首屏脚本加载 → 起卦 → 应期区间展示 → 分享链接还原（逐字比对）
        → 重新起卦清场 → 接口鉴权（仅真域名下检查）
   本机若无外网出口，可先把线上产物抓成本地镜像再指向 http://127.0.0.1:PORT/
   （镜像必须与线上逐字节一致，否则测的是另一份代码）*/
const { chromium } = require('playwright-core');

const BASE = process.argv[2] || 'https://liuyao.dhxlsfn.dpdns.org/';
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
}
const norm = s => (s || '').replace(/\s+/g, ' ').trim();

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--no-proxy-server'] });
  const ctx = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  const errs = [];
  const bad404 = [];
  const page = await ctx.newPage();
  page.on('pageerror', e => errs.push(String(e)));
  page.on('response', r => { if (r.status() >= 400) bad404.push(r.status() + ' ' + r.url()); });
  page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

  console.log('== 1. 线上首屏加载 ' + BASE);
  const resp = await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 40000 });
  ok('HTTP 200', resp && resp.status() === 200, resp && resp.status());
  await page.waitForFunction(() => typeof window.LY === 'object' && window.LY && typeof window.LY.shareUrl === 'function', null, { timeout: 20000 });
  await page.waitForTimeout(400);
  for (const id of ['btnShare', 'yingqiBox', 'useSelect', 'panBody', 'dtInput', 'btnReset']) {
    ok('元素存在 ' + id, await page.locator('#' + id).count() === 1);
  }
  ok('三个新增核心脚本已加载', await page.evaluate(() =>
    typeof LY.encodeCast === 'function' && typeof LY.yingqiWindow === 'function' && typeof LY.shareUrl === 'function'));

  console.log('== 2. 起卦 + 选事类 + 应期展示');
  for (let i = 0; i < 6; i++) {
    await page.click('#btnRandom'); await page.waitForTimeout(50);
    await page.click('#btnConfirm'); await page.waitForTimeout(50);
  }
  await page.waitForTimeout(300);
  const panText = norm(await page.textContent('#panBody'));
  ok('盘面已渲染', panText.length > 50, panText.slice(0, 40));
  ok('盘面含卦名与四柱', /之|为/.test(panText) && /[甲乙丙丁戊己庚辛壬癸][子丑寅卯辰巳午未申酉戌亥]年/.test(panText), panText.slice(0, 60));

  await page.selectOption('#useSelect', { label: '妻财' }).catch(async () => {
    await page.selectOption('#useSelect', { index: 1 });
  });
  await page.waitForTimeout(400);
  const yq = norm(await page.textContent('#yingqiBox'));
  console.log('  应期框: ' + yq.slice(0, 160));
  ok('应期框可见', await page.locator('#yingqiBox').isVisible());
  ok('应期含区间与置信', /应期/.test(yq) && /置信/.test(yq), yq.slice(0, 80));
  ok('应期不含「近期」', yq.indexOf('近期') < 0);

  console.log('== 3. 分享链接 → 新标签还原');
  await page.click('#btnShare');
  await page.waitForTimeout(400);
  const shareUrl = await page.evaluate(() => navigator.clipboard.readText());
  ok('剪贴板拿到分享链接', /[?&]s=/.test(shareUrl || ''), (shareUrl || '').slice(0, 90));
  ok('分享链接指向本站', /dhxlsfn\.dpdns\.org|pages\.dev|127\.0\.0\.1|localhost/.test(shareUrl), shareUrl.slice(0, 60));

  const page2 = await ctx.newPage();
  const errs2 = [];
  page2.on('pageerror', e => errs2.push(String(e)));
  await page2.goto(shareUrl, { waitUntil: 'domcontentloaded', timeout: 40000 });
  await page2.waitForTimeout(600);
  const panText2 = norm(await page2.textContent('#panBody'));
  const yq2 = norm(await page2.textContent('#yingqiBox'));
  const use2 = await page2.inputValue('#useSelect');
  ok('还原后盘面逐字一致', panText === panText2, panText2.slice(0, 60));
  ok('还原后应期一致', yq === yq2, yq2.slice(0, 80));
  ok('还原后用神一致', use2 === (await page.inputValue('#useSelect')), use2);
  ok('还原页无 JS 错误', errs2.length === 0, errs2.join(' | '));

  console.log('== 4. 重新起卦清场');
  await page2.click('#btnReset');
  await page2.waitForTimeout(300);
  ok('重置后地址栏无 s=', (page2.url().indexOf('s=') < 0), page2.url());
  ok('重置后盘面卡片隐藏', await page2.getAttribute('#panCard', 'hidden') !== null);
  ok('重置后应期框清空', await page2.getAttribute('#yingqiBox', 'hidden') !== null);

  console.log('== 5. 接口存活');
  if (/127\.0\.0\.1|localhost/.test(BASE)) {
    console.log('  - 本地镜像无 Functions，接口鉴权已在 curl 层单独验证');
  } else {
    const api = await ctx.request.get(BASE.replace(/\/$/, '') + '/api/records');
    ok('/api/records 需口令（401）', api.status() === 401, api.status());
  }

  const apiMissing = bad404.filter(u => /\/api\//.test(u));
  const otherBad = bad404.filter(u => !/\/api\//.test(u));
  if (apiMissing.length) console.log('  - 后端接口（本地镜像无 Functions，已单独 curl 验证）: ' + apiMissing.join(', '));
  ok('无 4xx/5xx 静态资源', otherBad.length === 0, otherBad.join(' | '));
  const realErrs = errs.filter(e => !/Failed to load resource/.test(e));
  ok('无 JS 运行时错误', realErrs.length === 0, realErrs.join(' | '));
  await browser.close();
  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('e2e 异常:', e.message); process.exit(2); });
