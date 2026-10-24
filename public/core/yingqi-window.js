/* ============================================================
 * 应期域层 (core/yingqi-window.js)
 *
 * 把《analyze》给出的「应期线索」收敛为一个**可核对**的应期窗口：
 *   区间（第几日至第几日 + 干支 + 公历日期）／置信度（高/中/低）／
 *   依据（每条指向该窗口的盘面要素）／下调原因（哪些要素削弱了置信度）
 *
 * 为什么需要这一层：
 *   旧版只有 `yingqiClues`（扁平线索）与 `yingqiLayers`（三层归档），
 *   都是「线索陈述」——没有终点、没有强弱、没有为什么不能更早。
 *   通用大模型在这种情况下只能写「近期会有变化」，因为线索本身不含时间刻度。
 *   本层把「出空 / 冲空 / 出月 / 逢冲 / 引拔」换算成**天数**，让应期成为
 *   可被事后核对的对象（也是回执分桶统计的数据来源）。
 *
 * 口径（与 analyze.js 同源，不新立流派）：
 *   · 旬空  —— 出空（本旬尽）、冲空（冲用神之支值日），两者取近
 *   · 月破  —— 假破出月（交下一节）方解；真破不立应期
 *   · 真空  —— 不立应期（用神无救，谈应期无意义）
 *   · 暗动  —— 其应极速（1–3 日）；若同时旬空，则「出空之日方显」，取较晚者
 *   · 合绊  —— 逢冲之日应
 *   · 伏神  —— 冲开飞神之日为引拔之期
 *   · 无空破冲合显象 —— 以本旬出旬为最宽窗口（诚实的最弱档，不作细断）
 *
 * 边界（诚实声明）：
 *   1. 本层只做**算术换算**，不新增断法。窗口宽窄（spread）是工程约定，不是古法。
 *   2. 置信度是「盘面要素的自洽程度」，不是命中概率——样本足够前不得当概率用。
 *   3. 真破/真空直接拒答（status:'blocked'），不用「近期」这类无法核对的话兜底。
 * ============================================================ */
(function (root) {
  const LY = root.LY = root.LY || {};
  const ZHI = LY.ZHI, GAN = LY.GAN;

  const STRONG = ['旺', '相'];
  const WEAK = ['休', '囚', '死'];
  const CONF_LABEL = { '高': '高', '中': '中等', '低': '低' };

  // 窗口宽度（日）：极速类 2、常规 2、慢速类（出月/引拔/默认）3
  const SPREAD = { fast: 2, normal: 2, slow: 3 };

  function chong(a, b) { return ((a - b + 12) % 12) === 6; }
  function gzOfDayIdx(i) {
    const n = ((i % 60) + 60) % 60;
    return GAN[n % 10] + ZHI[n % 12];
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function fmtMD(dt) { return (dt.getMonth() + 1) + '月' + dt.getDate() + '日'; }
  function addDays(dt, n) {
    const d = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
    d.setDate(d.getDate() + n);
    return d;
  }

  // 距下一个「节」（交节）的天数：月破假破须出月方解，此处换算为天数。
  // 表外年份（termMoment 返回 null）时降级为 null —— 不猜，由调用方换用其它线索。
  function daysToNextTerm(dt) {
    if (!dt || typeof dt.getTime !== 'function' || isNaN(dt.getTime())) return null;
    if (typeof LY.termMoment !== 'function' || typeof LY.jdn !== 'function') return null;
    const y = dt.getFullYear(), m = dt.getMonth() + 1, d = dt.getDate();
    const ny = (m === 12) ? y + 1 : y;
    const nm = (m === 12) ? 1 : m + 1;
    const t = LY.termMoment(ny, nm);
    if (!t) return null;
    const diff = LY.jdn(t.y, t.m, t.day) - LY.jdn(y, m, d);
    return diff > 0 ? diff : null;
  }

  function ruleSet(judgments) {
    const s = Object.create(null);
    (judgments || []).forEach(function (j) {
      if (!j || !j.tag || !j.rule) return;
      s[j.tag + ':' + j.rule] = true;
    });
    return s;
  }

  function emptyOut() {
    return {
      status: 'ok', lo: null, hi: null, unit: 'day',
      dayLo: '', dayHi: '', dateLo: '', dateHi: '',
      confidence: '低', text: '', basis: [], downgrades: [], blockedBy: '',
      spread: null
    };
  }

  /**
   * @param {object} pan       paipan() 的输出（需 pillars 与 date）
   * @param {object} analysis  analyze() 的输出（judgments / yongshen / trend / yjs）
   * @returns {object} 见 emptyOut()；另附 {status:'blocked', blockedBy, text, ...}
   */
  function yingqiWindow(pan, analysis) {
    const out = emptyOut();

    if (!pan || !pan.pillars || !pan.lines) {
      out.status = 'blocked'; out.blockedBy = 'no_pan';
      out.text = '应期：无盘可依，不立应期';
      out.basis.push('未取得盘面');
      return out;
    }
    if (!analysis || !analysis.yongshen || !analysis.yongshen.line) {
      out.status = 'blocked'; out.blockedBy = 'no_yongshen';
      out.text = '应期：卦中未见用神，不立应期（宜另择用神或以世爻参断）';
      out.basis.push('未取到用神，应期无所依附');
      return out;
    }

    const pil = pan.pillars;
    const J = analysis.judgments || [];
    const R = ruleSet(J);
    const has = function (k) { return !!R[k]; };
    const grade = analysis.yongshen.wang || '';
    const yl = analysis.yongshen.line;
    const yIdx = ZHI.indexOf(yl.zhi);

    // ---------- ① 用神无救：直接拒答，不拿「近期」兜底 ----------
    if (has('旬空:真空') || has('月破:真月破')) {
      const zk = has('旬空:真空');
      out.status = 'blocked';
      out.blockedBy = zk ? '真空' : '真月破';
      out.confidence = '低';
      out.text = '应期：用神' + (zk ? '真空' : '真月破') + '，无应期可立——宜另择用神或以世爻参断';
      out.basis.push(zk
        ? '用神安静值旬空且休囚无扶，真空到底空（《卜筮正宗·旬空论第十》）'
        : '用神休囚无救，真破难扶（《增删卜易》月破真假之说）');
      out.downgrades.push('用神无救：此处不断应期，也不用「近期会有变化」这类无法核对的话兜底');
      return out;
    }

    const dayZhi = pil.dayZhi;
    const dayIdx = pil.dayIdx;
    const toZhi = function (z) { return ((z - dayZhi) + 12) % 12; };
    const toChongOf = function (z) { return toZhi((z + 6) % 12); };
    const toChuXun = function () {
      const r = 10 - (dayIdx % 10);
      return r === 0 ? 10 : r;
    };

    // ---------- ② 收集候选窗口（每条线索换算为「第几日」） ----------
    const cands = [];
    const kongNow = has('旬空:动不为空') || has('旬空:旬空待时');
    const chuXun = toChuXun();

    if (kongNow) {
      const a = chuXun, b = toChongOf(yIdx);
      const d = Math.min(a, b);
      cands.push({
        d: d, spread: SPREAD.normal, key: 'kong',
        why: '旬空：出空在第 ' + a + ' 日（' + gzOfDayIdx(dayIdx + a) + '），冲空在第 ' + b +
          ' 日（' + gzOfDayIdx(dayIdx + b) + '）；两者取近'
      });
    }

    if (has('月破:月破有救（假破）')) {
      const d = daysToNextTerm(pan.date);
      if (d) {
        cands.push({
          d: d, spread: SPREAD.slow, key: 'yuepo',
          why: '月破有救（假破）：出月（交下一节）方解，约 ' + d + ' 日后'
        });
      } else {
        out.downgrades.push('月破假破须出月方解，但占时超出节气表覆盖范围，无法换算具体日数');
      }
    }

    if (has('日冲:暗动')) {
      // 暗动本主「其应极速」，但爻值旬空则「动而未实，出空之日方显」——
      // 与 ruleDayChong 的文案口径一致，故取较晚者，不得取 1 日。
      const d = kongNow ? Math.max(1, chuXun) : 1;
      cands.push({
        d: d, spread: SPREAD.fast, key: 'andong',
        why: '暗动：旺相之爻被日辰冲动，其应极速' + (kongNow ? '；惟值旬空，出空之日方显' : '')
      });
    }

    // 用神值日：古法应期之正期（「应期以用神值日、逢冲逢合为期」）。
    // 值旬空时不取——空则未实，须先出空，故此时该候选中止（否则会给出早于出空的窗口）。
    if (!kongNow) {
      const d0 = toZhi(yIdx);
      const d = d0 === 0 ? 12 : d0;
      cands.push({
        d: d, spread: SPREAD.normal, key: 'zhiri',
        why: '用神' + yl.zhi + '值日，为应期之正期（第 ' + d + ' 日，' + gzOfDayIdx(dayIdx + d) + '）'
      });
    }

    if (has('日合:合绊')) {
      let d = toChongOf(yIdx);
      if (d === 0) d = 12;
      cands.push({
        d: d, spread: SPREAD.normal, key: 'heban',
        why: '合绊：动而逢合为牵住，逢冲之日应（' + gzOfDayIdx(dayIdx + d) + '）'
      });
    }

    if (has('伏神:伏藏待引')) {
      const fly = pan.lines[yl.pos];
      const flyIdx = fly ? fly.zhiIdx : null;
      let d = (flyIdx != null) ? toChongOf(flyIdx) : chuXun;
      if (d === 0) d = 12;
      cands.push({
        d: d, spread: SPREAD.slow, key: 'fu',
        why: '伏藏待引：冲开飞神之日为引拔之期' + (fly ? '（飞神' + fly.lq + fly.zhi + '）' : '')
      });
    }

    if (has('动变:化回头克')) {
      cands.push({
        d: chuXun, spread: SPREAD.normal, key: 'huikou',
        why: '用神化回头克：须待制忌之神值日，取本旬为限'
      });
    }

    if (!cands.length) {
      cands.push({
        d: chuXun, spread: SPREAD.slow, key: 'default',
        why: '卦无空破冲合之显象，以本旬出旬（第 ' + chuXun + ' 日，' +
          gzOfDayIdx(dayIdx + chuXun) + '）为最宽窗口'
      });
    }

    cands.sort(function (a, b) { return a.d - b.d; });
    const main = cands[0];
    const lo = Math.max(1, main.d);
    const hi = lo + main.spread;

    // ---------- ③ 置信度：盘面要素的自洽程度，不是命中概率 ----------
    let consistency = 1; // 基准：中
    if (STRONG.indexOf(grade) >= 0) consistency += 1;
    else if (WEAK.indexOf(grade) >= 0) consistency -= 1;

    // 多条线索指向相近窗口（±3 日内）互为佐证
    const near = cands.filter(function (c) {
      return c.key !== 'default' && Math.abs(c.d - main.d) <= 3;
    }).length;
    if (near >= 2) consistency += 1;

    const downgrades = out.downgrades;
    if (WEAK.indexOf(grade) >= 0) {
      downgrades.push('月建' + ZHI[pil.monthZhi] + '下用神' + grade + '，无根则虽应亦薄');
    }
    const ys = analysis.yjs || {};
    if (!ys.yuanshen || !ys.yuanshen.length) {
      downgrades.push('卦中无元神生助，应期全靠用神自身与日辰');
    }
    if (has('忌神:忌神有力')) {
      downgrades.push('忌神旺动克用，阻力在前，应期易延后');
    }
    if (has('日冲:冲散')) {
      consistency -= 1;
      downgrades.push('用神发动逢日冲为散，事有反复，须再验');
    }
    if (has('伏神:伏藏待引')) {
      consistency -= 1;
      downgrades.push('用神伏藏，未出伏则不应');
    }
    if (has('卦型:六合变六冲') || has('卦型:卦变六冲') || has('卦型:六冲变六冲')) {
      // 卦型只陈述、不扣分（与 analyze 的纳入准则一致：吉凶随占类翻转）。
      // 但「事多反复」确实会推迟应期，故仍列为下调原因。
      downgrades.push('卦变六冲，事多反复，应期易延后');
    }
    if (has('月破:月破有救（假破）')) {
      downgrades.push('用神月破，出月前难有实应');
    }

    out.confidence = consistency >= 3 ? '高' : (consistency === 2 ? '中' : '低');
    out.lo = lo;
    out.hi = hi;
    out.spread = main.spread;
    out.dayLo = gzOfDayIdx(dayIdx + lo);
    out.dayHi = gzOfDayIdx(dayIdx + hi);

    const dt = pan.date;
    if (dt && typeof dt.getTime === 'function' && !isNaN(dt.getTime())) {
      out.dateLo = fmtMD(addDays(dt, lo));
      out.dateHi = fmtMD(addDays(dt, hi));
    }

    out.text = '应期：' + out.dayLo + '日前后（第 ' + lo + '–' + hi + ' 日' +
      (out.dateLo ? '，' + out.dateLo + '—' + out.dateHi : '') +
      '），置信' + CONF_LABEL[out.confidence];

    out.basis.push(main.why);
    cands.slice(1).forEach(function (c) {
      out.basis.push('辅助节点（第 ' + Math.max(1, c.d) + ' 日）：' + c.why);
    });
    if (!downgrades.length) downgrades.push('无明显削弱项（月建与元神无碍）');

    return out;
  }

  // 供 UI / 排盘文本统一取用的多行文本（依据 / 下调原因各一行）
  function yingqiText(w) {
    if (!w) return '';
    let s = w.text || '';
    if (w.basis && w.basis.length) s += '\n依据：' + w.basis.join('；');
    if (w.downgrades && w.downgrades.length) s += '\n下调原因：' + w.downgrades.join('；');
    return s;
  }

  LY.yingqiWindow = yingqiWindow;
  LY.yingqiText = yingqiText;
})(typeof window !== 'undefined' ? window : globalThis);
