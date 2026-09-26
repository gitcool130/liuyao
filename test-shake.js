/* ============================================================
 * UI 冒烟 + 交互回归测试 (test-shake.js)
 * 用 Playwright（Edge 通道，无需下载浏览器）跑真实浏览器，覆盖：
 *   #9  盲摇落爻后揭晓真实铜钱（只读不可翻）
 *   #18 初始态不得预设「重·老阳·发动」
 *   #4  追问请求体中须含本次追问（旧版 slice(0,-1) 会切掉）
 *   #5  切回现场模式后 #timeInfo 与排盘时间一致（重排盘）
 *   #10 输入框与 selectedDate 时间显示一致
 *   #17 core 脚本加载失败时给可读提示而非整页崩溃
 *   #8  后台返回的模型名含注入字符时须转义（不产生 DOM 注入）
 * 运行：
 *   node test-shake.js                      # 默认 http://127.0.0.1:8931
 *   node test-shake.js https://liuyao.dhxlsfn.dpdns.org/
 * 前置：本地需先起静态服务（npx wrangler pages dev public 或任意静态服务器）
 * ============================================================ */
const { chromium } = require('playwright-core');

const BASE = process.argv[2] || 'http://127.0.0.1:8931';
let pass = 0, fail = 0;
function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + ' got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)); }
}

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });

  // ---------- A. 摇卦全流程 + 揭晓 ----------
  {
    const page = await browser.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    await page.goto(BASE, { waitUntil: 'networkidle' });

    console.log('A. 盲摇流程与揭晓');
    eq('初始硬币为三背', await page.$$eval('.coin', e => e.map(x => x.textContent)), ['背', '背', '背']);
    const initHint = await page.$eval('#tossHint', e => e.innerText);
    eq('初始提示不预设结果（不含「老阳 · 发动」）', initHint.indexOf('老阳 · 发动') < 0, true);
    eq('初始提示引导点摇卦', initHint.indexOf('摇卦') >= 0, true);

    const seen = [];
    for (let i = 0; i < 6; i++) {
      await page.click('#btnRandom');
      await page.waitForTimeout(80);
      eq('第' + (i + 1) + '爻摇中显示遮蔽「？」', await page.$$eval('.coin', e => e.map(x => x.textContent)), ['？', '？', '？']);
      await page.click('#btnConfirm');
      await page.waitForTimeout(80);
      const coins = await page.$$eval('.coin', e => e.map(x => x.textContent));
      seen.push(coins.join(''));
      eq('第' + (i + 1) + '爻落爻后揭晓（不再是三背占位）', coins.every(c => c === '背' || c === '字'), true);
      const hint = await page.$eval('#tossHint', e => e.innerText);
      eq('第' + (i + 1) + '爻提示报「已落」', hint.indexOf('第 ' + (i + 1) + ' 爻已落') >= 0, true);
      // 揭晓态只读
      await page.click('.coin');
      await page.waitForTimeout(30);
      eq('第' + (i + 1) + '爻揭晓态不可翻动', await page.$$eval('.coin', e => e.map(x => x.textContent)), coins);
    }
    // 随机性：6 爻不应完全相同（256 组合里 4 种恒定，若恒定则熵源可疑）
    eq('六爻结果非恒定同一组合（随机性生效）', new Set(seen).size > 1, true);
    eq('排盘出现', (await page.$eval('.hex-title', e => e.textContent)).length > 0, true);
    // 撤销回手动模式
    await page.click('#btnUndo');
    await page.waitForTimeout(60);
    eq('撤销后硬币复位三背', await page.$$eval('.coin', e => e.map(x => x.textContent)), ['背', '背', '背']);
    await page.click('.coin');
    await page.waitForTimeout(60);
    eq('撤销后可手动翻铜钱', await page.$$eval('.coin', e => e.map(x => x.textContent)), ['字', '背', '背']);
    eq('页面无 JS 异常', errs, []);
    await page.close();
  }

  // ---------- B. 追问请求体（#4） ----------
  {
    const page = await browser.newPage();
    const captured = [];
    await page.route('**/api/interpret', async route => {
      captured.push(JSON.parse(route.request().postData() || '{}'));
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ reply: '断语示例：用神旺相，事可成。' }) });
    });
    await page.goto(BASE, { waitUntil: 'networkidle' });
    console.log('B. 追问历史');
    for (let i = 0; i < 6; i++) { await page.click('#btnRandom'); await page.click('#btnConfirm'); }
    await page.click('#btnAI');
    await page.waitForTimeout(800);
    eq('首次断卦请求已发出', captured.length >= 1, true);
    eq('首次请求 messages 为空', captured[0].messages.length, 0);
    const Q = '此卦问婚姻何时可成？';
    await page.fill('#chatInput', Q);
    await page.click('#btnChat');
    await page.waitForTimeout(800);
    const follow = captured[captured.length - 1];
    const contents = follow.messages.map(m => m.content).join('\n');
    eq('追问请求含本次追问原文', contents.indexOf(Q) >= 0, true);
    eq('追问为 messages 末条（未被切掉）', follow.messages[follow.messages.length - 1].role, 'user');
    eq('追问请求带上前答', contents.indexOf('断语示例') >= 0, true);
    await page.close();
  }

  // ---------- C. 时间一致性（#5 / #10） ----------
  {
    const page = await browser.newPage();
    await page.goto(BASE, { waitUntil: 'networkidle' });
    console.log('C. 时间锁与显示一致性');
    for (let i = 0; i < 6; i++) { await page.click('#btnRandom'); await page.click('#btnConfirm'); }
    const meta1 = await page.$eval('.meta-line', e => e.innerText);
    const time1 = await page.$eval('#timeInfo', e => e.innerText);
    const m1 = meta1.match(/占时 (\d{4}-\d{2}-\d{2} \d{2}:\d{2})/);
    eq('排盘含占时', !!m1, true);
    eq('摇卦后 #timeInfo 与排盘占时一致', time1.indexOf(m1[1]) >= 0, true);
    const input1 = await page.$eval('#dtInput', e => e.value);
    eq('#10 输入框与锁定时刻一致', input1.replace('T', ' '), m1[1]);

    await page.click('#btnTimeMode');                  // → 补录
    await page.fill('#dtInput', '2026-01-01T08:30');
    await page.dispatchEvent('#dtInput', 'change');
    await page.waitForTimeout(80);
    const meta2 = await page.$eval('.meta-line', e => e.innerText);
    eq('补录改时后立即重排盘', meta2.indexOf('2026-01-01 08:30') >= 0, true);

    await page.click('#btnTimeMode');                  // → 切回现场
    await page.waitForTimeout(120);
    const meta3 = await page.$eval('.meta-line', e => e.innerText);
    const time3 = await page.$eval('#timeInfo', e => e.innerText);
    const input3 = await page.$eval('#dtInput', e => e.value);
    eq('#5 切回现场后恢复锁定时刻（非补录时刻）', meta3.indexOf('2026-01-01 08:30') < 0, true);
    eq('#5 切回现场后 #timeInfo 与排盘一致', time3.indexOf(m1[1]) >= 0, true);
    eq('#10 切回现场后输入框同步锁定时刻', input3.replace('T', ' '), m1[1]);
    await page.close();
  }

  // ---------- D. core 加载失败守卫（#17） ----------
  {
    const page = await browser.newPage();
    await page.route('**/core/analyze.js', route => route.fulfill({ status: 404, body: '' }));
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(300);
    console.log('D. 内核加载失败守卫');
    const body = await page.$eval('body', e => e.innerText);
    eq('给出可读提示', body.indexOf('排盘内核未能加载') >= 0, true);
    await page.close();
  }

  // ---------- E. 模型芯片转义（#8） ----------
  {
    const page = await browser.newPage();
    let alerted = false;
    page.on('dialog', async d => { alerted = true; await d.dismiss(); });
    await page.route('**/api/models', route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ models: [
        { id: 'gpt-6-luna', pv: 'OpenAI', configured: true },
        { id: 'x"><img src=x onerror=alert(1)>', pv: '<script>alert(2)</script>', configured: true }
      ], warnings: ['CUSTOM_PROVIDERS 不是合法 JSON：测试'] })
    }));
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForTimeout(300);
    console.log('E. 模型芯片 XSS 转义与告警展示');
    eq('未产生注入的 img 元素', await page.$$eval('#modelChips img', e => e.length), 0);
    eq('未产生注入的 script 元素', await page.$$eval('#modelChips script', e => e.length), 0);
    eq('未触发 alert', alerted, false);
    eq('服务端告警可见（不再静默）', (await page.$eval('#modelWarn', e => e.innerText)).indexOf('CUSTOM_PROVIDERS') >= 0, true);
    await page.close();
  }

  await browser.close();
  console.log('\nPASS:', pass, ' FAIL:', fail);
  if (fail > 0) process.exit(1);
})().catch(e => { console.error('SCRIPT FAIL:', e.message); process.exit(1); });
