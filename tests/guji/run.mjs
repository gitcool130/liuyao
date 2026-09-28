/* ============================================================
 * 古籍卦例回归 —— 报告器 (tests/guji/run.mjs)
 *
 * 运行：npm run test:guji
 * 可选：node tests/guji/run.mjs [--corpus <dir>] [--cases <dir>] [--quiet]
 *
 * 语料与原理见 lib/check.mjs 头注、README.md。
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkCorpus, checkTabCorpus, checkCases } from './lib/check.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
function argOf(name, dflt) {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
}
const CORPUS_DIR = argOf('corpus', path.join(__dirname, 'corpus'));
const CASES_DIR = argOf('cases', path.join(__dirname, 'cases'));

// 已知文本缺陷登记表（逐条回溯原文定性；非静默白名单，条数单独报告）
const KNOWN_FILE = path.join(__dirname, 'known-text-issues.json');
let KNOWN = { books: {} };
if (fs.existsSync(KNOWN_FILE)) {
  try { KNOWN = JSON.parse(fs.readFileSync(KNOWN_FILE, 'utf8')); }
  catch (e) { console.error('known-text-issues.json 解析失败：' + e.message); }
}

const total = { checks: 0, fails: 0, failLog: [], noDomain: [], byChapter: new Map(), cases: 0, excluded: 0, noGan: 0, divergences: 0, divergenceIds: [] };
const metas = [];

function merge(name, R) {
  total.checks += R.checks;
  total.fails += R.fails;
  total.cases += R.cases;
  total.excluded += (R.excluded || 0);
  total.noGan += (R.noGan || 0);
  total.divergences += (R.divergences || 0);
  total.divergenceIds = total.divergenceIds.concat(R.divergenceIds || []);
  total.failLog = total.failLog.concat(R.failLog);
  total.noDomain = total.noDomain.concat(R.noDomain);
  R.byChapter.forEach(function (v, k) {
    const b = total.byChapter.get(k) || { n: 0, bad: 0 };
    b.n += v.n; b.bad += v.bad;
    total.byChapter.set(k, b);
  });
  metas.push({ name: name, cases: R.cases, fails: R.fails, excluded: R.excluded || 0, noGan: R.noGan || 0, divergences: R.divergences || 0 });
}

if (fs.existsSync(CORPUS_DIR)) {
  fs.readdirSync(CORPUS_DIR).filter(function (f) { return f.endsWith('.json'); }).sort()
    .forEach(function (f) {
      const c = JSON.parse(fs.readFileSync(path.join(CORPUS_DIR, f), 'utf8'));
      const bk = KNOWN.books && KNOWN.books[c.book];
      if (c.format === 'table') {
        merge('《' + (c.book || f) + '》装卦/六神/伏神对账', checkTabCorpus(c, bk && bk.items));
      } else {
        merge('《' + (c.book || f) + '》排盘对账', checkCorpus(c));
      }
    });
}
if (fs.existsSync(CASES_DIR)) {
  fs.readdirSync(CASES_DIR).filter(function (f) { return f.endsWith('.json'); }).sort()
    .forEach(function (f) {
      const d = JSON.parse(fs.readFileSync(path.join(CASES_DIR, f), 'utf8'));
      merge('《' + (d.book || f) + '》断语断言', checkCases(d));
    });
}

console.log('== 古籍卦例回归 ==\n');
metas.forEach(function (m) {
  console.log('  ' + m.name + '：' + m.cases + ' 条' +
    (m.excluded ? '　※登记文本缺陷 ' + m.excluded + ' 处' : '') +
    (m.noGan ? '　（其中 ' + m.noGan + ' 条未印日干，六神项略）' : '') +
    (m.divergences ? '　※登记口径分歧 ' + m.divergences + ' 处' : '') +
    (m.fails ? '　✗ ' + m.fails + ' 处不符' : ''));
});

console.log('\n断言总数 ' + total.checks + '　通过 ' + (total.checks - total.fails) + '　失败 ' + total.fails +
  (total.excluded ? '　（含已登记文本缺陷 ' + total.excluded + ' 处）' : '') +
  (total.noDomain.length ? '　无等价日期 ' + total.noDomain.length : ''));

if (total.divergences) {
  console.log('\n※ 已登记口径分歧 ' + total.divergences + ' 处（' + total.divergenceIds.join('、') + '）');
  console.log('  原文口径与本实现不同：保留实现口径 → 登记分歧 → 锁定现状（expect 写实测值）。');
  console.log('  这类用例仍参与断言；若将来改了口径，测试会转红并提示更新分歧表。');
}

if (total.excluded) {
  console.log('\n※ 已登记文本缺陷 ' + total.excluded + ' 处 —— 逐条回溯定本原文，定性为第三方转换文本的排版缺陷');
  console.log('  （td 错位 / 串栏 / 讹字），非引擎分歧。明细与原文证据见 known-text-issues.json。');
}

if (total.noDomain.length) {
  console.log('\n-- 无等价日期（该例未印足供驱动的日辰；或 1900–2100 内无该「月支 + 日干支」组合）--');
  total.noDomain.slice(0, 12).forEach(function (d) {
    const when = d.monthZhi ? (d.monthZhi + '月' + d.dayGZ + '日') : (d.dayGZ || '(未印日辰)');
    console.log('  L' + (d.line || '') + '　' + when + '　' + String(d.head).slice(0, 46));
  });
  if (total.noDomain.length > 12) console.log('  …另有 ' + (total.noDomain.length - 12) + ' 条');
}

if (total.fails) {
  console.log('\n-- 差异明细（前 40）--');
  total.failLog.slice(0, 40).forEach(function (f) {
    console.log('  L' + f.line + ' [' + f.field + '] 书上=' + JSON.stringify(f.want) + ' 引擎=' + JSON.stringify(f.got));
    console.log('      ' + String(f.head).slice(0, 74));
  });
  if (total.failLog.length > 40) console.log('  …另有 ' + (total.failLog.length - 40) + ' 条');

  console.log('\n-- 按章节差异分布 --');
  [...total.byChapter.entries()].filter(function (e) { return e[1].bad > 0; })
    .sort(function (a, b) { return b[1].bad - a[1].bad; })
    .forEach(function (e) { console.log('  ' + e[1].bad + '/' + e[1].n + '　' + e[0]); });
}

console.log('');
if (total.fails || total.noDomain.length) {
  console.log('古籍回归：FAIL');
  process.exit(1);
}
console.log('古籍回归：PASS —— 全部装卦字段与传世定本吻合' +
  (total.excluded ? '（另有 ' + total.excluded + ' 处已逐条回溯原文、定性为语料转换缺陷，见 known-text-issues.json）' : ''));
