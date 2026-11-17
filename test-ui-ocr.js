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

const EXE = process.env.LY_CHROME ||
  'C:/Users/ABC/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe';
const BASE = process.argv[2] || 'http://127.0.0.1:8932';

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
  const b = await chromium.launch({ executablePath: EXE, headless: true });
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
  ok('起卦页有「选择截图」', await page.$('#btnOcrPick') !== null);
  ok('起卦页有「读剪贴板截图」', await page.$('#btnOcrPaste') !== null);
  ok('解析模块已加载', await page.evaluate(function () {
    return !!(window.LY && window.LY.ocrPaipan && window.LY.ocrPaipan.parse);
  }));
  eq('未导入时预览收起', await page.$eval('#ocrPreview', function (e) { return e.hidden; }), true);

  /* ---------- 盘一：有变卦、动二四 ---------- */
  await page.click('#btnOcrPick');
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
      ocrCardStill: !document.getElementById('ocrCard').hidden
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
  /* 导入卡独立于起卦卡：切到干支口径后起卦卡会收起，导入入口必须还在 */
  ok('导入卡在干支口径下仍可见（不受口径切换影响）', pan1.ocrCardStill);

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
  await page.click('#btnOcrPick');
  await page.waitForTimeout(900);
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

  /* ---------- 放弃按钮 ---------- */
  await page.click('#btnOcrPick');
  await page.waitForTimeout(900);
  await page.click('#btnOcrCancel');
  await page.waitForTimeout(300);
  eq('点「放弃」后预览收起', await page.$eval('#ocrPreview', function (e) { return e.hidden; }), true);

  eq('全程无页面错误', errs.slice(0, 3), []);
  await b.close();

  console.log('\n截图导入：' + pass + ' 项通过' + (fail ? '，' + fail + ' 项失败' : ''));
  if (fail) process.exit(1);
})();
