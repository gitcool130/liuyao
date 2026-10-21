/* ============================================================
 * 问法形态检测 (core/question-shape.js)
 *
 * 背景：实测「是换医生还是不换还是先不治疗了」这类多选一问法，
 * 两个大模型断出完全相反的建议（一个令换、一个令不换）。根因不在
 * 盘面事实层（双方事实全对），而在取象层——卦面没有专爻代表
 * 「各选项」，每份断语各挑一个象放大，必然各执一端。
 *
 * 本模块的定位（与 fact-audit 同一精神，只提示不拦截）：
 *   - 检测所测之事是否属于「多选一强制站队」型问法；
 *   - 给用户三条改问路径（趋势题 / 定向假设题 / 决策树），纯建议，
 *     永不拦截断卦——改不改问法由用户定；
 *   - 给大模型一段「问法处理」指令（随排盘文本入模），要求按
 *     条件决策树输出，不得强制站队。
 *
 * 检测口径（宁缺勿滥，全部为软提示）：
 *   - multi（多选一）：**连接义**连接词「还是/或者」出现 ≥2 次；
 *   - either-or（二选一）：单个连接义连接词且两侧均为实义选项；
 *   - should-i（该不该）：「该不该 / 要不要」式单一动作问句；
 *   - 「能不能 / 怎么办」等趋势题、开放式问法一律不报——它们
 *     本来就是六爻擅长的问法。
 *   - 「还是」的副词用法（「仍然」义，如「他还是不回消息」「还是
 *     算了吧」）不计入连接词：前接人称代词、或后接情态/建议类字
 *     （还是**算**了 / 还是**再**等等）者排除；「还是不X」「还是先X」
 *     在前接实义选项时是连接义（「换医生还是不换还是先不治疗了」），
 *     仅前接人称代词（「他还是不…」= 他仍然不）时是副词。
 * ============================================================ */
(function (root) {
  const LY = root.LY = root.LY || {};

  // 「还是」作副词（仍然义）的两侧紧邻字排除表：
  //   前接人称/指示代词（他还是…/我还是…）；后接否定、情态、建议类字
  //   （还是不回 / 还是算了 / 还是先别动）。
  // 后接表分两组：
  //   HARD（没别会得就仍算再也好吧太很有老）——后接即恒副词；
  //   SOFT（不先）——「还是不X」「还是先X」在**前接实义选项**时其实是
  //     连接义（「换医生还是不换还是先不治疗了」两个「还是不/还是先」
  //     都是并列链的一环），只有前接人称代词（「他还是不…」= 他仍然不）
  //     才是副词——后者已由 ADV_BEFORE 兜住。旧版把「不先」与 HARD 同组，
  //     且 n>=2 路径完全不过副词排除，既漏掉上面这类真实多选一的判定依据，
  //     又让「他还是不来，还是算了吧」这类双副词句误报 multi（2026-10-21 修正）。
  var ADV_BEFORE = '他她它我您你这那其';
  var ADV_AFTER_HARD = '没别会得就仍算再也好吧太很有老';
  var ADV_AFTER_SOFT = '不先';

  // 「还是」在位置 i 是否副词用法（仍然义）：
  //   句首（i===0）或前接人称/指示代词 → 恒副词；
  //   后接 HARD 字（没别会得就仍算再也好吧太很有老）→ 恒副词；
  //   后接 SOFT 字（不/先）或句尾无后接字 → 按连接义（前接代词已兜住）。
  function adverbialHaishi(q, idx) {
    if (idx === 0) return true;
    var before = q.charAt(idx - 1);
    var after = q.charAt(idx + 2);
    if (ADV_BEFORE.indexOf(before) >= 0) return true;
    if (after && ADV_AFTER_HARD.indexOf(after) >= 0) return true;
    return false;
  }

  // 连接义「还是」出现位列表（副词位不计）。
  function haishiPositions(q) {
    var pos = [], i;
    i = q.indexOf('还是');
    while (i >= 0) {
      if (!adverbialHaishi(q, i)) pos.push(i);
      i = q.indexOf('还是', i + 2);
    }
    return pos;
  }

  // 连接词总数：「或者」无歧义恒计；「还是」只计连接义位。
  function countConnectors(q) {
    var n = 0, i;
    haishiPositions(q).forEach(function () { n++; });
    i = q.indexOf('或者');
    while (i >= 0) { n++; i = q.indexOf('或者', i + 2); }
    return n;
  }

  // 「A还是不A」句式：同一短语回指出现，如「换医生还是不换医生」。
  // 捕获组最多 5 字，超长的选项并列举不动（留作 future）。
  var RE_REPEAT = /(.{1,5})还是不\1/;

  function splitOptions(q) {
    return q.split(/还是|或者/).map(function (s) {
      return s.replace(/^[是：:，,。？?\s]+/, '').replace(/[？?了的呢吧\s]+$/, '');
    }).filter(function (s) { return s; }).slice(0, 4);
  }

  function build(shape, options) {
    var hint = '', aiNote = '';
    if (shape === 'multi' || shape === 'either-or') {
      var opts = options.length >= 2 ? '（' + options.join(' / ') + '）' : '';
      hint = '检测到「多选一」式问法' + opts + '：卦面无专爻代表各选项，硬断必致各执一象。三种改法任选——\n' +
        '① 趋势题（推荐，一卦即够）：改问「维持现状（照原方案先不动），走势如何」——断吉则守；断凶则盘中动爻与变卦自会指出当变之机。\n' +
        '② 定向假设题：逐项各占一卦，每卦只问一个假设（如「若取其中一项，效果如何」），焚祝专一；忌同一问题连环滥问——《易·蒙》「再三渎」所忌者是滥问，非定向再占。\n' +
        '③ 保持原问不改：也可直接断——断卦将按「当前态势 → 核对节点 → 各选项适用条件」的决策树输出，不强制站队。';
      aiNote = '【问法处理】所测为多选一式问法：卦面无专爻代表各选项，不得强制站队单选其一，' +
        '也不得把用神或应爻兼作「某个选项/某一方」的代表。按以下次序输出：先断当前态势与用神主线，' +
        '再给出可核对的节点（出空、填实、值日、变爻值日等），最后按条件分支说明各选项的适用情形，' +
        '每个分支注明所依据的盘面要素。';
    } else if (shape === 'should-i') {
      hint = '「该不该／要不要」式问法建议改趋势题：改问「若维持现状，走势如何」——吉则可为，凶则盘中自示变机与应期。也可保持原问，断卦会先断走势再论取舍。';
      aiNote = '【问法处理】所测为「该不该」式问法：先断「维持现状」的走势，再据盘面动变给出动与守的时机与应期，不得脱离盘面空谈选择。';
    }
    return { shape: shape, options: options, hint: hint, aiNote: aiNote };
  }

  /**
   * @param {string} question 所测之事原文（自定义输入）
   * @returns {{shape:'multi'|'either-or'|'should-i'|null, options:string[], hint:string, aiNote:string}}
   *   shape=null 表示正常问法，hint/aiNote 均为空串。
   */
  function questionShape(question) {
    const q = String(question == null ? '' : question);
    if (!q) return { shape: null, options: [], hint: '', aiNote: '' };
    // n 为**连接义**连接词总数：「或者」恒计，「还是」只计非副词位。
    // 旧版 n 计全部出现位，n>=2 路径又完全不过副词排除——两个副词「还是」
    // 的句子（「他还是不来，还是算了吧」）会误判 multi；现在该路径与
    // n===1 路径同一口径（2026-10-21 修正）。
    const n = countConnectors(q);
    if (n >= 2) return build('multi', splitOptions(q));
    if (RE_REPEAT.test(q)) return build('either-or', []);
    // 单个连接义连接词即二选一（「或者」无歧义；「还是」的连接义位已由
    // countConnectors 保证非副词，旧版此处再查一次 indexOf 首位，句首副词
    // 会遮住后文的连接义——如「他还是不来，还是换一家」漏报 either-or）。
    if (n === 1) return build('either-or', []);
    if (/该不该|要不要/.test(q)) return build('should-i', []);
    return { shape: null, options: [], hint: '', aiNote: '' };
  }

  /** 把检测结果渲染成 UI 提示块（shape=null 返回空串，调用方据此隐藏）。 */
  function questionShapeText(r) {
    if (!r || !r.shape) return '';
    return '问法提示：' + r.hint;
  }

  LY.questionShape = questionShape;
  LY.questionShapeText = questionShapeText;
})(typeof window !== 'undefined' ? window : globalThis);
