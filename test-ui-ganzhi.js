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
  eq('五个按钮', tbLabels, ['古籍卦例库', 'AI 接口设置', '大模型断卦', '卦例库', '画板']);
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

  // 画板：canvas 就绪、能画一笔、撤销可用
  await page.click('#toolCard .tb-btn[data-k="board"]');
  await page.waitForTimeout(500);
  eq('画板面板展开', await page.$eval('.tb-pane[data-k="board"]', e => e.hidden), false);
  const cvBox = await page.$eval('#bdCanvas', e => ({ w: e.width, h: e.height }));
  ok('canvas 已按容器定尺寸', cvBox.w > 300 && cvBox.h > 200, JSON.stringify(cvBox));
  eq('工具齐全（9 个）', await page.$$eval('#boardCard .bd-tool', e => e.map(x => x.textContent.trim())),
    ['鼠标', '画笔', '文字', '矩形', '圆形', '画线', '圆弧形', '箭头', '橡皮擦']);
  ok('有后退/前进', await page.$('#bdUndo') !== null && await page.$('#bdRedo') !== null);
  ok('有截屏批注按钮', await page.$('#bdShot') !== null);
  await page.click('#boardCard .bd-tool[data-tool="rect"]');
  await page.waitForTimeout(150);
  eq('切到矩形后按钮高亮', await page.$eval('#boardCard .bd-tool[data-tool="rect"]', e => e.classList.contains('on')), true);
  await page.click('#boardCard .bd-tool[data-tool="pen"]');
  await page.waitForTimeout(150);
  await page.evaluate(function () {
    const cv = document.getElementById('bdCanvas');
    const r = cv.getBoundingClientRect();
    const opts = { bubbles: true, clientX: r.left + 40, clientY: r.top + 40, pointerId: 1 };
    cv.dispatchEvent(new PointerEvent('pointerdown', opts));
    cv.dispatchEvent(new PointerEvent('pointermove', Object.assign({}, opts, { clientX: r.left + 120, clientY: r.top + 90 })));
    cv.dispatchEvent(new PointerEvent('pointerup', opts));
  });
  await page.waitForTimeout(200);
  const inked = await page.evaluate(function () {
    const cv = document.getElementById('bdCanvas');
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) { if (d[i] !== 255 || d[i + 1] !== 253 || d[i + 2] !== 248) n++; }
    return n;
  });
  ok('画笔在画布上留下笔迹', inked > 50, 'ink=' + inked);
  await page.click('#bdUndo');
  await page.waitForTimeout(200);
  const afterUndo = await page.evaluate(function () {
    const cv = document.getElementById('bdCanvas');
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) { if (d[i] !== 255 || d[i + 1] !== 253 || d[i + 2] !== 248) n++; }
    return n;
  });
  ok('撤销清掉笔迹', afterUndo < inked, afterUndo + ' < ' + inked);
  await page.click('#bdRedo');
  await page.waitForTimeout(200);
  const afterRedo = await page.evaluate(function () {
    const cv = document.getElementById('bdCanvas');
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) { if (d[i] !== 255 || d[i + 1] !== 253 || d[i + 2] !== 248) n++; }
    return n;
  });
  ok('前进把笔迹还原', afterRedo >= inked, afterRedo + ' >= ' + inked);
  await page.click('#toolCard .tb-btn[data-k="board"]');

  /* ---------- B. 干支排盘界面（本卦/变卦/占问 + 年月建日辰时辰） ---------- */
  say('B. 干支排盘界面');
  await page.click('#btnModeGz');
  await page.waitForTimeout(300);
  eq('干支卡片可见', await page.$eval('#gzCard', e => e.hidden), false);
  eq('摇卦卡片隐藏', await page.$eval('#castCard', e => e.hidden), true);
  eq('公历时间行隐藏', await page.$eval('#dateRow', e => e.hidden), true);

  const optCounts = await page.evaluate(() => ({
    ben: document.querySelectorAll('#gzBen option').length,        // 64 卦
    bian: document.querySelectorAll('#gzBian option').length,      // 65（含「无」）
    year: document.querySelectorAll('#gzYear option').length,      // 61（含「无」）
    month: document.querySelectorAll('#gzMonth option').length,    // 12
    day: document.querySelectorAll('#gzDay option').length,        // 60
    hour: document.querySelectorAll('#gzHour option').length       // 13（含「无」）
  }));
  eq('下拉选项数', optCounts, { ben: 64, bian: 65, year: 61, month: 12, day: 60, hour: 13 });
  eq('本卦默认乾为天', await page.$eval('#gzBen', e => e.value), '乾为天');
  eq('变卦默认为空（静卦）', await page.$eval('#gzBian', e => e.value), '');
  ok('有占问输入框', await page.$('#gzQuestion') !== null);
  ok('有按爻区', await page.$('#gzYao') !== null);
  ok('有右侧古籍版式预览', await page.$('#gzPreview') !== null);

  let tip = await page.$eval('#timeInfo', e => e.innerText);
  ok('摘要标出本卦与静卦', tip.indexOf('乾为天') >= 0 && tip.indexOf('静卦') >= 0, tip.replace(/\n/g, ' | '));
  ok('摘要给出旬空', tip.indexOf('旬空') >= 0);

  /* ---------- C. 按爻 / 卦名双向联动 ---------- */
  say('C. 按爻与卦名联动');
  eq('按爻六行', (await page.$$('#gzYao .gz-yrow')).length, 6);
  eq('每行一个「动」复选框', (await page.$$('#gzYao .gz-move')).length, 6);
  eq('默认全阳（每行一段爻画）',
    await page.$$eval('#gzYao .gz-ybar', e => e.map(x => x.querySelectorAll('i').length)),
    [1, 1, 1, 1, 1, 1]);

  /* 注意：每次改动都会重绘按爻网格，元素句柄随即失效——
     所以一律按索引重新取，不能缓存 ElementHandle（踩过一次）。 */
  async function clickBar(i) {
    await page.$$eval('#gzYao .gz-yrow', (rows, k) => rows[k].querySelector('.gz-ybar').click(), i);
    await page.waitForTimeout(300);
  }
  async function clickMove(i) {
    await page.$$eval('#gzYao .gz-yrow', (rows, k) => rows[k].querySelector('.gz-move').click(), i);
    await page.waitForTimeout(300);
  }

  // 点初爻爻画（DOM 顺序是上→初，索引 5 才是初爻）→ 变阴 → 本卦应为天风姤
  await clickBar(5);
  eq('点爻画后本卦跟变', await page.$eval('#gzBen', e => e.value), '天风姤');
  eq('未勾动时无变卦', await page.$eval('#gzBian', e => e.value), '');

  // 勾初爻「动」→ 变卦应为乾为天（初爻阴动化阳）
  await clickMove(5);
  eq('勾动后变卦跟变', await page.$eval('#gzBian', e => e.value), '乾为天');

  // 反向：从下拉改回静卦，按爻应回到全阳
  await page.selectOption('#gzBen', '乾为天');
  await page.selectOption('#gzBian', '');
  await page.waitForTimeout(300);
  eq('下拉改回后按爻回到全阳',
    await page.$$eval('#gzYao .gz-ybar', e => e.map(x => x.querySelectorAll('i').length)),
    [1, 1, 1, 1, 1, 1]);

  let tip2 = await page.$eval('#gzPreview', e => e.innerText);
  ok('右侧预览是古籍版式', tip2.indexOf('干支：') >= 0 && tip2.indexOf('六神') >= 0, tip2.split('\n')[0]);

  /* ---------- D. 开始排盘 → 结果页 ---------- */
  say('D. 开始排盘');
  // 固定成「丙午年 亥月 戊子日」（旬空午未）以便断言红色标记，不随跑的日期变
  await page.selectOption('#gzYear', '42');
  await page.selectOption('#gzMonth', '11');
  await page.selectOption('#gzDay', '24');
  // 选一张变卦，让盘里真有动爻（变爻列与红标才有东西可断言）
  await page.selectOption('#gzBian', '天风姤');
  await page.waitForTimeout(400);
  await page.click('#btnGzPaipan');
  await page.waitForSelector('#panCard:not([hidden])', { timeout: 8000 });
  eq('结果页可见', await page.$eval('#panCard', e => e.hidden), false);
  ok('复制按钮在（说明盘已渲染）', await page.$('#btnCopy') !== null);

  /* 默认版式：古籍版式展开、卦象表格收起、古籍版式排在表之前 */
  eq('古籍版式默认展开', await page.$eval('#classicBox', e => e.hidden), false);
  eq('卦象表格默认收起', await page.$eval('#panBody', e => e.hidden), true);
  eq('开关文案为「卦象表格」', (await page.$eval('#btnClassic', e => e.textContent)).trim(), '卦象表格');
  ok('古籍版式排在卦象表之前', await page.evaluate(function () {
    const a = document.getElementById('classicBox');
    const b = document.getElementById('panBody');
    return !!(a && b && (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING));
  }));

  const classic = await page.$eval('#classicText', e => e.textContent);
  const cLines = classic.split('\n');
  ok('古籍版式首行为干支', /^干支：/.test(cLines[0] || ''), cLines[0]);
  ok('古籍版式第二行为宫名卦名', /宫：/.test(cLines[1] || ''), cLines[1]);
  ok('古籍版式第三行为四列表头', /六神　伏　　神/.test(cLines[2] || ''), cLines[2]);
  ok('古籍版式六爻齐全', cLines.length >= 9, 'lines=' + cLines.length);
  ok('古籍版式标出世应', /世|应/.test(classic));
  ok('古籍版式含旬空', /旬空/.test(classic));

  /* 切到卦象表格 */
  await page.click('#btnClassic');
  await page.waitForTimeout(350);
  eq('表格显示出来', await page.$eval('#panBody', e => e.hidden), false);
  eq('古籍版式收起', await page.$eval('#classicBox', e => e.hidden), true);
  eq('开关文案变「古籍版式」', (await page.$eval('#btnClassic', e => e.textContent)).trim(), '古籍版式');

  const gzMeta = await page.$eval('#panBody .gz-meta', e => e.innerText).catch(() => '');
  const gzTitle = await page.$eval('#panBody .gz-title', e => e.innerText).catch(() => '');
  ok('干支行以「干支：」开头', /^干支：/.test(gzMeta.trim()), gzMeta);
  ok('干支行含旬空', gzMeta.indexOf('旬空') >= 0);
  ok('宫名行形如「乾宫：乾为天」', /宫：/.test(gzTitle), gzTitle);

  // 变爻列：起出变卦后六爻全给，静爻用灰色（bian-static）与动爻（bian-move）区分
  const bianCells = await page.$$eval('#panBody table.pan tbody tr', rows => rows.map(function (r) {
    const c = r.querySelectorAll('td')[4];
    const sp = c.querySelector('span');
    return { text: c.textContent.trim(), cls: sp ? sp.className : '' };
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

  await page.waitForTimeout(300);
  eq('排盘后断卦面板有内容', await page.$eval('.tb-pane[data-k="ai"]', e => e.getAttribute('data-empty')), '0');

  /* 再切回古籍版式 */
  await page.click('#btnClassic');
  await page.waitForTimeout(300);
  eq('可切回古籍版式', await page.$eval('#classicBox', e => e.hidden), false);
  eq('切回后表格再收起到', await page.$eval('#panBody', e => e.hidden), true);

  /* ---------- D2. 存入卦例库（按钮已挪到结果页） ---------- */
  say('D2. 存入卦例库');
  ok('存入按钮在结果页', await page.$('#panCard #btnSave') !== null);
  ok('断卦面板里不再有存入按钮', await page.$('#aiCard #btnSave') === null);
  await page.click('#btnSave');
  await page.waitForTimeout(1000);
  const saved = await page.evaluate(function () {
    const a = JSON.parse(localStorage.getItem('ly_records_v1') || '[]');
    return { n: a.length, hex: a[0] && a[0].hex, hasPan: !!(a[0] && a[0].panText), dt: a[0] && a[0].datetime };
  });
  eq('本机库落了 1 条', saved.n, 1);
  ok('记录带卦名', !!saved.hex, JSON.stringify(saved).slice(0, 120));
  ok('记录带排盘文本', saved.hasPan);
  ok('干支盘的占时写干支', /干支/.test(saved.dt || ''), saved.dt);
  ok('按钮回执变「已入卦例库」', /已入卦例库/.test(await page.$eval('#btnSave', e => e.textContent)));

  /* ---------- D3. 画板载入卦象 ---------- */
  say('D3. 画板载入卦象');
  await page.click('#toolCard .tb-btn[data-k="board"]');
  await page.waitForTimeout(400);
  await page.evaluate(function () {
    const cv = document.getElementById('bdCanvas');
    cv.getContext('2d').clearRect(0, 0, cv.width, cv.height);
  });
  await page.click('#bdPan');
  await page.waitForTimeout(500);
  const panInk = await page.evaluate(function () {
    const cv = document.getElementById('bdCanvas');
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) { if (d[i] !== 255 || d[i + 1] !== 253 || d[i + 2] !== 248) n++; }
    return n;
  });
  ok('「载入卦象」把盘面画到画布上', panInk > 2000, 'ink=' + panInk);

  /* ---------- E2. 公历口径也默认「古籍版式」+ 收起卦象表格 ---------- */
  say('E2. 公历口径的默认版式');
  await page.click('#toolCard .tb-btn[data-k="board"]');   // 收起画板
  await page.click('#btnModeDate');
  await page.waitForTimeout(400);
  await page.fill('#guaNameInput', '水火既济');
  await page.click('#btnByName');
  await page.waitForTimeout(1000);
  eq('公历口径也默认展开古籍版式', await page.$eval('#classicBox', e => e.hidden), false);
  eq('公历口径默认收起卦象表格', await page.$eval('#panBody', e => e.hidden), true);
  const dText = await page.$eval('#classicText', e => e.textContent);
  ok('公历口径古籍版式首行为干支', /^干支：/.test((dText.split('\n')[0] || '').trim()),
    (dText.split('\n')[0] || '').slice(0, 40));
  eq('开关文案为「卦象表格」', (await page.$eval('#btnClassic', e => e.textContent)).trim(), '卦象表格');

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

    // 字号：可调、持久化到 localStorage
    const fs0 = await page.$eval('#gujiDetail .guji-text', e => parseFloat(getComputedStyle(e).fontSize));
    await page.click('#gujiDetail .guji-fs[data-fs="1"]');
    await page.waitForTimeout(200);
    await page.click('#gujiDetail .guji-fs[data-fs="1"]');
    await page.waitForTimeout(200);
    const fs1 = await page.$eval('#gujiDetail .guji-text', e => parseFloat(getComputedStyle(e).fontSize));
    ok('A＋ 放大正文', fs1 > fs0, fs0 + ' → ' + fs1);
    eq('字号写入本机', await page.evaluate(() => localStorage.getItem('ly_reader_font')),
      String(Math.round(fs1)));

    // 全页面阅读
    await page.click('#btnGujiFull');
    await page.waitForSelector('#readerOverlay', { timeout: 5000 });
    ok('全页面阅读已打开', await page.$('#readerOverlay') !== null);
    const rdLen = await page.$eval('#readerOverlay .rd-text', e => e.innerText.length);
    ok('浮层里有正文', rdLen > 50, 'len=' + rdLen);
    await page.click('#readerOverlay .rd-fs-btn[data-fs="-1"]');
    await page.waitForTimeout(200);
    const rdFs = await page.$eval('#readerOverlay .rd-text', e => parseFloat(getComputedStyle(e).fontSize));
    ok('浮层内也能改字号', rdFs < fs1, fs1 + ' → ' + rdFs);
    await page.click('#readerOverlay .rd-close');
    await page.waitForTimeout(300);
    ok('关闭后浮层消失', await page.$('#readerOverlay') === null);
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
