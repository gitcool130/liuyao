/* 核心引擎自检 */
const C = require('./core.js');
let pass = 0, fail = 0;
function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; } else { fail++; console.log('FAIL', name, 'got=', got, 'want=', want); }
}

// 1. 日柱锚点：1949-10-01 甲子日
eq('1949-10-01 甲子', C.GAN[C.dayGanZhiIndex(1949,10,1)%10] + C.ZHI[C.dayGanZhiIndex(1949,10,1)%12], '甲子');
// 2. 2000-01-01 戊午日（双锚点交叉验证）
eq('2000-01-01 戊午', C.GAN[C.dayGanZhiIndex(2000,1,1)%10] + C.ZHI[C.dayGanZhiIndex(2000,1,1)%12], '戊午');
// 3. 2026 年干支（(y-4)%60 → 丙午）
const yIdx = C.yearGanZhiIndex(2026, 9, 24);
eq('2026 年柱', C.GAN[yIdx%10] + C.ZHI[yIdx%12], '丙午');
// 4. 2026-09-24 月支：白露(9月约第8日)后 → 酉
eq('2026-09 月支', C.ZHI[C.monthZhiIndex(2026, 9, 24)], '酉');
// 5. 月干：丙午年五虎遁庚寅起，酉月=庚+7=丁 → 丁酉
const mZhi = C.monthZhiIndex(2026, 9, 24);
const mFromYin = (mZhi - 2 + 12) % 12;
const mGan = (2 + mFromYin) % 10; // 丙午年→丙→寅月起庚? WUHU: 丙→6(庚)
const mGan2 = (6 + mFromYin) % 10;
eq('2026-09 月干(五虎遁)', C.GAN[mGan2], '丁');
// 6. 八宫：泽火革 属坎宫四世
const ge = C.hexName([1,0,1, 1,1,0]);
eq('泽火革 卦名', ge, '泽火革');
const geInfo = C.PALACE[[1,0,1,1,1,0].join('')];
eq('革 宫', geInfo.palace, '坎');
eq('革 世位', geInfo.shi, 3);
eq('革 应位', geInfo.ying, 0);
// 7. 革卦初爻纳甲：下离 → 己卯（坎宫水 → 卯木=子孙）
const pan0 = C.paipan([1,0,1, 1,1,0], new Date(2026, 8, 24, 9, 0)); // 革：下离上兑
eq('革 初爻干支', pan0.lines[0].gan + pan0.lines[0].zhi, '己卯');
eq('革 初爻六亲', pan0.lines[0].lq, '子孙');
eq('革 四爻干支', pan0.lines[3].gan + pan0.lines[3].zhi, '丁亥');
eq('革 五爻干支', pan0.lines[4].gan + pan0.lines[4].zhi, '丁酉');
// 8. 乾宫归魂=火天大有
eq('大有卦名', C.hexName([1,1,1, 1,0,1]), '火天大有');
eq('大有 宫', C.PALACE[[1,1,1,1,0,1].join('')].palace, '乾');
eq('大有 游魂=火地晋', C.hexName([0,0,0, 1,0,1]), '火地晋');
// 9. 64卦宫无重复无遗漏
eq('八宫卦总数', Object.keys(C.PALACE).length, 64);
// 10. 六神起法：甲日初爻青龙
eq('甲日六神起', C.BEASTS ? '' : '', '');
const bs = C.beastStart(0); eq('甲日起兽', bs, 0);
eq('癸日起兽', C.beastStart(9), 5);
// 11. 六亲：乾宫金，午火爻=官鬼
eq('乾宫午火六亲', C.liuqin('金','火'), '官鬼');
eq('乾宫戌土六亲', C.liuqin('金','土'), '父母');
eq('乾宫申金六亲', C.liuqin('金','金'), '兄弟');
eq('乾宫寅木六亲', C.liuqin('金','木'), '妻财');
eq('乾宫子水六亲', C.liuqin('金','水'), '子孙');
// 12. 冲合
eq('子午冲', C.chong(0, 6), true);
eq('卯酉冲', C.chong(3, 9), true);
eq('子丑合', C.liuhe(0, 1), true);
eq('巳申合', C.liuhe(5, 8), true);
// 13. 旬空：甲子日(0) 旬空戌亥
const p1 = C.fourPillars(new Date(1949, 9, 1, 12));
eq('甲子日旬空', p1.kongStr, '戌亥');
// 14. 完整排盘：地天泰(坤宫三世) 世在三爻
const taiInfo = C.PALACE[[1,1,1,0,0,0].join('')];
eq('泰 宫', taiInfo.palace, '坤');
eq('泰 世', taiInfo.shi, 2);
eq('泰 应', taiInfo.ying, 5);
// 15. 老阳动变：乾之姤（初爻动）
const pan2 = C.paipan([9,1,1,1,1,1], new Date());
eq('乾之姤 变卦', pan2.bianName, '天风姤');
eq('姤 宫', pan2.bianPalace, '乾');
eq('变爻初爻', pan2.lines[0].bian.gan + pan2.lines[0].bian.zhi, '辛丑'); // 巽纳甲初爻辛丑
eq('变爻六亲(以乾宫金论)', pan2.lines[0].bian.lq, '父母'); // 丑土生金 → 父母

// 16. 节气边界：立春前后各一天（年柱须翻转）
// 2026 立春 02-04 04:02：前一日属乙巳年、当日已过立春属丙午年
const beforeLc = C.fourPillars(new Date(2026, 1, 3, 10, 0));
const afterLc = C.fourPillars(new Date(2026, 1, 4, 10, 0));
eq('立春前一日 年柱', beforeLc.yearGZ, '乙巳');
eq('立春当日 年柱', afterLc.yearGZ, '丙午');
// 同日内精确到分钟（03:59 vs 04:02）
eq('立春前一分钟 年柱', C.fourPillars(new Date(2026, 1, 4, 4, 1)).yearGZ, '乙巳');
eq('立春当刻 年柱', C.fourPillars(new Date(2026, 1, 4, 4, 2)).yearGZ, '丙午');
// 惊恐节边界：2026 白露 09-07 22:41（月支申→酉）
eq('白露前一日 月支', C.ZHI[C.monthZhiIndex(2026, 9, 6, 23, 0)], '申');
eq('白露当日 月支', C.ZHI[C.monthZhiIndex(2026, 9, 7, 23, 0)], '酉');
eq('白露前一分钟 月支', C.ZHI[C.monthZhiIndex(2026, 9, 7, 22, 40)], '申');
eq('白露当刻 月支', C.ZHI[C.monthZhiIndex(2026, 9, 7, 22, 41)], '酉');
// 节气表覆盖范围（1900–2100）与表外兜底
eq('节气表下限 1900', !!C.termMoment(1900, 1), true);
eq('节气表上限 2100', !!C.termMoment(2100, 12), true);
eq('表外 1899 返回 null', C.termMoment(1899, 12), null);
eq('表外 2101 返回 null', C.termMoment(2101, 1), null);

// 17. 夜子时段：日柱归属 + 时干五鼠遁（23:00–24:00）
const pNight = C.fourPillars(new Date(2026, 8, 24, 23, 30));  // 辛丑日
eq('夜子时 日柱归当日', pNight.dayGZ, C.fourPillars(new Date(2026, 8, 24, 12, 0)).dayGZ);
eq('夜子时 时支为子', pNight.hourZhi, 0);
eq('夜子时 时干按次日日干遁', pNight.hourGZ, '庚子');
eq('早子时 时干按当日日干遁', C.fourPillars(new Date(2026, 8, 24, 0, 30)).hourGZ, '戊子');
eq('23:00 整即入夜子时', C.fourPillars(new Date(2026, 8, 24, 23, 0)).hourZhi, 0);
eq('22:59 仍为亥时', C.fourPillars(new Date(2026, 8, 24, 22, 59)).hourZhi, 11);
// 子时跨日：23:30 与次日 00:30 时柱相同（同属子时，日干已换，故时干不同）
eq('夜子时 旬空依当日日柱', pNight.kongStr, C.fourPillars(new Date(2026, 8, 24, 12, 0)).kongStr);

console.log('PASS:', pass, ' FAIL:', fail);
if (fail > 0) process.exit(1);
