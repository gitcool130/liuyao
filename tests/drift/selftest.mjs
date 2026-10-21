/* ============================================================
 * 断语质量指标自检 (tests/drift/selftest.mjs)
 *
 * 目的：证明 run.mjs 报的那四个数字**不是恒真的摆设**。
 * 每组都配反向对照——指标该动的时候必须动，该放行的时候必须放行。
 * 一个只会输出「全绿」的评测器，比没有评测器更糟。
 * ============================================================ */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { directionOf, boundaryOf, evaluateCorpus, judge } from './lib.mjs';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const core = require(path.join(repo, 'core.js'));

let pass = 0, fail = 0;
function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; } else { fail++; console.log('  ✗ ' + name + ' got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)); }
}
function ok(name, cond) { eq(name, !!cond, true); }

console.log('A. 结论方向解析');
eq('显式「结论：凶，不可堪用」→ 凶', directionOf('诸事不宜。\n结论：凶，不可堪用'), '凶');
eq('显式「结论：平」→ 平', directionOf('六冲反复。\n结论：平'), '平');
eq('显式「结论：大吉」→ 吉', directionOf('用神旺相。\n结论：大吉'), '吉');
eq('「断为凶」句式 → 凶', directionOf('综合观之，断为凶。'), '凶');
eq('无结论行、通篇不可用 → 凶', directionOf('用神休囚。事不可用。终难成。'), '凶');
eq('无结论行、通篇可成 → 吉', directionOf('用神旺相。事可成。谋可得。'), '吉');
eq('否定优先：「不可用」不得被判成吉', directionOf('此物不可用。'), '凶');
eq('未表态 → null', directionOf('今日天气如何。'), null);
eq('空串 → null', directionOf(''), null);
eq('吉凶句数并列 → 不敢表态（null）', directionOf('此事可成。彼事不可用。'), null);

console.log('B. 边界词');
ok('「必然应验」判为独断', !boundaryOf('此事必然应验，毫无疑问。').clean);
ok('「准确率可达 70%」判为独断',
  boundaryOf('本项目准确率可达 70% 以上。').dogma.some(function (w) { return w.indexOf('准确率') >= 0; }));
ok('「可能／若…则」不算独断', boundaryOf('可能有反复，若出空则见分晓。').clean);
ok('普通断语不算独断', boundaryOf('用神休囚，宜作辅助参考。').clean);

console.log('C. 四指标会动（反向对照）');
// 先拿一张真实盘，问出引擎自己的 trend，再按 trend 拼造同向/反向断语
const at = { y: 2026, m: 10, d: 21, h: 12, min: 1 };
const vals = [0, 6, 6, 0, 6, 0];
const probe = evaluateCorpus([{ id: 'probe', chart: { vals: vals, at: at }, target: '父母', replies: [] }], core);
const trend = probe.perCase[0].trend;
const SAME = { 吉: '用神旺相，事可成。', 平: '旺衰相半，宜待时。', 凶: '用神受制，事难成，不可用。' };
const OPPOSITE = { 吉: '用神受制，事难成，不可用。', 平: '用神旺相，事可成。', 凶: '用神旺相，事可成。' };
ok('样本前提：该盘 trend 为三值之一', ['吉', '平', '凶'].indexOf(trend) >= 0);

function mk(replies) {
  return evaluateCorpus([{
    id: 'synthetic', chart: { vals: vals, at: at }, target: '父母',
    replies: replies.map(function (t) { return { text: t }; })
  }], core);
}

const rSame = mk([SAME[trend] + '\n结论：' + trend, SAME[trend] + '\n结论：' + trend]);
eq('两条同向→冲突率 0', rSame.metrics.drift.rate, 0);
eq('两条同向且合 trend→一致率 1', rSame.metrics.trendAgreement.rate, 1);
eq('两条同向→要素错误率 0', rSame.metrics.elementError.rate, 0);

const rSplit = mk([SAME[trend] + '\n结论：' + trend, OPPOSITE[trend] + '\n结论：' + (trend === '凶' ? '吉' : '凶')]);
eq('一正一反→冲突率 0.5', rSplit.metrics.drift.rate, 0.5);
ok('一正一反→一致率跌破 1', rSplit.metrics.trendAgreement.rate < 1);

const rThree = mk([
  SAME[trend] + '\n结论：' + trend,
  SAME[trend] + '\n结论：' + trend,
  OPPOSITE[trend] + '\n结论：' + (trend === '凶' ? '吉' : '凶')
]);
eq('三条 2 同 1 异→冲突率 1/3', Math.round(rThree.metrics.drift.rate * 100) / 100, 0.33);

const rDogma = mk(['此事必然应验，准确率可达 90%。\n结论：' + trend]);
eq('独断断语→边界遵守率 0', rDogma.metrics.boundary.rate, 0);

// 显式分歧：结论与引擎相反，但标注了「（与引擎分歧：…）」
// —— 契约允许分歧，但要求声明。声明过的从一致率分母剔除，未声明的照扣。
const otherDir = trend === '凶' ? '吉' : '凶';
const rDeclared = mk([
  SAME[trend] + '\n结论：' + trend,
  OPPOSITE[trend] + '\n结论：' + otherDir + '（与引擎分歧：引擎判' + trend + '，此处判' + otherDir + '）'
]);
eq('显式分歧→计入 declared 桶', rDeclared.metrics.trendAgreement.declared, 1);
eq('显式分歧→不计入 disagree', rDeclared.metrics.trendAgreement.disagree, 0);
eq('显式分歧→一致率仍为 1（分母只剩同向那条）', rDeclared.metrics.trendAgreement.rate, 1);
const rSilent = mk([
  SAME[trend] + '\n结论：' + trend,
  OPPOSITE[trend] + '\n结论：' + otherDir
]);
eq('静默相反→仍计入 disagree（契约不是免责声明）', rSilent.metrics.trendAgreement.disagree, 1);
eq('静默相反→一致率 0.5', rSilent.metrics.trendAgreement.rate, 0.5);

console.log('D. 硬伤检测会红（用真实语料）');
const corpus = JSON.parse(fs.readFileSync(path.join(here, 'corpus', '2026-10-21-kun-weijing.json'), 'utf8'));
const real = evaluateCorpus(corpus.cases, core);
const repliesEv = real.perCase[0].replies;
ok('语料第二版至少 2 处硬伤', repliesEv[1].errors.length >= 2);
eq('语料第二版与引擎 trend 不符', repliesEv[1].agreesTrend, false);
eq('语料第一版无硬伤', repliesEv[0].errors.length, 0);
eq('语料第一版与引擎 trend 一致', repliesEv[0].agreesTrend, true);

console.log('E. 门槛判定');
const good = judge({
  metrics: {
    trendAgreement: { rate: 0.95 }, drift: { rate: 0.05 },
    elementError: { rate: 0 }, boundary: { rate: 1 }
  }
});
ok('全优→四项 PASS', good.every(function (r) { return r.ok === true; }));
const bad = judge({
  metrics: {
    trendAgreement: { rate: 0.5 }, drift: { rate: 0.5 },
    elementError: { rate: 0.5 }, boundary: { rate: 1 }
  }
});
eq('三项不达标→FAIL 数为 3', bad.filter(function (r) { return r.ok === false; }).length, 3);
const empty = judge({ metrics: { trendAgreement: { rate: null }, drift: { rate: null }, elementError: { rate: null }, boundary: { rate: null } } });
ok('无样本→不判 PASS 也不判 FAIL', empty.every(function (r) { return r.ok === null; }));

console.log('\nPASS: ' + pass + '  FAIL: ' + fail);
if (fail) process.exit(1);
