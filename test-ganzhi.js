/* 干支排盘自检（pillarsFromGanzhi + paipan 第三参）
 *
 * 覆盖：五虎遁月干、五鼠遁时干、旬空、六神起法、缺柱留空、变卦、
 * 以及与默认路径（不传 opt）的兼容性——后者是关键回归：任何改动都不得
 * 让原有「按公历起盘」的结果变一位。
 */
const C = require('./core.js');
let pass = 0, fail = 0;
function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++;
  else { fail++; console.log('FAIL', name, '\n  got =', JSON.stringify(got), '\n  want=', JSON.stringify(want)); }
}
function ok(name, cond, extra) {
  if (cond) pass++;
  else { fail++; console.log('FAIL', name, extra === undefined ? '' : extra); }
}
function throws(name, fn, re) {
  try { fn(); fail++; console.log('FAIL', name, '应当抛错但没抛'); }
  catch (e) { if (!re || re.test(e.message)) pass++; else { fail++; console.log('FAIL', name, '错误文案不符:', e.message); } }
}

/* ---------- 1. 六甲子下标锚点 ---------- */
// 丁亥 = 23（23%10=3 丁，23%12=11 亥）
eq('丁亥 index', C.ganzhiOfIndex(23), '丁亥');
eq('甲子 index 0', C.ganzhiOfIndex(0), '甲子');
eq('癸亥 index 59', C.ganzhiOfIndex(59), '癸亥');

/* ---------- 2. 旬空：丁亥日属甲申旬 → 午未空 ---------- */
const pDingHai = C.pillarsFromGanzhi({ monthZhi: 10, dayIdx: 23 });
eq('丁亥日 旬空', pDingHai.kongStr, '午未');
eq('戌月 旬空', pDingHai.kongStr, '午未');
eq('日柱', pDingHai.dayGZ, '丁亥');
eq('日干下标', pDingHai.dayGan, 3);
eq('日支下标', pDingHai.dayZhi, 11);
eq('月建地支', pDingHai.monthZhi, 10);

/* ---------- 3. 月干五虎遁：丙年戌月 = 戊戌 ---------- */
// 丙午年 = 42（42%10=2 丙）
eq('丙午 index', C.ganzhiOfIndex(42), '丙午');
const pBingWu = C.pillarsFromGanzhi({ yearIdx: 42, monthZhi: 10, dayIdx: 23 });
eq('丙年戌月 月柱', pBingWu.monthGZ, '戊戌');
eq('丙年戌月 年柱', pBingWu.yearGZ, '丙午');
// 五虎遁逐月核对：丙年起庚寅，寅卯辰巳午未申酉戌亥子丑 → 庚辛壬癸甲乙丙丁戊己
const wuhu = [];
for (let mz = 2; mz < 14; mz++) {
  wuhu.push(C.pillarsFromGanzhi({ yearIdx: 42, monthZhi: mz % 12, dayIdx: 0 }).monthGZ);
}
eq('丙年十二月建', wuhu, ['庚寅', '辛卯', '壬辰', '癸巳', '甲午', '乙未', '丙申', '丁酉', '戊戌', '己亥', '庚子', '辛丑']);

/* ---------- 4. 时干五鼠遁：丁日亥时 = 辛亥 ---------- */
// 丁日起庚子：子庚 丑辛 … 亥 = 庚+11 → 辛
const pShi = C.pillarsFromGanzhi({ monthZhi: 10, dayIdx: 23, hourZhi: 11 });
eq('丁日亥时 时柱', pShi.hourGZ, '辛亥');
const wushu = [];
for (let hz = 0; hz < 12; hz++) {
  wushu.push(C.pillarsFromGanzhi({ monthZhi: 0, dayIdx: 23, hourZhi: hz }).hourGZ);
}
eq('丁日十二时辰', wushu, ['庚子', '辛丑', '壬寅', '癸卯', '甲辰', '乙巳', '丙午', '丁未', '戊申', '己酉', '庚戌', '辛亥']);

/* ---------- 5. 缺柱留空：年 / 时辰不填 ---------- */
eq('无年柱 → 空串', pDingHai.yearGZ, '');
eq('无时辰 → 空串', pDingHai.hourGZ, '');
eq('无年柱时月柱仍给地支', pDingHai.monthGZ, '戌');
ok('无年柱不推月干', pDingHai.monthGan === null, 'monthGan=' + pDingHai.monthGan);
eq('ganzhiMode 标记', pDingHai.ganzhiMode, true);

/* ---------- 6. 入参校验 ---------- */
throws('缺 dayIdx', function () { C.pillarsFromGanzhi({ monthZhi: 0 }); }, /dayIdx/);
throws('dayIdx 越界', function () { C.pillarsFromGanzhi({ monthZhi: 0, dayIdx: 60 }); }, /dayIdx/);
throws('缺 monthZhi', function () { C.pillarsFromGanzhi({ dayIdx: 0 }); }, /monthZhi/);

/* ---------- 7. 排盘：全阳静卦 = 乾为天 ---------- */
const yang6 = [1, 1, 1, 1, 1, 1];
const pQian = C.paipan(yang6, null, { pillars: pBingWu });
eq('全阳 卦名', pQian.benName, '乾为天');
eq('全阳 宫', pQian.palace, '乾');
eq('全阳 静卦', pQian.hasBian, false);
eq('全阳 无变卦', pQian.bianName, null);
eq('旬空透传到盘面', pQian.pillars.kongStr, '午未');
eq('六神（丁日初爻朱雀）', pQian.lines[0].beast, '朱雀');
eq('六神（丁日二爻勾陈）', pQian.lines[1].beast, '勾陈');
eq('六神（丁日上爻青龙）', pQian.lines[5].beast, '青龙');
// 乾为天 世在上爻（八纯卦）
eq('乾 世位', pQian.shi, 5);
eq('乾 应位', pQian.ying, 2);
// 甲子水在初爻（乾纳甲子）
eq('乾初爻纳甲', pQian.lines[0].gan + pQian.lines[0].zhi, '甲子');
eq('乾初爻六亲（乾宫金 → 子水 = 子孙）', pQian.lines[0].lq, '子孙');

/* ---------- 8. 变卦：初爻动 → 天风姤；上爻动 → 泽天夬 ---------- */
const pGou = C.paipan([9, 1, 1, 1, 1, 1], null, { pillars: pBingWu });
eq('初爻动 变卦', pGou.bianName, '天风姤');
eq('初爻动 标记', pGou.moving, [true, false, false, false, false, false]);
eq('初爻动 变爻六亲', pGou.lines[0].bian.lq, '父母');   // 姤初爻辛丑土 → 乾宫金生土? 土生金 → 父母
const pGuai = C.paipan([1, 1, 1, 1, 1, 9], null, { pillars: pBingWu });
eq('上爻动 变卦', pGuai.bianName, '泽天夬');
// 阴爻动 → 6
const pFu = C.paipan([6, 1, 1, 1, 1, 1], null, { pillars: pBingWu });
eq('初爻阴动 本卦', pFu.benName, '天风姤');
eq('初爻阴动 变卦', pFu.bianName, '乾为天');
eq('初爻阴动 变出阳', pFu.bianBits[0], 1);

/* ---------- 9. 分析层能吃干支四柱（不抛错、月建/日辰进主证据） ---------- */
let a = null, aErr = null;
try { a = C.analyze(pQian, { yongshen: '' }); } catch (e) { aErr = e; }
ok('analyze(干支盘) 不抛错', aErr === null, aErr && aErr.message);
ok('analyze 有返回', !!a, 'a=' + typeof a);

/* ---------- 10. 兼容性：不传第三参时与旧路径逐字一致 ---------- */
const dt = new Date(2026, 8, 24, 9, 0);   // 2026-09-24 09:00 丙午年 丁酉月
const legacy = C.paipan([1, 0, 1, 1, 0, 1], dt);
const legacyPil = C.fourPillars(dt);
eq('默认路径 年柱', legacy.pillars.yearGZ, legacyPil.yearGZ);
eq('默认路径 月柱', legacy.pillars.monthGZ, legacyPil.monthGZ);
eq('默认路径 日柱', legacy.pillars.dayGZ, legacyPil.dayGZ);
eq('默认路径 旬空', legacy.pillars.kongStr, legacyPil.kongStr);
ok('默认路径无 ganzhiMode 标记', legacy.pillars.ganzhiMode === undefined, 'got=' + legacy.pillars.ganzhiMode);
ok('默认路径 date 仍为入参', legacy.date.getTime() === dt.getTime());
// 非法 dt 仍须抛错（旧行为不得因放宽校验而丢失）
throws('默认路径非法 dt', function () { C.paipan(yang6, new Date('x')); }, /dt 须为有效 Date/);
throws('默认路径缺 dt', function () { C.paipan(yang6); }, /dt 须为有效 Date/);
// 爻值校验仍在
throws('爻值非法', function () { C.paipan([1, 1, 1, 1, 1, 5], null, { pillars: pBingWu }); }, /tossVals\[5\]/);

/* ---------- 11. 干支盘与同四柱的公历盘等价 ---------- */
// 用「丙午年 戊戌月 丁亥日 辛亥时」构造，再找一个公历时刻排出同样四柱难，
// 改为反向验证：公历盘的 pillars 喂回 pillarsFromGanzhi，盘面必须逐字相同。
const byDate = C.paipan([1, 0, 1, 1, 0, 1], dt);
const rebuiltPil = C.pillarsFromGanzhi({
  yearIdx: byDate.pillars.yearIdx,
  monthZhi: byDate.pillars.monthZhi,
  dayIdx: byDate.pillars.dayIdx,
  hourZhi: byDate.pillars.hourZhi
});
const byGz = C.paipan([1, 0, 1, 1, 0, 1], null, { pillars: rebuiltPil });
eq('四柱还原 月柱一致', byGz.pillars.monthGZ, byDate.pillars.monthGZ);
eq('四柱还原 时柱一致', byGz.pillars.hourGZ, byDate.pillars.hourGZ);
eq('四柱还原 旬空一致', byGz.pillars.kongStr, byDate.pillars.kongStr);
eq('四柱还原 卦名一致', byGz.benName, byDate.benName);
eq('四柱还原 六神一致', byGz.lines.map(function (l) { return l.beast; }), byDate.lines.map(function (l) { return l.beast; }));

console.log('\n干支排盘自检：通过 ' + pass + '　失败 ' + fail);
if (fail) process.exit(1);
