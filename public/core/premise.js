/* ============================================================
 * 前提元数据与应期同域 (core/premise.js)
 *
 * 定位：**确定性预检层**，与 analyze.js / yingqi-window.js 同一精神——
 *   规则链先算出可核对的事实，再交给大模型去解释。本文件不算吉凶、不改盘面，
 *   只做三件事：
 *     ① 从「所测之事」里判定五类通用前提哪些已明示、哪些缺（缺项分级）；
 *     ② 判定此事的时间跨度，据此约束「应期」粒度（应期同域）；
 *     ③ 给出缺项的补问提示与应期撤回模板。
 *
 * 为什么需要它（事故复盘 2026-10-27）：
 *   问「今年能不能考上市重点」，题面没写应届与否、目标标准是什么。模型直接
 *   把「今年」当成本招生年度、把「对象阶段」默认为应届，并给出「甲子日」这种
 *   日级应期——跨年之事给了日级刻度。病根不是模型笨，而是排盘文本里没有刻度：
 *   它能拿到的只有一句所测之事，其余全靠默认值，而默认值不写在输出里，用户看不见。
 *
 * 抽象层级（重要，勿把某一领域写成通用规则）：
 *   本文件只写**与领域无关**的五类槽位与两级风险；某个领域里「时间范围」到底指
 *   自然年还是招生年度、哪些缺项算关键，由 core/domain-methods.js 的 premise
 *   字段（领域适配包）实例化。升学只是示例之一，不是通用槽位表。
 * ============================================================ */
(function (root) {
  const LY = root.LY = root.LY || {};

  // ---- 刻度表 ----
  // rank 用于「应期粒度是否细于事项跨度」的比较：rank 越大，跨度的量级越大。
  const UNITS = {
    day: { rank: 1, label: '日', days: 1 },
    xun: { rank: 2, label: '旬', days: 10 },
    month: { rank: 3, label: '月', days: 30 },
    season: { rank: 4, label: '季', days: 92 },
    year: { rank: 5, label: '年', days: 365 }
  };

  // ---- 五类通用槽位（与领域无关）----
  // risk 是**默认**等级；领域包用 decisive 数组把某几项提为高风险，
  // 其余缺项按低风险处理（只标注、不拦结论）。
  const SLOTS = [
    {
      id: 'timeSpan', label: '时间范围', risk: 'mid',
      ask: '此事的判定跨度是什么（这几天／这个月／今年）'
    },
    {
      id: 'stage', label: '对象阶段', risk: 'mid',
      ask: '当事人此刻处在哪个阶段（未开始／进行中／已出结果待揭晓）'
    },
    {
      id: 'standard', label: '目标标准', risk: 'mid',
      ask: '要达成的具体目标与门槛是什么'
    },
    {
      id: 'process', label: '进程状态', risk: 'mid',
      ask: '事情推进到哪一步了（还没开始／已提交／已出结果）'
    },
    {
      id: 'rules', label: '规则环境', risk: 'low',
      ask: '有哪些外部规则、政策或条件会影响结果'
    }
  ];

  // ---- 时间跨度词表 ----
  // 顺序即优先级：先命中的更具体（「这学期」不能被「学期」以外的东西抢走，
  // 「半个月」不能被「月」抢走，「半年」属季而非年）。
  const SPAN_RULES = [
    { unit: 'day', re: /今[天日夜晚]|明[天日]|后天|当天|当日|这几个小时|一会儿/ },
    { unit: 'xun', re: /这周|本周|下周|周末|这旬|下旬|上旬|中旬|近几[天日]|这几[天日]|半个月|十天内|一周|一个礼拜/ },
    { unit: 'season', re: /本学[期年]|这学[期年]|下学[期年]|季度|上半年|下半年|半年|一个季度|三个月/ },
    { unit: 'month', re: /本月|这个月|下个月|下月|月底|月初|月内|几个月|一两个月|一个月|两个月|近期/ },
    { unit: 'year', re: /今年|明年|后年|去年|本年|年度|年内|年底|过年|未来一年|一年内|两三年|几年|一年/ }
  ];

  // 日历刻度词：用这些词时，若领域包声明了「非日历锚点」（如招生年度、结算周期），
  // 就构成口径歧义——须让模型写明按哪个口径算，而非默默按自然年处理。
  const CALENDAR_RE = /今年|明年|去年|本年|年度|年内|年底|本月|这个月|下个月|这周|本周|下周/;

  // ---- 槽位关键词 ----
  const SLOT_RE = {
    stage: /应届|在读|在校|大[一二三四]|高[一二三]|初[一二三]|研[一二三]|在职|离职|待业|失业|试用期|实习|刚毕业|毕业|退休|孕期|备孕|术后|康复期|住院|未成年|孩子|老人|考生|家长/,
    // 目标标准：既认「目标」（考上／录取／入职…），也认「门槛」（分数线／名额／预算…）。
    // 只命中目标而不见门槛，仍算部分明示——提示里会要求写明所设门槛口径。
    standard: /分数线|录取线|达线|过线|达标|门槛|标准|要求|名额|指标|预算|金额|多少钱|几分|多少分|考上|录取|上榜|入职|拿到|签约|成交|通过|中标|晋升|提薪|offer/i,
    process: /还没|尚未|已经|正在|刚|开始|报名|提交|材料|面试|笔试|初试|复试|出结果|待定|进行中|流程|初审|复审|上诉|开庭|立案|复查|排期|公示|摇号/,
    rules: /政策|新规|规定|限购|限号|审批|批文|许可|资格|制度|规则|户籍|社保|学区|指标生/
  };

  // 门槛细分：只有命中这一组，才算「具体标准已明示」；只命中目标词则算部分明示。
  const THRESHOLD_RE = /分数线|录取线|达线|过线|达标|门槛|名额|指标|预算|金额|多少分|几分/i;

  // 目标类问法：有明确「达成某结果」的动词，才存在「门槛」这个槽位。
  // 「这周会不会来电」是二元事件、无门槛，「今年能不能考上市重点」有门槛——
  // 二者缺「目标标准」的后果不同，不能同档处理。
  const GOAL_RE = /考上|录取|上榜|签约|签合同|签下|成交|中标|通过|拿到|入职|晋升|提薪|涨|过线|达线|达标|够|选中|录上/;

  const DEFAULT_PACK = {
    label: '通用事项',
    anchors: [],          // 非日历锚点（如招生年度）；空表示只按日历口径
    decisive: ['timeSpan'], // 缺了会改变结论方向或应期量级的槽位
    typicalSpan: 'xun',    // 本类事项的典型跨度，未知跨度时用于应期同域
    spanNote: ''
  };

  // ---- 领域适配包（按事由关键词实例化）----
  // 为什么需要这一层：选「自定义所测」时，用神下拉给不出领域，题面又只有一句话，
  // 于是「时间锚点是什么」无从判断——问升学的「今年」指招生年度，问回款的「这个月」
  // 指账期，问诉讼的「这个月」指审限。锚点不同，应期写法就不同。
  // 这里按事由里的实义词给包，只影响**前提预检与应期刻度**，不改用神、不改断法。
  // 顺序即优先级：先命中的更具体。
  const KEYWORD_PACKS = [
    {
      name: '升学', re: /升学|考学|考研|考公|中考|高考|考上|考试|备考|报名|录取|招生|志愿|分数线|上岸|复读|择校|学位|学校|转学/,
      pack: {
        anchors: ['招生年度／考期'], decisive: ['timeSpan', 'standard'], typicalSpan: 'month',
        spanNote: '升学、招考以「招生年度／考期」为刻度，不等同于自然年；录取以流程节点（出分、投档、录取）为刻度。'
      }
    },
    {
      name: '求职', re: /求职|面试|入职|跳槽|招聘|升职|晋升|调岗|裁员|试用期|offer|简历|编制|上岸/i,
      pack: {
        anchors: ['招聘批次'], decisive: ['timeSpan', 'process'], typicalSpan: 'month',
        spanNote: '求职以招聘批次与流程节点（投递／面试／发offer）为刻度；进程状态直接决定断法。'
      }
    },
    {
      name: '诉讼', re: /官司|诉讼|开庭|判决|立案|仲裁|起诉|上诉|律师|执行|和解|赔偿/,
      pack: {
        anchors: ['审限／程序节点'], decisive: ['timeSpan', 'process'], typicalSpan: 'month',
        spanNote: '官讼以审限与程序节点（立案／开庭／判决／执行）为刻度；进程状态直接决定断法。'
      }
    },
    {
      name: '健康', re: /病|手术|住院|复查|康复|医生|吃药|中药|中医|体检|输液|疼痛|发烧/,
      pack: {
        anchors: ['病程（近病／久病）'], decisive: ['timeSpan', 'process'], typicalSpan: 'xun',
        spanNote: '占病以病程长短为刻度：近病旬月可验，久病以月、季为刻度，二者断法不同。'
      }
    },
    {
      name: '交易', re: /合同|签|回款|投资|生意|买卖|订单|项目|成交|客户|货款|报价|投标|中标/,
      pack: {
        anchors: ['结算／回款周期'], decisive: ['timeSpan', 'standard'], typicalSpan: 'month',
        spanNote: '求财看结算或回款周期，不等同于自然月；「这个月」须问清是账期还是日历月。'
      }
    },
    {
      name: '感情', re: /感情|婚姻|结婚|离婚|复合|分手|对象|相亲|恋爱|男友|女友|暧昧/,
      pack: {
        anchors: [], decisive: ['timeSpan'], typicalSpan: 'month',
        spanNote: '感情之事以月、季为常；短期消息可用旬日，但须附公历区间。'
      }
    }
  ];

  /**
   * 取领域适配包。领域包 = core/domain-methods.js 的 premise 字段（按用神分），
   * 自定义所测（__custom__）再按事由关键词挑一个（KEYWORD_PACKS）。
   * @param {string} domainKey #useSelect 的 value
   * @param {string} [question] 所测之事原文（自定义时用于挑包）
   */
  function packOf(domainKey, question) {
    const M = LY.DOMAIN_METHODS || {};
    const m = M[domainKey];
    const p = m && m.premise ? m.premise : null;
    let base = p ? {
      label: (m && m.label) || DEFAULT_PACK.label,
      anchors: p.anchors || [],
      decisive: p.decisive || DEFAULT_PACK.decisive,
      typicalSpan: p.typicalSpan || DEFAULT_PACK.typicalSpan,
      spanNote: p.spanNote || ''
    } : {
      label: DEFAULT_PACK.label,
      anchors: DEFAULT_PACK.anchors.slice(),
      decisive: DEFAULT_PACK.decisive.slice(),
      typicalSpan: DEFAULT_PACK.typicalSpan,
      spanNote: DEFAULT_PACK.spanNote
    };
    // 自定义所测没有领域信息：按事由关键词挑包（命中不了就用通用包）。
    const q = String(question == null ? '' : question);
    if ((domainKey === '__custom__' || !p) && q) {
      for (let i = 0; i < KEYWORD_PACKS.length; i++) {
        const kp = KEYWORD_PACKS[i];
        if (kp.re.test(q)) {
          base = {
            label: kp.name, anchors: kp.pack.anchors.slice(), decisive: kp.pack.decisive.slice(),
            typicalSpan: kp.pack.typicalSpan, spanNote: kp.pack.spanNote, matchedBy: kp.name
          };
          break;
        }
      }
    }
    return base;
  }

  /**
   * 判定所测之事的时间跨度。
   * @param {string} question
   * @returns {{unit:string, rank:number, label:string, days:number, hit:string, calendar:boolean, explicit:boolean}}
   *   unit 为 'unknown' 表示题面没给跨度（此时应期只能给区间与条件，不给单一干支日）。
   */
  function spanOf(question) {
    const q = String(question == null ? '' : question);
    for (let i = 0; i < SPAN_RULES.length; i++) {
      const r = SPAN_RULES[i];
      const m = q.match(r.re);
      if (m) {
        const u = UNITS[r.unit];
        return {
          unit: r.unit, rank: u.rank, label: u.label, days: u.days,
          hit: m[0], calendar: CALENDAR_RE.test(m[0]), explicit: true
        };
      }
    }
    return { unit: 'unknown', rank: 0, label: '未明示', days: 0, hit: '', calendar: false, explicit: false };
  }

  /**
   * 五类槽位的明示情况与缺项分级。
   * @param {string} question 所测之事原文
   * @param {string} [domainKey] #useSelect 的 value（领域适配包键）
   * @returns {object} 判定结果，见下方字段注释
   */
  function judge(question, domainKey) {
    const q = String(question == null ? '' : question);
    const pack = packOf(domainKey, q);
    const span = spanOf(q);
    const slots = SLOTS.map(function (s) {
      let known = false, hit = '', partial = false;
      if (s.id === 'timeSpan') {
        known = span.explicit;
        hit = span.hit;
      } else if (s.id === 'standard') {
        const m = q.match(SLOT_RE.standard);
        if (m) {
          known = true;
          hit = m[0];
          // 只写了目标（考上/入职）而没写门槛（分数线/名额/预算）→ 部分明示
          partial = !THRESHOLD_RE.test(q);
        }
      } else {
        const re = SLOT_RE[s.id];
        const m = re ? q.match(re) : null;
        if (m) { known = true; hit = m[0]; }
      }
      // 风险：缺项且属本类关键槽位 → high；缺项非关键 → low；
      // 已明示但只是部分明示 → mid（结论可给，口径须写明）。
      let risk = 'none';
      if (!known) {
        // 高风险＝缺了就翻转结论方向或应期量级，且**本类事项确实需要这一项**：
        //   - 进度（进程状态）：仅当本类把它列为关键（官讼看审限、占病看近久）；
        //   - 门槛（目标标准）：仅当问法本身是「达成某结果」（GOAL_RE 命中）；
        //   - 对象阶段：仅当本类把它列为关键。
        // 时间范围缺失不升为高风险——它由本类典型刻度兜底，且必须在正文写明此假设。
        const needs = pack.decisive.indexOf(s.id) >= 0;
        const goalish = s.id === 'standard' ? GOAL_RE.test(q) : true;
        risk = (needs && goalish && s.id !== 'timeSpan') ? 'high' : (s.id === 'standard' ? 'mid' : 'low');
      } else if (partial) risk = 'mid';
      return { id: s.id, label: s.label, ask: s.ask, known: known, hit: hit, partial: partial, risk: risk };
    });
    const missing = slots.filter(function (s) { return !s.known; });
    const high = slots.filter(function (s) { return s.risk === 'high'; });
    const mid = slots.filter(function (s) { return s.risk === 'mid'; });
    // 口径歧义：题面用日历词（今年/本月），而本类事项的时间锚点不是日历（招生年度、
    // 结算周期、审理周期）→ 须写明按哪个口径算，否则「今年」会被默默当成自然年。
    let ambiguity = null;
    if (span.explicit && span.calendar && span.rank >= 3 && pack.anchors.length) {
      ambiguity = {
        slot: 'timeSpan',
        hit: span.hit,
        anchors: pack.anchors,
        note: '题面用「' + span.hit + '」，而本类事项的时间锚点是' + pack.anchors.join('、') +
          '，与自然年／自然月不同口径；须写明按哪个算，不得默认按自然年。'
      };
    }
    const effUnit = span.explicit ? span.unit : pack.typicalSpan;
    return {
      question: q,
      domainKey: domainKey || '',
      pack: pack,
      span: span,
      // 应期同域的比较刻度：题面没给跨度时用本类典型跨度兜底（并在文本里说明是兜底）
      effUnit: effUnit,
      effRank: (UNITS[effUnit] || { rank: 0 }).rank,
      effLabel: (UNITS[effUnit] || { label: '未定' }).label,
      spanFromPack: !span.explicit,
      slots: slots,
      missing: missing,
      high: high,
      mid: mid,
      ambiguity: ambiguity,
      completeness: high.length ? '缺失' : (missing.length || mid.length ? '前提未定' : '完整')
    };
  }

  /**
   * 生成进入大模型上下文的「前提预检」块（确定性陈述，非推断）。
   * @param {string} question
   * @param {string} [domainKey]
   * @returns {string} 空字符串表示无需注入（无题面且无缺项时）
   */
  function premiseBlock(question, domainKey, opts) {
    const q = String(question == null ? '' : question).trim();
    if (!q) return '';
    const j = judge(q, domainKey);
    const o = opts || {};
    let out = '【前提预检（规则链 · 非推断）】\n';
    out += '- 时间范围：' + (j.span.explicit
      ? ('题面「' + j.span.hit + '」→ 以「' + j.span.label + '」为刻度')
      : ('未见明示 → 以本类典型刻度「' + j.effLabel + '」作应期上限（兜底，非题面口径，须在正文写明此假设）')) + '\n';
    if (j.ambiguity) out += '- 口径歧义：' + j.ambiguity.note + '\n';
    // 已明示的槽位只列命中词，缺项按风险分级列——省 token，且避免模型把预检误当成新盘面事实。
    const known = j.slots.filter(function (s) { return s.known; });
    if (known.length) {
      out += '- 已明示：' + known.map(function (s) {
        return s.label + '「' + s.hit + '」' + (s.partial ? '（只见目标，未见具体门槛）' : '');
      }).join('；') + '\n';
    }
    if (j.high.length) {
      out += '- 高风险缺项：' + j.high.map(function (s) { return s.label; }).join('、') +
        '——缺之会改变结论方向或应期量级：首轮不得给出单一吉凶与单一应期，须先说明缺什么、为何影响判断，再按可能情形给条件分支。\n';
    }
    const lowMissing = j.missing.filter(function (s) { return s.risk === 'low'; });
    if (lowMissing.length) {
      out += '- 低风险缺项：' + lowMissing.map(function (s) { return s.label; }).join('、') +
        '——只影响细节，标注「前提未定」照常输出结论。\n';
    }
    out += '- 应期同域：本类事项刻度为「' + j.effLabel + '」' +
      (j.effRank >= 4 ? '，应期只能给月／季／年或流程节点，不得写具体干支日' :
        (j.effRank === 3 ? '，可按日给出节点，但须同时给公历区间与月份主刻度，不得只写干支日' :
          '，可给日／旬级节点，但须附公历区间')) +
      '。\n';
    // 与【应期窗口】的和解（只有调用方明说「本次盘面带日级节点窗口」时才写）：
    // 引擎窗口由出空／值日／逢冲换算，天然是日级；若事项以年、季为刻度，
    // 两者并不矛盾——窗口是节点，不是应期。不写这一行，模型要么违背窗口、要么
    // 把日级节点直接当应期，前端的一致性校验就会把它判成冲突。
    if (o.dayNodeWindow && j.effRank >= 4) {
      out += '- 与【应期窗口】的关系：该窗口是出空／值日／逢冲换算出的**日级节点**，' +
        '本题以「' + j.effLabel + '」为刻度——窗口只能作为其中一个节点引用，不得直接当作应期；' +
        '应期须落到月／季或流程节点。\n';
    }
    const toAsk = j.high.concat(j.mid).map(function (s) { return s.ask; });
    if (toAsk.length) {
      out += '- 如需补充（用户问一句即可，不必全填）：' + toAsk.slice(0, 2).join('；') + '。\n';
    }
    return out;
  }

  // 日级应期的三种写法：干支日（甲子日）、相对日（第3–5日 / 三日内）、天数（12天内）。
  const DAY_GRAIN_RE = /[甲乙丙丁戊己庚辛壬癸][子丑寅卯辰巳午未申酉戌亥]\s*日|第\s*\d+\s*[–\-—~至到]\s*\d+\s*日|\d+\s*日内|[一二三四五六七八九十]日内/;
  const MONTH_GRAIN_RE = /\d+\s*月|[一二三四五六七八九十]月/;
  const YEAR_GRAIN_RE = /\d+\s*年|明年|后年|今年|年内|年度/;
  // 粗刻度：月份（含「7月上旬」）、季度、流程节点（出分／公布／批次／节点…）
  const COARSE_GRAIN_RE = /\d+\s*月|[一二三四五六七八九十]月|[上中下]旬|季度|上半[年季]|下半[年季]|流程|批次|节点|出分|公布|录取|签约|开庭|判决/;

  /**
   * 应期同域校验：应期粒度不得细于事项的时间跨度。
   * @param {string} yingqi 「应期」行的值（不含「应期：」前缀亦可）
   * @param {object} span spanOf() 或 judge() 的返回值（judge 亦可，取 effUnit）
   * @returns {{ok:boolean, code:string, level:string, msg:string}}
   *   level: 'ok' | 'warn' | 'violation'
   */
  function checkYingqi(yingqi, span) {
    const t = String(yingqi == null ? '' : yingqi).trim();
    if (!t) return { ok: true, code: 'NO_YINGQI', level: 'ok', msg: '' };
    const unit = span && (span.effUnit || span.unit) ? (span.effUnit || span.unit) : 'unknown';
    const rank = (UNITS[unit] || { rank: 0 }).rank;
    const label = (UNITS[unit] || { label: '未定' }).label;
    if (!rank) return { ok: true, code: 'SPAN_UNKNOWN', level: 'ok', msg: '' };
    const dayGrain = DAY_GRAIN_RE.test(t);
    // 粗刻度：月份／季度／流程节点。应期里若已有粗刻度，日级节点只是辅助定位，
    // 不构成「粒度细于跨度」的硬冲突（引擎窗口本身就是「癸未日前后＋公历区间」的写法）。
    const coarse = COARSE_GRAIN_RE.test(t);
    if (rank >= 4 && dayGrain && !coarse) {
      return {
        ok: false, code: 'YINGQI_TOO_FINE', level: 'violation',
        msg: '应期写成了日级（' + t + '），而此事以「' + label + '」为刻度——粒度细于时间跨度，无法成立。'
      };
    }
    if (rank >= 4 && dayGrain && coarse) {
      return {
        ok: false, code: 'YINGQI_DAY_AS_AUX', level: 'warn',
        msg: '应期里的日级节点（' + t + '）只能作辅，主刻度须是月／季或流程节点——此处已给粗刻度，请确保日级不是唯一依据。'
      };
    }
    const hasRange = /\d+\s*月\s*\d+\s*日|\d+\s*月\s*[上中下]旬|\d+\s*月\s*[底初中]/.test(t);
    if (rank === 3 && dayGrain && !hasRange) {
      return {
        ok: false, code: 'YINGQI_TOO_FINE', level: 'warn',
        msg: '应期写成日级（' + t + '），此事以「月」为刻度：日级只在旬内之事成立，须同时给出月份或流程节点作主刻度。'
      };
    }
    if (rank <= 2 && !dayGrain && (YEAR_GRAIN_RE.test(t) || MONTH_GRAIN_RE.test(t))) {
      return {
        ok: false, code: 'YINGQI_TOO_COARSE', level: 'warn',
        msg: '应期写成' + (YEAR_GRAIN_RE.test(t) ? '年' : '月') + '级（' + t + '），而此事是' + label + '内之事——尺度过粗，起不到可核对的作用。'
      };
    }
    return { ok: true, code: 'OK', level: 'ok', msg: '' };
  }

  /**
   * 应期撤回模板（R5）。原应期被新前提证伪时用它，不得静默改写。
   * @param {string} prevYingqi 原应期
   * @param {string} reason 与哪条前提／盘面要素冲突
   * @param {string} [unitLabel] 同域粒度（如「年」「月」）
   */
  function withdrawText(prevYingqi, reason, unitLabel) {
    const p = String(prevYingqi == null ? '' : prevYingqi).trim() || '（未记录）';
    const r = String(reason == null ? '' : reason).trim() || '与补充前提冲突';
    const u = String(unitLabel == null ? '' : unitLabel).trim() || '与事项跨度同域';
    return '原应期 ' + p + ' 作废：' + r + '；在新前提下应期应落在（' + u +
      ' 刻度），需另起一卦重断。';
  }

  /**
   * 同盘追问提示（R5）：上一轮的应期/结论与新补充的前提是否还成立。
   * @param {{yingqi?:string, trend?:string, spanUnit?:string}} prev 上一轮结构化结论
   * @param {string} question 本轮（含补充信息）的所测之事
   * @returns {string} 空字符串表示无需提示
   */
  function followUpHint(prev, question) {
    if (!prev || !prev.yingqi) return '';
    const now = spanOf(question);
    const prevUnit = prev.spanUnit || 'unknown';
    if (!now.explicit || now.unit === prevUnit) return '';
    const pr = (UNITS[prevUnit] || { rank: 0 }).rank;
    if (now.rank === pr) return '';
    return '本轮补充的信息把时间跨度从「' + ((UNITS[prevUnit] || { label: '未明示' }).label) +
      '」改为「' + now.label + '」。上一轮的应期「' + prev.yingqi +
      '」按新跨度已不成立：须先按【应期撤回】格式作废，再给同域粒度的应期或说明须另起一卦。';
  }

  LY.premise = {
    UNITS: UNITS,
    SLOTS: SLOTS,
    DEFAULT_PACK: DEFAULT_PACK,
    KEYWORD_PACKS: KEYWORD_PACKS,
    packOf: packOf,
    spanOf: spanOf,
    judge: judge,
    block: premiseBlock,
    checkYingqi: checkYingqi,
    withdraw: withdrawText,
    followUpHint: followUpHint
  };
  // 便于 html/app.js 直接调用（与 LY.domainBlock 同风格）
  LY.premiseBlock = premiseBlock;
})(typeof window !== 'undefined' ? window : globalThis);
