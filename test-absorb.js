/* ============================================================
 * 上层契约层自检 (test-absorb.js)
 * 覆盖：
 *   core/sensitive.js       敏感问题确定性分流（block / advisory / pass 三档）
 *   core/domain-methods.js  所测之事的分析方法注入（不得伪称古籍原文）
 *   core/fact-audit.js      断语事实一致性审计（只审显式盘面断言）
 *   core/analyze.js         应期三层（主应期 / 辅助节点 / 风险窗口）
 * 运行：npm run test:absorb
 *
 * 设计要点：这些层都「不参与排盘」，因此最容易写成恒真断言。
 * 每组都配反向对照（命中/未命中、写错/写对），确保断言本身会变红。
 * ============================================================ */
const C = require('./core.js');
let pass = 0, fail = 0;
function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; } else { fail++; console.log('FAIL', name, 'got=', JSON.stringify(got), 'want=', JSON.stringify(want)); }
}
function ok(name, cond) { eq(name, !!cond, true); }

// ---------- 1. 敏感分流 ----------
// 正常占问一律放行：不得因为「疾病」「手术」之外的普通用词误伤
eq('正常求财放行', C.classifySensitive('下季度业绩能不能达标').action, 'pass');
eq('正常求职放行', C.classifySensitive('这次跳槽去新公司合适吗').action, 'pass');
eq('空串放行（未填事由不起卦也不拦截）', C.classifySensitive('').action, 'pass');
eq('undefined 放行', C.classifySensitive(undefined).action, 'pass');

// block 档：五类各一例
eq('自伤→block', C.classifySensitive('我最近总想自杀').action, 'block');
eq('自伤→分类名', C.classifySensitive('我最近总想自杀').category, 'self_harm_or_violence');
eq('自伤→urgent 置位', C.classifySensitive('我最近总想自杀').urgent, true);
eq('胎儿性别→block', C.classifySensitive('能看出胎儿性别吗').action, 'block');
eq('胎儿→分类名', C.classifySensitive('能看出胎儿性别吗').category, 'pregnancy_or_child');
eq('确诊类→block', C.classifySensitive('医生确诊癌症，还能活多久').action, 'block');
eq('确诊类→分类名', C.classifySensitive('医生确诊癌症，还能活多久').category, 'medical_decision');
eq('失踪→block', C.classifySensitive('我爸失踪三天了，人在哪').action, 'block');
eq('失踪→分类名', C.classifySensitive('我爸失踪三天了，人在哪').category, 'missing_or_crime');
eq('倾家荡产→block', C.classifySensitive('借高利贷押上全部身家赌一把行不行').action, 'block');

// 误伤白名单：商事/职场语境里高频出现的歧义词，一律不得拦截。
// 这组词是「裸词拦截」的真实失败案例，收紧词表时不得把它们改回 block。
[
  '这条产线下月能不能生产',
  '新的生产项目能不能上马',
  '新工厂能不能顺利通过生产验收',
  '公司生死存亡之际，能不能翻盘',
  '这笔生意生死攸关',
  '项目晚期还能不能救回来',
  '产品已经到了生命周期晚期',
  '公司的生死线就看下季度'
].forEach(function (t) {
  eq('商事歧义词不得拦截：' + t, C.classifySensitive(t).action, 'pass');
});
// 收紧后的词表仍须拦住真正的医疗/孕产决策（漏拦回归）
eq('医疗语境仍拦：确诊癌症晚期', C.classifySensitive('父亲确诊癌症晚期，还能撑多久').action, 'block');
eq('医疗语境仍拦：生死未卜', C.classifySensitive('爷爷病危，生死未卜').action, 'block');
eq('孕产语境仍拦：能不能顺产', C.classifySensitive('预产期快到了，能不能顺产').action, 'block');

// advisory 档：一般健康可断卦，但必须带现实提示
eq('一般健康→advisory', C.classifySensitive('这病什么时候能康复').action, 'advisory');
eq('一般健康→分类名', C.classifySensitive('这病什么时候能康复').category, 'general_health');
ok('advisory 必带提示语', C.classifySensitive('这病什么时候能康复').message.length > 0);
ok('advisory 提示不得写成医学诊断', C.classifySensitive('这病什么时候能康复').message.indexOf('就医') >= 0);

// 命中顺序固定：同句同时命中「确诊」与「失踪」时，按 BLOCK_TERMS 的既定次序取前者，
// 不因对象遍历顺序产生结果漂移
eq('多类同命中→次序固定为 medical_decision',
  C.classifySensitive('确诊之后人失踪了').category, 'medical_decision');

// 反向对照：block 档不得误伤「生产项目」这类含敏感子串的正常问句
// （外部实现曾把「生产」列入拦截词，致求财问「生产项目」被拦；本仓不收该词）
eq('对照：「生产项目」不拦截', C.classifySensitive('新的生产项目能不能上马').action, 'pass');
eq('对照：「疾病」不在 block 词表（走 advisory）',
  C.classifySensitive('疾病何时痊愈').action, 'advisory');

// ---------- 2. 领域方法注入 ----------
const USE_VALUES = ['妻财', '官鬼', '父母', '子孙', '兄弟', 'shi', '__custom__'];
USE_VALUES.forEach(function (k) {
  ok('DOMAIN_METHODS 收录取值 ' + k, C.DOMAIN_METHODS[k]);
  ok('  ' + k + ' 有次序条目', C.DOMAIN_METHODS[k].order.length >= 3);
  ok('  ' + k + ' 有误判条目', C.DOMAIN_METHODS[k].pitfalls.length >= 1);
});
ok('domainBlock 含次序', C.domainBlock('妻财').indexOf('次序：') >= 0);
ok('domainBlock 含常见误判', C.domainBlock('妻财').indexOf('常见误判') >= 0);
// 关键声明：不得被当成古籍引文（本仓对「结论须引原文」有硬性口径）
ok('domainBlock 明示非古籍引文', C.domainBlock('妻财').indexOf('非古籍引文') >= 0);
ok('domainBlock 明示不预设吉凶', C.domainBlock('妻财').indexOf('不预设吉凶') >= 0);
eq('未收录取值→空串（不炸）', C.domainBlock('不存在的键'), '');
eq('自定义取值带入原文', C.domainBlock('__custom__', '能否跳槽').indexOf('能否跳槽') >= 0, true);
eq('意图→用神：求财', C.INTENT_YONGSHEN['求财'], '妻财');
eq('意图→用神：考试', C.INTENT_YONGSHEN['考试'], '父母');

// ---------- 3. 断语事实审计 ----------
// 水雷屯（坎宫二世，世在二爻、应在五爻），四爻发动 → 泽雷随
// 六亲（坎宫水）：初兄弟 / 二子孙 / 三官鬼 / 四父母 / 五官鬼 / 上兄弟
const panZZ = C.paipan([1, 0, 0, 6, 1, 0], new Date(2026, 8, 24, 9, 0));
eq('样本卦名', panZZ.benName, '水雷屯');
eq('样本变卦名', panZZ.bianName, '泽雷随');
eq('样本世位', C.LINE_NAMES[panZZ.shi], '二爻');

eq('全对：无冲突', C.auditFactClaims('本卦为水雷屯，三爻为官鬼，四爻发动，世爻在二爻。', panZZ).accepted, true);
eq('无显式断言：不报冲突', C.auditFactClaims('用神旺相，事体可图，宜速决。', panZZ).accepted, true);

const bad1 = C.auditFactClaims('初爻为妻财，受月建之生。', panZZ);
eq('六亲写错→报冲突', bad1.accepted, false);
eq('六亲冲突的实测值', bad1.errors[0].actual, '兄弟');
eq('六亲冲突的断语值', bad1.errors[0].claimed, '妻财');

const bad2 = C.auditFactClaims('世爻在三爻。', panZZ);
eq('世位写错→报冲突', bad2.accepted, false);
eq('世位冲突的实际值', bad2.errors[0].actual, '二爻');

const bad3 = C.auditFactClaims('本卦为火地晋，三爻为官鬼。', panZZ);
eq('卦名写错→报冲突', bad3.accepted, false);
eq('卦名冲突的实际值', bad3.errors[0].actual, '水雷屯');

const bad4 = C.auditFactClaims('五爻发动，化出回头克。', panZZ);
eq('动爻写错（实为安静）→报冲突', bad4.accepted, false);
eq('动爻冲突的实际值', bad4.errors[0].actual, '安静');

// 静卦不比对变卦名：静卦的 bianName 为 null，漏判会把「变卦：xxx」一律判错
const panJing = C.paipan([1, 0, 0, 0, 1, 0], new Date(2026, 8, 24, 9, 0));
eq('静卦样本无变卦名', panJing.bianName, null);
eq('静卦提到变卦不误报', C.auditFactClaims('变卦：无（静卦）', panJing).accepted, true);

// 审计边界：吉凶 / 应期 / 取象不在审计范围，须明示列出
const scope = C.auditFactClaims('此卦主凶，应期在明年春天。', panZZ);
ok('unrestricted 列明吉凶与应期不审',
  scope.unrestricted.indexOf('吉凶倾向') >= 0 && scope.unrestricted.indexOf('应期早晚') >= 0);

// 审计自身不得因缺参炸裂
eq('卦盘缺失→不报冲突（不炸）', C.auditFactClaims('三爻为妻财', null).accepted, true);

// ---------- 4. 应期三层 ----------
// 不变量：三层的并集必须逐项等于扁平 yingqiClues（顺序亦一致），
// 即「分层只是另归档，不新增也不丢失线索」——防止将来改规则时只改一边。
const TARGETS = ['妻财', '官鬼', '父母', '子孙', '兄弟', 'shi'];
const SAMPLES = [
  [1, 0, 0, 6, 1, 0], [9, 9, 9, 9, 9, 9], [6, 6, 6, 6, 6, 6],
  [1, 1, 0, 0, 1, 9], [0, 0, 1, 6, 0, 0], [9, 0, 1, 0, 1, 6]
];
let layerChecks = 0;
SAMPLES.forEach(function (vals, i) {
  const pan = C.paipan(vals.slice(), new Date(2026, 8, 24, 9, 0));
  TARGETS.forEach(function (t) {
    const r = C.analyze(pan, t);
    const flat = r.yingqiLayers.main.concat(r.yingqiLayers.auxiliary, r.yingqiLayers.risk);
    if (JSON.stringify(flat) !== JSON.stringify(r.yingqiClues)) {
      fail++;
      console.log('FAIL 应期三层并集≠扁平线索', i, t, JSON.stringify(flat), JSON.stringify(r.yingqiClues));
    } else { layerChecks++; }
  });
});
ok('应期三层与扁平线索逐案一致（' + layerChecks + ' 组）', layerChecks === SAMPLES.length * TARGETS.length);

// 待审分支（卦中无用神）也必须给出同形三层，消费侧可无条件读
const panNoUse = C.paipan([9, 9, 9, 9, 9, 9], new Date(2026, 8, 24, 9, 0));
const rNo = C.analyze(panNoUse, '妻财');
ok('待审分支仍有三层结构',
  Array.isArray(rNo.yingqiLayers.main) && Array.isArray(rNo.yingqiLayers.auxiliary) && Array.isArray(rNo.yingqiLayers.risk));

// ---------- 5. 审计容差（防误报回归） ----------
// 大模型几乎必然写成「本卦为水雷屯卦」：多一个「卦」字就整片误报，
// 会把「盘面校对」这块提示废掉（用户看到全是假告警就会无视真告警）。
eq('卦名带「卦」字尾不误报', C.auditFactClaims('本卦为' + panZZ.benName + '卦，' + '世爻在' + ['初', '二', '三', '四', '五', '上'][panZZ.shi] + '爻。', panZZ).accepted, true);
// 伏神同位：断语说某爻为某六亲，若该六亲正伏在此爻之下，说的是伏神而非写错。
const fuLine = panZZ.lines.findIndex(function (l) { return l.fu; });
if (fuLine >= 0) {
  const fuTxt = ['初', '二', '三', '四', '五', '上'][fuLine] + '爻为' + panZZ.lines[fuLine].fu.lq;
  eq('伏神同位不误报：' + fuTxt, C.auditFactClaims(fuTxt + '，伏而待引。', panZZ).accepted, true);
} else { ok('伏神同位用例跳过（本盘无伏神）', true); }

// ---------- 6. 自定义事由的用神建议 ----------
ok('求财事由推妻财', C.domainBlock('__custom__', '这笔投资能不能回款').indexOf('妻财') >= 0);
ok('考试事由推父母', C.domainBlock('__custom__', '这次考试能不能录取').indexOf('父母') >= 0);
ok('无语义线索时不强推用神', C.domainBlock('__custom__', '此事成否').indexOf('用神建议') < 0);
eq('固定事类不出现用神建议段', C.domainBlock('妻财', '').indexOf('用神建议') < 0, true);

// ---------- 7. 推理一致性审查（core/coverage-audit.js） ----------
// fact-audit 只管盘面写没写反；这一组管「推理走没走样」。
// 每组都配反向对照（说对→放行，说反→告警），确保断言本身会变红。
const D0 = new Date(2026, 8, 24, 9, 0);
const D1 = new Date(2026, 2, 15, 14, 0);
const D3 = new Date(2026, 10, 3, 16, 0);
function an(vals, target, d) { return C.analyze(C.paipan(vals, d || D0), target); }

// 真空 / 动不为空 / 旬空待时 —— 三态互斥
const kZhen = an([1, 0, 0, 0, 0, 9], '子孙');
const kDong = an([6, 9, 0, 0, 0, 1], '子孙');
const kDai = an([1, 6, 0, 1, 0, 0], '妻财');
eq('真空盘说「动不为空」→告警', C.auditCoverage('此爻动不为空，出空可用。', kZhen).accepted, false);
eq('真空盘说「真空」→放行', C.auditCoverage('用神安静无扶，是为真空。', kZhen).accepted, true);
eq('动空盘说「真空」→告警', C.auditCoverage('用神发动，然到底空。', kDong).accepted, false);
eq('动空盘说「出空即有用」→放行', C.auditCoverage('动不为空，出空之日即有用。', kDong).accepted, true);
eq('待时盘说「到底空」→告警', C.auditCoverage('用神到底空，终无成。', kDai).accepted, false);
eq('待时盘说「出空可应」→放行', C.auditCoverage('旺不惧空，出空之日可应。', kDai).accepted, true);

// 真破 / 假破
const pZhen = an([1, 1, 1, 6, 1, 9], '兄弟');
const pJia = an([0, 9, 0, 1, 0, 1], '子孙', D3);
eq('真破盘说「出月可解」→告警', C.auditCoverage('虽月破，出月可解。', pZhen).accepted, false);
eq('真破盘说「真破难扶」→放行', C.auditCoverage('休囚无救，真破难扶。', pZhen).accepted, true);
eq('假破盘说「真破」→告警', C.auditCoverage('真破难扶，事不可为。', pJia).accepted, false);
eq('假破盘说「假破」→放行', C.auditCoverage('旺相为假破，出月可解。', pJia).accepted, true);

// 暗动 / 日破 —— 六爻最高频的一步之差
const andong = an([0, 1, 0, 6, 6, 1], '兄弟', D1);
const ripo = an([1, 1, 0, 1, 1, 0], 'shi');
eq('暗动盘说「日破」→告警', C.auditCoverage('此爻日破，败象已成。', andong).accepted, false);
eq('暗动盘说「暗动」→放行', C.auditCoverage('旺相被日辰冲之，为暗动。', andong).accepted, true);
eq('日破盘说「暗动」→告警', C.auditCoverage('此爻暗动，事机已萌。', ripo).accepted, false);
eq('日破盘说「日破」→放行', C.auditCoverage('休囚被日辰冲之，为日破。', ripo).accepted, true);

// 无此结构而断言
const noPo = an([1, 6, 0, 1, 0, 0], '妻财');
const hasPoTag = noPo.judgments.some(function (j) { return j.tag === '月破'; });
eq('样本前提：该盘确无月破', hasPoTag, false);
eq('无月破却断言「月破」→告警', C.auditCoverage('用神月破，凶。', noPo).accepted, false);

// 用神一致性
eq('取用与卦盘不符→告警', C.auditCoverage('以妻财为用神观之。', ripo).accepted, false);
eq('取用与卦盘相符→放行',
  C.auditCoverage('以' + ripo.yongshen.type + '为用神观之。', ripo).accepted, true);
eq('未明说取用→不审（不误报）', C.auditCoverage('用神旺相，可图。', ripo).yongshen, null);

// 结构遗漏属软提示：进 missing，不进 conflicts
const withFu = an([1, 0, 0, 0, 0, 9], '官鬼');
const hasFuTag = withFu.judgments.some(function (j) { return j.tag === '伏神'; });
if (hasFuTag) {
  const r = C.auditCoverage('世爻旺相，事可成。', withFu);
  ok('漏提伏神→记入 missing', r.missing.some(function (x) { return x.tag === '伏神'; }));
  eq('漏审不算冲突（软提示，不染红）', r.accepted, true);
} else { ok('伏神样本跳过（该盘无伏神判语）', true); }

// 边界：不得因输入异常而崩，也不得无中生有
eq('空断语→放行', C.auditCoverage('', withFu).accepted, true);
eq('无判语可对照→放行', C.auditCoverage('随便写点什么。', { judgments: [] }).accepted, true);
eq('null 判语→放行（不炸）', C.auditCoverage('用神旺相。', null).accepted, true);
eq('无冲突且无遗漏→提示文本为空串', C.coverageText({ accepted: true, conflicts: [], missing: [] }), '');
// 漏审只给「提醒」措辞，不得出现告警口径——否则用户会把提醒当错误，真告警反被无视
const missOnly = C.auditCoverage('世爻旺相，事可成。', withFu);
if (missOnly.missing.length) {
  const t = C.coverageText(missOnly);
  ok('纯遗漏提示不含告警字样', t.indexOf('相左') < 0);
  ok('纯遗漏提示说明是漏审', t.indexOf('漏审') >= 0);
} else { ok('纯遗漏用例跳过', true); }

console.log('PASS:', pass, ' FAIL:', fail);
if (fail > 0) process.exit(1);
