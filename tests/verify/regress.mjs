/* ============================================================
 * 排盘事实金标准回归 (tests/verify/regress.mjs)
 *
 * 用途：把「三方对账裁决后」的用例集当作固定金标准，逐字段断言引擎输出。
 * 与 run.mjs 的分工：
 *   run.mjs    —— 对账/判责。需要三家裁判库，回答「分歧该怪谁」；--fix 才重写金标准。
 *   regress.mjs—— 断言。零依赖（只加载 core.js），回答「引擎是否偏离了已裁决的基线」。
 *   金标准只在「重新裁决」（run.mjs --fix）时才会变动，日常回归不需要裁判库在场。
 *
 * 零依赖是刻意的：CI 里 npm ci 失败、离线、或仅想快速自检时，这一步都应当跑得动。
 *
 * 数据来源：external-suite-v1.1-adjudicated.json（由 run.mjs --fix 生成，
 *   每个字段均要求「引擎与 ≥1 家独立裁判库一致」才写入）。
 *   原始未裁决件 external-suite-v1.json 仅供 run.mjs 判责使用，不作为本回归的期望。
 *
 * 运行：npm run test:paipan
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import LY from '../../core.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SUITE = path.join(__dirname, 'external-suite-v1.1-adjudicated.json');

let pass = 0, fail = 0, soft = 0;
const failLog = [];
function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++;
  else { fail++; failLog.push(name + '\n     引擎=' + JSON.stringify(got) + '　金标准=' + JSON.stringify(want)); }
}
function softEq(name, got, want) {
  if (JSON.stringify(got) !== JSON.stringify(want)) { soft++; console.log('   ⚠ 档案漂移：' + name + '（档案=' + JSON.stringify(want) + '　引擎=' + JSON.stringify(got) + '）'); }
}

// ---------- 输入归一（与 run.mjs 同一口径） ----------
// 用例 coin：7 少阳静 / 8 少阴静 / 9 老阳动 / 6 老阴动 → 本引擎 toss：1/0/9/6
function coinToToss(c) {
  if (c === 7) return 1;
  if (c === 8) return 0;
  if (c === 9) return 9;
  if (c === 6) return 6;
  throw new Error('非法 coin 值 ' + c);
}
function parseDt(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(s);
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
}
const normBeast = (s) => String(s).replace('螣', '腾'); // 螣蛇/腾蛇 用字归一
const soulName = (s) => (s ? s + '卦' : '(非游魂归魂)');   // 引擎 soul 取值 → 用例 category 口径
const branchOf = (l) => l.zhi + l.wx;

// ---------- 主流程 ----------
const suite = JSON.parse(fs.readFileSync(SUITE, 'utf8'));
console.log('== 排盘事实金标准回归（零依赖）==');
console.log('   金标准：' + path.basename(SUITE) + '　' + suite.cases.length + ' 条\n');

suite.cases.forEach(function (c) {
  const id = c.case_id;
  const dt = parseDt(c.input.datetime);
  const exp = c.expected;
  const pan = LY.paipan(c.input.coins.map(coinToToss), dt);
  const P = (f) => id + ' · ' + f; // 断言名前缀

  // ---- 1. 四柱（由 datetime 定，与 coins 无关）----
  const pil = pan.pillars;
  eq(P('四柱·年柱'), pil.yearGZ, c.input.ganzhi.year);
  eq(P('四柱·月柱'), pil.monthGZ, c.input.ganzhi.month);
  eq(P('四柱·日柱'), pil.dayGZ, c.input.ganzhi.day);
  eq(P('四柱·时柱'), pil.hourGZ, c.input.ganzhi.hour);

  // ---- 2. 卦名 / 卦宫 / 世应 ----
  eq(P('本卦'), pan.benName, exp.original_gua);
  eq(P('之卦'), pan.hasBian ? pan.bianName : pan.benName, exp.changed_gua);
  eq(P('卦宫'), pan.palace + pan.palaceWx, exp.palace);
  eq(P('世爻'), pan.shi + 1, exp.shi_line);
  eq(P('应爻'), pan.ying + 1, exp.ying_line);
  eq(P('旬空'), [LY.ZHI[pil.kong[0]], LY.ZHI[pil.kong[1]]], exp.xun_kong);

  // ---- 3. 六爻逐爻 ----
  exp.lines.forEach(function (el) {
    const i = el.level - 1;
    const l = pan.lines[i];
    const Q = '第' + el.level + '爻';
    eq(P(Q + '·干支'), branchOf(l), el.branch);
    eq(P(Q + '·六亲'), l.lq, el.relative);
    eq(P(Q + '·六神'), normBeast(l.beast), normBeast(el.god));
    eq(P(Q + '·动静'), l.moving, el.moving);
    if (el.changed_branch !== undefined) {
      eq(P(Q + '·变爻干支'), l.bian ? branchOf(l.bian) : null, el.changed_branch);
      eq(P(Q + '·变爻六亲'), l.bian ? l.bian.lq : null, el.changed_relative);
    }
  });
  // 反向：金标准含动爻 ⇔ 引擎判有变卦。
  // 注意 API 语义陷阱：pan.lines[i].bian 是「变卦同位爻的纳甲」，只要本卦有动爻
  // （hasBian）即六爻全有值，**不是**「该爻发动后的值」。故不能用「静爻应无 bian」来断言，
  // 只能断言「有无变卦」这一层。上面 changed_* 的比对已限定在 el.changed_branch 存在时。
  eq(P('有无变卦'), pan.hasBian, exp.lines.some(el => el.moving));

  // ---- 4. 伏神 ----
  const fuLevels = pan.lines.map((l, i) => (l.fu ? i + 1 : 0)).filter(x => x > 0);
  eq(P('伏神·位次'), fuLevels, (exp.hidden_spirits || []).map(h => h.level));
  (exp.hidden_spirits || []).forEach(function (h) {
    const i = h.level - 1, fu = pan.lines[i].fu;
    const H = '伏神[' + h.level + ']';
    eq(P(H + '·干支'), fu ? branchOf(fu) : null, h.branch);
    eq(P(H + '·六亲'), fu ? fu.lq : null, h.relative);
    eq(P(H + '·本宫首卦'), LY.hexName(LY.TRIG[pan.palace].bits.concat(LY.TRIG[pan.palace].bits)), h.source_gua);
  });
  // 反向：金标准未列伏神者，引擎不应多出伏神
  eq(P('无多余伏神'), fuLevels.length, (exp.hidden_spirits || []).length);

  // ---- 5. 卦型三项（引擎原生字段，非测试层现算）----
  if (exp.is_liu_chong !== undefined) eq(P('六冲卦'), pan.isLiuChong, exp.is_liu_chong);
  if (exp.is_liu_he !== undefined) eq(P('六合卦'), pan.isLiuHe, exp.is_liu_he);
  eq(P('游魂归魂'), soulName(pan.soul), exp.category || '(非游魂归魂)');

  // ---- 6. 档案软检查：description_check 记录的是生成当时的引擎行为 ----
  if (c.description_check) {
    softEq(P('档案·日干'), c.description_check.day_gan, pil.dayGZ[0]);
    softEq(P('档案·起神'), c.description_check.beast_start, LY.BEASTS[LY.beastStart(pil.dayGan)]);
    softEq(P('档案·卦型'), c.description_check.soul, soulName(pan.soul));
    softEq(P('档案·六冲'), c.description_check.is_liu_chong, pan.isLiuChong);
    softEq(P('档案·六合'), c.description_check.is_liu_he, pan.isLiuHe);
  }
});

// ---------- 汇总 ----------
console.log('断言 ' + (pass + fail) + '　通过 ' + pass + '　失败 ' + fail +
  (soft ? '　档案漂移 ' + soft + ' 处（非致命）' : ''));
if (fail) {
  console.log('\n-- 失败明细 --');
  failLog.forEach(f => console.log('   ✗ ' + f));
  console.log('\n若确有理由变更：请重跑 `npm run test:verify`（需裁判库）确认引擎仍获支持，');
  console.log('再用 `node tests/verify/run.mjs --fix tests/verify/external-suite-v1.1-adjudicated.json` 更新金标准。');
  console.log('RESULT: FAIL');
  process.exit(1);
}
console.log('RESULT: PASS —— 引擎与已裁决基线逐字段一致');
