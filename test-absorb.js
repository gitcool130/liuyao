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

// 变卦语境：模型描述「变卦三爻为子孙」时比的是变卦同位爻，不得拿本卦六亲判成写错。
const P6 = ['初', '二', '三', '四', '五', '上'];
const bianLine = panZZ.lines.findIndex(function (l) { return l.bian && l.bian.lq !== l.lq; });
ok('样本盘存在六亲不同的变爻位（否则本组无判别力）', bianLine >= 0);
if (bianLine >= 0) {
  const bLq = panZZ.lines[bianLine].bian.lq;
  const nLq = panZZ.lines[bianLine].lq;
  eq('变卦六亲不误报：' + P6[bianLine] + '爻为' + bLq,
    C.auditFactClaims('变卦' + P6[bianLine] + '爻为' + bLq + '。', panZZ).accepted, true);
  // 反向对照：变卦语境下写成第三种六亲，仍须报冲突——豁免不能变成整段放行。
  const other = ['父母', '兄弟', '子孙', '妻财', '官鬼'].filter(function (x) { return x !== bLq; })[0];
  eq('变卦语境仍审六亲：' + P6[bianLine] + '爻为' + other + '→报冲突',
    C.auditFactClaims('变卦' + P6[bianLine] + '爻为' + other + '。', panZZ).accepted, false);
  // 同句并列时各归各：前句说变卦、后句说本卦，不能被前一句的语境带偏。
  eq('同句本卦/变卦各归各',
    C.auditFactClaims('变卦' + P6[bianLine] + '爻为' + bLq + '，本卦' + P6[bianLine] + '爻为' + nLq + '。', panZZ).accepted, true);
}

// 书名号/引号：模型引经据典时普遍写成《泽天夬》，旧版把每个正确卦名都判成不符。
eq('卦名带书名号不误报',
  C.auditFactClaims('本卦为《' + panZZ.benName + '》，变卦为《' + panZZ.bianName + '》。', panZZ).accepted, true);
eq('卦名带直角引号不误报',
  C.auditFactClaims('本卦为「' + panZZ.benName + '」。', panZZ).accepted, true);
// 反向对照：书名号里写错卦名，仍须报冲突。
eq('书名号内卦名写错仍报冲突',
  C.auditFactClaims('本卦为《火地晋》。', panZZ).accepted, false);

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
// 后置否定（2026-10-21 扩样本实测误报）：断语写「月破无」是在说**没有**月破，
// 旧版只看前置 3 字，把它当成断言月破 → 无中生有误报。
eq('「月破无」→放行（后置否定）', C.auditCoverage('月建戌，日辰辰，旬空戌亥；月破无。', noPo).accepted, true);
eq('「月破，无救」不算后置否定→仍告警',
  C.auditCoverage('用神月破，无救，凶。', noPo).accepted, false);
eq('「旬空不见」→放行（后置否定）', C.auditCoverage('全盘旬空不见。', ripo).accepted, true);

// 引述古法：断语先引条文再说不适用，是正确写法，不得判「概念误置」。
// 实测一轮 14 条断语里 7 条栽在这条上，把要素错误率抬到 43%。
eq('引文+「皆不适用」→放行',
  C.auditCoverage('《卜筮正宗》谓“旺不为空，动不为空”。今用神安静，故“动不为空”“旺不惧空”皆不适用。', kZhen).accepted, true);
eq('无引号的真断言→仍告警', C.auditCoverage('此卦旺不为空，可言有成。', kZhen).accepted, false);
// 列表标题：「月破：」只是小标题，真正的陈述在冒号之后
eq('标题「月破：盘面未列」→放行', C.auditCoverage('- 月破：盘面未列爻逢月破；', noPo).accepted, true);
eq('「卦中无爻逢月破」→放行（否定距词 5 字）', C.auditCoverage('- 旬空月破：旬空戌亥；卦中无爻逢月破。', noPo).accepted, true);

// 用神一致性
eq('取用与卦盘不符→告警', C.auditCoverage('以妻财为用神观之。', ripo).accepted, false);
eq('取用与卦盘相符→放行',
  C.auditCoverage('以' + ripo.yongshen.type + '为用神观之。', ripo).accepted, true);
eq('未明说取用→不审（不误报）', C.auditCoverage('用神旺相，可图。', ripo).yongshen, null);

// ---------- 7b. 两处真实断语硬伤（语料来自 2026-10-21 实测一次断卦） ----------
// 坤为地（六冲）之水风井，二三五爻动；月建戌、日辰辰、旬空戌亥，
// 用神父母巳在二爻（动、化亥回头克）。同一张盘、同一模型，两次断语结论相反
// （平 / 凶），且第二版有两处硬伤：静爻论「受日月冲动」、一事两体（父母/官鬼）。
// 这两类旧版审计全部放行 —— 因此在此锁定，往后必须能变红。
const kDa = new Date(2026, 9, 21, 12, 1);
const PDP = C.paipan([0, 6, 6, 0, 6, 0], kDa);
const kDaA = C.analyze(PDP, '父母');
function cov(t) { return C.auditCoverage(t, kDaA, PDP); }
function hasType(r, t) { return r.conflicts.some(function (c) { return c.type === t; }); }

eq('样本前提：本卦坤为地且为六冲', PDP.benName + '/' + (PDP.isLiuChong ? '六冲' : '非冲'), '坤为地/六冲');
eq('样本前提：用神取父母巳在二爻', kDaA.yongshen.type + '@' + kDaA.yongshen.line.pos, '父母@1');
eq('样本前提：初、四爻为静，三五爻为动',
  [PDP.lines[0].moving, PDP.lines[3].moving, PDP.lines[2].moving, PDP.lines[4].moving],
  [false, false, true, true]);

// 静爻论冲 —— 静爻逢冲只有暗动/日破/月破，没有「受日月冲动」这一说
eq('静爻说「受日辰月建冲动」→告警',
  hasType(cov('四爻兄弟癸丑土、初爻兄弟乙未土受日辰月建冲动。'), '静爻论冲'), true);
eq('静爻说「受日辰冲动」而判日破→放行（术语已对）',
  hasType(cov('初爻兄弟乙未安静受日辰冲之，为日破。'), '静爻论冲'), false);
eq('动爻说「受日辰冲动」→放行（动爻本可受冲）',
  hasType(cov('三爻官鬼乙卯受日辰冲动。'), '静爻论冲'), false);
eq('未提具体爻位→不审（不误报）',
  hasType(cov('卦中静爻若受日辰月建冲动，则事有反复。'), '静爻论冲'), false);

// 取用两说 —— 同一事之体判给两个六亲，用神不唯一，后文生克全落空
eq('「父母为用神」+「应爻官鬼为所测项目之体」→告警',
  hasType(cov('取二爻父母乙巳火为用神。应爻官鬼乙卯木为所测项目之体。'), '取用两说'), true);
eq('只说一处取用→不告警',
  hasType(cov('取二爻父母乙巳火为用神，观其旺衰。'), '取用两说'), false);
eq('用神+忌神并存不算两说（角色词豁免）',
  hasType(cov('取父母为用神，妻财为忌神。'), '取用两说'), false);


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

// ---------- 8. 覆盖率审查的误报豁免（第二轮审计修复） ----------
// 这一组是「豁免过头」与「豁免不足」的双向断言：改任何一边都应变红。

// 否定句式：「非真空」「并非日破」「幸无月破」都是正确断语，不得当反向断言。
// 实测：旧版把「非真空也」报成真空冲突、「非日破也，实为暗动」报成日破冲突。
eq('否定「非真空」→放行', C.auditCoverage('此爻发动值空，动不为空，非真空也。', kDong).accepted, true);
eq('否定「非日破」→放行', C.auditCoverage('旺相逢冲，非日破也，实为暗动。', andong).accepted, true);
eq('否定「幸无月破」→放行', C.auditCoverage('用神无伤，幸无月破。', noPo).accepted, true);
// 肯定句照拦（防豁免过头）
eq('肯定「到底空」照拦', C.auditCoverage('用神发动，然到底空。', kDong).accepted, false);
eq('肯定「月破」照拦', C.auditCoverage('用神月破，凶。', noPo).accepted, false);

// 全盘结构豁免：analyze 只判用神一线，judgments 无某 tag ≠ 全盘无该结构。
// 断语谈非用神爻的旬空/月破/日冲完全合法——第三参 pan 给了之后才查得出来。
// 样本：震为雷 [1,6,0,1,0,0]@D0，三爻辰值旬空（kong=[4,5]）；取官鬼为用时
// 用神在五爻申，不临空，judgments 无旬空 tag。
const panKong = C.paipan([1, 6, 0, 1, 0, 0], D0);
const anGG = C.analyze(panKong, '官鬼');
eq('豁免样本前提：用神无旬空判语',
  anGG.judgments.some(function (j) { return j.tag === '旬空'; }), false);
eq('豁免样本前提：三爻（非用神）值旬空', panKong.lines[2].zhiIdx, 4);
eq('断语谈非用神爻旬空→放行（有 pan）',
  C.auditCoverage('三爻值旬空，无力。', anGG, panKong).accepted, true);
const stillBad = C.auditCoverage('三爻逢月破。', anGG, panKong);
eq('全盘皆无月破→照拦（有 pan）', stillBad.accepted, false);
ok('有 pan 时告警文案升级为「全盘六爻皆无」',
  stillBad.conflicts.length > 0 && stillBad.conflicts[0].actual.indexOf('全盘六爻皆无') >= 0);
eq('无 pan→退回旧行为（仍按 judgments 告警）',
  C.auditCoverage('三爻值旬空。', anGG).accepted, false);

// 用神角色词豁免：「以X为忌神/为原神/为仇神」说的是忌原仇，不是取用。
// 实测：旧版把「以官鬼为忌神」报成「用神不一致」。
eq('「以官鬼为忌神」→不审用神', C.auditCoverage('以官鬼为忌神，忌神发动则忧。', ripo).yongshen, null);
eq('「取父母为原神」→不审用神', C.auditCoverage('取父母为原神，原神有力。', ripo).yongshen, null);
eq('正常取用仍审（防豁免过头）', C.auditCoverage('以妻财为用神观之。', ripo).accepted, false);

// ---------- 静卦路径（2026-10-17）----------
// 静卦（六爻皆静）没有变卦。旧版两处退化：
//   ①「变卦三爻为X」因 L.bian 为空而回落到本卦，报出「实为<本卦六亲>」——把
//      「凭空造盘」误报成「六亲写反」，用户读到的 actual 完全误导；
//   ②「变卦为X」因 bianName 为空被 `if (!pair[1]) return` 整段跳过，静默放行。
const panJingNew = C.paipan([1, 1, 0, 0, 1, 0], new Date(2026, 9, 17, 22, 30));
eq('静卦样本：无变卦', panJingNew.hasBian, false);
eq('静卦样本：卦名', panJingNew.benName, '水泽节');

const j1 = C.auditFactClaims('变卦三爻为兄弟。', panJingNew);
eq('静卦提变卦六亲→报冲突', j1.accepted, false);
ok('静卦提变卦六亲→提示「无变卦」而非本卦六亲',
  j1.errors.length > 0 && j1.errors[0].actual.indexOf('无变卦') >= 0);

const j2 = C.auditFactClaims('变卦为天风姤。', panJingNew);
eq('静卦凭空给变卦名→报冲突', j2.accepted, false);
ok('静卦凭空给变卦名→提示「无变卦」',
  j2.errors.length > 0 && j2.errors[0].actual.indexOf('无变卦') >= 0);

eq('静卦说「变卦无」→不误报',
  C.auditFactClaims('此卦六爻皆静，变卦无。', panJingNew).accepted, true);
eq('动卦提变卦六亲仍照常比对（防修过头）',
  C.auditFactClaims('变卦三爻为兄弟。', panZZ).accepted, false);

// ---------- 旬空校验（2026-10-17）----------
// 此前审计器完全不看旬空：模型说「父母持世空亡」或「世爻不空」都无人对撞。
const panDaNew = C.paipan([0, 1, 1, 1, 1, 0], new Date(2026, 9, 17, 22, 30)); // 泽风大过，世四爻亥，戌亥空
eq('大过样本：卦名', panDaNew.benName, '泽风大过');
eq('大过样本：世在四爻', C.LINE_NAMES[panDaNew.shi], '四爻');
eq('大过样本：世爻亥值旬空', panDaNew.pillars.kong.indexOf(panDaNew.lines[panDaNew.shi].zhiIdx) >= 0, true);

eq('世爻实空，断语作旬空→放行',
  C.auditFactClaims('父母持世，世爻旬空，出空之日应。', panDaNew).accepted, true);
const k1 = C.auditFactClaims('世爻不空，旺而可用。', panDaNew);
eq('世爻实空，断语作不空→报冲突', k1.accepted, false);
ok('旬空冲突带出空亡地支', k1.errors.length > 0 && k1.errors[0].actual.indexOf('戌亥') >= 0);
eq('初爻不空，断语作旬空→报冲突',
  C.auditFactClaims('初爻旬空，无力。', panDaNew).accepted, false);
eq('审计覆盖项含旬空',
  C.auditFactClaims('', panDaNew).checked.indexOf('旬空') >= 0, true);
eq('「用神旬空」不在本层审（需 analyze，防越界）',
  C.auditFactClaims('用神旬空，须待出空。', panDaNew).accepted, true);

// ---------- 「用神克世」按占类分流（2026-10-17）----------
// 《黄金策》「用克世勿作凶看……占求财财爻克世者必得；占行人即归；占医药子孙克世者即愈……
// 若占功名，官鬼克世，非祸即灾」。旧版文案固定为「事与己有碍，宜谨慎」，模型据此
// 一概断凶——guji 用例 zsby-1406（求财，书断「许之必得」）即因此被判反。
const panKS = C.paipan([1, 1, 1, 0, 1, 1], D0);   // 风天小畜，妻财克世
const ksJ = function (target, opts) {
  return (C.analyze(panKS, target, opts).judgments || []).filter(function (j) { return j.rule === '用神克世'; })[0];
};
eq('克世样本：确有用神克世判语', !!ksJ('妻财'), true);
ok('无 topic → 给出四类书证并禁止一概断凶',
  /随占类翻转/.test(ksJ('妻财').text) && /不得一概断凶/.test(ksJ('妻财').text));
ok('求财 → 明言「财爻克世者必得」',
  /必得/.test(ksJ('妻财', { topic: '这笔投资能不能回款' }).text) &&
  !/有碍/.test(ksJ('妻财', { topic: '这笔投资能不能回款' }).text));
ok('行人 → 明言「即归」', /即归/.test(ksJ('妻财', { topic: '他什么时候回来' }).text));
const ksBing = ksJ('妻财', { topic: '这个病什么时候好' });
ok('占病取错用神 → 提示复核取用，不套用鬼克世',
  /复核取用/.test(ksBing.text) && !/官鬼克世/.test(ksBing.text));
ok('旧文案「事与己有碍」已不再出现',
  C.analyze(panKS, '妻财').bullets.join('').indexOf('事与己有碍') < 0);

const panGG = C.paipan([1, 1, 1, 0, 0, 0], D0);   // 地天泰，官鬼克世
const ggJ = function (opts) {
  return (C.analyze(panGG, '官鬼', opts).judgments || []).filter(function (j) { return j.rule === '用神克世'; })[0];
};
eq('官鬼克世样本：成立', !!ggJ(), true);
ok('功名 + 官鬼 → 明言「非祸即灾」', /非祸即灾/.test(ggJ({ topic: '这次考试能不能过' }).text));
ok('占病 + 官鬼 → 明言「缠绵」，不套功名口径',
  /缠绵/.test(ggJ({ topic: '这个病什么时候好' }).text) &&
  !/非祸即灾/.test(ggJ({ topic: '这个病什么时候好' }).text));

// ---------- 9. 问法形态检测（core/question-shape.js） ----------
// 「多选一」问法是断语分歧的重灾区：卦面无专爻代表各选项，两模型各执
// 一象必得相反建议（2026-10-21 实测：换医生 vs 不换医生）。本层只提示
// 改问（趋势题 / 定向假设题 / 决策树），永不拦截——所有用例双向对照。
const qs3 = C.questionShape('是换医生还是不换还是先不治疗了');
eq('三选一→multi', qs3.shape, 'multi');
eq('三选一选项拆分', JSON.stringify(qs3.options), JSON.stringify(['换医生', '不换', '先不治疗']));
eq('并列选项（还是×2）→multi', C.questionShape('换医生还是换药还是继续等').shape, 'multi');
eq('或者×2→multi', C.questionShape('换医生或者换药或者继续等').shape, 'multi');
eq('单个还是→either-or', C.questionShape('换工作还是留在原公司').shape, 'either-or');
eq('「A还是不A」句式→either-or', C.questionShape('换医生还是不换医生').shape, 'either-or');
eq('「该不该」→should-i', C.questionShape('该不该换医生').shape, 'should-i');
eq('「要不要」→should-i', C.questionShape('要不要跳槽').shape, 'should-i');
// 误伤对照（反向断言，防检测写过头——副词「还是」与趋势题问法不得报）
eq('副词「他还是不回」不误报', C.questionShape('他还是不回消息，这单能成吗').shape, null);
eq('句首「还是算了」不误报', C.questionShape('还是算了吧，看这一卦就好').shape, null);
eq('「能不能」不误报（趋势题本来就是这个问法）', C.questionShape('这笔投资能不能回款').shape, null);
eq('开放式「怎么办」不误报', C.questionShape('当下该怎么办').shape, null);
eq('空串不炸', C.questionShape('').shape, null);
eq('null 不炸', C.questionShape(null).shape, null);
// 提示与入模指令的内容契约
ok('multi 提示含三条改法（趋势/定向假设/决策树）',
  /趋势/.test(qs3.hint) && /定向假设/.test(qs3.hint) && /决策树/.test(qs3.hint));
ok('multi 入模指令含条件分支与不站队',
  qs3.aiNote.indexOf('条件分支') >= 0 && qs3.aiNote.indexOf('不得强制站队') >= 0);
ok('should-i 也有改写建议', C.questionShape('该不该换医生').hint.length > 0);
ok('should-i 入模指令要求先断走势', C.questionShape('该不该换医生').aiNote.indexOf('走势') >= 0);
ok('正常问法无提示无指令', !C.questionShape('这笔投资能不能回款').hint && !C.questionShape('这笔投资能不能回款').aiNote);
ok('questionShapeText：multi 有文，正常问法为空串',
  C.questionShapeText(qs3).indexOf('问法提示') >= 0 && C.questionShapeText(C.questionShape('这笔投资能不能回款')) === '');

console.log('PASS:', pass, ' FAIL:', fail);
if (fail > 0) process.exit(1);
