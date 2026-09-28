/* ============================================================
 * 断卦规则链单测 (test-rules.js)
 * M3 验收：每条规则 ≥2 用例（命中/不命中）；
 *          暗动判定有旺衰前序依赖（闭环证明）；
 *          analyze 无 score 残留；trend 由规则汇聚表驱动。
 * 运行：npm test（node test-core.js && node test-rules.js）
 * ============================================================ */
const C = require('./core.js');
const fs = require('fs');
let pass = 0, fail = 0;
function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; } else { fail++; console.log('FAIL', name, 'got=', JSON.stringify(got), 'want=', JSON.stringify(want)); }
}

// ---------- 工具：合成爻/四柱 ----------
function mkLine(o) {
  return Object.assign({ pos: 0, zhi: '巳', zhiIdx: 5, wx: '火', lq: '官鬼', moving: false, bian: null, isFu: false }, o);
}
function mkPil(o) {
  return Object.assign({ yearGZ: '', monthGZ: '', monthZhi: 5, monthGan: 0, dayGZ: '', dayGan: 0, dayZhi: 11, hourGZ: '', kong: [], kongStr: '' }, o);
}

// ---------- 1. 旺相休囚死 ----------
eq('旺（临令）', C.wangXiangXiuQiuSi('水', 0), '旺');   // 子月水
eq('相（令生）', C.wangXiangXiuQiuSi('木', 0), '相');   // 子月木，水生木
eq('休（生令）', C.wangXiangXiuQiuSi('金', 0), '休');   // 子月金，金生水
eq('囚（克令）', C.wangXiangXiuQiuSi('土', 0), '囚');   // 子月土，土克水
eq('死（令克）', C.wangXiangXiuQiuSi('火', 0), '死');   // 子月火，水克火
eq('午月火旺', C.wangXiangXiuQiuSi('火', 6), '旺');

// ---------- 2. 暗动闭环（M3 核心）：同为静爻被日冲，旺衰定暗动/日破 ----------
// 巳火静爻，日亥冲巳
const L1 = mkLine({ zhi: '巳', zhiIdx: 5, wx: '火' });
// 巳月（火当令旺）→ 暗动
const ad = C.ruleDayChong(L1, mkPil({ monthZhi: 5, dayZhi: 11 }), '旺', '官鬼');
eq('旺相静爻被日冲=暗动', ad.kind, 'andong');
eq('暗动判定文本含「暗动」', ad.judgments[0].text.indexOf('暗动') >= 0, true);
// 亥月（火死）→ 日破
const rp = C.ruleDayChong(L1, mkPil({ monthZhi: 11, dayZhi: 11 }), '死', '官鬼');
eq('休囚静爻被日冲=日破', rp.kind, 'ripo');
// 闭环证明：grade 变化翻转结论（同一爻同一日辰）
eq('闭环：旺衰翻转结论', ad.kind !== rp.kind, true);
// 动爻被日冲 → 冲散（不论旺衰）
const cs = C.ruleDayChong(mkLine({ zhi: '巳', zhiIdx: 5, wx: '火', moving: true }), mkPil({ monthZhi: 5, dayZhi: 11 }), '旺', '官鬼');
eq('动爻被日冲=冲散', cs.kind, 'chongsan');
// 不被冲 → 无判定
const nc = C.ruleDayChong(L1, mkPil({ monthZhi: 5, dayZhi: 0 }), '旺', '官鬼');
eq('不被日冲无判定', nc.kind, null);

// ---------- 3. 月破真假 ----------
// 午火爻，子月冲午；火死于冬 → 真破（无日生扶）
const zp = C.ruleYuePo(mkLine({ zhi: '午', zhiIdx: 6, wx: '火' }), mkPil({ monthZhi: 0, dayZhi: 0 }), '死', false, '官鬼');
eq('休囚无救=真月破', zp.zhen, true);
// 同爻得日辰生扶 → 假破
const jp = C.ruleYuePo(mkLine({ zhi: '午', zhiIdx: 6, wx: '火' }), mkPil({ monthZhi: 0, dayZhi: 2 }), '死', true, '官鬼');
eq('得日生扶=假破', jp.zhen, false);
// 非冲 → 无
const np = C.ruleYuePo(mkLine({ zhi: '午', zhiIdx: 6, wx: '火' }), mkPil({ monthZhi: 1, dayZhi: 2 }), '死', false, '官鬼');
eq('非月破', np.isPo, false);

// ---------- 4. 旬空与真空 ----------
// 旬空+月破 → 真空
const zk = C.ruleXunKong(mkLine({ zhi: '午', zhiIdx: 6, wx: '火' }), mkPil({ monthZhi: 0, dayZhi: 0, kong: [6, 7], kongStr: '午未' }), true, false, '死', '官鬼');
eq('旬空+月破=真空', zk.zhen, true);
// 动不为空
const dk = C.ruleXunKong(mkLine({ zhi: '午', zhiIdx: 6, wx: '火', moving: true }), mkPil({ kong: [6, 7], kongStr: '午未' }), false, true, '旺', '官鬼');
eq('动不为空', dk.judgments[0].rule, '动不为空');
// 不空 → 无判定
const bk = C.ruleXunKong(mkLine({ zhi: '午', zhiIdx: 6, wx: '火' }), mkPil({ kong: [] }), false, false, '旺', '官鬼');
eq('不空无判定', bk.isKong, false);

// 真空以「安静」为前提（《卜筮正宗·旬空论第十》：动爻永不真空）——两条真空分支逐条覆盖
// (a) 休囚无日扶 + 旬空：静者真空，动者「动不为空」
const kWeakStatic = C.ruleXunKong(mkLine({ zhi: '午', zhiIdx: 6, wx: '火' }), mkPil({ kong: [6, 7], kongStr: '午未' }), false, false, '囚', '官鬼');
eq('休囚无扶+空+静 = 真空', kWeakStatic.zhen, true);
const kWeakMoving = C.ruleXunKong(mkLine({ zhi: '午', zhiIdx: 6, wx: '火', moving: true }), mkPil({ kong: [6, 7], kongStr: '午未' }), false, false, '囚', '官鬼');
eq('休囚无扶+空+动 ≠ 真空', kWeakMoving.zhen, false);
eq('休囚无扶+空+动 → 动不为空', kWeakMoving.judgments[0].rule, '动不为空');
// (b) 旬空 + 月破：静者真空，动者亦不为真空（「静逢月破值此旬空者」）
const kPoStatic = C.ruleXunKong(mkLine({ zhi: '午', zhiIdx: 6, wx: '火' }), mkPil({ kong: [6, 7], kongStr: '午未' }), true, true, '旺', '官鬼');
eq('空+月破+静 = 真空', kPoStatic.zhen, true);
const kPoMoving = C.ruleXunKong(mkLine({ zhi: '午', zhiIdx: 6, wx: '火', moving: true }), mkPil({ kong: [6, 7], kongStr: '午未' }), true, false, '囚', '官鬼');
eq('空+月破+动 ≠ 真空', kPoMoving.zhen, false);
eq('空+月破+动 → 动不为空', kPoMoving.judgments[0].rule, '动不为空');
// 文案自洽：真空必称「安静」，动不为空必称「发动」（防改判定时漏改文案）
eq('真空文案称「安静」', kWeakStatic.judgments[0].text.indexOf('安静') >= 0, true);
eq('动不为空文案称「发动」', kWeakMoving.judgments[0].text.indexOf('发动') >= 0, true);
eq('动不为空仍计入旬空', kWeakMoving.isKong, true);

// ---------- 5. 进神退神 ----------
const jin = C.ruleDongBian(mkLine({ zhi: '寅', zhiIdx: 2, wx: '木', moving: true, bian: { zhi: '卯', wx: '木', lq: '兄弟' } }), '兄弟');
eq('寅化卯=进神', jin.judgments.some(function (j) { return j.rule === '化进神'; }), true);
const tui = C.ruleDongBian(mkLine({ zhi: '卯', zhiIdx: 3, wx: '木', moving: true, bian: { zhi: '寅', wx: '木', lq: '兄弟' } }), '兄弟');
eq('卯化寅=退神', tui.judgments.some(function (j) { return j.rule === '化退神'; }), true);
const hsh = C.ruleDongBian(mkLine({ zhi: '子', zhiIdx: 0, wx: '水', moving: true, bian: { zhi: '酉', wx: '金', lq: '父母' } }), '妻财');
eq('变爻生本爻=回头生', hsh.judgments.some(function (j) { return j.rule === '化回头生'; }), true);
const hkk = C.ruleDongBian(mkLine({ zhi: '子', zhiIdx: 0, wx: '水', moving: true, bian: { zhi: '未', wx: '土', lq: '官鬼' } }), '妻财');
eq('变爻克本爻=回头克', hkk.judgments.some(function (j) { return j.rule === '化回头克'; }), true);
// 子化亥：同五行，亥在子前（逆）→ 退神
const bh = C.ruleDongBian(mkLine({ zhi: '子', zhiIdx: 0, wx: '水', moving: true, bian: { zhi: '亥', wx: '水', lq: '兄弟' } }), '妻财');
eq('子化亥=非进神', bh.judgments.some(function (j) { return j.rule === '化进神'; }), false);
eq('子化亥=退神', bh.judgments.some(function (j) { return j.rule === '化退神'; }), true);
// 化耗：本爻克变爻（木克土）。旧版 ruleDongBian 独缺此分支——
// 用神木化土一类动变整条无判定输出（analyze 失声），本轮补齐。
const hh = C.ruleDongBian(mkLine({ zhi: '寅', zhiIdx: 2, wx: '木', moving: true, bian: { zhi: '未', wx: '土', lq: '妻财' } }), '兄弟');
eq('本爻克变爻=化耗气', hh.judgments.some(function (j) { return j.rule === '化耗气'; }), true);
eq('化耗 kind', hh.kind, '化耗');
// 五值完备性：动变关系必居「比和／得生／受克／泄／耗」之一，任一组合都不得失声
const FIVE_REL = [
  ['丑', '土', '未', '土', '化比和'],   // 比和（土化土；丑未相冲故另附化回头冲，属正常）
  ['寅', '木', '子', '水', '化回头生'], // 得生（水生木）
  ['寅', '木', '申', '金', '化回头克'], // 受克（金克木）
  ['寅', '木', '午', '火', '化泄气'],   // 泄（木生火）
  ['寅', '木', '未', '土', '化耗气']    // 耗（木克土）★ 本轮新增
];
FIVE_REL.forEach(function (c) {
  const r = C.ruleDongBian(mkLine({
    zhi: c[0], zhiIdx: C.ZHI.indexOf(c[0]), wx: c[1], moving: true,
    bian: { zhi: c[2], wx: c[3], lq: '妻财' }
  }), '兄弟');
  eq('动变五值完备（' + c[1] + '→' + c[3] + '）', r.judgments.some(function (j) { return j.rule === c[4]; }), true);
  eq('动变五值必有 kind（' + c[1] + '→' + c[3] + '）', r.kind !== null, true);
});

// ---------- 6. 贲卦修复回归（差分发现的真实 bug） ----------
eq('下离上艮=山火贲', C.hexName([1, 0, 1, 0, 0, 1]), '山火贲');
eq('下艮上离=火山旅', C.hexName([0, 0, 1, 1, 0, 1]), '火山旅');
// 64 卦名无重复
const allNames = Object.values(C.HEXNAMES);
eq('64卦名唯一', new Set(allNames).size, 64);

// ---------- 7. 三合局 ----------
// 构造三动爻申子辰：用 paipan 真实排盘——乾为天（子寅辰午申戌）取 1,9,1,1,9,1? 
// 直接找一卦：需 卦宫坎…简单起见合成 pan 交给 ruleSanHe
const fakePan = {
  lines: [
    mkLine({ zhi: '申', zhiIdx: 8, moving: true }),
    mkLine({ zhi: '子', zhiIdx: 0, moving: true, pos: 1 }),
    mkLine({ zhi: '辰', zhiIdx: 4, moving: true, pos: 2 }),
    mkLine({ pos: 3 }), mkLine({ pos: 4 }), mkLine({ pos: 5 })
  ]
};
const sh = C.ruleSanHe(fakePan, '官鬼');
eq('申子辰三合水局', sh.length === 1 && sh[0].text.indexOf('三合水局') >= 0, true);
const shNo = C.ruleSanHe({ lines: fakePan.lines.map(function (l) { return Object.assign({}, l, { moving: false }); }) }, '官鬼');
eq('无动爻不成局', shNo.length, 0);

// ---------- 8. analyze 全链：无 score、trend 合法 ----------
// 乾为天 六爻全动（用神官鬼=午火四爻）：2026-06-15（甲午月? 实算）
const panA = C.paipan([9, 9, 9, 9, 9, 9], new Date(2026, 5, 15, 10, 0));
const resA = C.analyze(panA, '官鬼');
eq('analyze 无 score 键', Object.keys(resA).indexOf('score') < 0, true);
eq('trend 合法值', ['吉', '凶', '平', '待审'].indexOf(resA.trend) >= 0, true);
eq('judgments 非空', resA.judgments.length > 0, true);
eq('yongshen 结构完整', !!(resA.yongshen && resA.yongshen.wang && resA.yongshen.source), true);
// 伏神路径：坤为地（六亲全? 坤宫土：未巳卯丑亥酉 → 兄弟子孙妻财… 六亲可能全）找缺用神的卦：
// 天风姤（乾宫）：丑亥酉未巳卯 → 乾宫金：丑土父母 亥水子孙 酉金兄弟 未土父母 巳火官鬼 卯木妻财 → 全；需找缺卦
// 泽火革（坎宫水）：卯木子孙 丑土官鬼 亥水兄弟 亥水兄弟 酉金父母 未土官鬼 → 缺妻财（火）
const panFu = C.paipan([1, 0, 1, 1, 1, 0], new Date(2026, 8, 24, 9, 0)); // 泽火革
const resFu = C.analyze(panFu, '妻财');
eq('用神不上卦取伏神', resFu.yongshen.source, '伏神');
eq('伏神判定含飞神', resFu.judgments.some(function (j) { return j.tag === '伏神'; }), true);
// 无用神路径：真实排盘不可达——八宫首卦六亲必全，故伏神恒存在
// （实测：64 卦 × 5 六亲 = 320 组合，primary/source 为空者 0 例），
// 故此处构造「本卦无妻财、且去掉其伏神」的盘来验证该分支。
const panNone = C.paipan([1, 0, 1, 1, 1, 0], new Date(2026, 8, 24, 9, 0)); // 泽火革（妻财伏于三爻）
panNone.lines.forEach(function (l) { if (l.fu && l.fu.lq === '妻财') l.fu = null; });
const yNone = C.pickYongshen(panNone, '妻财');
eq('无伏无现 → primary 为 null', yNone.primary, null);
eq('无伏无现 → source 为 null', yNone.source, null);
const resNone = C.analyze(panNone, '妻财');
eq('无用神 → yongshen 为 null', resNone.yongshen, null);
eq('无用神 → trend 待审', resNone.trend, '待审');
// 对照：同一卦保留伏神时必有用神（证上一步是构造而非卦本身无解）
eq('保留伏神时有解（对照）', C.analyze(panFu, '妻财').yongshen.source, '伏神');
// 真实排盘的六亲用神必可取得（八宫首卦六亲必全，故伏神恒存）
const unreachable = (function () {
  let bad = 0;
  const targets = ['妻财', '官鬼', '父母', '子孙', '兄弟'];
  for (let m = 0; m < 64; m++) {
    const arr = []; for (let i = 0; i < 6; i++) arr.push((m >> i) & 1);
    const p = C.paipan(arr, new Date(2026, 8, 24, 9, 0));
    targets.forEach(function (t) { const y = C.pickYongshen(p, t); if (!y || !y.primary) bad++; });
  }
  return bad;
})();
eq('64 卦 × 5 用神全部取得到（无用神分支现实不可达）', unreachable, 0);

// ---------- 9. 汇聚表 ----------
const agg1 = C.aggregateTrend({ hasYongshen: true, grade: '旺', daySupports: true, zhenKong: true, zhenYuePo: false, judgments: [{ tag: '旬空', rule: '真空' }] });
eq('真空→凶', agg1.trend, '凶');
const agg2 = C.aggregateTrend({ hasYongshen: true, grade: '旺', daySupports: true, zhenKong: false, zhenYuePo: false, judgments: [{ tag: '月建', rule: '临月建' }, { tag: '日辰', rule: '临日辰' }] });
eq('旺+生扶→吉', agg2.trend, '吉');
const agg3 = C.aggregateTrend({ hasYongshen: false, grade: '', daySupports: false, zhenKong: false, zhenYuePo: false, judgments: [] });
eq('无用神→待审', agg3.trend, '待审');
const agg4 = C.aggregateTrend({ hasYongshen: true, grade: '休', daySupports: false, zhenKong: false, zhenYuePo: false, judgments: [] });
eq('无生无克→平', agg4.trend, '平');
// 失令（休囚）虽得日辰生扶，亦不与吉断——旧版「有生扶→吉」兜底分支把 STRONG 门废掉，
// 使「用神泄气于月／克月建 ＋ 日辰生扶」被静默判吉，与《增删卜易》「月建为提纲」相左。
const agg5 = C.aggregateTrend({ hasYongshen: true, grade: '休', daySupports: true, zhenKong: false, zhenYuePo: false,
  judgments: [{ tag: '月建', rule: '泄气于月' }, { tag: '日辰', rule: '日辰生扶' }] });
eq('休（泄气于月）得日生→平', agg5.trend, '平');
eq('泄气于月不入 harms（非伤克）', agg5.harms.length, 0);
eq('泄气于月不入 supports', agg5.supports.indexOf('月建:泄气于月'), -1);
const agg6 = C.aggregateTrend({ hasYongshen: true, grade: '囚', daySupports: true, zhenKong: false, zhenYuePo: false,
  judgments: [{ tag: '月建', rule: '克月建' }, { tag: '日辰', rule: '日辰生扶' }] });
eq('囚（克月建）得日生→平', agg6.trend, '平');
// 对照：旺相得生扶仍判吉（STRONG 门真正生效，而非被兜底分支架空）
const agg7 = C.aggregateTrend({ hasYongshen: true, grade: '相', daySupports: true, zhenKong: false, zhenYuePo: false,
  judgments: [{ tag: '月建', rule: '月建生扶' }, { tag: '日辰', rule: '日辰生扶' }] });
eq('相（月建生扶）得日生→吉', agg7.trend, '吉');

// ---------- 10. 源码级验收：analyze.js 代码中无 score 残留（剔除字符串与注释后扫描） ----------
// 注意顺序：先剥字符串再剥注释。否则 'https://x' 里的 // 会被当行注释，把后半行代码一并吃掉。
const src = fs.readFileSync(__dirname + '/public/core/analyze.js', 'utf8')
  .replace(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g, '""') // 字符串字面量
  .replace(/\/\*[\s\S]*?\*\//g, '')               // 块注释
  .replace(/\/\/.*$/gm, '');                      // 行注释
eq('analyze.js 代码无 score 字样', (src.match(/\bscore\b/g) || []).length, 0);
eq('剥离后仍保留代码主体（非空且含函数声明）', src.indexOf('function ') >= 0, true);

// ---------- 11. 夜子时流派（M2） ----------
const late = new Date(2026, 8, 24, 23, 30);
C.nightZiMode = 'day';
const pDay = C.fourPillars(late);
eq('默认夜子时归当日', pDay.dayGZ, C.fourPillars(new Date(2026, 8, 24, 12, 0)).dayGZ);
eq('默认时支为子', pDay.hourZhi, 0);
// 夜子时正法：时干按【次日】日干五鼠遁（辛丑日 23:30 → 次日壬寅遁 → 庚子时；najia/lunar-javascript 实证一致）
eq('夜子时时干按次日日干遁', pDay.hourGZ, '庚子');
eq('早子时时干按当日日干遁', C.fourPillars(new Date(2026, 8, 24, 0, 30)).hourGZ, '戊子');
eq('亥时不受夜子时影响', C.fourPillars(new Date(2026, 8, 24, 22, 30)).hourGZ, '己亥');
C.nightZiMode = 'next';
const pNext = C.fourPillars(late);
eq('夜子时归次日（day-advances 流派）', pNext.dayGZ, C.fourPillars(new Date(2026, 8, 25, 12, 0)).dayGZ);
eq('夜子标记', pNext.nightZi, true);
eq('换日说时柱', pNext.hourGZ, '庚子');
C.nightZiMode = 'day'; // 还原默认

// ---------- 11·五、ruleShi 伏神伏世下（不误报用神持世） ----------
(function () {
  // 乾坤 nid：乾为天（世在六爻/上九）。构造伏神虚拟爻：伏于世爻之下
  const pan = C.paipan([1, 1, 1, 1, 1, 1], new Date(2026, 8, 24, 10, 0)); // 乾为天，静卦
  const S = pan.lines[pan.shi];
  const fuVirtual = mkLine({ pos: pan.shi, isFu: true, wx: '火', zhi: '巳', zhiIdx: 5, lq: '子孙' });
  const rs = C.ruleShi(pan, fuVirtual, '子孙');
  eq('伏神伏世下：不误报用神持世', rs.some(function (j) { return j.rule === '用神持世'; }), false);
  eq('伏神伏世下：出「用神伏世下」判定', rs.some(function (j) { return j.rule === '用神伏世下'; }), true);
  // 对照：非伏神本爻持世 → 正常报持世
  const rs2 = C.ruleShi(pan, Object.assign({}, S, { isFu: false }), '父母');
  eq('本爻持世正常报持世', rs2.some(function (j) { return j.rule === '用神持世'; }), true);
})();

// ---------- 11·六、伏神 pos 传递（ruleShi「用神伏世下」的隐式依赖） ----------
// ruleShi 用 L.pos === pan.shi 区分「用神持世」与「用神伏世下」，该判定隐式依赖
// pickYongshen 取伏神时保留飞神位的 pos（makeFu 用 Object.assign 复制 fl，pos 随之带出）。
// 若日后有人改 makeFu 丢掉 pos，此处会静默误报「用神持世」——故直接钉住这一传递。
(function () {
  let fuCases = 0, posBad = 0;
  for (let m = 0; m < 64; m++) {
    const arr = []; for (let i = 0; i < 6; i++) arr.push((m >> i) & 1);
    const p = C.paipan(arr, new Date(2026, 8, 24, 10, 0));
    ['妻财', '官鬼', '父母', '子孙', '兄弟'].forEach(function (t) {
      const y = C.pickYongshen(p, t);
      if (!y || y.source !== '伏神') return;
      fuCases++;
      const host = p.lines[y.primary.pos]; // pos 应为飞神位
      if (!host || !host.fu || host.fu.lq !== t) posBad++;
    });
  }
  eq('伏神用例样本数 > 0', fuCases > 0, true);
  eq('伏神 pos 恒承自飞神位（' + fuCases + ' 例）', posBad, 0);
})();

// ---------- 11·六、用神两现取舍（发动者 → 临世应者 → 旺者 → 初现） ----------
(function () {
  // 合成卦：六爻皆静，月令子（水旺）
  function mkPan(lines, monthZhi) {
    return { lines: lines, shi: 0, ying: 3, pillars: { monthZhi: monthZhi } };
  }
  const l = function (o) { return Object.assign(mkLine({ lq: '妻财' }), o); };

  // ① 发动者优先（即使旺衰更差）
  var p1 = mkPan([
    l({ pos: 0, zhi: '午', zhiIdx: 6, wx: '火', moving: false }),
    l({ pos: 3, zhi: '子', zhiIdx: 0, wx: '水', moving: true })
  ], 0);
  eq('两现取发动者', C.pickYongshen(p1, '妻财').primary.pos, 3);

  // ② 皆静：临世应者优先（世在 pos 0）
  var p2 = mkPan([
    l({ pos: 0, zhi: '午', zhiIdx: 6, wx: '火', shi: true }),
    l({ pos: 3, zhi: '子', zhiIdx: 0, wx: '水' })
  ], 0);
  eq('两现取临世应者', C.pickYongshen(p2, '妻财').primary.pos, 0);

  // ③ 皆静且不临世应：取月令旺者（子月水旺 → 取水爻，尽管水爻在后）
  var p3 = mkPan([
    l({ pos: 0, zhi: '午', zhiIdx: 6, wx: '火' }),   // 子月 火死
    l({ pos: 3, zhi: '子', zhiIdx: 0, wx: '水' })    // 子月 水旺
  ], 0);
  var r3 = C.pickYongshen(p3, '妻财');
  eq('两现皆静取月令旺者', r3.primary.pos, 3);
  eq('两现取舍注明旺衰依据', r3.note.indexOf('旺者') >= 0, true);

  // ④ 皆静、不临世应、旺衰相同 → 退化取初现
  var p4 = mkPan([
    l({ pos: 0, zhi: '子', zhiIdx: 0, wx: '水' }),
    l({ pos: 3, zhi: '亥', zhiIdx: 11, wx: '水' })
  ], 0);
  eq('旺衰相同退取初现', C.pickYongshen(p4, '妻财').primary.pos, 0);

  // ⑤ 旺衰翻转即翻转取舍（闭环：同一卦、仅换月令）
  var p5 = mkPan([
    l({ pos: 0, zhi: '午', zhiIdx: 6, wx: '火' }),
    l({ pos: 3, zhi: '子', zhiIdx: 0, wx: '水' })
  ], 6); // 午月：火旺水死
  eq('旺衰翻转则取舍翻转', C.pickYongshen(p5, '妻财').primary.pos, 0);
})();


// 2026 白露 09-07 22:41：22:40 仍属申月（七月节后为酉…白露交节后为酉月）
eq('交节前一分钟属前月', C.ZHI[C.monthZhiIndex(2026, 9, 7, 22, 40)], '申');
eq('交节当刻起属本月', C.ZHI[C.monthZhiIndex(2026, 9, 7, 22, 41)], '酉');
// 立春 2026-02-04 04:02
eq('立春前一分钟属前一年', C.GAN[C.yearGanZhiIndex(2026, 2, 4, 4, 1) % 10] + C.ZHI[C.yearGanZhiIndex(2026, 2, 4, 4, 1) % 12], '乙巳');
eq('立春当刻起属新年', C.GAN[C.yearGanZhiIndex(2026, 2, 4, 4, 2) % 10] + C.ZHI[C.yearGanZhiIndex(2026, 2, 4, 4, 2) % 12], '丙午');

// ---------- 12. relation5 五值完备（月建/日辰兜底漏判的根因修复） ----------
eq('relation5 比和', C.relation5('水', '水'), '比和');
eq('relation5 得生', C.relation5('木', '水'), '得生');
eq('relation5 受克', C.relation5('木', '金'), '受克');
eq('relation5 泄', C.relation5('木', '火'), '泄');
eq('relation5 耗', C.relation5('木', '土'), '耗');
// 五值遍历：任意两行必有确定关系（旧版 else 兜底会把「同五行不同支」吞成克/比和）
(function () {
  const WX = ['金', '木', '水', '火', '土'];
  let uncovered = 0;
  WX.forEach(function (a) { WX.forEach(function (b) { if (!C.relation5(a, b)) uncovered++; }); });
  eq('relation5 全覆盖 25 组合', uncovered, 0);
})();
eq('旧 relationText 与 relation5 同源', C.relationText('木', '土'), '受制');

// ---------- 13. 规则回归：同五行不同支不得落入兜底 ----------
// #1 月建子水 / 用神亥水：旧版穿落 else 误报「用神克月建」，与 grade='旺' 自相矛盾
const Lhai = mkLine({ zhi: '亥', zhiIdx: 11, wx: '水', lq: '子孙' });
const mHai = C.ruleMonth(Lhai, mkPil({ monthZhi: 0 }), '子孙');
eq('月建子水/用神亥水 → 月建同气', mHai.judgments[0].rule, '月建同气');
eq('月建同气 grade 为旺', mHai.grade, '旺');
eq('月建同气不误报克月建', mHai.judgments[0].rule === '克月建', false);
eq('月建同气文本不自相矛盾', mHai.judgments[0].text.indexOf('克月建') < 0, true);

// #2 用神木 / 日辰土：旧版落 else 误判「日辰比和」且 supports=true（污染月破/真空/trend）
const Lmu = mkLine({ zhi: '寅', zhiIdx: 2, wx: '木', lq: '官鬼' });
const dMu = C.ruleDay(Lmu, mkPil({ monthZhi: 2, dayZhi: 4 }), '官鬼'); // 日辰辰土
eq('用神木克日辰土 → 耗于日辰', dMu.judgments[0].rule, '耗于日辰');
eq('耗于日辰不计日辰生扶', dMu.supports, false);
eq('耗于日辰不误报比和', dMu.judgments[0].rule === '日辰比和', false);
// 交叉影响：耗不得救月破 → 真破（同一 pan 只换月令为申，寅申相冲）
const yuepoMu = C.ruleYuePo(Lmu, mkPil({ monthZhi: 8, dayZhi: 4 }), '死', dMu.supports, '官鬼');
eq('耗于日辰不得救月破（真破）', yuepoMu.zhen, true);
// 交叉影响：耗不得救旬空 → 休囚+空+无扶 = 真空
const kongMu = C.ruleXunKong(Object.assign({}, Lmu, { zhiIdx: 2 }), mkPil({ monthZhi: 8, dayZhi: 4, kong: [2], kongStr: '寅卯' }), false, dMu.supports, '死', '官鬼');
eq('休囚耗气又旬空 → 真空', kongMu.zhen, true);
// 对照：日辰子水生用神寅木 → 日辰生扶（原路径不受影响）
eq('日辰生扶路径仍生效', C.ruleDay(Lmu, mkPil({ monthZhi: 2, dayZhi: 0 }), '官鬼').supports, true);
// 对照：日辰寅木临用神 → 临日辰
eq('临日辰路径仍生效', C.ruleDay(Lmu, mkPil({ monthZhi: 2, dayZhi: 2 }), '官鬼').judgments[0].rule, '临日辰');

// ---------- 14. #3 其余动爻对用神的作用（原判定链缺环） ----------
(function () {
  const pan = {
    lines: [
      mkLine({ pos: 0, zhi: '巳', zhiIdx: 5, wx: '火', lq: '妻财' }),
      // 动爻寅木生用神巳火（原神发动）
      mkLine({ pos: 1, zhi: '寅', zhiIdx: 2, wx: '木', lq: '兄弟', moving: true }),
      // 动爻子水克用神巳火（忌神发动），且化出亥水再克
      mkLine({ pos: 2, zhi: '子', zhiIdx: 0, wx: '水', lq: '父母', moving: true, bian: { lq: '兄弟', zhi: '亥', zhiIdx: 11, wx: '水' } }),
      mkLine({ pos: 3 }), mkLine({ pos: 4 }), mkLine({ pos: 5 })
    ],
    shi: 0, ying: 3, pillars: mkPil({})
  };
  const ms = C.ruleMovingOthers(pan, pan.lines[0], '妻财');
  const rules = ms.map(function (j) { return j.rule; });
  eq('动爻生用（原神发动）', rules.indexOf('动爻生用') >= 0, true);
  eq('动爻克用（忌神发动）', rules.indexOf('动爻克用') >= 0, true);
  eq('变爻克用（后患在变）', rules.indexOf('变爻克用') >= 0, true);
  eq('动爻判定数（2 动爻各 1 + 1 变爻）', ms.length, 3);
  // 用神自身动变不在此判（由 ruleDongBian 管），不重复计数
  const msSelf = C.ruleMovingOthers(pan, pan.lines[2], '父母');
  eq('用神自身动变不重复计入', msSelf.some(function (j) { return j.text.indexOf('三爻') >= 0; }), false);
  // 汇聚表：动爻生用入 supports、动爻克用入 harms
  const agg = C.aggregateTrend({ hasYongshen: true, grade: '旺', daySupports: false, zhenKong: false, zhenYuePo: false, judgments: ms });
  eq('动爻生用计入 supports', agg.supports.indexOf('动爻:动爻生用') >= 0, true);
  eq('动爻克用计入 harms', agg.harms.indexOf('动爻:动爻克用') >= 0, true);
  // analyze 全链：真实排盘（地泽临，二爻官鬼卯木动、用神妻财亥水静）中出现动爻标签
  const cast2 = C.paipan([1, 9, 0, 0, 0, 0], new Date(2026, 8, 24, 10, 0));
  const res2 = C.analyze(cast2, '妻财');
  const yongPos2 = res2.yongshen ? res2.yongshen.line.pos : -1;
  const otherMoving = cast2.lines.some(function (l) { return l.moving && l.pos !== yongPos2; });
  eq('analyze 用例存在他爻发动', otherMoving, true);
  eq('analyze 判定链含动爻标签', res2.judgments.some(function (j) { return j.tag === '动爻'; }), true);
})();

// ---------- 15. #7 三合局纳入变爻（两动爻 + 一变爻） ----------
(function () {
  const panSH = {
    lines: [
      mkLine({ pos: 0, zhi: '申', zhiIdx: 8, moving: true, lq: '兄弟' }),
      mkLine({ pos: 1, zhi: '子', zhiIdx: 0, moving: true, lq: '父母' }),
      mkLine({ pos: 2, zhi: '戌', zhiIdx: 10, moving: true, lq: '官鬼', bian: { lq: '父母', zhi: '辰', zhiIdx: 4, wx: '土' } }),
      mkLine({ pos: 3 }), mkLine({ pos: 4 }), mkLine({ pos: 5 })
    ]
  };
  const s = C.ruleSanHe(panSH, '官鬼');
  eq('两动爻+一变爻成申子辰水局', s.length === 1 && s[0].text.indexOf('三合水局') >= 0, true);
  eq('三合文本标注变爻来源', s[0].text.indexOf('（变爻') >= 0, true);
  eq('三合文本含来源标注', s[0].text.indexOf('（本卦') >= 0, true);
  // 同一爻本变不得双算：单动爻（本申 变辰）只有两支，不成局
  const panSH2 = {
    lines: [
      mkLine({ pos: 0, zhi: '申', zhiIdx: 8, moving: true, lq: '兄弟', bian: { lq: '父母', zhi: '辰', zhiIdx: 4, wx: '土' } }),
      mkLine({ pos: 1 }), mkLine({ pos: 2 }), mkLine({ pos: 3 }), mkLine({ pos: 4 }), mkLine({ pos: 5 })
    ]
  };
  eq('单爻本变两支不成局', C.ruleSanHe(panSH2, '官鬼').length, 0);
})();

// ---------- 16. #11/#12 伏神取法与飞伏同气 ----------
(function () {
  // 伏神两现：乾宫首卦父母（辰、戌）两现，其一伏于世下 → 取临世应者
  const mkFuPan = function () {
    return {
      lines: [
        mkLine({ pos: 0, zhi: '子', zhiIdx: 0, wx: '水', lq: '兄弟', fu: { lq: '父母', zhi: '辰', wx: '土', zhiIdx: 4 } }),
        mkLine({ pos: 1, zhi: '寅', zhiIdx: 2, wx: '木', lq: '妻财' }),
        mkLine({ pos: 2, zhi: '辰', zhiIdx: 4, wx: '土', lq: '子孙' }),
        mkLine({ pos: 3, zhi: '午', zhiIdx: 6, wx: '火', lq: '官鬼', fu: { lq: '父母', zhi: '戌', wx: '土', zhiIdx: 10 } }),
        mkLine({ pos: 4, zhi: '申', zhiIdx: 8, wx: '金', lq: '兄弟' }),
        mkLine({ pos: 5, zhi: '戌', zhiIdx: 10, wx: '土', lq: '子孙' })
      ], shi: 0, ying: 3, pillars: mkPil({ monthZhi: 0 })
    };
  };
  const pk = C.pickYongshen(mkFuPan(), '父母');
  eq('伏神两现取临世应者', pk.primary.pos, 0);
  eq('伏神两现说明取法', pk.note.indexOf('临世应') >= 0, true);
  eq('伏神 all 列出全部候选', pk.all.length, 2);
  // 皆不临世应 → 退取在前之爻（伏神同六亲必同五行，旺衰恒同）
  // 注意：ying 必须避开候选位（原 ying=3 会让 pos3 命中「临世应」）
  const pan2 = mkFuPan();
  pan2.ying = 5;
  pan2.lines[0].fu = null;
  pan2.lines[1].fu = { lq: '父母', zhi: '辰', wx: '土', zhiIdx: 4 };
  const pk2 = C.pickYongshen(pan2, '父母');
  eq('伏神皆不临世应退取前爻', pk2.primary.pos, 1);
  eq('退取时说明理由', pk2.note.indexOf('在前之爻') >= 0, true);

  // #12 飞伏同气：飞神与伏神同五行
  const panSame = {
    lines: [
      mkLine({ pos: 0, zhi: '子', zhiIdx: 0, wx: '水', lq: '兄弟', fu: { lq: '子孙', zhi: '亥', wx: '水', zhiIdx: 11 } }),
      mkLine({ pos: 1 }), mkLine({ pos: 2 }), mkLine({ pos: 3 }), mkLine({ pos: 4 }), mkLine({ pos: 5 })
    ], shi: 0, ying: 3, pillars: mkPil({})
  };
  const fuL = Object.assign({}, panSame.lines[0], { isFu: true, wx: '水', zhi: '亥', zhiIdx: 11, lq: '子孙' });
  const rf = C.ruleFu(panSame, fuL, mkPil({}), '子孙');
  eq('飞伏同气单独成条（不再落「无生克」）', rf.some(function (j) { return j.rule === '飞伏同气'; }), true);
  eq('飞伏同气不误报无生克', rf.some(function (j) { return j.rule === '飞伏无关'; }), false);
  eq('飞伏同气计入 supports', C.aggregateTrend({ hasYongshen: true, grade: '旺', daySupports: false, zhenKong: false, zhenYuePo: false, judgments: rf }).supports.indexOf('伏神:飞伏同气') >= 0, true);
  // 伏克飞：伏神能制飞神（旧版误入「飞伏无关」）
  const panKe = {
    lines: [
      mkLine({ pos: 0, zhi: '子', zhiIdx: 0, wx: '水', lq: '兄弟' }),
      mkLine({ pos: 1 }), mkLine({ pos: 2 }), mkLine({ pos: 3 }), mkLine({ pos: 4 }), mkLine({ pos: 5 })
    ], shi: 0, ying: 3, pillars: mkPil({})
  };
  const fuL2 = Object.assign({}, panKe.lines[0], { isFu: true, wx: '土', zhi: '辰', zhiIdx: 4, lq: '父母' });
  eq('伏克飞单列', C.ruleFu(panKe, fuL2, mkPil({}), '父母').some(function (j) { return j.rule === '伏克飞神'; }), true);
})();

// ---------- 17. 第六轮：三合局纳入汇聚表（依《增删卜易·六合章第十九》） ----------
// 原文：「三合其局者，用神旺则无不为吉……如占功名，合成官局谓之官旺；合成财局，财旺生官；
//        倘合成子孙局者，乃伤用之神也」——「合成子孙局」即「局泄用神」的五行表述，
//        故三合吉凶由「局五行 对 用神五行」的生克定，ruleSanHe 因而需用神（target 恢复启用）。
(function () {
  const L = function (o) { return Object.assign({ pos: 0, zhi: '巳', zhiIdx: 5, wx: '火', lq: '官鬼', moving: false, bian: null, isFu: false }, o); };
  // 三动爻申子辰成水局；用神取四爻妻财，其五行可变，以遍历「局对用神」五态
  const mkPan = function (yWx) {
    return { lines: [
      L({ pos: 0, zhi: '申', zhiIdx: 8, wx: '金', lq: '兄弟', moving: true }),
      L({ pos: 1, zhi: '子', zhiIdx: 0, wx: '水', lq: '父母', moving: true }),
      L({ pos: 2, zhi: '辰', zhiIdx: 4, wx: '土', lq: '官鬼', moving: true }),
      L({ pos: 3, zhi: '卯', zhiIdx: 3, wx: yWx, lq: '妻财' }),
      L({ pos: 4, zhi: '巳', zhiIdx: 5, wx: '火', lq: '兄弟' }),
      L({ pos: 5, zhi: '未', zhiIdx: 7, wx: '土', lq: '父母' })
    ] };
  };
  const rel = function (yWx) { return C.ruleSanHe(mkPan(yWx), '妻财')[0].relation; };
  eq('水局 × 用神水 → 同气', rel('水'), '同气');
  eq('水局 × 用神木 → 生用（水生木）', rel('木'), '生用');
  eq('水局 × 用神火 → 克用（水克火）', rel('火'), '克用');
  eq('水局 × 用神金 → 泄用（用神生局）', rel('金'), '泄用');
  eq('水局 × 用神土 → 耗用（用神克局）', rel('土'), '耗用');
  eq('不传 target 时不判助伤（兼容旧调用，只陈述成局）', C.ruleSanHe(mkPan('木'))[0].relation, '');
  eq('成局事实不受 target 影响（局名与来源仍照出）', C.ruleSanHe(mkPan('木'))[0].text.indexOf('三合水局') >= 0, true);

  const agg = function (relation) {
    return C.aggregateTrend({
      hasYongshen: true, grade: '旺', daySupports: true, zhenKong: false, zhenYuePo: false,
      judgments: [{ tag: '三合', rule: '申子辰三合水局', relation: relation }]
    });
  };
  eq('三合生用 → 入 supports', agg('生用').supports.length, 1);
  eq('三合同气 → 入 supports', agg('同气').supports.length, 1);
  eq('三合同气（旺相）→ trend 吉', agg('同气').trend, '吉');
  eq('三合克用 → 入 harms', agg('克用').harms.length, 1);
  eq('三合克用（旺相、无他生扶）→ 不判吉', agg('克用').trend, '平');
  eq('三合泄用 → 不入 supports', agg('泄用').supports.length, 0);
  eq('三合泄用 → 不入 harms（与「泄气于月不入 harms」同口径）', agg('泄用').harms.length, 0);
  eq('三合耗用 → 不入 harms', agg('耗用').harms.length, 0);
  eq('supports 条目带局名与关系', agg('生用').supports[0], '三合:申子辰三合水局（生用）');
  eq('relation 缺省时不入表（只陈述）', agg('').supports.length + agg('').harms.length, 0);
  // 端到端：真实排盘（乾为天六爻全动）应同时体现「火局同气」与「水局克用」两条三合判词
  const resSH = C.analyze(C.paipan([9, 9, 9, 9, 9, 9], new Date(2026, 5, 15, 10, 0)), '官鬼');
  eq('真实卦：三合入 supports', resSH.supports.some(function (s) { return s.indexOf('三合:') === 0; }), true);
  eq('真实卦：三合入 harms', resSH.harms.some(function (h) { return h.indexOf('三合:') === 0; }), true);
})();

// ---------- 18. 第六轮：刑害与世爻关系「不」入汇聚表（依经典定论） ----------
// 《增删卜易·三刑章第二十一》野鹤自述「只以三刑为证而应验，这数十年，我只得到这一卦」，
//   并谓子卯、丑未之刑「多是附和为凶」——刑非凶之主因，只在用神本已虚弱时附和；
//   该语义由「WEAK + harms>0 + 无 supports → 凶」分支天然实现，无需入表。
//   反之若入 harms，会让「旺相用神遇单刑」由吉降平，与「旺者不畏刑」相悖。
// 《黄金策》《增删卜易》「用克世勿作凶看……如占求财，财爻克世者必得；占行人，用神克世者即归；
//   占医药，子孙克世者即愈……若占功名，官鬼克世，非祸即灾」——吉凶随占类翻转，
//   无法映射为单一方向；且其作用对象是世爻（事与己），非用神旺衰，故只作 bullet 陈述。
(function () {
  const agg = function (grade, js) {
    return C.aggregateTrend({ hasYongshen: true, grade: grade, daySupports: true, zhenKong: false, zhenYuePo: false, judgments: js });
  };
  const xh = [
    { tag: '月建', rule: '临月建' }, { tag: '相刑', rule: '寅巳相刑' },
    { tag: '相害', rule: '六害' }, { tag: '世爻', rule: '用神克世' }, { tag: '世爻', rule: '世克用神' }
  ];
  eq('刑害/世爻不入 supports', agg('旺', xh).supports, ['月建:临月建']);
  eq('刑害/世爻不入 harms', agg('旺', xh).harms.length, 0);
  eq('旺相 + 刑害/世爻 → 仍判吉（旺者不畏刑）', agg('旺', xh).trend, '吉');
  // 附和为凶：用神本已虚弱且另有伤克时，凶由伤克定（刑只是附和）
  eq('虚弱 + 伤克（另有刑）→ 凶', agg('死', [{ tag: '月破', rule: '真月破' }, { tag: '相刑', rule: '寅巳相刑' }]).trend, '凶');
  eq('仅刑害、无伤克、旺相 → 不因刑而降吉', agg('相', [{ tag: '月建', rule: '月建生扶' }, { tag: '相刑', rule: '寅巳相刑' }]).trend, '吉');
})();

console.log('PASS:', pass, ' FAIL:', fail);
if (fail > 0) process.exit(1);

