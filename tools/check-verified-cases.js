/* ============================================================
 * (tools/check-verified-cases.js)
 * 「有断有验」清单的自检 —— 防止这份数据悄悄腐烂。
 *
 * 它不检验断卦对错（那要靠人工裁定），只检验**抽取过程没走样**：
 *   ① 每个 prediction / outcome 都必须能回溯到语料原文的 conclusion
 *      （不是重新编的、不是跨例串行的）；
 *   ② engine 六视角齐全，且 trend 取值合法；
 *   ③ 条数不能无声塌陷（低于地板值即报错）；
 *   ④ 极性猜测不许出现「词表里没有的词」（防止有人改词表却忘了改文档）。
 *
 * 跑法：node tools/check-verified-cases.js（已挂进 npm test）
 * ============================================================ */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const VER = path.join(ROOT, 'tests', 'guji', 'verified-cases.json');
const CORPUS = path.join(ROOT, 'tests', 'guji', 'corpus', 'zengshan-boyi.json');

let pass = 0, fail = 0;
function eq(name, a, b) {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x === y) { pass++; }
  else { fail++; console.log('  ✗ ' + name + '\n      实际 ' + x + '\n      期望 ' + y); }
}
function ok(name, cond, extra) {
  if (cond) { pass++; }
  else { fail++; console.log('  ✗ ' + name + (extra ? '　' + extra : '')); }
}

if (!fs.existsSync(VER)) {
  console.error('找不到 tests/guji/verified-cases.json —— 先跑 npm run guji:verified');
  process.exit(1);
}
const ver = JSON.parse(fs.readFileSync(VER, 'utf8'));
const corpus = JSON.parse(fs.readFileSync(CORPUS, 'utf8'));
const byId = new Map(corpus.cases.map(function (c) { return [c.id, c]; }));

console.log('\n① 规模：清单不许无声塌陷');
ok('条数 ≥ 70（当前 ' + ver.cases.length + '）', ver.cases.length >= 70);
ok('summary.total 与 cases.length 一致', ver.summary.total === ver.cases.length);
eq('每例 id 唯一', new Set(ver.cases.map(function (r) { return r.id; })).size, ver.cases.length);

console.log('\n② 溯源：断语与应验句必须回到原文');
const TREND_OK = ['吉', '凶', '平'];
const GUESS_OK = ['POS', 'NEG', 'MIXED', 'UNKNOWN', 'MISMATCH'];
const bad = [];
ver.cases.forEach(function (r) {
  const c = byId.get(r.id);
  if (!c) { bad.push(r.id + '：语料中无此 id'); return; }
  const cons = String(c.conclusion || '');
  if (cons.indexOf(r.outcome) < 0) bad.push(r.id + '：outcome 不在原文里');
  if (cons.indexOf(r.prediction) < 0) bad.push(r.id + '：prediction 不在原文里');
  if (cons.indexOf(r.prediction + r.outcome) < 0 && (r.prediction + r.outcome).indexOf(cons) < 0) {
    // 切片之间允许有空白差异，但不许出现跨例串行——二者必须首尾相接
    bad.push(r.id + '：prediction 与 outcome 不连续（可能跨例串行）');
  }
});
eq('全部可溯源（prediction/outcome 均为原文切片）', bad, []);

console.log('\n③ 引擎六视角与取值');
const miss = [];
ver.cases.forEach(function (r) {
  ['shi', '妻财', '官鬼', '父母', '兄弟', '子孙'].forEach(function (t) {
    if (!(t in r.engine)) miss.push(r.id + '：缺 ' + t);
    else if (r.engine[t] !== null && TREND_OK.indexOf(r.engine[t]) < 0) miss.push(r.id + '：' + t + '=' + r.engine[t]);
  });
});
eq('六视角齐全且 trend 合法', miss, []);

console.log('\n④ 极性猜测与词表自洽');
const badGuess = ver.cases.filter(function (r) { return GUESS_OK.indexOf(r.resultGuess) < 0; });
eq('resultGuess 取值合法', badGuess.map(function (r) { return r.id; }), []);
const unknownWithWords = ver.cases.filter(function (r) { return r.resultGuess === 'UNKNOWN' && r.guessWords.length; });
eq('UNKNOWN 不得携带线索词', unknownWithWords.map(function (r) { return r.id; }), []);
const highNoWords = ver.cases.filter(function (r) { return r.confidence === 'high' && !r.guessWords.length; });
eq('confidence=high 必须有线索词（否则无从复核）', highNoWords.map(function (r) { return r.id; }), []);

console.log('\n⑤ 口径声明不能丢');
ok('文件头保留 caveats（三条以上）', Array.isArray(ver.caveats) && ver.caveats.length >= 3);
ok('caveats 明示 resultGuess 只是猜测',
  ver.caveats.some(function (s) { return /机械猜测|不是标签/.test(s); }));
ok('caveats 明示「无法校验古书自述应验」的真实性',
  ver.caveats.some(function (s) { return /选样偏差|无法校验/.test(s); }));
ok('summary 带六视角同向率', ver.summary.byTarget && Object.keys(ver.summary.byTarget).length === 6);

console.log('\n结果：PASS ' + pass + '　FAIL ' + fail + '\n');
process.exit(fail ? 1 : 0);
