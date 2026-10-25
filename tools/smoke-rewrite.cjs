/* 线上回归：断卦「先碎片、末尾整篇重来」是否已收敛 + 背景音按钮能否起播
   用法：node tools/smoke-rewrite.cjs https://liuyao.dhxlsfn.dpdns.org/
   依赖：playwright-core + 本机 Edge（与 tools/smoke-prod.cjs 相同）

   做法：真浏览器跑真站点，但**把 /api/interpret 换成脚本化 SSE**——
   第一稿故意「无结论行」（触发 app.js 的补全重写路径），第二稿带结论。
   重点断言两件事：
     ① 重写期间气泡**不能**从空重画：草稿句必须一直在，顶部只出现 .rw-bar 状态条；
     ② 重写完成后一次性替换成最终渲染（结论卡），状态条消失。
   这两条正是 M19 修的观感问题，纯单测覆盖不到（要真实 DOM + 时序）。 */
const { chromium } = require('playwright-core');

const BASE = process.argv[2] || 'https://liuyao.dhxlsfn.dpdns.org/';
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + extra : '')); }
}

// 第一稿：>30 字、**不含**「结论：」→ 触发补全重写
const DRAFT = '此卦坤为地，六冲之象，问事多阻。世爻持世，月建相生，然忌神动而克用，事多反复。先看用神父母，父母持世则文书之事可成，但需待出空之后方可着手。';
// 第二稿（重写稿）：与草稿用词刻意不同，便于分辨「气泡里现在显示的是哪一稿」
const FINAL = '【重写稿】坤为地，六冲之象，初阻后通。世应相合，用神父母得月建生扶，文书之事终可成。\n' +
  '结论：可成\n应期：戌月出空之后\n用神：父母\n置信：中等\n\n' +
  '详解：此卦世爻旺相，忌神虽动而受制，故主先难后易。文书之事宜待出空再图，戌月之后自有转机。';

(async () => {
  // 本机网络到 CF 边缘偶发劣化（TTFB 十几秒）时，可用 SMOKE_PROXY 走本地代理：
  //   SMOKE_PROXY=http://127.0.0.1:7890 node tools/smoke-rewrite.cjs
  const netArgs = process.env.SMOKE_PROXY
    ? ['--proxy-server=' + process.env.SMOKE_PROXY]
    : ['--no-proxy-server'];
  const browser = await chromium.launch({
    channel: 'msedge', headless: true,
    // 无头环境没有音频设备，且自动播放策略会拦 Web Audio；这里放行策略，
    // 只用于验证「起播链路不抛错、按钮能进播放态」，不代表真机听感。
    args: netArgs.concat(['--autoplay-policy=no-user-gesture-required'])
  });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

  console.log('== 1. 打开线上站点并起卦 ' + BASE);
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(() => window.LY && typeof window.LY.shareUrl === 'function', null, { timeout: 20000 });
  for (let i = 0; i < 6; i++) {
    await page.click('#btnRandom'); await page.waitForTimeout(40);
    await page.click('#btnConfirm'); await page.waitForTimeout(40);
  }
  await page.waitForTimeout(300);
  ok('盘面已渲染', (await page.textContent('#panBody')).length > 50);

  console.log('== 2. 装上脚本化 SSE（第 1 次=草稿，第 2 次=重写稿）并采样 DOM');
  await page.evaluate(({ DRAFT, FINAL }) => {
    window.__samples = [];
    window.__calls = 0;
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    function sse(text, size, gap) {
      const enc = new TextEncoder();
      return new Response(new ReadableStream({
        async start(c) {
          for (let i = 0; i < text.length; i += size) {
            c.enqueue(enc.encode('data: ' + JSON.stringify({ t: text.slice(i, i + size) }) + '\n\n'));
            await sleep(gap);
          }
          c.enqueue(enc.encode('data: [DONE]\n\n'));
          c.close();
        }
      }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
    }
    const orig = window.fetch;
    window.fetch = function (url) {
      if (String(url).indexOf('/api/interpret') >= 0) {
        window.__calls++;
        const n = window.__calls;
        return Promise.resolve(n === 1 ? sse(DRAFT, 16, 35) : sse(FINAL, 20, 45));
      }
      return orig.apply(window, arguments);
    };
    window.__timer = setInterval(function () {
      const el = document.querySelector('.ai-col-body');
      if (!el) return;
      window.__samples.push({
        t: Date.now(),
        bar: !!el.querySelector('.rw-bar'),
        barText: (el.querySelector('.rw-bar') || {}).textContent || '',
        text: el.textContent || '',
        empty: !el.textContent.trim()
      });
    }, 40);
  }, { DRAFT, FINAL });

  await page.click('#btnAI');
  // 等重写结束：出现结论卡（.verdict 或含「结论」）+ 按钮恢复
  await page.waitForFunction(() => {
    const el = document.querySelector('.ai-col-body');
    return el && !el.querySelector('.rw-bar') && /结[论局]\s*[：:]/.test(el.textContent || '');
  }, null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(400);
  await page.evaluate(() => clearInterval(window.__timer));

  const calls = await page.evaluate(() => window.__calls);
  const samples = await page.evaluate(() => window.__samples);
  const barSamples = samples.filter(s => s.bar);
  const draftSamples = barSamples.filter(s => s.text.indexOf('六冲之象') >= 0);
  const emptySamples = samples.filter(s => s.empty);
  const finalHTML = await page.evaluate(() => (document.querySelector('.ai-col-body') || {}).innerHTML || '');

  console.log('  采样 ' + samples.length + ' 帧，接口调用 ' + calls + ' 次，状态条帧 ' + barSamples.length + ' 帧');
  // 调用次数：1=首稿；2=补全重写（本用例必走）；3=盘面审计后的校正重写（草稿里的卦名与随机盘不符，
  // 审计必然报错并触发一次校正，属预期路径，不是重复渲染）
  ok('触发了补全重写（接口 ≥2 次）', calls >= 2, calls);
  ok('重写期出现过 .rw-bar 状态条', barSamples.length > 0);
  ok('状态条带接收进度（已收到 N 字）', barSamples.some(s => /已收到 \d+ 字/.test(s.barText)),
    barSamples.slice(-1)[0] && barSamples.slice(-1)[0].barText);
  ok('重写期草稿始终可见（气泡未从空重画）', barSamples.length > 0 && draftSamples.length === barSamples.length,
    draftSamples.length + '/' + barSamples.length);
  ok('全程没有空气泡帧', emptySamples.length === 0, emptySamples.length);
  ok('状态条里的字数单调不减', (function () {
    const nums = barSamples.map(s => (s.barText.match(/已收到 (\d+) 字/) || [, '0'])[1] | 0);
    for (let i = 1; i < nums.length; i++) if (nums[i] < nums[i - 1]) return false;
    return true;
  })());
  ok('最终渲染出结论卡', /class="verdict"|结[论局]\s*[：:]/.test(finalHTML));
  ok('最终渲染后状态条已移除', finalHTML.indexOf('rw-bar') < 0);
  ok('最终内容为重写稿（不是草稿残留）', finalHTML.indexOf('重写稿') >= 0);

  console.log('== 3. 背景音按钮');
  // 注意：本页设计是「首个用户手势即自动起播」（arm/kick），上面起卦点了一堆按钮，
  // 所以走到这里时正常应已是播放态；再点 #bgmBtn 是「关」，不是「开」。
  const readBgm = () => page.evaluate(() => {
    const btn = document.getElementById('bgmBtn');
    return { exists: !!btn, on: btn.classList.contains('on'), title: btn.title };
  });
  const s0 = await readBgm();
  ok('#bgmBtn 存在', s0.exists);
  ok('首个用户手势后自动起播（arm/kick 生效）', s0.on === true, 'on=' + s0.on + ' / title=' + s0.title);

  // 必须用真实指针点击（page.click）：页内 el.click() 是非用户手势，会被自动播放策略拒。
  await page.click('#bgmBtn');
  await page.waitForTimeout(400);
  const s1 = await readBgm();
  ok('点击一次 → 静音（class on 移除）', s1.on === false, 'on=' + s1.on + ' / title=' + s1.title);

  await page.click('#bgmBtn');
  await page.waitForTimeout(900);
  const s2 = await readBgm();
  ok('再点一次 → 恢复播放', s2.on === true, 'on=' + s2.on + ' / title=' + s2.title);
  console.log('  文案：初始「' + s0.title + '」→ 关「' + s1.title + '」→ 开「' + s2.title + '」');
  // console 里的「Failed to load resource」是资源加载失败（/api/records?verify=1 无口令 401、
  // 或本机网络抖动导致的 ERR_CONNECTION_CLOSED），属预期/环境噪声，不是 JS 运行时错误；
  // 真正的脚本异常走 pageerror，不在这里被过滤。
  const real = errs.filter(e =>
    !/cloudflareinsights|challenge-platform|Failed to load resource|status of 401|null: 401/.test(e));
  ok('无 JS 运行时错误', real.length === 0, real.join(' | '));

  await browser.close();
  console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('崩溃：', e && e.message); process.exit(2); });
