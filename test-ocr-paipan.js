/* ============================================================
 * 截图导入排盘 · 解析层回归（node test-ocr-paipan.js）
 *
 * 样本是两张真实的「六爻排盘宝」手机截图，经 Windows 自带 OCR
 * （Windows.Media.Ocr / zh-Hans-CN）原样输出的文本，未做任何人工清洗。
 * 样本文件在 tests/fixtures/ocr/ 下。
 *
 * 断言口径（都是「不可推算的事实」，不是我的推断）：
 *   盘一：震宫雷水解 之 坤为地，二、四爻动，丙午年 己亥月 乙未日，戌月？
 *   盘二：坤宫雷天大壮（静），丙午年 己亥月 乙未日，占问「快递何时来」
 * 另钉几个「读歪了也得救回来」的用例：巳→已、月日那行的丙午年、单卦静卦。
 * ============================================================ */
const fs = require('fs');
const path = require('path');

const C = require('./core.js');
const LY = globalThis.LY;
require('./public/core/ocr-paipan.js');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '　【' + extra + '】' : '')); }
}
function eq(name, got, want) {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  ok(name, a === b, '得 ' + a + '，应 ' + b);
}

const bitsOfName = function (n) {
  if (!n) return null;
  const ks = Object.keys(C.HEXNAMES).filter(function (k) { return C.HEXNAMES[k] === n; });
  if (!ks.length) return null;
  const k = ks[0];
  return C.TRIG[k[0]].bits.concat(C.TRIG[k[1]].bits);
};

const FIX = path.join(__dirname, 'tests', 'fixtures', 'ocr');
function load(name) {
  return fs.readFileSync(path.join(FIX, name), 'utf8')
    .split('\n').filter(function (l) { return /^\d+\t\d+\t/.test(l); }).join('\n');
}

/* 解析两次：第一次拿卦名，第二次带 bits 好让「两卦差异」反推动爻 */
function parseTwice(raw) {
  let r = LY.ocrPaipan.parse(raw);
  const bb = bitsOfName(r.benName), xb = bitsOfName(r.bianName);
  return LY.ocrPaipan.parse(raw, { benBits: bb, bianBits: xb });
}

console.log('截图导入 · 解析层');

/* ---------- 盘一：有变卦、有两处动 ---------- */
const r1 = parseTwice(load('pan-jie.txt'));
eq('盘一 · 认出本卦', r1.benName, '雷水解');
eq('盘一 · 认出变卦', r1.bianName, '坤为地');
eq('盘一 · 本变卦是「同一横排左本右变」认出来的', r1.pairHow, 'same-row');
eq('盘一 · 动爻 2、4（由两卦差异反推）', r1.dong, [2, 4]);
eq('盘一 · 动爻来源', r1.dongFrom, 'diff');
eq('盘一 · 四柱', [r1.pillars.yearGZ, r1.pillars.monthGZ, r1.pillars.dayGZ], ['丙午', '己亥', '乙未']);
eq('盘一 · 日柱落了索引（乙未=31）', r1.pillars.dayIdx, 31);
eq('盘一 · 方式', r1.method, '电脑卦');
eq('盘一 · 公历时刻', r1.solar, { y: 2026, m: 11, d: 17, hh: 16, mm: 35 });
eq('盘一 · 卦名无需模糊兜底', r1.hexes.every(function (h) { return h.dist === 0; }), true);
ok('盘一 · ok 为真（卦名 + 日柱都拿到）', r1.ok);

/* 重排后必须与截图上的变卦一致——这是「差异即动爻」的自洽性证明 */
const pp1 = C.paipan(
  [0, 1, 0, 1, 0, 0].map(function (b, i) {   // 雷水解 初→上
    const moving = r1.dong.indexOf(i + 1) >= 0;
    return b === 1 ? (moving ? 9 : 1) : (moving ? 6 : 0);
  }),
  null,
  { pillars: C.pillarsFromGanzhi({ yearIdx: 42, monthZhi: 11, dayIdx: 31, hourZhi: 8 }) }
);
eq('盘一 · 按解析结果重排，本卦对得上', pp1.benName, '雷水解');
eq('盘一 · 按解析结果重排，变卦对得上', pp1.bianName, '坤为地');
eq('盘一 · 重排后旬空与截图一致（空 辰巳）', pp1.pillars.kongStr, '辰巳');
eq('盘一 · 重排后卦宫（震宫）', pp1.palace, '震');
/* 排盘宝在这一格标的是**变卦**的卦型：本卦雷水解非六冲，变卦坤为地才是六冲。
 * 盘二（雷天大壮静卦）标的则是本卦。所以断言按「谁六冲就谁六冲」写。 */
eq('盘一 · 本卦雷水解不是六冲', pp1.isLiuChong, false);
const pp1b = C.paipan(bitsOfName('坤为地'), null,
  { pillars: C.pillarsFromGanzhi({ yearIdx: 42, monthZhi: 11, dayIdx: 31, hourZhi: 8 }) });
eq('盘一 · 变卦坤为地是六冲（截图底部「六冲卦」指的它）', pp1b.isLiuChong, true);
eq('盘一 · 重排后世爻在二爻（财辰土持世）', pp1.lines[1].shi, true);
eq('盘一 · 重排后世爻六亲（截图：妻财持世）', pp1.lines[1].lq, '妻财');

/* ---------- 盘二：单卦静卦、有占问 ---------- */
const r2 = parseTwice(load('pan-dazhuang.txt'));
eq('盘二 · 认出本卦', r2.benName, '雷天大壮');
eq('盘二 · 没有变卦', r2.bianName, null);
eq('盘二 · 按静卦处理', r2.dong, []);
eq('盘二 · 四柱', [r2.pillars.yearGZ, r2.pillars.monthGZ, r2.pillars.dayGZ], ['丙午', '己亥', '乙未']);
eq('盘二 · 占问', r2.question, '快递何时来');
eq('盘二 · 方式', r2.method, '电脑卦');
ok('盘二 · ok 为真', r2.ok);
ok('盘二 · 提示里明说「按静卦处理」',
  r2.warnings.some(function (w) { return w.indexOf('静卦') >= 0; }), r2.warnings.join(' / '));

const pp2 = C.paipan([1, 1, 1, 1, 0, 0], null,
  { pillars: C.pillarsFromGanzhi({ yearIdx: 42, monthZhi: 11, dayIdx: 31, hourZhi: 8 }) });
eq('盘二 · 重排后本卦', pp2.benName, '雷天大壮');
eq('盘二 · 重排后静卦（无变卦）', pp2.hasBian, false);
eq('盘二 · 重排后卦宫（坤宫）', pp2.palace, '坤');
eq('盘二 · 重排后世爻在四爻（父母持世）', [pp2.lines[3].shi, pp2.lines[3].lq], [true, '父母']);

/* ---------- 容错：读歪了也得救回来 ---------- */
console.log('容错');

/* 「巳」读成「已」——实测最常见的一种错 */
eq('「巳」被读成「已」时仍能认出干支',
  LY.ocrPaipan._internals.fixGanZhi('乙已'), '乙巳');
eq('非法组合（甲丑）直接丢弃', LY.ocrPaipan._internals.fixGanZhi('甲丑'), null);
eq('「午」被读成「干」也能救', LY.ocrPaipan._internals.fixGanZhi('甲干'), '甲午');

/* 纯文本（没有坐标）也要能吃：这是「手动粘贴别人盘的文本」那条路 */
const pasted = [
  '占问：货款何时到',
  '时间：阳历 2026 年 11 月 17 日 16 时 35 分',
  '月日：(丙午年) 己亥月 乙未日 (空 辰巳)',
  '震：雷水解        坤为地',
  '六冲卦'
].join('\n');
const r3 = LY.ocrPaipan.parse(pasted);
eq('纯文本 · 本卦', r3.benName, '雷水解');
eq('纯文本 · 变卦', r3.bianName, '坤为地');
eq('纯文本 · 日柱', r3.pillars.dayGZ, '乙未');
eq('纯文本 · 占问', r3.question, '货款何时到');
eq('纯文本 · 没有坐标时 hasCoord 为假', r3.hasCoord, false);

/* 卦名写坏一个字：靠编辑距离兜底，但要给警告 */
const typo = LY.ocrPaipan.parse('月日：(丙午年) 己亥月 乙未日\n震：雷水觧');
eq('卦名错一字仍能匹配', typo.benName, '雷水解');
ok('近似匹配会给出警告',
  typo.warnings.some(function (w) { return w.indexOf('近似匹配') >= 0; }), typo.warnings.join(' / '));

/* 什么都没认出来时不许假装成功 */
const empty = LY.ocrPaipan.parse('随便一段没有盘面的文字');
eq('无盘面文本 → ok 为假', empty.ok, false);
ok('无盘面文本 → 明确提示没认出卦名',
  empty.warnings.some(function (w) { return w.indexOf('本卦') >= 0; }), empty.warnings.join(' / '));

/* ---------- 阳历时刻（年月日时）：各种写法都要认 ---------- */
console.log('阳历时刻');
const solarOf = function (t) { return LY.ocrPaipan._internals.readSolar(t); };
/* 王哥 2026-11-28 那张截图的原文格式，一字不改 */
eq('「时间: 阳历2026年11月28日13时18分」',
  solarOf('时间:阳历2026年11月28日13时18分'), { y: 2026, m: 11, d: 28, hh: 13, mm: 18 });
eq('数字与汉字之间夹空格也认',
  solarOf('阳历 2026 年 11 月 28 日 13 时 18 分'), { y: 2026, m: 11, d: 28, hh: 13, mm: 18 });
eq('短横线写法（公历2026-11-28 13:18）',
  solarOf('公历2026-11-28 13:18'), { y: 2026, m: 11, d: 28, hh: 13, mm: 18 });
eq('斜杠写法（2026/11/28 13:18）',
  solarOf('2026/11/28 13:18'), { y: 2026, m: 11, d: 28, hh: 13, mm: 18 });
eq('只有日期没有时刻 → 时分记 0', solarOf('阳历2026年11月28日'), { y: 2026, m: 11, d: 28, hh: 0, mm: 0 });
eq('点号写法（2026.11.28）',
  solarOf('2026.11.28'), { y: 2026, m: 11, d: 28, hh: 0, mm: 0 });
eq('不像日期的直接丢（13 月 40 日）', solarOf('阳历2026年13月40日'), null);
/* 「月日:(丙午年)己亥月乙未日」这种干支行里根本没有数字日期，
 * 绝不能把丙午/己亥里的字当成年月日——认错了整张盘的日辰就跟着错。 */
ok('农历干支行不会被误当阳历', solarOf('月日:(丙午年)己亥月乙未日(空 辰巳)') === null);
ok('读歪的时分（13时75分）不当作有效时刻，退回整点',
  solarOf('阳历2026年11月28日13时75分').mm === 0);

/* 整条走一遍：截图原文（含阳历那行）→ 盘面该有的东西都在 */
const shot = [
  '占问：这个月业绩能达标吗',
  '时间: 阳历2026年11月28日13时18分',
  '月日:(丙午年)己亥月乙未日(空 辰巳)',
  '震:雷水解        坤为地'
].join('\n');
const r4 = LY.ocrPaipan.parse(shot);
eq('整条 · 阳历年月日时', r4.solar, { y: 2026, m: 11, d: 28, hh: 13, mm: 18 });
eq('整条 · 本卦', r4.benName, '雷水解');
eq('整条 · 日柱', r4.pillars.dayGZ, '乙未');
eq('整条 · 占问不被阳历那行截断', r4.question, '这个月业绩能达标吗');

/* ---------- 汇总 ---------- */
console.log('\n截图导入 · 解析层：' + pass + ' 项通过' + (fail ? '，' + fail + ' 项失败' : ''));
if (fail) process.exit(1);
