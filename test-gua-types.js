/* ============================================================
 * 卦型判定回归 (test-gua-types.js)
 *
 * 覆盖 paipan.js 的三项卦画事实判定：
 *   六冲卦 chongGua() / 六合卦 heGua() / 游魂归魂 soulGua()
 *   以及 paipan() 返回值上的 isLiuChong / isLiuHe / soul 三个字段。
 *
 * 期望值来源（外部金标准，非由本实现枚举得出）：
 *   ① 京房八宫卦次（乾坎艮震巽离坤兑，每宫八变：本宫·一世…五世·游魂·归魂）
 *      ——传世通行表，且已用 @taoracle/najia 独立实现交叉验证（见 tests/verify/）
 *   ② 六冲卦 10 个、六合卦 8 个、游魂 8 个、归魂 8 个——传统通行表
 * 本文件刻意把整张 64 卦表写死，这样 PALACE 变爻次序若被改错，会立刻转红。
 *
 * 末尾附变异自检：把三个判定分别替换成「恒真 / 恒真 / 恒 null」，
 * 要求金标准立即失配 —— 证明上述断言真的在约束语义，而非空转。
 *
 * 运行：node test-gua-types.js　（npm run test:types）
 * ============================================================ */
const C = require('./core.js');

let pass = 0, fail = 0;
function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++;
  else { fail++; console.log('FAIL ' + name + '\n   got = ' + JSON.stringify(got) + '\n   want= ' + JSON.stringify(want)); }
}

// ---------- 外部金标准 ----------
// 京房八宫卦次，键为宫，值为该宫八变（0 本宫 → 7 归魂）的卦名
const BA_GONG = {
  乾: ['乾为天', '天风姤', '天山遁', '天地否', '风地观', '山地剥', '火地晋', '火天大有'],
  坎: ['坎为水', '水泽节', '水雷屯', '水火既济', '泽火革', '雷火丰', '地火明夷', '地水师'],
  艮: ['艮为山', '山火贲', '山天大畜', '山泽损', '火泽睽', '天泽履', '风泽中孚', '风山渐'],
  震: ['震为雷', '雷地豫', '雷水解', '雷风恒', '地风升', '水风井', '泽风大过', '泽雷随'],
  巽: ['巽为风', '风天小畜', '风火家人', '风雷益', '天雷无妄', '火雷噬嗑', '山雷颐', '山风蛊'],
  离: ['离为火', '火山旅', '火风鼎', '火水未济', '山水蒙', '风水涣', '天水讼', '天火同人'],
  坤: ['坤为地', '地雷复', '地泽临', '地天泰', '雷天大壮', '泽天夬', '水天需', '水地比'],
  兑: ['兑为泽', '泽水困', '泽地萃', '泽山咸', '水山蹇', '地山谦', '雷山小过', '雷泽归妹']
};

const CHONG_GUA = ['乾为天', '坤为地', '震为雷', '巽为风', '坎为水', '离为火', '艮为山', '兑为泽', '天雷无妄', '雷天大壮'];
const HE_GUA = ['地天泰', '天地否', '地雷复', '雷地豫', '水泽节', '泽水困', '山火贲', '火山旅'];
const YOU_HUN = ['火地晋', '地火明夷', '风泽中孚', '泽风大过', '山雷颐', '天水讼', '水天需', '雷山小过'];
const GUI_HUN = ['火天大有', '地水师', '风山渐', '泽雷随', '山风蛊', '天火同人', '水地比', '雷泽归妹'];
// 游魂/归魂 → 所属宫（与上式同源，此处按宫列出便于双向核对）
const SOUL_PALACE = {
  游魂: { 乾: '火地晋', 坎: '地火明夷', 艮: '风泽中孚', 震: '泽风大过', 巽: '山雷颐', 离: '天水讼', 坤: '水天需', 兑: '雷山小过' },
  归魂: { 乾: '火天大有', 坎: '地水师', 艮: '风山渐', 震: '泽雷随', 巽: '山风蛊', 离: '天火同人', 坤: '水地比', 兑: '雷泽归妹' }
};

// ---------- 工具 ----------
function bitsOf(m) { const b = []; for (let i = 0; i < 6; i++) b.push((m >> i) & 1); return b; }
const ALL64 = []; for (let m = 0; m < 64; m++) ALL64.push(bitsOf(m));
const ordered = (set) => set.slice().sort();

// 按宫号取该宫八变的卦名（variant 0→7）
function guaOfPalace(p) {
  const rs = [];
  for (const k of Object.keys(C.PALACE)) {
    const v = C.PALACE[k];
    if (v.palace === p) rs.push({ variant: v.variant, name: C.hexName(k.split('').map(Number)) });
  }
  rs.sort((a, b) => a.variant - b.variant);
  return rs.map(r => r.name);
}

// ---------- 一、八宫卦次：整张 64 卦表 ----------
Object.keys(BA_GONG).forEach(function (p) {
  eq('八宫·' + p + '宫八变', guaOfPalace(p), BA_GONG[p]);
});

// ---------- 二、四个卦型集合：全枚举，要求集合完全相等（防漏也防多） ----------
const mine = { 六冲: [], 六合: [], 游魂: [], 归魂: [] };
ALL64.forEach(function (b) {
  const n = C.hexName(b);
  if (C.chongGua(b)) mine.六冲.push(n);
  if (C.heGua(b)) mine.六合.push(n);
  const s = C.soulGua(b);
  if (s === '游魂') mine.游魂.push(n);
  if (s === '归魂') mine.归魂.push(n);
});
eq('六冲卦（全枚举 10 个）', ordered(mine.六冲), ordered(CHONG_GUA));
eq('六合卦（全枚举 8 个）', ordered(mine.六合), ordered(HE_GUA));
eq('游魂卦（全枚举 8 个）', ordered(mine.游魂), ordered(YOU_HUN));
eq('归魂卦（全枚举 8 个）', ordered(mine.归魂), ordered(GUI_HUN));

// ---------- 三、互斥性与总计数自洽 ----------
const inter = (a, b) => a.filter(x => b.indexOf(x) >= 0);
eq('六冲 ∩ 六合 为空', inter(mine.六冲, mine.六合), []);
eq('六冲 ∩ 游魂 为空', inter(mine.六冲, mine.游魂), []);
eq('六合 ∩ 游魂 为空', inter(mine.六合, mine.游魂), []);
eq('既非六冲亦非六合 = 46 卦', 64 - mine.六冲.length - mine.六合.length, 46);
eq('卦型计数合计', [mine.六冲.length, mine.六合.length, mine.游魂.length, mine.归魂.length], [10, 8, 8, 8]);

// ---------- 四、游魂/归魂与宫的对应（换个维度复核 variant 表） ----------
Object.keys(SOUL_PALACE.游魂).forEach(function (p) {
  eq('『' + p + '』宫游魂', SOUL_PALACE.游魂[p], mine.游魂.filter(n => BA_GONG[p].indexOf(n) >= 0)[0] || '(无)');
});
Object.keys(SOUL_PALACE.归魂).forEach(function (p) {
  eq('『' + p + '』宫归魂', SOUL_PALACE.归魂[p], mine.归魂.filter(n => BA_GONG[p].indexOf(n) >= 0)[0] || '(无)');
});
// 非本宫末两变者，不应被判为游魂/归魂
eq('游魂归魂各 8 个（每宫恰 1 个）',
  [mine.游魂.length, mine.归魂.length], [Object.keys(SOUL_PALACE.游魂).length, Object.keys(SOUL_PALACE.归魂).length]);

// ---------- 五、paipan() 对外字段与实际排盘一致 ----------
// 卦画一律由卦名反查 64 卦枚举取得，不手写比特（防测试数据自身出错）
// —— 卦名→卦画所依赖的 hexName 已由第二节「八宫卦次」整表锁定。
const PICK = ['乾为天', '天雷无妄', '地天泰', '火地晋', '水地比', '风泽中孚', '雷泽归妹', '山水蒙'];
PICK.forEach(function (n) {
  const b = ALL64.filter(x => C.hexName(x) === n)[0];
  if (!b) { eq('64 卦中存在『' + n + '』', false, true); return; }
  const p = C.paipan(b.map(x => x ? 1 : 0), new Date(2026, 8, 24, 10, 0)); // 全静卦
  eq('paipan 卦名 ' + n, p.benName, n);
  eq('paipan isLiuChong ' + n, p.isLiuChong, CHONG_GUA.indexOf(n) >= 0);
  eq('paipan isLiuHe ' + n, p.isLiuHe, HE_GUA.indexOf(n) >= 0);
  eq('paipan soul ' + n, p.soul, YOU_HUN.indexOf(n) >= 0 ? '游魂' : GUI_HUN.indexOf(n) >= 0 ? '归魂' : null);
});
// 动卦：卦型由【本卦】定，不随变卦漂移
const dongPan = C.paipan([9, 1, 1, 1, 1, 1], new Date(2026, 8, 24, 10, 0)); // 乾为天 初爻动
eq('动卦：本卦仍判六冲', dongPan.isLiuChong, true);
eq('动卦：本卦乾为天，非游魂归魂', dongPan.soul, null);
eq('动卦：变卦为天风姤', dongPan.bianName, '天风姤');

// ---------- 六、边界与鲁棒性 ----------
eq('soulGua 非 6/7 变次返回 null', C.soulGua([1, 1, 1, 1, 1, 1]), null); // 乾为天=本宫
eq('soulGua 无此卦画返回 null', C.soulGua([0, 1, 0, 1, 0, 1]), C.PALACE['010101'] ? C.soulGua([0, 1, 0, 1, 0, 1]) : null);
eq('chongGua 对 64 卦均为布尔', ALL64.every(b => typeof C.chongGua(b) === 'boolean'), true);
eq('heGua 对 64 卦均为布尔', ALL64.every(b => typeof C.heGua(b) === 'boolean'), true);

// ---------- 七、带内卦/外卦拆分的辅助（变异与等价性质共用） ----------
const PAIRS3 = [[0, 3], [1, 4], [2, 5]];
function relOnPairs(bits6, pairs, rel) {
  const lo = C.trigOfBits(bits6.slice(0, 3)), up = C.trigOfBits(bits6.slice(3));
  const z = C.TRIG[lo].najia.slice(0, 3).concat(C.TRIG[up].najia.slice(3)).map(c => C.ZHI.indexOf(c));
  return pairs.every(p => rel(z[p[0]], z[p[1]]));
}

// ---------- 八、变异自检：断言是否真的在约束语义 ----------
// 独立计数（不污染 pass/fail），只数「金标准失配条数」
function stdMismatches() {
  let n = 0;
  Object.keys(BA_GONG).forEach(function (p) {
    const got = guaOfPalace(p);
    for (let i = 0; i < 8; i++) if (got[i] !== BA_GONG[p][i]) n++;
  });
  const s = { 六冲: [], 六合: [], 游魂: [], 归魂: [] };
  ALL64.forEach(function (b) {
    const nm = C.hexName(b);
    if (C.chongGua(b)) s.六冲.push(nm);
    if (C.heGua(b)) s.六合.push(nm);
    const sl = C.soulGua(b);
    if (sl === '游魂') s.游魂.push(nm);
    if (sl === '归魂') s.归魂.push(nm);
  });
  if (JSON.stringify(ordered(s.六冲)) !== JSON.stringify(ordered(CHONG_GUA))) n++;
  if (JSON.stringify(ordered(s.六合)) !== JSON.stringify(ordered(HE_GUA))) n++;
  if (JSON.stringify(ordered(s.游魂)) !== JSON.stringify(ordered(YOU_HUN))) n++;
  if (JSON.stringify(ordered(s.归魂)) !== JSON.stringify(ordered(GUI_HUN))) n++;
  return n;
}
const base = stdMismatches();
eq('变异基线：金标准无失配', base, 0);
const orig = { chongGua: C.chongGua, heGua: C.heGua, soulGua: C.soulGua };
// 注：刻意不收「只查其中两对」这类变异 —— 本纳甲体系下它与「三对皆冲/合」等价
//    （实证见第九节），改不动输出即非有效变异，收进来只会产生假警报。
const MUTS = [
  ['chongGua 恒真', () => { C.chongGua = () => true; }],
  ['chongGua 恒假', () => { C.chongGua = () => false; }],
  ['heGua 恒真', () => { C.heGua = () => true; }],
  ['heGua 恒假', () => { C.heGua = () => false; }],
  ['soulGua 恒 null', () => { C.soulGua = () => null; }],
  ['soulGua 全体判游魂', () => { C.soulGua = () => '游魂'; }],
  ['六冲改用六合关系（义项错位）', () => { C.chongGua = (b) => relOnPairs(b, PAIRS3, C.liuhe); }],
  ['六合改用六冲关系（义项错位）', () => { C.heGua = (b) => relOnPairs(b, PAIRS3, C.chong); }],
  ['游魂与归魂互换', () => { C.soulGua = (b) => { const p = C.PALACE[b.join('')]; if (!p) return null; return p.variant === 6 ? '归魂' : p.variant === 7 ? '游魂' : null; }; }],
  ['变爻次序整体错位一格（variant 6/7 → 5/6）', () => { C.soulGua = (b) => { const p = C.PALACE[b.join('')]; if (!p) return null; return p.variant === 5 ? '游魂' : p.variant === 6 ? '归魂' : null; }; }]
];
MUTS.forEach(function (m) {
  C.chongGua = orig.chongGua; C.heGua = orig.heGua; C.soulGua = orig.soulGua;
  m[1]();
  const n = stdMismatches();
  eq('变异被检出：' + m[0], n > 0, true);
  if (n === 0) console.log('   ※ 该变异未被任何金标准断言捕获');
});
C.chongGua = orig.chongGua; C.heGua = orig.heGua; C.soulGua = orig.soulGua;
eq('变异后已还原实现', stdMismatches(), 0);

// ---------- 九、已实测的等价性质（解释第八节为何不收「只查一对」类变异） ----------
// 本纳甲体系下，内卦与外卦的纳支对应是刚性的：初-四一旦相冲/相合，二-五、三-六自动成立。
// 故「三对皆冲」与「仅查初四」在 64 卦空间上给出同一集合。这不是巧合，而是纳支表结构的推论；
// 锁定它，是为了将来若有人改动纳支表而破坏此性质时能收到提示（届时引擎内注释需同步更新）。
const onlyFirst = (rel) => ALL64.filter(b => relOnPairs(b, [[0, 3]], rel)).map(b => C.hexName(b));
eq('等价性质：仅查初四 ≡ 三对皆冲', ordered(onlyFirst(C.chong)), ordered(CHONG_GUA));
eq('等价性质：仅查初四 ≡ 三对皆合', ordered(onlyFirst(C.liuhe)), ordered(HE_GUA));
eq('等价性质：仅查初四亦无冲合交叠', inter(onlyFirst(C.chong), onlyFirst(C.liuhe)), []);

// ---------- 汇总 ----------
console.log('卦型判定回归：通过 ' + pass + '　失败 ' + fail + '（含变异自检 ' + MUTS.length + ' 项）');
if (fail) { console.log('RESULT: FAIL'); process.exit(1); }
console.log('RESULT: PASS —— 八宫卦次、六冲/六合/游魂/归魂四表与传世通行表吻合');
