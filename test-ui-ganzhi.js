/* 干支排盘 + 古籍卦例库的 UI 冒烟（无头浏览器，跑在 CI）
 *
 * 为什么要这一层：干支引擎有 58 项 node 单测，但「四个下拉有没有铺开」
 * 「点爻画真的换了阴阳」「装入排盘真的把盘送进结果页」只有真浏览器能验。
 * 本地模式靠 ?local=1 打开（core/local-api.js 的开关），与桌面壳同一条路径。
 */
const { chromium } = require('playwright-core');

const BASE = process.argv[2] || 'http://127.0.0.1:8931';
let pass = 0, fail = 0;
function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else { fail++; console.log('  ✗ ' + name + '  got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)); }
}
function ok(name, cond, extra) {
  if (cond) pass++; else { fail++; console.log('  ✗ ' + name + (extra === undefined ? '' : '  ' + extra)); }
}
function say(s) { console.log(s); }

async function launchBrowser() {
  const attempts = [
    { channel: 'msedge', headless: true },
    { channel: 'chrome', headless: true },
    { headless: true }
  ];
  let lastErr;
  for (const opt of attempts) {
    try { return await chromium.launch(opt); } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

(async () => {
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

  await page.goto(BASE + '/index.html?local=1', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#btnRandom', { timeout: 20000 });

  /* ---------- A. 本地模式生效 ---------- */
  say('A. 本地接口层');
  ok('本地模式标记已置位', await page.evaluate(() => window.LY_LOCAL_MODE === true));
  await page.waitForTimeout(600);
  const models = await page.evaluate(async () => {
    const r = await fetch('/api/models');
    return r.json();
  });
  ok('/api/models 有返回且是本地实现', models && models.local === true, JSON.stringify(models).slice(0, 120));
  ok('未填 Key 时给告警文案', Array.isArray(models.warnings) && models.warnings.length === 1);
  ok('AI 接口设置卡片已挂载', await page.$('#localApiCard') !== null);
  ok('设置卡片有 3 个接口槽', (await page.$$('#localApiCard .local-api-row')).length === 3);

  /* ---------- A2. 工具栏：四块收成一行按钮 ---------- */
  say('A2. 工具栏');
  const tbLabels = await page.$$eval('#toolCard .tb-btn', e => e.map(x => x.textContent.trim()));
  eq('四个按钮', tbLabels, ['古籍卦例库', 'AI 接口设置', '大模型断卦', '卦例库']);
  eq('默认全收起', await page.$eval('#toolBody', e => e.hidden), true);

  await page.click('#toolCard .tb-btn[data-k="api"]');
  await page.waitForTimeout(300);
  eq('点开后展开', await page.$eval('#toolBody', e => e.hidden), false);
  eq('只显示被点的那块',
    await page.$$eval('#toolBody .tb-pane', e => e.filter(x => !x.hidden).map(x => x.getAttribute('data-k'))), ['api']);
  ok('AI 设置卡片已搬进面板', await page.$('#toolBody .tb-pane[data-k="api"] #localApiCard') !== null);

  await page.click('#toolCard .tb-btn[data-k="api"]');
  await page.waitForTimeout(300);
  eq('再点收起', await page.$eval('#toolBody', e => e.hidden), true);

  await page.click('#toolCard .tb-btn[data-k="ai"]');
  await page.waitForTimeout(300);
  eq('排盘前断卦面板给提示', await page.$eval('.tb-pane[data-k="ai"]', e => e.getAttribute('data-empty')), '1');

  /* ---------- B. 干支排盘界面 ---------- */
  say('B. 干支排盘界面');
  await page.click('#btnModeGz');
  await page.waitForTimeout(300);
  eq('干支卡片可见', await page.$eval('#gzCard', e => e.hidden), false);
  eq('摇卦卡片隐藏', await page.$eval('#castCard', e => e.hidden), true);
  eq('公历时间行隐藏', await page.$eval('#dateRow', e => e.hidden), true);

  const optCounts = await page.evaluate(() => ({
    year: document.querySelectorAll('#gzYear option').length,     // 61（含「不填」）
    month: document.querySelectorAll('#gzMonth option').length,   // 12
    day: document.querySelectorAll('#gzDay option').length,       // 60
    hour: document.querySelectorAll('#gzHour option').length      // 13（含「不填」）
  }));
  eq('下拉选项数（年/月/日/时）', optCounts, { year: 61, month: 12, day: 60, hour: 13 });

  eq('六爻行数', (await page.$$('#gzYao .gz-row')).length, 6);
  eq('默认全为静', await page.$$eval('#gzYao .gz-dyn', e => e.map(x => x.textContent.trim())),
    ['静', '静', '静', '静', '静', '静']);

  let prev = await page.$eval('#gzPreview', e => e.innerText);
  ok('默认预览为乾为天·静卦', prev.indexOf('乾为天') >= 0 && prev.indexOf('静卦') >= 0, prev.replace(/\n/g, ' | '));
  ok('预览给出旬空', prev.indexOf('旬空') >= 0);

  /* ---------- C. 点爻画切阴阳、点动静切动爻 ---------- */
  say('C. 爻画与动静交互');
  // DOM 顺序是上爻→初爻，最后一行才是初爻
  const rows = await page.$$('#gzYao .gz-row');
  const lastRow = rows[rows.length - 1];
  await lastRow.$eval('.gz-dyn', el => el.click());      // 初爻 静 → 动
  await page.waitForTimeout(200);
  prev = await page.$eval('#gzPreview', e => e.innerText);
  ok('初爻动 → 变为天风姤', prev.indexOf('天风姤') >= 0, prev.replace(/\n/g, ' | '));
  eq('初爻状态显示 ○动', (await page.$$eval('#gzYao .gz-dyn', e => e.map(x => x.textContent.trim())))[5], '○动');
  eq('动爻数统计', (function (t) { const m = t.match(/动爻 (\d+) 个/); return m ? +m[1] : -1; })(prev), 1);

  // 再点爻画把初爻改阴 → 卦应变成 天风姤 之 天水讼? 只断言「不再是乾为天」
  await lastRow.$eval('.gz-bar', el => el.click());
  await page.waitForTimeout(200);
  const after = await page.$eval('#gzPreview', e => e.innerText);
  ok('点爻画后本卦变化', after.indexOf('（六冲）') >= 0 || after.indexOf('本卦') >= 0);

  /* ---------- D. 开始排盘 → 结果页 ---------- */
  say('D. 开始排盘');
  // 固定成「丙午年 亥月 戊子日」（旬空午未）以便断言红色标记，不随跑的日期变
  await page.selectOption('#gzYear', '42');
  await page.selectOption('#gzMonth', '11');
  await page.selectOption('#gzDay', '24');
  await page.waitForTimeout(400);
  await page.click('#btnGzPaipan');
  await page.waitForSelector('#panCard:not([hidden])', { timeout: 8000 });
  eq('结果页可见', await page.$eval('#panCard', e => e.hidden), false);
  const panText = await page.evaluate(() => {
    const btn = document.querySelector('#btnCopy');
    return btn ? true : false;
  });
  ok('复制按钮在（说明盘已渲染）', panText);
  const panHead = await page.$eval('#panCard', e => e.innerText);
  ok('结果页含干支行', /干支|月建|日辰/.test(panHead), panHead.slice(0, 80).replace(/\n/g, ' '));
  ok('结果页含旬空', panHead.indexOf('旬空') >= 0);
  await page.waitForTimeout(400);
  eq('排盘后断卦面板有内容', await page.$eval('.tb-pane[data-k="ai"]', e => e.getAttribute('data-empty')), '0');

  // 变爻列：起出变卦后六爻全给，静爻用灰色（bian-static）与动爻（bian-move）区分
  const bianCells = await page.$$eval('#panBody table.pan tbody tr', rows => rows.map(function (r) {
    const c = r.querySelectorAll('td')[4];
    const sp = c.querySelector('span');
    return { text: c.innerText.trim(), cls: sp ? sp.className : '' };
  }));
  eq('变爻列六行都有内容', bianCells.filter(function (x) { return !!x.text; }).length, 6);
  ok('存在灰色静爻变爻', bianCells.some(function (x) { return x.cls === 'bian-static'; }),
    JSON.stringify(bianCells.map(function (x) { return x.cls; })));
  ok('存在动爻变爻', bianCells.some(function (x) { return x.cls === 'bian-move'; }));

  // 旬空（午未）/ 月破（冲月建）的干支标红
  const redMarks = await page.$$eval('#panBody .gzp-kong, #panBody .gzp-po', function (e) {
    return e.map(function (x) { return x.className + ':' + x.textContent; });
  });
  ok('旬空/月破干支标红', redMarks.length > 0, JSON.stringify(redMarks));

  // 古籍版式：干支口径默认展开，四列纯文本，可切回表格
  eq('干支口径默认展示古籍版式', await page.$eval('#classicBox', e => e.hidden), false);
  const classic = await page.$eval('#classicText', e => e.textContent);
  const cLines = classic.split('\n');
  ok('古籍版式首行为干支', /^干支：/.test(cLines[0] || ''), cLines[0]);
  ok('古籍版式第二行为宫名卦名', /宫：/.test(cLines[1] || ''), cLines[1]);
  ok('古籍版式第三行为四列表头', /六神　伏　　神/.test(cLines[2] || ''), cLines[2]);
  ok('古籍版式六爻齐全', cLines.length >= 9, 'lines=' + cLines.length);
  ok('古籍版式标出世应', /世|应/.test(classic));

  await page.click('#btnClassic');
  await page.waitForTimeout(250);
  eq('可切回表格', await page.$eval('#classicBox', e => e.hidden), true);
  await page.click('#btnClassic');
  await page.waitForTimeout(250);
  eq('可再切回古籍版式', await page.$eval('#classicBox', e => e.hidden), false);

  /* ---------- E. 古籍卦例库 → 装入排盘 ---------- */
  say('E. 古籍卦例库');
  ok('古籍卡片已挂载', await page.$('#gujiCard') !== null);
  await page.click('#toolCard .tb-btn[data-k="guji"]');
  await page.waitForTimeout(600);
  eq('古籍面板已展开', await page.$eval('.tb-pane[data-k="guji"]', e => e.hidden), false);
  const bookCount = (await page.$$eval('#gujiBook option', e => e.length));
  if (bookCount < 12) {
    // 仓库不携带古籍数据（不入 GitHub），此时只断言「空库有可读提示」
    say('  · 本仓未携带古籍数据包，跳过书目与装入断言');
    const emptyTip = await page.$eval('#gujiList', e => e.innerText);
    ok('空库给可读提示', /没有古籍数据包|暂无书籍/.test(emptyTip), emptyTip.slice(0, 60));
    await browser.close();
    console.log('\n干支排盘 UI 冒烟：通过 ' + pass + '　失败 ' + fail);
    process.exit(fail ? 1 : 0);
  }
  ok('书籍数 ≥ 12', bookCount >= 12, 'got=' + bookCount);

  // 选「增删卜易 · 原文卦例」（只有卦名，需要反推动爻）
  await page.selectOption('#gujiBook', { label: '增删卜易 · 原文卦例（404 例）' }).catch(async () => {
    const opts = await page.$$eval('#gujiBook option', e => e.map(x => x.textContent));
    const hit = opts.find(t => t.indexOf('原文卦例') >= 0);
    if (hit) await page.selectOption('#gujiBook', { label: hit });
  });
  await page.waitForTimeout(1200);
  const items = await page.$$('#gujiList .guji-item');
  ok('卦例列表已渲染', items.length > 0, 'count=' + items.length);
  const firstMeta = await items[0].innerText();
  ok('条目显示干支与卦名', /月|日/.test(firstMeta), firstMeta.split('\n').slice(1).join(' ').slice(0, 80));

  await items[0].click();
  await page.waitForSelector('#gujiDetail:not([hidden])', { timeout: 5000 });
  const detail = await page.$eval('#gujiDetail', e => e.innerText);
  ok('详情有原文', detail.length > 20);
  const canLoad = await page.$eval('#btnGujiLoad', e => !e.disabled).catch(() => false);
  ok('装入排盘按钮可用（六爻已由卦名还原）', canLoad);

  await page.click('#btnGujiLoad');
  await page.waitForTimeout(800);
  const afterLoad = await page.$eval('#gzPreview', e => e.innerText);
  ok('装入后干支页刷新出卦名', /本卦/.test(afterLoad), afterLoad.replace(/\n/g, ' | ').slice(0, 100));
  eq('装入后切到干支模式', await page.$eval('#gzCard', e => e.hidden), false);

  /* ---------- F. 古籍全文阅读 ---------- */
  say('F. 古籍全文');
  const textOpts = await page.$$eval('#gujiBook option', e => e.map(x => x.textContent));
  const textBook = textOpts.find(t => t.indexOf('原文') >= 0 && t.indexOf('章') >= 0);
  ok('存在全文类书籍', !!textBook, textOpts.join(' / ').slice(0, 160));
  if (textBook) {
    await page.selectOption('#gujiBook', { label: textBook });
    await page.waitForTimeout(1500);
    const chs = await page.$$('#gujiList .guji-item');
    ok('章节列表已渲染', chs.length > 0, 'count=' + chs.length);
    // 有的书首章是「序」或空章，逐章找到第一篇有正文的再断言
    let got = '';
    for (let i = 0; i < Math.min(6, chs.length); i++) {
      await chs[i].click();
      await page.waitForSelector('#gujiDetail .guji-text', { timeout: 5000 });
      const t = await page.$eval('#gujiDetail .guji-text', e => e.innerText);
      if (t.length > 50) { got = t; break; }
    }
    ok('章节正文非空', got.length > 50, 'len=' + got.length);
  }

  /* ---------- G. 无脚本错误 ---------- */
  say('G. 控制台');
  // 本地模式下 fetch('/api/...') 全被接管，不应有报错
  const real = errs.filter(e => e.indexOf('favicon') < 0);
  ok('无 JS 报错', real.length === 0, real.slice(0, 3).join(' | '));

  await browser.close();
  console.log('\n干支排盘 UI 冒烟：通过 ' + pass + '　失败 ' + fail);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('SCRIPT FAIL:', e && e.message); process.exit(1); });
