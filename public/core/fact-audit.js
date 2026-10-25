/* ============================================================
 * 断语事实一致性审计 (core/fact-audit.js)
 *
 * 大模型流式输出无人回检时，可能出现「文字通顺但盘面写反」的情况：
 * 六亲认错、世应错位、卦名写错、动爻说错。本模块把断语里**显式写出的
 * 盘面断言**与 paipan.js 的确定性结果逐条对撞，只报冲突，不改文字、
 * 不评吉凶。
 *
 * 边界（与 analyze.js「只出线索不下结论」同一精神）：
 *   - 只审计**显式**断言（「三爻为妻财」「世爻在三爻」「本卦为水雷屯」）。
 *   - 不审计吉凶倾向、应期早晚、取象类象、作用链主次——这些属传统推断，
 *     程序无权判定对错，故列在 unrestricted 里明示。
 *   - 匹配不到不等于错：本模块只在「写了且与卦盘不符」时报冲突。
 * ============================================================ */
(function (root) {
  const LY = root.LY = root.LY || {};

  const POS = { '初': 0, '二': 1, '三': 2, '四': 3, '五': 4, '上': 5 };
  const POS_CN = ['初爻', '二爻', '三爻', '四爻', '五爻', '上爻'];
  const RELATIVES = ['父母', '兄弟', '子孙', '妻财', '官鬼'];
  // 明确列出「程序不审」的维度：断语在这些方向上自由，审计不得越界
  const UNRESTRICTED = ['吉凶倾向', '应期早晚', '取象与类象', '作用链主次', '旺衰综合判断'];

  /**
   * 卦名容差比对：大模型几乎总会写成「本卦为水雷屯卦」，多一个「卦」字，
   * 严格相等会把每一个正确断语整片误报——故先剥尾字再比；
   * 「水雷屯」写成「水雷屯之泽雷随」的连写已由长度闸（>6）先行跳过。
   */
  function sameGuaName(claimed, actual) {
    if (!actual) return false;
    // 先剥掉书名号/引号：模型引经据典时会把卦名写成《泽天夬》，
    // 旧版只剥尾字「卦」，于是每一个带书名号的正确卦名都被判成「与卦盘不符」。
    const c = String(claimed)
      .trim()
      .replace(/^[《〈「『【(“‘"']+/, '')
      .replace(/[》〉」』】)”’"']+$/, '')
      .replace(/卦$/, '');
    return c === actual || (c.length >= 2 && actual.indexOf(c) === 0);
  }

  /** 剥掉书名号/引号/尾部「卦」，取规范卦名（sameGuaName 与卦名白名单共用） */
  function normGuaName(s) {
    return String(s == null ? '' : s)
      .trim()
      .replace(/^[《〈「『【(“‘"']+/, '')
      .replace(/[》〉」』】)”’"']+$/, '')
      .replace(/卦$/, '');
  }

  /* 64 卦名白名单（懒建：data.js 总在本模块之前加载）。
   *
   * 「本卦为X」里的 X 不一定是卦名。模型极常见的写法是
   *   「**卦型**：本卦为六冲卦（坤为地）」
   * 旧版把「六冲卦」当卦名直接比对盘面，于是每一篇把「卦型」写进「本卦为…」
   * 句式的正常断语都被判成「本卦卦名：六冲卦 ≠ 坤为地」。
   *
   * 这条误报的代价不只是显示错：app.js 一旦收到未 accepted 的审计结果，
   * 就会把冲突回灌给模型**整篇重写一次**，并把重写稿重新流式渲染到同一个气泡里
   * ——用户观感正是「断语先出片段，收尾后又整篇重来一遍」。
   * 2026-10-25 线上复现：gemini-3.8-flash 首稿 1718 字、结论四行齐全、warn 为空，
   * 仍被判 1 处「本卦卦名：六冲卦 ≠ 坤为地」，随后触发整篇重写。
   *
   * 处理：只有当捕获片段确实是 64 卦名之一时才是「卦名断言」；不是就往后看一眼
   * 括注里有没有点名真卦名（「本卦为六冲卦（坤为地）」以括号内为准），
   * 都没有则本条不作断言——不报错，也不猜。 */
  let GUA_NAMES = null;
  function guaNameSet() {
    if (!GUA_NAMES) {
      GUA_NAMES = {};
      const hn = LY.HEXNAMES || {};
      for (const k in hn) { if (typeof hn[k] === 'string') GUA_NAMES[hn[k]] = true; }
    }
    return GUA_NAMES;
  }
  function isGuaName(s) {
    const c = normGuaName(s);
    return !!c && !!guaNameSet()[c];
  }
  /** 在片段里找最早出现的 64 卦名（同位置取较长者），找不到返回 '' */
  function firstGuaNameIn(seg) {
    const set = guaNameSet();
    let best = '', bestAt = -1;
    for (const n in set) {
      const at = seg.indexOf(n);
      if (at < 0) continue;
      if (bestAt < 0 || at < bestAt || (at === bestAt && n.length > best.length)) { best = n; bestAt = at; }
    }
    return best;
  }

  /**
   * 判断某个「N爻」断言说的是不是变卦。
   * 只看该断言之前最近一次出现的「变卦/之卦/变体」与「本卦/原卦」谁更近：
   * 「变卦三爻为子孙，本卦三爻为兄弟」两句各归各，不会被前一句带偏。
   */
  function inBianContext(src, idx) {
    const back = src.slice(Math.max(0, idx - 12), idx);
    const bian = Math.max(back.lastIndexOf('变卦'), back.lastIndexOf('之卦'), back.lastIndexOf('变体'));
    const ben = Math.max(back.lastIndexOf('本卦'), back.lastIndexOf('原卦'));
    return bian >= 0 && bian > ben;
  }

  function relPattern() {
    return '(' + RELATIVES.join('|') + ')';
  }
  function posPattern() {
    return '([初二三四五上])';
  }

  /**
   * @param {string} text 大模型断语全文
   * @param {object} pan  paipan() 的返回值
   * @returns {{accepted:boolean, errors:Array<{type:string,claimed:string,actual:string,at?:string}>, checked:string[], unrestricted:string[]}}
   */
  function auditFactClaims(text, pan) {
    const errors = [];
    const checked = [];
    const src = String(text == null ? '' : text);

    if (!pan || !Array.isArray(pan.lines) || pan.lines.length !== 6) {
      return {
        accepted: true, errors: [], checked: [],
        unrestricted: UNRESTRICTED.slice(),
        note: '卦盘缺失，未执行审计'
      };
    }

    // 1. 逐爻六亲：「三爻为妻财」「初爻官鬼」「五爻临父母」
    const reRel = new RegExp(posPattern() + '爻(?:为|是|临|属)?\\s*' + relPattern(), 'g');
    let m;
    while ((m = reRel.exec(src)) !== null) {
      const pos = POS[m[1]];
      const L = pan.lines[pos];
      // 变卦语境：「变卦三爻为子孙」说的是变卦同位爻（L.bian），不是本卦。
      // 旧版一律取本卦，模型只要描述变卦六亲就会被判成盘面写反。
      const bianCtx = inBianContext(src, m.index);
      // 静卦（无动爻）根本没有变卦：断语提「变卦」属凭空造盘，须明确报「无变卦」，
      // 不能退化成「拿本卦六亲去比」——那样会把「无中生有」误报成「六亲写反」，
      // 用户看到的 actual 是本卦六亲，完全误导。
      if (bianCtx && !L.bian) {
        errors.push({ type: '变卦', at: POS_CN[pos], claimed: m[2], actual: '此卦六爻皆静，无变卦' });
        continue;
      }
      const bianSide = !!L.bian && bianCtx;
      const actual = bianSide ? L.bian.lq : L.lq;
      const at = POS_CN[pos] + (bianSide ? '（变卦）' : '');
      // 伏神同位只对本卦成立：变卦无伏神。
      if (actual !== m[2] && !(!bianSide && L.fu && L.fu.lq === m[2])) {
        errors.push({ type: '六亲', at: at, claimed: m[2], actual: actual });
      }
    }
    checked.push('逐爻六亲');

    // 2. 世应位置：「世爻在三爻」「应爻居上爻」
    [['世', pan.shi], ['应', pan.ying]].forEach(function (pair) {
      const re = new RegExp(pair[0] + '爻(?:在|居|临)\\s*' + posPattern() + '爻', 'g');
      let mm;
      while ((mm = re.exec(src)) !== null) {
        const claimed = POS[mm[1]];
        if (claimed !== pair[1]) {
          errors.push({ type: pair[0] + '爻位置', claimed: POS_CN[claimed], actual: POS_CN[pair[1]] });
        }
      }
    });
    checked.push('世应位置');

    // 3. 本卦 / 变卦卦名：「本卦为水雷屯」「变卦：泽雷随」
    [['本卦', pan.benName], ['变卦', pan.bianName]].forEach(function (pair) {
      const re = new RegExp(pair[0] + '(?:为|是|：|:)\\s*([^\\s，。；、（）()"\']+)', 'g');
      let mm;
      while ((mm = re.exec(src)) !== null) {
        let claimed = normGuaName(mm[1]);
        // 捕获片段不是 64 卦名 → 本条说的是卦型/宫位等，不是卦名断言。
        // 旧版拿它直接比对，是「本卦为六冲卦」一类正常写法被误报的唯一成因（见上）。
        if (!isGuaName(claimed)) {
          // 括注里点名了真卦名（「本卦为六冲卦（坤为地）」）时以括号内为准，
          // 这样既不再误报「六冲卦≠坤为地」，又不放过「本卦为六冲卦（水雷屯）」这类真错。
          const seg = src.slice(mm.index, mm.index + mm[0].length + 14);
          claimed = firstGuaNameIn(seg);
          if (!claimed) continue;   // 通篇没点名卦名：不作断言
        }
        // 只比对「确实像卦名」的片段：卦名 3–5 字，过长的多半是「本卦为X之Y」这类连写
        if (claimed.length < 3 || claimed.length > 6) continue;
        // 静卦说「变卦为X」同样是凭空造盘：原实现遇 bianName 为空直接 return，
        // 整段跳过——模型可以随口编一个变卦而无人拦。含「无/静/不变」的是在
        // 陈述「没有变卦」，不算错，跳过以免误报。
        if (!pair[1]) {
          if (/无|静|不变/.test(claimed)) continue;
          errors.push({ type: pair[0] + '卦名', claimed: claimed, actual: '此卦六爻皆静，无变卦' });
          continue;
        }
        if (!sameGuaName(claimed, pair[1])) {
          errors.push({ type: pair[0] + '卦名', claimed: claimed, actual: pair[1] });
        }
      }
    });
    checked.push('本卦与变卦卦名');

    // 4. 动爻：「初爻发动」「三爻独发」（只取显式表述，避免误伤「动爻生用」之类）
    const reMoving = new RegExp(posPattern() + '爻(?:发动|独发)', 'g');
    while ((m = reMoving.exec(src)) !== null) {
      const pos = POS[m[1]];
      if (!pan.lines[pos].moving) {
        errors.push({ type: '动爻', at: POS_CN[pos], claimed: '发动', actual: '安静' });
      }
    }
    checked.push('动爻位置');

    // 5. 旬空：「世爻旬空」「三爻空亡」「四爻不空」
    // 此前审计器完全不看旬空——而「父母持世空亡」这类判断恰恰是断语里最常见的
    // 定性依据之一，模型说空就空、说不空就不空，无人对撞。只校验显式挂在
    // 世/应/具体爻位上的表述；「用神旬空」需 analyze() 结果，此处不涉。
    const pil = pan.pillars || {};
    if (Array.isArray(pil.kong)) {
      const kongStr = pil.kongStr || pil.kong.map(function (i) { return (LY.ZHI || [])[i]; }).join('');
      const lineOf = function (tag) {
        if (tag === '世') return pan.lines[pan.shi];
        if (tag === '应') return pan.lines[pan.ying];
        return pan.lines[POS[tag]];
      };
      const atOf = function (tag) {
        if (tag === '世' || tag === '应') return tag + '爻';
        return POS_CN[POS[tag]];
      };
      // 肯定式在前、否定式单独一条，避免「不空亡」被「空亡」截断
      [{ re: '(世|应|[初二三四五上])爻(?:值|临|逢|落|亦|又|已)?\\s*(?:旬空|空亡)', claimKong: true },
       { re: '(世|应|[初二三四五上])爻(?:值|临|逢|落|亦|又|已)?\\s*(?:不空亡|不空)', claimKong: false }
      ].forEach(function (pat) {
        const re = new RegExp(pat.re, 'g');
        let mm;
        while ((mm = re.exec(src)) !== null) {
          const L = lineOf(mm[1]);
          if (!L || typeof L.zhiIdx !== 'number') continue;
          const actualKong = pil.kong.indexOf(L.zhiIdx) >= 0;
          if (actualKong === pat.claimKong) continue;
          errors.push({
            type: '旬空', at: atOf(mm[1]),
            claimed: pat.claimKong ? '旬空' : '不空',
            actual: actualKong ? ('旬空（' + kongStr + '空）') : '不空'
          });
        }
      });
      checked.push('旬空');
    }

    return {
      accepted: errors.length === 0,
      errors: errors,
      checked: checked,
      unrestricted: UNRESTRICTED.slice()
    };
  }

  /** 把审计结果渲染成一行可读提示；无冲突时返回空串（调用方据此决定是否展示）。 */
  function auditText(result) {
    if (!result || result.accepted) return '';
    const parts = result.errors.slice(0, 5).map(function (e) {
      if (e.at) return e.at + '：断语作「' + e.claimed + '」，卦盘实为「' + e.actual + '」';
      return e.type + '：断语作「' + e.claimed + '」，卦盘实为「' + e.actual + '」';
    });
    let s = '盘面校对：发现 ' + result.errors.length + ' 处与卦盘不符 —— ' + parts.join('；');
    if (result.errors.length > 5) s += '（仅列前 5 处）';
    s += '。以上为确定性盘面事实的对撞，不涉及吉凶与应期判断。';
    return s;
  }

  LY.auditFactClaims = auditFactClaims;
  LY.auditText = auditText;
})(typeof window !== 'undefined' ? window : globalThis);
