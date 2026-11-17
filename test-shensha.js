/* ============================================================
 * 神煞算法回归（node test-shensha.js）
 *
 * 基线取自两张「六爻排盘宝」实拍盘（王哥提供，2026-11-17 16:35，
 * 丙午年 己亥月 乙未日 甲申时）：
 *   盘一 雷水解 之 坤为地    盘二 雷天大壮（静）
 * 两张盘的日柱相同，所以 13 项神煞完全一样：
 *   驿马巳 桃花子 禄神卯 贵人子申 文昌午 劫煞申 华盖未 将星卯
 *   天喜未 天医戌 阳刃寅 灾煞酉 谋星丑
 * 卦身与香闺/床帐随卦而变：
 *   雷水解（世二爻，阴）→ 卦身丑（土）→ 香闺子亥（土克水）、床帐申酉（土生金）
 *   雷天大壮（世四爻，阳）→ 卦身卯（木）→ 香闺辰戌丑未（木克土）、床帐巳午（木生火）
 * 另用古籍通例钉住卦身：乾为天→巳、坤为地→亥。
 * ============================================================ */
const C = require('./core.js');
const LY = globalThis.LY;
require('./public/core/shensha.js');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '　【' + extra + '】' : '')); }
}
function eq(name, got, want) {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  ok(name, a === b, '得 ' + a + '，应 ' + b);
}

const GZ = (gz) => {
  const g = C.GAN.indexOf(gz[0]), z = C.ZHI.indexOf(gz[1]);
  for (let i = 0; i < 60; i++) if (i % 10 === g && i % 12 === z) return i;
  return -1;
};
const bits = (n) => {
  const ks = Object.keys(C.HEXNAMES).filter(k => C.HEXNAMES[k] === n);
  if (!ks.length) throw new Error('无此卦：' + n);
  const k = ks[0];
  return C.TRIG[k[0]].bits.concat(C.TRIG[k[1]].bits);
};
function panOf(name, dong) {
  const bb = bits(name);
  const vals = bb.map((b, i) => {
    const m = (dong || []).indexOf(i + 1) >= 0;
    return b ? (m ? 9 : 1) : (m ? 6 : 0);
  });
  return C.paipan(vals, null, {
    pillars: C.pillarsFromGanzhi({
      yearIdx: GZ('丙午'), monthZhi: 11, dayIdx: GZ('乙未'), hourZhi: 8
    })
  });
}

console.log('神煞');

/* ---------- 盘一：雷水解 之 坤为地 ---------- */
const p1 = panOf('雷水解', [2, 4]);
eq('盘一 · 排出来是雷水解之坤为地', [p1.benName, p1.bianName], ['雷水解', '坤为地']);
const s1 = LY.shensha.compute(p1);
const map1 = {};
s1.list.forEach(it => { map1[it.name] = it.zhi.join(''); });

eq('驿马（亥卯未日 → 巳）', map1['驿马'], '巳');
eq('桃花（亥卯未日 → 子）', map1['桃花'], '子');
eq('禄神（乙日 → 卯）', map1['禄神'], '卯');
eq('贵人（乙日 → 子申）', map1['贵人'], '子申');
eq('文昌（乙日 → 午）', map1['文昌'], '午');
eq('劫煞（亥卯未日 → 申）', map1['劫煞'], '申');
eq('华盖（亥卯未日 → 未）', map1['华盖'], '未');
eq('将星（亥卯未日 → 卯）', map1['将星'], '卯');
eq('天喜（亥月属冬 → 未）', map1['天喜'], '未');
eq('天医（月建亥退一位 → 戌）', map1['天医'], '戌');
eq('阳刃（乙日 → 寅）', map1['阳刃'], '寅');
eq('灾煞（亥卯未日 → 酉）', map1['灾煞'], '酉');
eq('谋星（亥卯未日 → 丑）', map1['谋星'], '丑');

eq('卦身（世二爻、阴世从午起 → 丑）', s1.guaShen.zhi, '丑');
eq('卦身五行', s1.guaShen.wx, '土');
eq('香闺＝卦身所克（土克水 → 子亥）', s1.xiangGui, ['子', '亥']);
eq('床帐＝卦身所生（土生金 → 申酉）', s1.chuangZhang, ['申', '酉']);

/* 落爻标注：巳在本卦五爻（雷水解五爻是官鬼申金？）——按实际盘算，只断言「标出的爻位确实持该支」 */
const hitOk = s1.list.every(it => it.onLines.every(function (pos) {
  return p1.lines[pos - 1].zhi === it.zhi[0] || it.zhi.indexOf(p1.lines[pos - 1].zhi) >= 0;
}));
ok('「落在某爻」的爻位与爻支自洽', hitOk);

/* ---------- 盘二：雷天大壮（静） ---------- */
const p2 = panOf('雷天大壮', []);
eq('盘二 · 静卦', [p2.benName, p2.bianName, p2.hasBian], ['雷天大壮', null, false]);
const s2 = LY.shensha.compute(p2);
const map2 = {};
s2.list.forEach(it => { map2[it.name] = it.zhi.join(''); });
eq('同一日柱下 13 项神煞与盘一一致',
  Object.keys(map1).sort().map(k => k + map1[k]),
  Object.keys(map2).sort().map(k => k + map2[k]));

eq('卦身（世四爻、阳世从子起 → 卯）', s2.guaShen.zhi, '卯');
eq('卦身五行', s2.guaShen.wx, '木');
// 土的四个支按排盘宝的次第「辰戌丑未」输出（不是十二支自然序，那样是丑辰未戌）
eq('香闺（木克土 → 辰戌丑未）', s2.xiangGui, ['辰', '戌', '丑', '未']);
eq('床帐（木生火 → 巳午）', s2.chuangZhang, ['巳', '午']);

/* ---------- 古籍通例：八纯卦卦身 ---------- */
eq('乾为天卦身（上爻世、阳、从子上数六位 → 巳）',
  LY.shensha.guaShenOf(panOf('乾为天', [])).zhi, '巳');
eq('坤为地卦身（上爻世、阴、从午上数六位 → 亥）',
  LY.shensha.guaShenOf(panOf('坤为地', [])).zhi, '亥');

/* ---------- 边界 ---------- */
eq('没有盘时返回 null', LY.shensha.compute(null), null);
eq('缺 pillars 时返回 null', LY.shensha.compute({ lines: [] }), null);

/* 神煞绝不能影响盘面：开关只动显示层（这里验「算法不写回 pan」） */
const before = JSON.stringify(p1.lines.map(L => [L.gan, L.zhi, L.lq, L.moving]));
LY.shensha.compute(p1);
eq('算神煞不改动盘面数据', JSON.stringify(p1.lines.map(L => [L.gan, L.zhi, L.lq, L.moving])), before);

console.log('\n神煞：' + pass + ' 项通过' + (fail ? '，' + fail + ' 项失败' : ''));
if (fail) process.exit(1);
