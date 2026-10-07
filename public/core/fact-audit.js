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
    const c = String(claimed).replace(/卦$/, '');
    return c === actual || (c.length >= 2 && actual.indexOf(c) === 0);
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
      const actual = L.lq;
      // 伏神同位也作数：断语说「三爻为妻财」时，若妻财正伏在该爻之下，
      // 说的是飞伏之伏神，不是写错六亲——不报冲突。
      if (actual !== m[2] && !(L.fu && L.fu.lq === m[2])) {
        errors.push({ type: '六亲', at: POS_CN[pos], claimed: m[2], actual: actual });
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
      if (!pair[1]) return; // 静卦无变卦，不比对
      const re = new RegExp(pair[0] + '(?:为|是|：|:)\\s*([^\\s，。；、（）()"\']+)', 'g');
      let mm;
      while ((mm = re.exec(src)) !== null) {
        const claimed = mm[1];
        // 只比对「确实像卦名」的片段：卦名 3–5 字，过长的多半是「本卦为X之Y」这类连写
        if (claimed.length < 3 || claimed.length > 6) continue;
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
