/* ============================================================
 * 截图导入排盘 · 端到端（node test-ui-ocr.js [baseUrl]）
 *
 * 需要真浏览器：这条链路的坑（入口在哪、装入后崩不崩、盘排得对不对）
 * 只有真 DOM 才能验。系统 OCR 那一步用 mock 壳顶替（C# 壳在 CI 里跑不起来），
 * 喂进去的是**真实 Windows OCR 输出**（tests/fixtures/ocr/*.txt），
 * 所以「解析 + 装盘」这两段是真的，只有「调用系统 OCR」那一行是假的。
 * ============================================================ */
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

const BASE = process.argv[2] || 'http://127.0.0.1:8932';

/* ⚠ 不能写死本机的 chrome 路径：CI 上没有那个文件，会以
 *   「Failed to launch chromium because executable doesn't exist」整步挂掉
 *   （2026-11-17 这轮就是这么挂的，白瞎了一次构建）。
 * 与 test-ui-ganzhi.js 同一套兜底：msedge → chrome → playwright 自带。 */
async function launchBrowser() {
  const attempts = [];
  if (process.env.LY_CHROME) attempts.push({ executablePath: process.env.LY_CHROME, headless: true });
  attempts.push({ channel: 'msedge', headless: true });
  attempts.push({ channel: 'chrome', headless: true });
  attempts.push({ headless: true });
  let lastErr;
  for (const opt of attempts) {
    try { return await chromium.launch(opt); } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

const FX = path.join(__dirname, 'tests', 'fixtures', 'ocr');
const loadOcr = function (f) {
  return fs.readFileSync(path.join(FX, f), 'utf8')
    .split('\n').filter(function (l) { return /^\d+\t\d+\t/.test(l); }).join('\n');
};
const OCR_JIE = loadOcr('pan-jie.txt');
const OCR_DAZHUANG = loadOcr('pan-dazhuang.txt');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '　【' + extra + '】' : '')); }
}
function eq(name, got, want) {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  ok(name, a === b, '得 ' + a + '，应 ' + b);
}

(async () => {
  const b = await launchBrowser();
  const ctx = await b.newContext({ viewport: { width: 1300, height: 1100 } });
  await ctx.addInitScript(function (payload) {
    const files = { '卦例库.json': '[]', '我的古籍.json': JSON.stringify({ books: [] }) };
    const listeners = [];
    /* mock 壳：pickimage 固定返回一张图；ocr 依次吐 fixtures 里的真实识别结果 */
    window.__ocrQueue = [payload.jie, payload.dazhuang];
    window.chrome = { webview: {
      postMessage: function (msg) {
        const p = String(msg).split('\n');
        const op = p[0], id = p[1], name = p[2] || '', payload = p.slice(3).join('\n');
        let body = '';
        if (op === 'info') body = 'D://x//data';
        else if (op === 'read') body = files[name] || '';
        else if (op === 'write') { files[name] = payload; body = name; }
        else if (op === 'list') body = Object.keys(files).join('\u0001');
        else if (op === 'pickimage') body = 'D:/shots/pan.png';
        else if (op === 'ocr') body = 'SIZE\t886\t1920\n' + (window.__ocrQueue.shift() || '');
        else if (op === 'saveexportb64') body = 'D:/x/导出/临时.png';
        setTimeout(function () { listeners.forEach(function (f) { f({ data: id + '\nok\n' + body }); }); }, 0);
      },
      addEventListener: function (k, f) { if (k === 'message') listeners.push(f); }
    } };
    window.__files = files;
  }, { jie: OCR_JIE, dazhuang: OCR_DAZHUANG });

  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', function (e) { errs.push(e.message); });
  page.on('dialog', async function (d) { await d.accept(); });
  await page.goto(BASE + '/index.html?local=1', { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);

  console.log('截图导入');

  /* ---------- 入口 ---------- */
  /* 导入入口已并入「画板涂鸦」（2026-11-17 王哥要求），首页不再有那张卡 */
  eq('首页不再有旧的导入卡', await page.evaluate(function () {
    return !!document.getElementById('ocrCard');
  }), false);
  await page.click('#sideRail .tb-btn[data-k="board"]');
  await page.waitForTimeout(700);
  ok('画板里有「截图导入」', await page.$('#bdOcrShot') !== null);
  ok('画板里有「文本导入」', await page.$('#bdOcrText') !== null);
  ok('解析模块已加载', await page.evaluate(function () {
    return !!(window.LY && window.LY.ocrPaipan && window.LY.ocrPaipan.parse);
  }));
  eq('未导入时导入区收起', await page.$eval('#bdOcrZone', function (e) { return e.hidden; }), true);

  /* 每装入一次都会自动跳回首页，所以每次导入前都要先回画板。
   * 用它统一处理，免得每处都写两行。 */
  async function backToBoardAndShot() {
    await page.click('#sideRail .tb-btn[data-k="board"]');
    await page.waitForTimeout(500);
    await page.click('#bdOcrShot');
    await page.waitForTimeout(900);
  }

  /* ---------- 盘一：有变卦、动二四 ---------- */
  await page.click('#bdOcrShot');
  await page.waitForTimeout(900);
  const prev = await page.evaluate(function () {
    const box = document.getElementById('ocrPreview');
    return {
      shown: !box.hidden,
      text: box.innerText,
      canLoad: document.getElementById('btnOcrLoad') ?
        !document.getElementById('btnOcrLoad').disabled : false
    };
  });
  ok('识别后出预览', prev.shown);
  ok('预览里有本卦雷水解', prev.text.indexOf('雷水解') >= 0, prev.text.slice(0, 80));
  ok('预览里有变卦坤为地', prev.text.indexOf('坤为地') >= 0);
  ok('预览里有四柱', prev.text.indexOf('乙未') >= 0);
  ok('预览里标明动爻来源', prev.text.indexOf('差异反推') >= 0);
  ok('「装入排盘」按钮可用', prev.canLoad);

  await page.click('#btnOcrLoad');
  await page.waitForTimeout(1300);

  const pan1 = await page.evaluate(function () {
    const head = document.getElementById('classicText').textContent.split('\n');
    return {
      gzMode: document.getElementById('btnModeGz').className.indexOf('primary') >= 0,
      gzCard: !document.getElementById('gzCard').hidden,
      panShown: !document.getElementById('panCard').hidden,
      head0: head[0], head1: head[1],
      moves: Array.from(document.querySelectorAll('#gzYao .gz-move'))
        .map(function (e, i) { return e.checked ? (6 - i) : 0; }).filter(Boolean),
      pane: (document.querySelector('#sideRail .tb-btn.on') || {}).textContent
    };
  });
  ok('装入后切到干支口径', pan1.gzMode);
  ok('干支排盘面板展开', pan1.gzCard);
  ok('卦象卡出现', pan1.panShown);
  ok('四柱与截图一致（丙午年 己亥月 乙未日）',
    pan1.head0.indexOf('丙午年') >= 0 && pan1.head0.indexOf('己亥月') >= 0 && pan1.head0.indexOf('乙未日') >= 0,
    pan1.head0);
  ok('旬空与截图一致（辰巳）', pan1.head0.indexOf('辰巳') >= 0, pan1.head0);
  ok('本卦雷水解、变卦坤为地', pan1.head1.indexOf('雷水解') >= 0 && pan1.head1.indexOf('坤为地') >= 0, pan1.head1);
  eq('动爻正是二、四', pan1.moves, [4, 2]);
  /* 导入入口在画板页、盘排在首页：装入后必须自动跳回首页，否则看着像没成功 */
  eq('装入后自动跳回首页排盘', pan1.pane, '首页排盘');

  /* ---------- 存进卦例库：导入的盘要能存 ---------- */
  await page.click('#btnSave');
  await page.waitForTimeout(1500);
  const saved = await page.evaluate(function () {
    const a = JSON.parse(window.__files['卦例库.json'] || '[]');
    return {
      n: a.length,
      hex: a[0] && a[0].hex,
      pil: a[0] && a[0].pillars,
      tosses: a[0] && (a[0].tosses || []).map(function (t) { return t.val; })
    };
  });
  eq('存入卦例库多一条', saved.n, 1);
  ok('记录里卦名对', String(saved.hex).indexOf('雷水解') >= 0 && String(saved.hex).indexOf('坤为地') >= 0, saved.hex);
  ok('记录里四柱对', String(saved.pil).indexOf('乙未') >= 0, saved.pil);
  eq('记录里六爻爻值完整（0/9/6 三档）', saved.tosses, [0, 9, 0, 9, 0, 0]);

  /* ---------- 盘二：静卦 + 占问 ---------- */
  await backToBoardAndShot();
  await page.click('#btnOcrLoad');
  await page.waitForTimeout(1300);
  const pan2 = await page.evaluate(function () {
    const t = document.getElementById('classicText').textContent;
    return {
      head1: t.split('\n')[1],
      staticGua: t.indexOf('静卦') >= 0,
      question: (document.getElementById('castQuestion') || {}).value,
      moves: Array.from(document.querySelectorAll('#gzYao .gz-move')).filter(function (e) { return e.checked; }).length
    };
  });
  ok('盘二 · 本卦雷天大壮', pan2.head1.indexOf('雷天大壮') >= 0, pan2.head1);
  /* 「静卦」两字只印在**表格版**（旧版既定写法，古籍版式不印）。
   * 这里验真正的判据：古籍版式第二行没有「之 某卦」，且干支面板无动爻。 */
  ok('盘二 · 古籍版式无变卦（静卦）', pan2.head1.indexOf('之') < 0, pan2.head1);
  eq('盘二 · 无动爻', pan2.moves, 0);
  eq('盘二 · 占问带进来了', pan2.question, '快递何时来');

  /* ---------- 文本导入（粘贴/剪贴板文本解析） ---------- */
  await page.click('#sideRail .tb-btn[data-k="board"]');
  await page.waitForTimeout(500);
  await page.evaluate(function () { document.querySelector('#bdOcrText').click(); });
  await page.waitForTimeout(400);
  await page.fill('#bdOcrRaw', [
    '占问：这笔货款何时到',
    '时间：阳历 2026 年 11 月 17 日 16 时 35 分',
    '月日：(丙午年) 己亥月 乙未日 (空 辰巳)',
    '震：雷水解        坤为地',
    '六冲卦'
  ].join(String.fromCharCode(10)));
  await page.evaluate(function () { document.querySelector('#bdOcrParse').click(); });
  await page.waitForTimeout(600);
  const txtPrev = await page.evaluate(function () {
    const box = document.getElementById('ocrPreview');
    return { shown: !box.hidden, text: box.innerText };
  });
  ok('文本导入出识别结果', txtPrev.shown);
  ok('文本导入认出本卦', txtPrev.text.indexOf('雷水解') >= 0, txtPrev.text.slice(0, 60));
  ok('文本导入认出占问', txtPrev.text.indexOf('这笔货款何时到') >= 0);

  await page.click('#btnOcrLoad');
  await page.waitForTimeout(1400);
  const txtPan = await page.evaluate(function () {
    return {
      head0: document.getElementById('classicText').textContent.split(String.fromCharCode(10))[0],
      question: (document.getElementById('castQuestion') || {}).value,
      pane: (document.querySelector('#sideRail .tb-btn.on') || {}).textContent
    };
  });
  ok('文本导入的盘排出来了', txtPan.head0.indexOf('乙未日') >= 0 && txtPan.head0.indexOf('辰巳') >= 0, txtPan.head0);
  eq('文本导入的占问回填', txtPan.question, '这笔货款何时到');
  eq('文本导入后也跳回首页', txtPan.pane, '首页排盘');

  /* ---------- 存入时能选分类 ---------- */
  ok('结果页有「分类」输入框', await page.$('#saveCat') !== null);
  await page.fill('#saveCat', '货款');
  await page.click('#btnSave');
  await page.waitForTimeout(1800);
  const savedCat = await page.evaluate(function () {
    const a = JSON.parse(window.__files['卦例库.json'] || '[]');
    const me = a.filter(function (r) { return r.question === '这笔货款何时到'; })[0] || {};
    return { cat: me.category, tip: (document.getElementById('saveTip') || {}).textContent };
  });
  eq('存入时写的分类落库了', savedCat.cat, '货款');
  ok('回执里说明已归类', String(savedCat.tip).indexOf('货款') >= 0, savedCat.tip);

  /* 换卦要把分类清掉，别带到下一卦去 */
  await page.click('#btnReset');
  await page.waitForTimeout(600);
  eq('重新起卦后分类框清空', await page.evaluate(function () {
    return (document.getElementById('saveCat') || {}).value;
  }), '');

  /* ---------- 放弃按钮 ---------- */
  await backToBoardAndShot();
  await page.click('#btnOcrCancel');
  await page.waitForTimeout(300);
  eq('点「放弃」后预览收起', await page.$eval('#ocrPreview', function (e) { return e.hidden; }), true);

  eq('全程无页面错误', errs.slice(0, 3), []);
  await b.close();

  console.log('\n截图导入：' + pass + ' 项通过' + (fail ? '，' + fail + ' 项失败' : ''));
  if (fail) process.exit(1);
})();
