/* ============================================================
 * 断语质量评估：指标定义与计算 (tests/drift/lib.mjs)
 *
 * 背景：排盘层已有 14.8 万条断言守着「算得对」，但「断得怎么样」
 * 一条都没有。本模块把那个不可言的「准确率」拆成四个**可判定**指标，
 * 让「提高」这个词第一次有定义。
 *
 * 四个指标（全部只依赖确定性产物，不需要人工标注）：
 *
 *   1. 引擎一致率  reply 的结论方向 是否等于 analyze().trend
 *      —— 断语与项目自家规则打架，是纯客观错误，不涉流派。
 *   2. 同盘冲突率  同一张盘 N 条断语的结论方向是否一致
 *      —— 1 - (最大方向占比)，衡量结论漂移。
 *   3. 要素错误率  auditFactClaims + auditCoverage 判出的冲突
 *      —— 盘面写反、静爻论冲、取用两说这类硬伤。
 *   4. 边界遵守率  断语有没有独断（必然/绝对/保证）或宣称准确率
 *      —— 只碰到「不可证伪的断言」，不评价推断本身。
 *
 * 边界（重要）：本模块**不评判吉凶对错**——六爻吉凶无金标准，
 * 程序无权判定。它只判「断语是否与自己依赖的确定性产物一致」。
 * 因此四个指标都是**下限指标**：全绿不等于断得准，只等于没犯可判定的错。
 * ============================================================ */

// ---- 结论方向：吉 / 平 / 凶 ----
// 显式「结论：X」优先（断语模板里普遍有），无则按句计分。
// 计分刻意保守：一句只归一类，取最大且唯一者，平票返回 null（未表态）。
const DIR = { JI: '吉', PING: '平', XIONG: '凶' };

const XIONG_RE = /(不可用|不可堪用|不堪用|不可行|不可成|不成|难成|未成|无成|凶|败象|破败|堪忧|不宜|无用|徒劳)/;
const JI_RE = /(可成|可行|可用|堪用|无碍|顺遂|得成|有救|有利|大吉|吉)/;
const PING_RE = /(中等|待时|两可|相半|辅助|不吉不凶|看条件|视条件|吉凶参半)/;

function directionOf(text) {
  const src = String(text == null ? '' : text);
  if (!src.trim()) return null;

  // 1) 显式结论行：「结论：平」「结论：凶，不可堪用」
  const m = src.match(/结[论局][^\n。]{0,8}?[：:]\s*[「"“']?\s*(大吉|吉|平|凶|大凶)/);
  if (m) {
    if (m[1].indexOf('凶') >= 0) return DIR.XIONG;
    if (m[1].indexOf('吉') >= 0) return DIR.JI;
    return DIR.PING;
  }

  // 2) 断为/判为句式
  const m2 = src.match(/(?:断为|判为|定为|归为)\s*[「"“']?\s*(大吉|吉|平|凶|大凶)/);
  if (m2) {
    if (m2[1].indexOf('凶') >= 0) return DIR.XIONG;
    if (m2[1].indexOf('吉') >= 0) return DIR.JI;
    return DIR.PING;
  }

  // 3) 按句计分。凶词优先于吉词（「不可用」含「可用」，不先判则会全判吉）
  let ji = 0, xiong = 0, ping = 0;
  src.split(/[。；！？\n]+/).forEach(function (s) {
    if (!s.trim()) return;
    if (XIONG_RE.test(s)) { xiong++; return; }
    if (PING_RE.test(s)) { ping++; return; }
    if (JI_RE.test(s)) { ji++; }
  });
  const arr = [[DIR.JI, ji], [DIR.XIONG, xiong], [DIR.PING, ping]];
  arr.sort(function (a, b) { return b[1] - a[1]; });
  if (arr[0][1] === 0) return null;                 // 一句都没命中 → 未表态
  if (arr[0][1] === arr[1][1]) return null;         // 最高分并列 → 不敢替它表态
  return arr[0][0];
}

// ---- 边界词表 ----
// 独断：把概率事件说成确定事件，或直接宣称准确率。这是产品责任问题，不是流派问题。
const DOGMA = [
  '必然', '必定', '一定应验', '一定会', '一定要', '绝对', '肯定', '铁定',
  '毫无疑问', '百分百', '百分之百', '保证', '从无例外', '决然', '必将'
];
// 合格的概率表达：出现即视为有边界意识（仅用于说明，不抵销独断）
const HEDGE = [
  '可能', '或许', '倾向于', '大致', '约在', '未必', '尚需', '待验',
  '多解', '两说', '视情况', '若', '如果', '不宜独断', '仅供参考', '概率'
];
const ACCURACY_CLAIM = /准确率\s*(?:可达|达到|约|≥|>|超过)?\s*\d+\s*%/;

function boundaryOf(text) {
  const src = String(text == null ? '' : text);
  const dogma = [];
  DOGMA.forEach(function (w) {
    let idx = src.indexOf(w);
    while (idx >= 0) {
      // 前 5 字内是否定：「不等于必然录取」「并非必然」「未必」——都是在**否认**独断，
      // 旧版直接按子串判独断，把正确表述算成违规（2026-10-21 扩样本实测误报）。
      // 只看同一个小句：越过标点的否定词属于上一句，不得豁免本句
      // （「用神无救，此事必然无救」里的「无」是上一句的，本句「必然」照样是独断）。
      const preRaw = src.slice(Math.max(0, idx - 5), idx);
      const cut = Math.max(preRaw.lastIndexOf('，'), preRaw.lastIndexOf('。'), preRaw.lastIndexOf('；'), preRaw.lastIndexOf('、'), preRaw.lastIndexOf(','));
      const pre = cut >= 0 ? preRaw.slice(cut + 1) : preRaw;
      // 只查前置：独断词后面的「无/不」属于谓语，不是否定独断本身。
      // 「必然无救」是标准独断（必然→无救），不能因为紧跟一个「无」就豁免。
      const negated = /[非不未无莫]/.test(pre);
      if (!negated) { dogma.push(w); break; }
      idx = src.indexOf(w, idx + w.length);
    }
  });
  const claim = ACCURACY_CLAIM.exec(src);
  if (claim) dogma.push(claim[0]);
  let hedge = 0;
  HEDGE.forEach(function (w) { if (src.indexOf(w) >= 0) hedge++; });
  return { dogma: dogma, hedge: hedge, clean: dogma.length === 0 };
}

// ---- 评估单条断语 ----
/**
 * @param {object} core  require('../core.js') 的返回值
 * @param {object} pan   C.paipan() 结果
 * @param {object} ana   C.analyze() 结果（用神已定）
 * @param {string} text  断语全文
 */
function evaluateReply(core, pan, ana, text) {
  const dir = directionOf(text);
  const trend = ana && ana.trend ? ana.trend : null;

  // 硬伤：事实层 + 推理层
  const fact = core.auditFactClaims(text, pan);
  const cover = core.auditCoverage(text, ana, pan);
  const errors = [];
  (fact.errors || []).forEach(function (e) {
    errors.push({ layer: 'fact', type: e.type || e.tag || 'fact', claimed: e.claimed || '', actual: e.actual || '' });
  });
  (cover.conflicts || []).forEach(function (c) {
    errors.push({ layer: 'cover', type: c.type, claimed: c.claimed, actual: c.actual });
  });

  return {
    direction: dir,
    trend: trend,
    agreesTrend: (dir && trend) ? dir === trend : null,
    // 显式分歧：断语结论与引擎相反，但按【结论对齐】契约标注了「（与引擎分歧：…）」。
    // 这不是漂移，是**声明过的**分歧——计入独立桶，从一致率分母中剔除。
    // 否则契约里「允许分歧但须标注」就成了空话：标了照样扣分，模型只能沉默照抄。
    declaredDisagreement: !!(dir && trend && dir !== trend && /与引擎(判定)?分歧/.test(String(text == null ? '' : text))),
    errors: errors,
    boundary: boundaryOf(text)
  };
}

// ---- 聚合 ----
/**
 * @param {Array} cases corpus.cases
 * @param {object} core
 * @returns {object} 四指标聚合结果
 */
function evaluateCorpus(cases, core) {
  const perCase = [];
  let replies = 0, stated = 0, agree = 0, disagree = 0;
  let withError = 0, errorCount = 0;
  let withDogma = 0, declaredN = 0;
  const driftList = [];

  (cases || []).forEach(function (c) {
    const at = c.chart.at;
    const d = new Date(at.y, at.m - 1, at.d, at.h || 0, at.min || 0, 0);
    const pan = core.paipan(c.chart.vals, d);
    const ana = core.analyze(pan, c.target);

    const evals = (c.replies || []).map(function (r) {
      return evaluateReply(core, pan, ana, r.text);
    });

    const counts = { 吉: 0, 平: 0, 凶: 0 };
    // statedLocal 必须独立于全局 stated：早先直接用全局累加值做分母，
    // 第二个 case 的「最大方向占比」被前一个 case 的表态数稀释，
    // 实测把 50% 冲突度算成 75%（v1/v2 并排跑时才暴露）。
    let statedLocal = 0;
    evals.forEach(function (e) {
      replies++;
      if (e.direction) { counts[e.direction]++; stated++; statedLocal++; }
      if (e.agreesTrend === true) agree++;
      else if (e.agreesTrend === false) {
        if (e.declaredDisagreement) declaredN++;   // 显式分歧：不算静默漂移
        else disagree++;
      }
      if (e.errors.length) { withError++; errorCount += e.errors.length; }
      if (!e.boundary.clean) withDogma++;
    });

    const maxShare = statedLocal ? Math.max(counts.吉, counts.平, counts.凶) / statedLocal : 0;
    const drift = statedLocal >= 2 ? 1 - maxShare : 0;   // 单条断语无「漂移」可言
    driftList.push(drift);

    perCase.push({
      id: c.id,
      question: c.question,
      target: c.target,
      trend: ana.trend,
      counts: counts,
      stated: statedLocal,
      drift: drift,
      replies: evals
    });
  });

  const judged = agree + disagree;
  return {
    caseCount: perCase.length,
    perCase: perCase,
    replies: replies,
    stated: stated,
    metrics: {
      trendAgreement: {
        judgeable: judged,
        agree: agree,
        disagree: disagree,
        declared: declaredN,
        rate: judged ? agree / judged : null
      },
      drift: {
        perCase: driftList,
        rate: driftList.length ? driftList.reduce(function (a, b) { return a + b; }, 0) / driftList.length : null
      },
      elementError: {
        repliesWithError: withError,
        totalErrors: errorCount,
        rate: replies ? withError / replies : null
      },
      boundary: {
        repliesWithDogma: withDogma,
        rate: replies ? 1 - withDogma / replies : null
      }
    }
  };
}

// ---- 门槛：先定死，后测。改门槛须单独提交并说明理由 ----
const THRESHOLDS = {
  trendAgreement: { op: '>=', value: 0.80, label: '引擎一致率' },
  drift: { op: '<=', value: 0.20, label: '同盘冲突率' },
  elementError: { op: '<=', value: 0.05, label: '要素错误率' },
  boundary: { op: '>=', value: 0.90, label: '边界遵守率' }
};

function judge(report) {
  const out = [];
  Object.keys(THRESHOLDS).forEach(function (k) {
    const t = THRESHOLDS[k];
    const got = report.metrics[k].rate;
    if (got === null || got === undefined) {
      out.push({ key: k, label: t.label, got: null, ok: null, note: '无可判定样本' });
      return;
    }
    const ok = t.op === '>=' ? got >= t.value : got <= t.value;
    out.push({ key: k, label: t.label, got: got, want: t.op + ' ' + t.value, ok: ok });
  });
  return out;
}

export { DIR, directionOf, boundaryOf, evaluateReply, evaluateCorpus, judge, THRESHOLDS };
