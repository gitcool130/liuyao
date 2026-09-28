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
// 5. 月柱：丙午年五虎遁庚寅起，酉月 = 庚+7 = 丁 → 丁酉
// 断言直接调 fourPillars；本测试原本在此重算一遍五虎遁（且留了未使用的 mGan 死变量），
// 实现写错也照样通过——改为对真实实现的端到端断言。
eq('2026-09-24 月柱(五虎遁)', C.fourPillars(new Date(2026, 8, 24, 9, 0)).monthGZ, '丁酉');
eq('2026-09-24 月支', C.fourPillars(new Date(2026, 8, 24, 9, 0)).monthZhi, C.monthZhiIndex(2026, 9, 24));
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
// 10. 六神起法：自日干起兽，初爻依次排布
// 原为 `eq('甲日六神起', C.BEASTS ? '' : '', '')`——两分支同为 ''，恒真空断言，已换为真实交叉断言。
const bs = C.beastStart(0); eq('甲日起兽', bs, 0);
eq('癸日起兽', C.beastStart(9), 5);
const panB = C.paipan([1, 1, 1, 1, 1, 1], new Date(2026, 8, 24, 9, 0));
const bGan = C.GAN.indexOf(C.fourPillars(new Date(2026, 8, 24, 9, 0)).dayGZ[0]);
eq('六神序列＝BEASTS 自 beastStart(日干) 起',
  panB.lines.map(function (l) { return l.beast; }).join(','),
  [0, 1, 2, 3, 4, 5].map(function (i) { return C.BEASTS[(C.beastStart(bGan) + i) % 6]; }).join(','));
eq('六神序列长度完整', panB.lines.filter(function (l) { return C.BEASTS.indexOf(l.beast) >= 0; }).length, 6);
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
// 白露边界：2026 白露 09-07 22:41（月支申→酉）
eq('白露前一日 月支', C.ZHI[C.monthZhiIndex(2026, 9, 6, 23, 0)], '申');
eq('白露当日 月支', C.ZHI[C.monthZhiIndex(2026, 9, 7, 23, 0)], '酉');
eq('白露前一分钟 月支', C.ZHI[C.monthZhiIndex(2026, 9, 7, 22, 40)], '申');
eq('白露当刻 月支', C.ZHI[C.monthZhiIndex(2026, 9, 7, 22, 41)], '酉');
// 节气表覆盖范围（1900–2100）与表外兜底
eq('节气表下限 1900', !!C.termMoment(1900, 1), true);
eq('节气表上限 2100', !!C.termMoment(2100, 12), true);
eq('表外 1899 返回 null', C.termMoment(1899, 12), null);
eq('表外 2101 返回 null', C.termMoment(2101, 1), null);

// 表外年份排盘降级（回归：曾于 2 月立春分支直接取 null.day，抛 TypeError 中断排盘）
const pOut = C.fourPillars(new Date(1660, 1, 5, 10, 0));
eq('表外 1660-02 出四柱（不抛异常）', !!pOut.dayGZ, true);
eq('表外 1660 outOfTable 标记', pOut.outOfTable, true);
eq('表外 2150-02 亦不抛异常', !!C.fourPillars(new Date(2150, 1, 5, 10, 0)).yearGZ, true);
eq('表外降级 立春前年柱归前一年', C.fourPillars(new Date(1660, 1, 3, 10, 0)).yearGZ, C.fourPillars(new Date(1659, 5, 3, 10, 0)).yearGZ);
eq('表外降级 立春后年柱归本年', C.fourPillars(new Date(1660, 1, 5, 10, 0)).yearGZ, C.fourPillars(new Date(1660, 5, 3, 10, 0)).yearGZ);
eq('表内年份 outOfTable=false', C.fourPillars(new Date(2026, 8, 24, 10, 0)).outOfTable, false);
eq('表内下限 1900 outOfTable=false', C.fourPillars(new Date(1900, 5, 1, 10, 0)).outOfTable, false);
eq('表内上限 2100 outOfTable=false', C.fourPillars(new Date(2100, 5, 1, 10, 0)).outOfTable, false);

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

// ---------- 18. paipan 入参校验（第二十一轮 C1） ----------
// 旧版换算 (v === 1 || v === 9) ? 1 : 0 对非法值**静默错排**：传统铜钱记法 7/8 不在
// {0,1,6,9} 内会被一律当作阴爻，排出一个毫不相干的卦却不报错；长度不足则抛
// `Cannot read properties of undefined`（指向实现细节，非用户错误）。静默错排最危险。
const D = new Date(2026, 8, 24, 9, 0);
const throws = function (fn) { try { fn(); return null; } catch (e) { return e.message || String(e); } };
eq('长度 3 → 报长度错', /长度 6/.test(throws(function () { C.paipan([1, 1, 1], D); }) || ''), true);
eq('长度 7 → 报长度错', /长度 6/.test(throws(function () { C.paipan([1, 1, 1, 1, 1, 1, 1], D); }) || ''), true);
eq('非数组 → 报错', /长度 6/.test(throws(function () { C.paipan('101110', D); }) || ''), true);
eq('不传参 → 报错', /长度 6/.test(throws(function () { C.paipan(); }) || ''), true);
// 旧版这三行全部静默排成坤为地，是「静默错排比报错危险」的直接证据
eq('传统记法 7 → 报错（不再静默当阴爻）', /tossVals\[0\]/.test(throws(function () { C.paipan([7, 7, 7, 7, 7, 7], D); }) || ''), true);
eq('字符串 "9" → 报错（旧版因 "9" !== 9 静默当阴爻）', /tossVals\[0\]/.test(throws(function () { C.paipan(['9', '9', '9', '9', '9', '9'], D); }) || ''), true);
eq('值域 2/3/4/5 → 报错', /tossVals\[0\]/.test(throws(function () { C.paipan([2, 3, 4, 5, 6, 7], D); }) || ''), true);
eq('null 元素 → 报错', /tossVals\[1\]/.test(throws(function () { C.paipan([1, null, 1, 1, 1, 1], D); }) || ''), true);
// 反向：四个合法值必须全部放行，且合法输入结果不变
eq('合法值不报错', throws(function () { C.paipan([1, 0, 9, 1, 0, 6], D); }), null);
eq('合法输入排盘结果不受校验影响', C.paipan([9, 1, 1, 1, 1, 1], D).benName, C.paipan([1, 1, 1, 1, 1, 1], D).benName);
eq('9（老阳）仍按阳爻起卦', C.paipan([9, 1, 1, 1, 1, 1], D).benName, '乾为天');

// ---------- 19. 非法日期给出准确错误（第二十一轮 C4） ----------
// 旧版 Invalid Date 会一路传到 termMoment 的边界断言，报出
// 「JIEQI_DELTAS 损坏：term #NaN 绝对分钟=undefined」——指向了错误的对象。
{
  const m = throws(function () { C.fourPillars(new Date('')); }) || '';
  eq('fourPillars 非法日期 → 报「须为有效 Date」', /须为有效 Date/.test(m), true);
  eq('fourPillars 非法日期 → 不再误指节气表', /JIEQI_DELTAS/.test(m), false);
  eq('fourPillars 非法日期 → 文案不含 NaN', /NaN/.test(m), false);
  eq('fourPillars 非 Date → 报错', /须为有效 Date/.test(throws(function () { C.fourPillars('2026-09-24'); }) || ''), true);
  eq('fourPillars 合法日期不受影响', C.fourPillars(D).monthGZ, '丁酉');
  eq('paipan 非法日期 → 报错', /须为有效 Date/.test(throws(function () { C.paipan([1, 0, 1, 1, 1, 0], new Date('')); }) || ''), true);
}

// ---------- 20. 契约锁定：bian 是「变卦同位爻的纳甲」（第二十一轮 C2 复核） ----------
// 十九轮报告曾把「静爻也有 bian」判为数据冗余并拟改为 null。复核发现那是**刻意设计**：
// 古籍排盘表的右半（变卦）对静爻位同样印出纳甲，tests/guji/lib/check.mjs 要逐位比对，
// tests/verify/regress.mjs 更明确写着「不能用『静爻应无 bian』来断言」。改掉会废掉
// 古籍回归的比对能力。此处锁定该语义，防止后人再按「冗余」误改。
{
  const p1 = C.paipan([9, 1, 1, 1, 1, 1], D);  // 乾为天，仅初爻（老阳）动 → 变天风姤
  eq('有动爻时，静爻位仍带 bian', p1.lines[1].moving === false && p1.lines[1].bian !== null, true);
  eq('变卦名：乾为天初爻动 → 天风姤', p1.bianName, '天风姤');
  eq('静爻位的 bian 取「变卦同位爻」而非本爻（姤二爻 = 辛亥）', p1.lines[1].bian.gan + p1.lines[1].bian.zhi, '辛亥');
  eq('该 bian 的六亲以本卦宫（乾金）论 → 亥水为子孙', p1.lines[1].bian.lq, '子孙');
  const p0 = C.paipan([1, 0, 1, 1, 1, 0], D);  // 泽火革，全静 → 无变卦
  eq('全静卦 → hasBian 为假', p0.hasBian, false);
  eq('全静卦 → 六爻 bian 皆为 null', p0.lines.every(function (l) { return l.bian === null; }), true);
}

console.log('PASS:', pass, ' FAIL:', fail);
if (fail > 0) process.exit(1);
