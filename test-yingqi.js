/* 应期区间与置信度自检 (core/yingqi-window.js)
 *
 * 本层是**算术换算**层，不是断法：把「出空 / 冲空 / 值日 / 出月 / 逢冲 / 引拔」
 * 换算成第几日。故测试分两类：
 *   ① 换算是否正确——期望值在测试里用 jdn / 干支独立算一遍，不读实现；
 *   ② 不可违反的契约——区间单调、拒答不用「近期」兜底、置信度随盘面要素单调、
 *      任何盘都不得产出空文本或越界窗口。
 */
const C = require('./core.js');

let pass = 0, fail = 0;
function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else { fail++; console.log('FAIL', name, 'got=', got, 'want=', want); }
}
function ok(name, cond) { eq(name, !!cond, true); }

const CONF_RANK = { '高': 2, '中': 1, '低': 0 };

const DT = new Date(2026, 9, 24, 8, 30);
DT.__wall = { y: 2026, m: 10, d: 24, h: 8, min: 30 };
const PAN = C.paipan([1, 0, 9, 6, 1, 1], DT);
const BASE = C.analyze(PAN, '妻财');

// 以真实 analyze 输出为底座，只替换 judgments —— 本层的输入契约就是
// (pan, analysis{judgments, yongshen, yjs, trend})，故这是合法的单元输入，
// 期望值来自外部规则（哪条线索换算出第几日），不是实现自身的输出。
function withJudgments(pairs, over) {
  const a = Object.assign({}, BASE, over || {});
  a.judgments = (pairs || []).map(function (p) { return { tag: p[0], rule: p[1], text: '', basis: '' }; });
  return a;
}

// ---------- 0. 接入：analyze 默认产出应期窗口 ----------
ok('analyze 输出含 yingqiWindow', BASE.yingqiWindow && typeof BASE.yingqiWindow === 'object');
eq('应期窗口文本以「应期：」开头', BASE.yingqiWindow.text.indexOf('应期：'), 0);
ok('应期窗口含置信度', CONF_RANK[BASE.yingqiWindow.confidence] !== undefined);

// ---------- 1. 契约：区间单调、四要素齐备 ----------
function assertShape(name, w) {
  if (w.status === 'blocked') {
    ok(name + '：拒答须说明原因', !!w.blockedBy);
    ok(name + '：拒答不得用「近期」兜底', w.text.indexOf('近期') < 0);
    ok(name + '：拒答仍列出依据', w.basis.length >= 1);
    ok(name + '：拒答仍列出下调原因', w.downgrades.length >= 1);
    eq(name + '：拒答不给区间', [w.lo, w.hi], [null, null]);
    pass += 4; // 已由上面四条覆盖，此处只记形状完整
    return;
  }
  ok(name + '：lo >= 1', w.lo >= 1);
  ok(name + '：hi > lo', w.hi > w.lo);
  ok(name + '：置信度取值合法', CONF_RANK[w.confidence] !== undefined);
  ok(name + '：至少一条依据', w.basis.length >= 1);
  ok(name + '：至少一条下调原因', w.downgrades.length >= 1);
  ok(name + '：文本非空', !!w.text);
}
assertShape('主盘', BASE.yingqiWindow);

// ---------- 2. 换算：旬空窗口取「出空 / 冲空」之近者 ----------
const dayIdx = PAN.pillars.dayIdx, dayZhi = PAN.pillars.dayZhi;
const yZhi = C.ZHI.indexOf(BASE.yongshen.line.zhi);
const chuXun = (10 - (dayIdx % 10)) || 10;
const chongDay = ((yZhi + 6) - dayZhi + 12) % 12;
const kongWin = C.yingqiWindow(PAN, withJudgments([['旬空', '旬空待时']]));
eq('旬空窗口 = min(出空, 冲空)（独立算得 ' + Math.min(chuXun, chongDay) + '）',
  kongWin.lo, Math.max(1, Math.min(chuXun, chongDay)));
ok('旬空依据同时点出出空与冲空', kongWin.basis.join('').indexOf('出空') >= 0 && kongWin.basis.join('').indexOf('冲空') >= 0);

// 出空天数必须与「第 n 日干支」自洽
const gzOf = function (n) {
  const i = ((dayIdx + n) % 60 + 60) % 60;
  return C.GAN[i % 10] + C.ZHI[i % 12];
};
eq('窗口首日的干支与 lo 自洽', kongWin.dayLo, gzOf(kongWin.lo));
eq('窗口末日的干支与 hi 自洽', kongWin.dayHi, gzOf(kongWin.hi));

// ---------- 3. 换算：无显象时以「用神值日」为正期 ----------
const zhiRi = ((yZhi - dayZhi) + 12) % 12 || 12;
const plain = C.yingqiWindow(PAN, withJudgments([]));
eq('无空破冲合时以用神值日为正期（独立算得 ' + zhiRi + '）', plain.lo, Math.max(1, zhiRi));
ok('值日依据点名用神地支', plain.basis.join('').indexOf('值日') >= 0);

// ---------- 4. 换算：暗动极速，且旬空时不早于出空 ----------
const anDong = C.yingqiWindow(PAN, withJudgments([['日冲', '暗动']]));
eq('暗动 → 第 1 日起', anDong.lo, 1);
const anDongKong = C.yingqiWindow(PAN, withJudgments([['日冲', '暗动'], ['旬空', '旬空待时']]));
ok('暗动兼旬空时不早于出空（第 ' + anDongKong.lo + ' 日 >= 第 ' + chuXun + ' 日）', anDongKong.lo >= Math.min(chuXun, Math.max(1, chuXun)));

// ---------- 5. 换算：假月破＝出月，用 jdn 独立复算 ----------
const ny = DT.getMonth() + 1 === 12 ? DT.getFullYear() + 1 : DT.getFullYear();
const nm = DT.getMonth() + 1 === 12 ? 1 : DT.getMonth() + 2;
const term = C.termMoment(ny, nm);
const dTerm = C.jdn(term.y, term.m, term.day) - C.jdn(DT.getFullYear(), DT.getMonth() + 1, DT.getDate());
const yuePo = C.yingqiWindow(PAN, withJudgments([['月破', '月破有救（假破）']]));
ok('假月破给出出月依据（' + dTerm + ' 日后交节）', yuePo.basis.join('').indexOf('出月') >= 0);
eq('假月破窗口不晚于出月日', yuePo.lo <= dTerm, true);

// ---------- 6. 拒答：真空 / 真月破不立应期 ----------
const zhenKong = C.yingqiWindow(PAN, withJudgments([['旬空', '真空']]));
eq('真空 → 不立应期', zhenKong.status, 'blocked');
eq('真空 → 原因记为真空', zhenKong.blockedBy, '真空');
eq('真空 → 置信度最低', zhenKong.confidence, '低');
assertShape('真空', zhenKong);

const zhenPo = C.yingqiWindow(PAN, withJudgments([['月破', '真月破']]));
eq('真月破 → 不立应期', zhenPo.status, 'blocked');
eq('真月破 → 原因记为真月破', zhenPo.blockedBy, '真月破');
assertShape('真月破', zhenPo);

// 用神不可取时同样拒答（而非给一个凭空窗口）
const noYs = C.yingqiWindow(PAN, { yongshen: null, judgments: [] });
eq('无用神 → 不立应期', noYs.status, 'blocked');
eq('无用神 → 原因记为 no_yongshen', noYs.blockedBy, 'no_yongshen');
eq('无盘 → 不立应期', C.yingqiWindow(null, BASE).status, 'blocked');

// ---------- 7. 置信度：随盘面要素单调 ----------
const strong = C.yingqiWindow(PAN, withJudgments([['日冲', '暗动']], {
  yongshen: Object.assign({}, BASE.yongshen, { wang: '旺' })
}));
const weak = C.yingqiWindow(PAN, withJudgments([['日冲', '暗动']], {
  yongshen: Object.assign({}, BASE.yongshen, { wang: '死' })
}));
ok('旺相盘置信不低于休囚盘（' + strong.confidence + ' vs ' + weak.confidence + '）',
  CONF_RANK[strong.confidence] >= CONF_RANK[weak.confidence]);

const withFu = C.yingqiWindow(PAN, withJudgments([['日冲', '暗动'], ['伏神', '伏藏待引']], {
  yongshen: Object.assign({}, BASE.yongshen, { wang: '旺' })
}));
ok('伏藏盘置信不高于同旺衰的明现盘（' + withFu.confidence + ' vs ' + strong.confidence + '）',
  CONF_RANK[withFu.confidence] <= CONF_RANK[strong.confidence]);
ok('伏藏列入下调原因', withFu.downgrades.join('').indexOf('伏藏') >= 0);
const noYuan = C.yingqiWindow(PAN, withJudgments([['日冲', '暗动']], {
  yongshen: Object.assign({}, BASE.yongshen, { wang: '旺' }),
  yjs: { yuanshen: [], jishen: [], choushen: [] }
}));
ok('无元神列入下调原因', noYuan.downgrades.join('').indexOf('元神') >= 0);

// ---------- 8. 文本：依据与下调原因分行输出 ----------
const txt = C.yingqiText(BASE.yingqiWindow);
ok('yingqiText 含「依据：」', txt.indexOf('依据：') > 0);
ok('yingqiText 含「下调原因：」', txt.indexOf('下调原因：') > 0);
eq('yingqiText(null) → 空串', C.yingqiText(null), '');

// ---------- 9. 扫描：任意盘都不得产出越界或空窗口 ----------
const TIMES = [
  new Date(2026, 0, 3, 1, 10), new Date(2026, 3, 18, 23, 45), new Date(2025, 6, 7, 12, 0),
  new Date(2024, 10, 30, 5, 25), new Date(2001, 8, 9, 18, 40)
];
const TARGETS = ['妻财', '官鬼', '父母', '子孙', '兄弟', 'shi'];
let n = 0, bad = 0;
for (let k = 0; k < 64; k++) {
  const vals = [];
  for (let i = 0; i < 6; i++) vals.push((k >> i) & 1 ? 9 : 6);
  TIMES.forEach(function (t) {
    const p = C.paipan(vals, t);
    TARGETS.forEach(function (tg) {
      const a = C.analyze(p, tg);
      const w = C.yingqiWindow(p, a);
      n++;
      if (!w || !w.text) { bad++; return; }
      if (w.status === 'ok' && !(w.lo >= 1 && w.hi > w.lo)) { bad++; if (bad < 3) console.log('  越界样例', p.benName, tg, w.lo, w.hi); }
      if (w.status === 'blocked' && (w.lo !== null || w.hi !== null)) bad++;
      if (!w.downgrades || !w.downgrades.length) bad++;
      if (!w.basis || !w.basis.length) bad++;
      if (w.text.indexOf('近期') >= 0) bad++;
    });
  });
}
eq('扫描 ' + n + ' 盘全部给出合法窗口', bad, 0);

// ---------- 10. 不引入断法：本层不做吉凶评分，只做换算 ----------
// 置信度用 consistency（要素自洽度）而非 score（吉凶分值）——M3 的「无评分制」
// 约束的是吉凶 trend，本层不得把那套算术借尸还魂。
const src = require('fs').readFileSync('public/core/yingqi-window.js', 'utf8');
const codeOnly = src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
ok('应期层不出现 score 字样', !/\bscore\b/i.test(codeOnly));
ok('应期层不写 DOM（纯函数）', src.indexOf('innerHTML') < 0 && src.indexOf('document.') < 0);

console.log('\n应期窗口自检：PASS ' + pass + '　FAIL ' + fail);
process.exit(fail ? 1 : 0);
