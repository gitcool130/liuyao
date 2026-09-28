/* ============================================================
 * 古籍回归自检 —— 变异验证 (tests/guji/selftest.mjs)
 *
 * 目的：证明古籍回归「不是空转」。历史教训：本项目 test-core.js 曾出现
 *   eq('甲日六神起', C.BEASTS ? '' : '', '') —— 两分支同为 ''，恒真空断言，
 *   实现写错也照样通过。全绿的回归必须能证明「注入错误就会变红」。
 *
 * 做法：以真实语料为基线，向期望值逐类注入一处已知错误，
 *       验证每一类错误都被对账捕获。
 *
 * 运行：npm run test:guji:self
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkCorpus, checkCases, checkTabCorpus } from './lib/check.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CORPUS = path.join(__dirname, 'corpus', 'zengshan-boyi.json');

if (!fs.existsSync(CORPUS)) {
  console.error('缺少语料 ' + CORPUS + '，请先跑 npm run gen:guji');
  process.exit(2);
}

const corpus = JSON.parse(fs.readFileSync(CORPUS, 'utf8'));
const clone = function (o) { return JSON.parse(JSON.stringify(o)); };

const base = checkCorpus(corpus);
console.log('== 古籍回归自检（变异验证）==\n');
console.log('基线：' + base.checks + ' 断言　' + base.cases + ' 条卦例　失败 ' + base.fails);
if (base.fails) {
  console.log('\n基线本身未全绿，无法进行变异自检。请先修好古籍回归。');
  process.exit(1);
}

// 取一条含动爻的卦例作变异靶（动爻才有变卦字段可变异）
let ci = corpus.cases.findIndex(function (c) { return c.ben.some(function (l) { return l.moving; }); });
if (ci < 0) ci = 0;
const tgt = corpus.cases[ci];
const movPos = tgt.ben.findIndex(function (l) { return l.moving; });
// 一个「不变动但变卦位仍有印出之爻」的位（书右半照抄本卦），用于验证变卦比对非只查动爻
const stillPos = tgt.bian.findIndex(function (b, i) { return b && b.zhi && !tgt.ben[i].moving; });
const otherIn = function (arr, v) { return arr.filter(function (x) { return x !== v; })[0]; };

const ZHI = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];
const LQ = ['父母', '兄弟', '子孙', '妻财', '官鬼'];

const MUTATIONS = [
  ['卦画注入错误（改初爻阴阳）', function (c) {
    c.cases[ci].ben[0].yang = !c.cases[ci].ben[0].yang;
  }],
  ['本卦初爻·地支', function (c) {
    c.cases[ci].ben[0].zhi = otherIn(ZHI, c.cases[ci].ben[0].zhi);
  }],
  ['本卦初爻·六亲', function (c) {
    c.cases[ci].ben[0].lq = otherIn(LQ, c.cases[ci].ben[0].lq);
  }],
  ['本卦' + tgt.ben.length + '爻·世位取反', function (c) {
    const i = c.cases[ci].ben.length - 1;
    c.cases[ci].ben[i].shi = !c.cases[ci].ben[i].shi;
  }],
  ['本卦初爻·应位取反', function (c) {
    c.cases[ci].ben[0].ying = !c.cases[ci].ben[0].ying;
  }],
  ['变卦动爻位·地支', function (c) {
    c.cases[ci].bian[movPos].zhi = otherIn(ZHI, c.cases[ci].bian[movPos].zhi);
  }],
  ['变卦动爻位·六亲', function (c) {
    c.cases[ci].bian[movPos].lq = otherIn(LQ, c.cases[ci].bian[movPos].lq);
  }],
  ['变卦动爻位·世位取反', function (c) {
    c.cases[ci].bian[movPos].shi = !c.cases[ci].bian[movPos].shi;
  }],
  ['变卦动爻位·应位取反', function (c) {
    c.cases[ci].bian[movPos].ying = !c.cases[ci].bian[movPos].ying;
  }],
  ['变卦静爻位（第' + (stillPos + 1) + '爻）·地支', function (c) {
    c.cases[ci].bian[stillPos].zhi = otherIn(ZHI, c.cases[ci].bian[stillPos].zhi);
  }],
  ['日辰非法（语料损坏应报无解）', function (c) {
    c.cases[ci].dayGZ = '甲甲';
  }]
];

console.log('\n靶例：L' + tgt.line + '　' + tgt.head.slice(0, 54));
console.log('注入 ' + MUTATIONS.length + ' 类已知错误，验证每类均被捕获：\n');

let caught = 0;
const rows = [];
MUTATIONS.forEach(function (m) {
  const c = clone(corpus);
  m[1](c);
  const R = checkCorpus(c);
  const ok = R.fails > base.fails || R.noDomain.length > base.noDomain.length;
  if (ok) caught++;
  rows.push('  ' + (ok ? '✓ 捕获' : '✗ 漏报') + '　' + m[0] +
    '　（不符 ' + R.fails + ' / 无解 ' + R.noDomain.length + '）');
});
rows.forEach(function (r) { console.log(r); });

console.log('\n捕获率 ' + caught + ' / ' + MUTATIONS.length);

/* ---------- 断语断言层（cases/*.json）的变异验证 ---------- */
const CASES = path.join(__dirname, 'cases', 'zengshan-boyi.json');
let caughtC = 0, totalC = 0;

if (fs.existsSync(CASES)) {
  const doc = JSON.parse(fs.readFileSync(CASES, 'utf8'));
  const baseC = checkCases(doc);
  console.log('\n-- 断语断言层（规则层）--');
  console.log('基线：' + baseC.checks + ' 断言　' + baseC.cases + ' 条用例　失败 ' + baseC.fails);

  const cmut = [
    ['改 trend 期望（凶→吉）', function (d) {
      const c = d.cases.find(function (x) { return x.expect.some(function (e) { return e.trend; }); });
      const e = c.expect.find(function (x) { return x.trend; });
      e.trend = e.trend === '凶' ? '吉' : '凶';
    }],
    ['改 tag:rule 期望为不存在之规则', function (d) {
      const c = d.cases.find(function (x) { return x.expect.some(function (e) { return e.rule; }); });
      c.expect.find(function (x) { return x.rule; }).rule = '__不存在的规则__';
    }],
    ['改 atLine 指向错爻', function (d) {
      const c = d.cases.find(function (x) { return x.id === 'zsby-1508-ripo'; });
      c.expect.find(function (x) { return x.atLine === 1; }).atLine = 5;
    }],
    ['改月建（丑月→子月，午火由休转死）', function (d) {
      const c = d.cases.find(function (x) { return x.id === 'zsby-1508-ripo'; });
      c.monthZhi = '子';
    }],
    ['改日辰（壬子→壬午，日冲消失）', function (d) {
      const c = d.cases.find(function (x) { return x.id === 'zsby-1508-ripo'; });
      c.dayGZ = '壬午';
    }]
  ];

  const rowsC = [];
  cmut.forEach(function (m) {
    const d = clone(doc);
    m[1](d);
    const R = checkCases(d);
    totalC++;
    const ok = R.fails > baseC.fails || R.noDomain.length > baseC.noDomain.length;
    if (ok) caughtC++;
    rowsC.push('  ' + (ok ? '✓ 捕获' : '✗ 漏报') + '　' + m[0] +
      '　（不符 ' + R.fails + ' / 无解 ' + R.noDomain.length + '）');
  });
  console.log('注入 ' + cmut.length + ' 类已知错误：');
  rowsC.forEach(function (r) { console.log(r); });
  console.log('\n断语层捕获率 ' + caughtC + ' / ' + totalC);
}

/* ---------- 表格式语料（六神 / 伏神）的变异验证 ---------- */
let caughtB = 0, totalB = 0;

const BSC = path.join(__dirname, 'corpus', 'bushi-zhengzong.json');
const KNOWN_FILE = path.join(__dirname, 'known-text-issues.json');

if (fs.existsSync(BSC) && fs.existsSync(KNOWN_FILE)) {
  const corpus2 = JSON.parse(fs.readFileSync(BSC, 'utf8'));
  const kItems = (JSON.parse(fs.readFileSync(KNOWN_FILE, 'utf8')).books['卜筮正宗'] || {}).items || [];
  const excludedIds = {};
  kItems.forEach(function (it) { excludedIds[it.id] = true; });

  const base2 = checkTabCorpus(corpus2, kItems);
  console.log('\n-- 表格式语料层（《卜筮正宗》装卦/六神/伏神）--');
  console.log('基线：' + base2.checks + ' 断言　' + base2.cases + ' 条　失败 ' + base2.fails +
    '　（已登记文本缺陷 ' + base2.excluded + ' 处）');

  if (base2.fails) {
    console.log('\n基线未全绿，无法变异自检。');
    process.exit(1);
  }

  const BEASTS = ['青龙', '朱雀', '勾陈', '腾蛇', '白虎', '玄武'];
  const LN = ['初爻', '二爻', '三爻', '四爻', '五爻', '上爻'];
  const otherB = function (v) { return BEASTS.filter(function (x) { return x !== v; })[0]; };

  // 靶例：有日干（六神可对账）且不在已知文本缺陷之列
  const bi = corpus2.cases.findIndex(function (c) {
    return c.dayGan && c.ben[0].beast && !excludedIds[c.id];
  });
  // 含伏神之靶例
  const fi = corpus2.cases.findIndex(function (c) {
    return c.dayGan && c.ben.some(function (b) { return b.fu; }) && !excludedIds[c.id];
  });
  const fuPos = fi >= 0 ? corpus2.cases[fi].ben.findIndex(function (b) { return b.fu; }) : -1;

  const MUT2 = [
    ['六神·初爻取反（青龙↔朱雀）', function (c) {
      c.cases[bi].ben[0].beast = otherB(c.cases[bi].ben[0].beast);
    }],
    ['六神·整体错位一位（模拟日干取错）', function (c) {
      c.cases[bi].ben.forEach(function (b) {
        b.beast = BEASTS[(BEASTS.indexOf(b.beast) + 1) % 6];
      });
    }],
    ['装卦地支·上爻', function (c) {
      const i = c.cases[bi].ben.length - 1;
      c.cases[bi].ben[i].zhi = otherIn(ZHI, c.cases[bi].ben[i].zhi);
    }],
    ['装卦六亲·上爻', function (c) {
      const i = c.cases[bi].ben.length - 1;
      c.cases[bi].ben[i].lq = otherIn(LQ, c.cases[bi].ben[i].lq);
    }],
    ['伏神值篡改（' + (fuPos >= 0 ? LN[fuPos] : '—') + '）', function (c) {
      if (fi < 0) return;
      const f = c.cases[fi].ben[fuPos].fu;
      f.zhi = otherIn(ZHI, f.zhi);
    }],
    ['伏神六亲篡改', function (c) {
      if (fi < 0) return;
      const f = c.cases[fi].ben[fuPos].fu;
      f.lq = otherIn(LQ, f.lq);
    }],
    ['卦画注入（改初爻阴阳，令装卦整体位移）', function (c) {
      c.cases[bi].toss[0] = c.cases[bi].toss[0] === 1 ? 0 : 1;
    }]
  ];

  console.log('\n靶例：L' + corpus2.cases[bi].line + '　' + corpus2.cases[bi].gua +
    (fi >= 0 ? '　（伏神靶 L' + corpus2.cases[fi].line + ' ' + corpus2.cases[fi].gua + '）' : ''));
  console.log('注入 ' + MUT2.length + ' 类已知错误：');

  const rowsB = [];
  MUT2.forEach(function (m) {
    const c = clone(corpus2);
    m[1](c);
    const R = checkTabCorpus(c, kItems);
    totalB++;
    const ok = R.fails > base2.fails || R.noDomain.length > base2.noDomain.length;
    if (ok) caughtB++;
    rowsB.push('  ' + (ok ? '✓ 捕获' : '✗ 漏报') + '　' + m[0] +
      '　（不符 ' + R.fails + ' / 无解 ' + R.noDomain.length + '）');
  });
  rowsB.forEach(function (r) { console.log(r); });
  console.log('\n表格式层捕获率 ' + caughtB + ' / ' + totalB);
}

const totalCaught = caught + caughtC + caughtB, totalMut = MUTATIONS.length + totalC + totalB;
console.log('\n合计捕获率 ' + totalCaught + ' / ' + totalMut);
console.log('');
if (totalCaught === totalMut) {
  console.log('自检 PASS —— 排盘层、断语层与表格式层（六神/伏神）对各类错误均能变红，非空转断言');
} else {
  console.log('自检 FAIL —— 存在漏报，对账逻辑有盲区');
  process.exit(1);
}
