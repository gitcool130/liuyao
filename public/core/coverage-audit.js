/* ============================================================
 * 断语推理一致性审查 (core/coverage-audit.js)
 *
 * fact-audit.js 只撞「盘面事实」（六亲、世应、卦名、动爻写没写反）。
 * 本模块补另一半：**推理有没有走样**——
 *
 *   A. 概念误置（冲突，硬告警）
 *      六爻里成对的判定只有一字之差，却是吉凶相反：
 *        真空 / 动不为空 / 旬空待时     真破 / 假破      暗动 / 日破 / 冲散
 *      盘面判成「暗动」而断语写成「日破」，文字通顺、盘面也没写反，
 *      唯独结论反了——fact-audit 查不出，这里查。
 *
 *   B. 结构遗漏（软提示）
 *      盘里判定出来的月破、旬空、伏神、三合、刑害，断语一个字没提。
 *      漏看不等于错，故只作提示、不作告警。
 *
 *   C. 用神是否一致
 *      断语明说「取妻财为用」而盘面取的是官鬼——整篇推理就落错了地方。
 *
 * 边界：本模块不评吉凶对错、不判应期准否，只做「断语 ↔ 确定性判定」
 * 的可形式化对撞。凡程序无权判定的维度，一律不碰。
 * ============================================================ */
(function (root) {
  const LY = root.LY = root.LY || {};

  // ---- A. 概念误置：盘面判定 → 不得出现在断语里的反向词 ----
  // rule 用子串匹配（judgments[].rule 含「月破有救（假破）」这类长名）
  const CONCEPTS = [
    {
      tag: '旬空', pick: function (j) { return j.rule.indexOf('真空') >= 0; },
      deny: ['动不为空', '旺不为空', '出空可用', '出空之日', '到底有用', '出空即有用'],
      truth: '真空（到底空，难以有成）'
    },
    {
      tag: '旬空', pick: function (j) { return j.rule.indexOf('动不为空') >= 0; },
      deny: ['真空', '到底空', '空而无用', '到底无用'],
      truth: '动不为空（出空之日即有用）'
    },
    {
      tag: '旬空', pick: function (j) { return j.rule.indexOf('待时') >= 0; },
      deny: ['真空', '到底空'],
      truth: '旬空待时（出空或冲空之日可应）'
    },
    {
      tag: '月破', pick: function (j) { return j.rule.indexOf('真月破') >= 0; },
      deny: ['假破', '出月可用', '出月可解', '逢合可解', '出月逢合'],
      truth: '真月破（休囚无救）'
    },
    {
      tag: '月破', pick: function (j) { return j.rule.indexOf('假破') >= 0; },
      deny: ['真破', '破而难扶', '真破难扶'],
      truth: '月破有救之假破（出月或逢合、逢值可解）'
    },
    {
      tag: '日冲', pick: function (j) { return j.rule.indexOf('暗动') >= 0; },
      deny: ['日破'],
      truth: '暗动（旺相被日辰冲，其应极速）'
    },
    {
      tag: '日冲', pick: function (j) { return j.rule.indexOf('日破') >= 0; },
      deny: ['暗动'],
      truth: '日破（休囚被日辰冲，败象已成）'
    },
    {
      tag: '日冲', pick: function (j) { return j.rule.indexOf('冲散') >= 0; },
      deny: ['暗动', '日破'],
      truth: '动逢日冲之冲散'
    }
  ];

  // 盘面本无此结构，断语却言之凿凿——同样是误置
  const ABSENT_CLAIMS = [
    { tag: '月破', words: ['月破', '真破', '假破'], truth: '卦盘未判月破' },
    { tag: '旬空', words: ['旬空', '空亡'], truth: '卦盘未判旬空' },
    { tag: '日冲', words: ['暗动', '日破'], truth: '卦盘未判日辰相冲' }
  ];

  // ---- B. 结构遗漏：盘里判出来了，断语应当交代 ----
  // 关键词取「提到就算」的宽口径：漏看只是软提示，宁可漏报不可误报
  const COVER = {
    '月破': ['月破', '破'],
    '旬空': ['旬空', '空亡', '空'],
    '日冲': ['日冲', '暗动', '日破', '冲散', '日辰冲'],
    '动变': ['发动', '动爻', '化出', '变爻', '动而', '独发'],
    '伏神': ['伏神', '伏藏', '飞伏', '伏而', '伏吟'],
    '三合': ['三合', '合成', '成局'],
    '刑害': ['刑', '害'],
    '应期': ['应期', '应于', '应验', '之期', '应在']
  };
  // 只对这些 tag 作遗漏检查：月建、日辰属基础项，断语表述形式太多，
  // 强行要求「必须出现某词」只会制造噪声。
  const COVER_TAGS = ['月破', '旬空', '日冲', '动变', '伏神', '三合', '刑害'];

  function hasAny(text, words) {
    for (let i = 0; i < words.length; i++) {
      if (text.indexOf(words[i]) >= 0) return true;
    }
    return false;
  }
  function tagsOf(js) {
    const s = {};
    (js || []).forEach(function (j) { if (j && j.tag) s[j.tag] = true; });
    return s;
  }

  /**
   * @param {string} text 断语全文
   * @param {object} [analysis] C.analyze() 的返回值（可空，空则只做 A 类）
   * @returns {{accepted:boolean, conflicts:Array, missing:Array, yongshen:?object, checked:string[]}}
   */
  function auditCoverage(text, analysis) {
    const src = String(text == null ? '' : text);
    const js = (analysis && Array.isArray(analysis.judgments)) ? analysis.judgments : [];
    const conflicts = [];
    const missing = [];
    const checked = [];

    if (!src) return { accepted: true, conflicts: [], missing: [], yongshen: null, checked: [], note: '断语为空，未执行审查' };
    if (!js.length) return { accepted: true, conflicts: [], missing: [], yongshen: null, checked: [], note: '无确定性判语可对照，未执行审查' };

    const tags = tagsOf(js);

    // A1. 成对立判：盘面判成 X，断语却用了 X 的反义词
    CONCEPTS.forEach(function (c) {
      if (!tags[c.tag]) return;
      const hit = js.filter(function (j) { return j.tag === c.tag && c.pick(j); });
      if (!hit.length) return;
      c.deny.forEach(function (w) {
        if (src.indexOf(w) >= 0) {
          conflicts.push({
            type: c.tag + '误置',
            claimed: w,
            actual: c.truth,
            hint: '卦盘判为「' + c.truth + '」，断语却用了「' + w + '」——二者吉凶相反，须按卦盘改正。'
          });
        }
      });
    });
    checked.push('成对概念误置（真空/动空/待时 · 真破/假破 · 暗动/日破/冲散）');

    // A2. 盘面本无此结构，断语却断言存在
    ABSENT_CLAIMS.forEach(function (a) {
      if (tags[a.tag]) return;
      a.words.forEach(function (w) {
        if (src.indexOf(w) >= 0) {
          conflicts.push({
            type: a.tag + '无中生有',
            claimed: w,
            actual: a.truth,
            hint: a.truth + '，断语却写了「' + w + '」——须核对是另有所指还是误判。'
          });
        }
      });
    });
    checked.push('无此结构而断言（月破/旬空/日冲）');

    // B. 结构遗漏
    COVER_TAGS.forEach(function (t) {
      if (!tags[t]) return;
      const words = COVER[t];
      if (words && !hasAny(src, words)) {
        missing.push({ tag: t, hint: '卦盘判定有「' + t + '」，断语未提及，请回看是否漏审。' });
      }
    });
    checked.push('结构遗漏（月破/旬空/日冲/动变/伏神/三合/刑害）');

    // C. 用神一致性：只审明说的取用，不说就不审
    let ys = null;
    const m = src.match(/(?:以|取|用神(?:为|是|取)?)\s*(父母|兄弟|子孙|妻财|官鬼|世爻)/);
    if (m && analysis && analysis.yongshen) {
      const actual = analysis.yongshen.type;
      ys = { claimed: m[1], actual: actual, match: m[1] === actual };
      if (!ys.match) {
        conflicts.push({
          type: '用神不一致',
          claimed: m[1],
          actual: actual,
          hint: '断语取「' + m[1] + '」为用，卦盘按所测之事取的是「' + actual + '」——用神一错，全篇生克皆落空处。'
        });
      }
    }
    checked.push('用神一致性（仅在断语明说取用时审）');

    return {
      accepted: conflicts.length === 0,
      conflicts: conflicts,
      missing: missing,
      yongshen: ys,
      checked: checked
    };
  }

  /** 渲染；无冲突且无遗漏时返回空串。 */
  function coverageText(r) {
    if (!r || (r.accepted && !r.missing.length)) return '';
    let s = '';
    if (!r.accepted) {
      const parts = r.conflicts.slice(0, 4).map(function (c) {
        return '「' + c.claimed + '」与卦盘不符（卦盘：' + c.actual + '）';
      });
      s += '推理校对：发现 ' + r.conflicts.length + ' 处与卦盘判定相左 —— ' + parts.join('；');
      if (r.conflicts.length > 4) s += '（仅列前 4 处）';
      s += '。';
    }
    if (r.missing.length) {
      s += (s ? '' : '推理校对：') + '卦盘判定而未见于断语：' +
        r.missing.map(function (x) { return x.tag; }).join('、') + '，请回看是否漏审。';
    }
    return s;
  }

  LY.auditCoverage = auditCoverage;
  LY.coverageText = coverageText;
})(typeof window !== 'undefined' ? window : globalThis);
