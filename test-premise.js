/* 前提元数据 / 缺项分级 / 应期同域 / 应期撤回 自检（M21）
 *
 * 这一层是 2026-10-27 事故的修法：问「今年能不能考上市重点」时，模型把「今年」
 * 当本招生年度、把应期写成「甲子日」——跨年之事给了日级刻度。根因是排盘文本里
 * 没有刻度，模型只能默认。本文件锁住三件事：
 *   ① 五类通用前提的判定与缺项分级（与领域无关，领域包只实例化叫法）；
 *   ② 应期粒度不得细于事项跨度；
 *   ③ 撤回模板与同盘追问提示（不得静默改写应期）。
 * 断言刻意用**多个领域**的例子（升学／诉讼／求职／健康／交易／短讯），
 * 防止把某一领域的槽位写成通用规则。
 */
const fs = require('fs');
const path = require('path');
require('./public/core/domain-methods.js');
require('./public/core/premise.js');

const P = globalThis.LY.premise;
const DM = globalThis.LY.DOMAIN_METHODS;
let pass = 0, fail = 0;
function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; } else { fail++; console.log('FAIL', name, 'got=', got, 'want=', want); }
}
function has(name, hay, needle) {
  const ok = String(hay).indexOf(needle) >= 0;
  if (ok) { pass++; } else { fail++; console.log('FAIL', name, 'missing=', needle); }
}

// ---------- §1 时间跨度判定（五档刻度 + 反向对照） ----------
eq('跨度·今天→日', P.spanOf('今天下午能收到回复吗').unit, 'day');
eq('跨度·明天→日', P.spanOf('明天面试结果会出吗').unit, 'day');
eq('跨度·这周→旬', P.spanOf('这周会不会来电').unit, 'xun');
eq('跨度·下周→旬', P.spanOf('下周能签吗').unit, 'xun');
eq('跨度·半个月→旬（不被「月」抢走）', P.spanOf('半个月内能到账吗').unit, 'xun');
eq('跨度·下个月→月', P.spanOf('下个月能签合同吗').unit, 'month');
eq('跨度·月底→月', P.spanOf('月底前能批下来吗').unit, 'month');
eq('跨度·这学期→季（不被「月」抢走）', P.spanOf('这学期成绩能提上来吗').unit, 'season');
eq('跨度·半年→季（不被「年」抢走）', P.spanOf('半年内能回本吗').unit, 'season');
eq('跨度·今年→年', P.spanOf('今年能不能考上市重点').unit, 'year');
eq('跨度·明年→年', P.spanOf('明年能调到总行吗').unit, 'year');
eq('跨度·没给→unknown', P.spanOf('这事能成吗').unit, 'unknown');
eq('跨度·空题面→unknown', P.spanOf('').unit, 'unknown');
eq('跨度·命中词回填', P.spanOf('今年能不能考上市重点').hit, '今年');
eq('跨度·日历词标记', P.spanOf('今年能不能考上市重点').calendar, true);
eq('跨度·非日历词不标记', P.spanOf('半年内能回本吗').calendar, false);

// ---------- §2 五类槽位与缺项分级（多领域，防单领域硬编码） ----------
// 升学案例：span=年、目标只见「考上」未见门槛、有口径歧义。
// 2026-10-27 修订：此处原断言「无高风险缺项（不拦结论）」，与需求相反——
// 「今年能不能考上市重点」只说考上、不知门槛与阶段，正是当初出问题的原始案例。
// 旧实现把「部分明示」一律降为 mid，于是最该拦的案例反倒只给「如需补充」，
// 模型照样给单一结论与日级应期。现改为：部分明示+本类关键+目标类问法 → high。
const edu = P.judge('今年能不能考上市重点', '__custom__');
eq('升学·跨度年', edu.span.unit, 'year');
eq('升学·领域包按事由命中', edu.pack.label, '升学');
eq('升学·口径歧义成立（招生年度≠自然年）', !!edu.ambiguity, true);
has('升学·歧义说明含招生年度', edu.ambiguity.note, '招生年度');
eq('升学·高风险含对象阶段与目标标准', edu.high.map(function (x) { return x.label; }).join(','), '对象阶段,目标标准');
eq('升学·完整性=缺失（有高风险缺项）', edu.completeness, '缺失');
// 古法依据：高风险缺项须能追溯到原文，而不是只说「工程规则要求」
has('升学·预检块给古法依据', P.block('今年能不能考上市重点', '__custom__'), '古法依据');
has('升学·对象阶段引远近当分', P.block('今年能不能考上市重点', '__custom__'), '远事定之以年月');
has('升学·目标标准引所指之疑', P.block('今年能不能考上市重点', '__custom__'), '须指其所疑之事而占之');
// 反向守护：短讯无门槛、属二元事件，缺「目标标准」不升级，不得被误伤
eq('短讯·无高风险缺项（不误伤）', P.judge('这周会不会来电', '父母').high.length, 0);
eq('短讯·预检块不写古法依据', P.block('这周会不会来电', '父母').indexOf('古法依据'), -1);
eq('升学·目标标准为部分明示', edu.slots.filter(s => s.id === 'standard')[0].partial, true);

// 短讯案例：旬内二元事件，缺「目标标准」不算高风险——否则每句「会不会」都要先追问。
const call = P.judge('这周会不会来电', '父母');
eq('短讯·旬', call.span.unit, 'xun');
eq('短讯·缺门槛不升为高风险', call.high.length, 0);
eq('短讯·旬刻度无口径歧义', call.ambiguity, null);

// 诉讼案例：进程状态是断法前提，缺了必须给分支。
const sue = P.judge('官司什么时候能了结', '官鬼');
eq('诉讼·跨度未明示', sue.span.unit, 'unknown');
eq('诉讼·高风险=进程状态', sue.high.map(s => s.id), ['process']);
eq('诉讼·完整性=缺失', sue.completeness, '缺失');
eq('诉讼·未知跨度按本类典型刻度兜底', sue.effUnit, 'month');
eq('诉讼·兜底标记', sue.spanFromPack, true);

// 求职／健康／交易：关键词包各自命中且互不串味。
eq('求职·包命中', P.judge('这个月面试能过吗', '__custom__').pack.label, '求职');
eq('健康·包命中', P.judge('手术后多久能康复', '__custom__').pack.label, '健康');
eq('交易·包命中', P.judge('这批货款什么时候能回来', '__custom__').pack.label, '交易');
eq('感情·包命中', P.judge('我们还有可能复合吗', '__custom__').pack.label, '感情');

// 目标类问法：有门槛的才算高风险（「下个月能签合同吗」缺门槛 → 高风险）。
eq('目标类·高风险=目标标准', P.judge('下个月能签合同吗', '父母').high.map(s => s.id), ['standard']);
// 反向对照：同样缺门槛，但不是目标类问法 → 不升高风险。
eq('对照·非目标类不升高风险', P.judge('下个月他会主动联系我吗', '父母').high.length, 0);

// 空题面：不注入、不抛。
eq('空题面·block 返回空串', P.block('  ', '父母'), '');
eq('空题面·judge 不抛', (function () { try { P.judge('', '父母'); return 'ok'; } catch (e) { return 'throw'; } })(), 'ok');

// 预检块文本契约
const blk = P.block('今年能不能考上市重点', '__custom__');
has('预检块·标题', blk, '【前提预检（规则链 · 非推断）】');
has('预检块·时间刻度', blk, '以「年」为刻度');
has('预检块·口径歧义', blk, '口径歧义');
has('预检块·应期同域要求', blk, '不得写具体干支日');
has('预检块·未明示跨度时要求写假设', P.block('官司什么时候能了结', '官鬼'), '须在正文写明此假设');

// ---------- §3 应期同域校验 ----------
const yearSpan = P.spanOf('今年能不能考上市重点');
const monthSpan = P.spanOf('下个月能签合同吗');
const xunSpan = P.spanOf('这周会不会来电');
eq('同域·年+干支日=硬违反', P.checkYingqi('甲子日', yearSpan).code, 'YINGQI_TOO_FINE');
eq('同域·年+干支日为violation级', P.checkYingqi('甲子日', yearSpan).level, 'violation');
eq('同域·年+月份=通过', P.checkYingqi('11月中旬（约 11月10日—11月20日）', yearSpan).ok, true);
eq('同域·年+流程节点=通过', P.checkYingqi('录取批次公布时（约 7月上旬）', yearSpan).ok, true);
eq('同域·月+裸干支日=警告', P.checkYingqi('甲子日', monthSpan).level, 'warn');
eq('同域·月+干支日带公历区间=通过', P.checkYingqi('癸未日前后（第12–14日，11月5日—11月7日）', monthSpan).ok, true);
eq('同域·旬+干支日=通过', P.checkYingqi('甲子日', xunSpan).ok, true);
eq('同域·旬+年份=尺度过粗', P.checkYingqi('2027年', xunSpan).code, 'YINGQI_TOO_COARSE');
eq('同域·空应期不报', P.checkYingqi('', yearSpan).ok, true);
eq('同域·null 不抛', P.checkYingqi(null, yearSpan).ok, true);
eq('同域·未知跨度不报', P.checkYingqi('甲子日', { unit: 'unknown' }).ok, true);
// judge 结果也能直接喂进去（取 effUnit 兜底刻度）
eq('同域·judge 结果可直用', P.checkYingqi('甲子日', P.judge('官司什么时候能了结', '官鬼')).ok, false);
// 与引擎应期窗口的和解：引擎窗口本身是「干支日＋公历区间」的日级节点，跨年之事
// 引用它作**辅**不算错，只要主刻度是月／季／流程节点。混为一谈会误伤引擎的常规输出。
eq('同域·年+干支日+月份=只作辅（warn 非 violation）', P.checkYingqi('癸未日前后（约 11月5日—11月7日）', yearSpan).code, 'YINGQI_DAY_AS_AUX');
eq('同域·年+干支日+月份仍不算通过', P.checkYingqi('癸未日前后（约 11月5日—11月7日）', yearSpan).ok, false);
eq('同域·月刻度不受粗刻度放行影响', P.checkYingqi('甲子日前后（11月5日—11月7日）', monthSpan).ok, true);
// 预检块的和解行只在调用方声明「带日级节点窗口」时出现
has('预检块·声明日级窗口时给和解说明', P.block('今年能不能考上市重点', '__custom__', { dayNodeWindow: true }), '与【应期窗口】的关系');
eq('预检块·未声明时不写和解行', P.block('今年能不能考上市重点', '__custom__').indexOf('与【应期窗口】的关系'), -1);
eq('预检块·月刻度不写和解行', P.block('下个月能签合同吗', '父母', { dayNodeWindow: true }).indexOf('与【应期窗口】的关系'), -1);

// ---------- §4 撤回模板与同盘追问 ----------
const wd = P.withdraw('甲子日', '题面已明确为明年招生年度', '年');
has('撤回·含作废', wd, '作废');
has('撤回·含原应期', wd, '甲子日');
has('撤回·含同域粒度', wd, '年 刻度');
has('撤回·要求另起一卦', wd, '需另起一卦重断');
has('撤回·空参数不炸', P.withdraw('', '', ''), '作废');

const hint = P.followUpHint({ yingqi: '甲子日', spanUnit: 'day' }, '不是这几天，是明年考');
has('追问·跨度改变→提示', hint, '上一轮的应期');
has('追问·提示要求撤回', hint, '应期撤回');
eq('追问·跨度未变→不提示', P.followUpHint({ yingqi: '甲子日', spanUnit: 'year' }, '明年能考上吗'), '');
eq('追问·无原应期→不提示', P.followUpHint({}, '明年能考上吗'), '');
eq('追问·空入参不抛', P.followUpHint(null, 'x'), '');

// ---------- §5 领域适配包是配置，不是硬编码 ----------
const USE_KEYS = ['妻财', '官鬼', '父母', '子孙', '兄弟', 'shi', '__custom__'];
USE_KEYS.forEach(function (k) {
  const m = DM[k];
  eq('领域包存在·' + k, !!(m && m.premise), true);
  eq('领域包字段齐全·' + k,
    ['anchors', 'decisive', 'typicalSpan'].every(function (f) { return Object.prototype.hasOwnProperty.call(m.premise, f); }), true);
  eq('领域包刻度合法·' + k, Object.prototype.hasOwnProperty.call(P.UNITS, m.premise.typicalSpan), true);
});
eq('关键词包≥5 个（升学只是其中之一）', P.KEYWORD_PACKS.length >= 5, true);
eq('关键词包都有 name/re/pack', P.KEYWORD_PACKS.every(function (k) {
  return k.name && k.re instanceof RegExp && k.pack && k.pack.typicalSpan;
}), true);

// ---------- §6 提示词与页面契约 ----------
const promptSrc = fs.readFileSync(path.join(__dirname, 'functions/api/interpret.js'), 'utf8');
const appSrc = fs.readFileSync(path.join(__dirname, 'public/app.js'), 'utf8');
const htmlSrc = fs.readFileSync(path.join(__dirname, 'public/index.html'), 'utf8');
['【前提元数据】', '【缺项分级】', '【应期同域】', '【应期撤回】'].forEach(function (m) {
  has('interpret.js 含契约段 ' + m, promptSrc, m);
  has('app.js 含契约段 ' + m, appSrc, m);
});
has('两份提示词都要求输出前提完整性行', promptSrc, "'前提完整性：");
has('app.js 也要求输出前提完整性行', appSrc, "'前提完整性：");
has('结构化结论为五行', promptSrc, '另起五行');
// 通用段不得把升学写成规范槽位表：必须有「领域适配包」与「示例只示范写法」的限定。
has('通用段声明由领域适配包实例化', promptSrc, '领域适配包');
has('通用段声明示例非槽位表', promptSrc, '示例只示范写法');
// 服务端兜底：直接用 API 打 /api/interpret 时，缺预检块也要被拦住默认时间跨度。
has('interpret.js 有前提预检兜底', promptSrc, 'PREMISE_FALLBACK');
has('兜底判据按预检块标记', promptSrc, "panText.indexOf('【前提预检')");
// 前端：解析前提完整性 + 应期同域校验 + 撤回模板。
has('app.js 解析前提完整性', appSrc, '前提完整性\\s*[:：]');
has('app.js 调应期同域校验', appSrc, 'C.premise.checkYingqi');
has('app.js 展示撤回模板', appSrc, 'C.premise.withdraw');
has('app.js 注入前提预检块', appSrc, 'C.premiseBlock(');
has('app.js 追问带前提变动提示', appSrc, 'followUpHint');
has('index.html 挂载 core/premise.js', htmlSrc, 'core/premise.js');
// 流式守卫（2026-10-27 二次修正）：思考期可超 180s，不能再用绝对上限掐断活着的流。
has('app.js 流式用空闲超时', appSrc, 'AI_STREAM_IDLE_MS');
has('app.js 流式另设硬上限', appSrc, 'AI_STREAM_MAX_MS');
has('app.js 按字节重置空闲计时', appSrc, 'onTick');
has('app.js 区分「只想不答」', appSrc, 'REASONING_ONLY');

console.log('PASS:', pass, ' FAIL:', fail);
if (fail > 0) process.exit(1);
