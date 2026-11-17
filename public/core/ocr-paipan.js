/* ============================================================
 * 截图导入排盘 · 文本解析层（本文件不碰 DOM，Node 可直接测）
 *
 * 场景：王哥在「六爻排盘宝」这类手机 App 里排好的盘，只剩截图。
 *   截图 → 系统 OCR（Windows.Media.Ocr，在 C# 外壳里跑）→ 若干带坐标的文本行
 *   → 本模块读成「本卦 / 变卦 / 四柱 / 占问 / 动爻」
 *   → 交回 app.js 走既有的干支口重排一遍，六亲六神伏神全由引擎现算。
 *
 * 为什么只取这几样（照六爻工坊 Flutter 版 paipan_parser.dart 的思路）：
 *   六亲、纳甲、六神、伏神、旬空**全都能由卦名 + 日柱推出来**，而 OCR 读那几列
 *   最容易错（实测「巳」读成「已」、「午」读成「干」）。与其信一张读歪的表，
 *   不如只取不可推算的「卦名 + 四柱」，其余让引擎重算——读错一个字也只错一处。
 *
 * 输入两种形态都吃：
 *   ① 纯文本（自己粘贴、别处复制来的）
 *   ② OCR 行：「top \t left \t 文本」每行一条（带坐标才能把同一横排的
 *      「玄」「虎」和爻画、把「震:雷水解」「坤为地」对到一起）
 * ============================================================ */
(function (root) {
  const LY = root.LY = root.LY || {};

  const GAN = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'];
  const ZHI = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];

  /* 地支同形误识别 → 正字（只在「干支」这种强约束位置替换，不全文乱改） */
  const ZHI_FIX = { '已': '巳', '己': '巳', '末': '未', '干': '午', '戍': '戌', '西': '酉', '中': '申', '卵': '卯' };

  const HEX_FULL = [
    '乾为天', '天风姤', '天山遁', '天地否', '风地观', '山地剥', '火地晋', '火天大有',
    '坎为水', '水泽节', '水雷屯', '水火既济', '泽火革', '雷火丰', '地火明夷', '地水师',
    '艮为山', '山火贲', '山天大畜', '山泽损', '火泽睽', '天泽履', '风泽中孚', '风山渐',
    '震为雷', '雷地豫', '雷水解', '雷风恒', '地风升', '水风井', '泽风大过', '泽雷随',
    '巽为风', '风天小畜', '风火家人', '风雷益', '天雷无妄', '火雷噬嗑', '山雷颐', '山风蛊',
    '离为火', '火山旅', '火风鼎', '火水未济', '山水蒙', '风水涣', '天水讼', '天火同人',
    '坤为地', '地雷复', '地泽临', '地天泰', '雷天大壮', '泽天夬', '水天需', '水地比',
    '兑为泽', '泽山咸', '泽地萃', '泽水困', '山水蹇', '地山谦', '雷山小过', '雷泽归妹'
  ];

  /* 六神：OCR 常只读到单字（玄/虎/蛇/勾/雀/龙），两种都认 */
  const BEAST_ORDER = ['青龙', '朱雀', '勾陈', '螣蛇', '白虎', '玄武'];   // 初爻 → 上爻
  const BEAST_ALIAS = {
    '青龙': '青龙', '青': '青龙', '龙': '青龙',
    '朱雀': '朱雀', '朱': '朱雀', '雀': '朱雀',
    '勾陈': '勾陈', '勾': '勾陈',
    '螣蛇': '螣蛇', '腾蛇': '螣蛇', '蛇': '螣蛇',
    '白虎': '白虎', '白': '白虎', '虎': '白虎',
    '玄武': '玄武', '玄': '玄武'
  };

  /* ---------- 小工具 ---------- */

  function norm(text) {
    return String(text == null ? '' : text)
      .replace(/\r\n?/g, '\n')
      .replace(/[\u3000\u00a0]/g, ' ')
      .replace(/：/g, ':')
      .replace(/（/g, '(').replace(/）/g, ')');
  }

  const compactOf = function (s) { return String(s).replace(/\s+/g, ''); };

  function isGan(ch) { return GAN.indexOf(ch) >= 0; }
  function isZhi(ch) { return ZHI.indexOf(ch) >= 0; }

  /* 「X支」校正成合法干支；非六十甲子内的一律丢（甲丑之类） */
  function fixGanZhi(pair) {
    if (!pair || pair.length < 2) return null;
    let g = pair[0], z = pair[1];
    if (ZHI_FIX[z]) z = ZHI_FIX[z];
    if (!isGan(g) || !isZhi(z)) return null;
    if ((GAN.indexOf(g) % 2) !== (ZHI.indexOf(z) % 2)) return null;
    return g + z;
  }

  function ganZhiIndex(gz) {
    if (!gz || gz.length !== 2) return -1;
    const gi = GAN.indexOf(gz[0]), zi = ZHI.indexOf(gz[1]);
    if (gi < 0 || zi < 0) return -1;
    for (let i = 0; i < 60; i++) if (i % 10 === gi && i % 12 === zi) return i;
    return -1;
  }

  function editDist(a, b) {
    const n = a.length, m = b.length;
    if (Math.abs(n - m) > 2) return 9;
    const dp = [];
    for (let i = 0; i <= n; i++) dp[i] = [i];
    for (let j = 0; j <= m; j++) dp[0][j] = j;
    for (let i = 1; i <= n; i++) {
      for (let j = 1; j <= m; j++) {
        dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1,
          dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
    }
    return dp[n][m];
  }

  /* ---------- 输入 → 逻辑行 ---------- */

  /* OCR 行格式「top<TAB>left<TAB>text」。没有坐标的纯文本也能吃（坐标按行号×40 模拟，
   * 保证相邻原文行不会被误并为同一横排）。 */
  function toRows(raw) {
    const text = norm(raw);
    const lines = text.split('\n');
    const rows = [];
    let hasCoord = 0;
    lines.forEach(function (line, idx) {
      const m = line.match(/^\s*(-?\d+)\s*\t\s*(-?\d+)\s*\t(.*)$/);
      if (m) {
        hasCoord++;
        rows.push({ top: +m[1], left: +m[2], text: m[3], compact: compactOf(m[3]), idx: idx });
      } else if (line.trim()) {
        rows.push({ top: idx * 40, left: 0, text: line, compact: compactOf(line), idx: idx, noCoord: true });
      }
    });
    return { rows: rows, hasCoord: hasCoord > 0 };
  }

  /* 同一横排聚类：OCR 会把「坤为地」和「震:雷水解」判成两行（y 差 1px），
   * 也会把「玄」「财戌土」「■■」判成三段。按 top 归堆后再按 left 排序拼成一行。 */
  function groupRows(rows, tol) {
    tol = tol || 34;
    const sorted = rows.slice().sort(function (a, b) { return a.top - b.top || a.left - b.left; });
    const groups = [];
    sorted.forEach(function (r) {
      const g = groups[groups.length - 1];
      if (g && Math.abs(r.top - g.top) <= tol) {
        g.items.push(r);
        g.top = Math.min(g.top, r.top);
      } else {
        groups.push({ top: r.top, items: [r] });
      }
    });
    groups.forEach(function (g) {
      g.items.sort(function (a, b) { return a.left - b.left; });
      g.compact = g.items.map(function (x) { return x.compact; }).join('');
      g.minLeft = g.items[0].left;
      g.maxLeft = g.items[g.items.length - 1].left;
    });
    return groups;
  }

  /* ---------- 1. 四柱 ---------- */

  function readPillars(fullCompact) {
    const out = { yearGZ: null, monthGZ: null, monthZhi: null, dayGZ: null, dayIdx: -1, hourGZ: null, hourZhi: null };

    /* 在压缩文本上扫「X支 + 年/月/日/时」。同一柱只认第一次，重复出现的多是
     * 卦里的纳甲干支，不该覆盖表头。 */
    /* ⚠ 千万别用 [甲-龥]：甲是 U+7532，而「乙丙丁」的码位都在它之前，
     * 实测「月日:(丙午年)己亥月乙未日」会被整段漏掉（pan2 就栽在这）。
     * 用完整的 CJK 基本区范围，靠 fixGanZhi 去校验真伪。 */
    const re = /([\u4e00-\u9fa5])([\u4e00-\u9fa5])([年月日时])/g;
    let m;
    while ((m = re.exec(fullCompact))) {
      const gz = fixGanZhi(m[1] + m[2]);
      if (!gz) continue;
      const suffix = m[3];
      if (suffix === '年' && !out.yearGZ) out.yearGZ = gz;
      else if (suffix === '月') {
        if (!out.monthZhi) out.monthZhi = ZHI.indexOf(gz[1]);
        if (!out.monthGZ) out.monthGZ = gz;
      } else if (suffix === '日' && !out.dayGZ) out.dayGZ = gz;
      else if (suffix === '时') {
        if (!out.hourZhi) out.hourZhi = ZHI.indexOf(gz[1]);
        if (!out.hourGZ) out.hourGZ = gz;
      }
    }

    /* 兜底：「日辰/日建/日柱」后面直接跟干支 */
    if (!out.dayGZ) {
      const dm = fullCompact.match(/(?:日辰|日建|日柱|日干)([\u4e00-\u9fa5])([\u4e00-\u9fa5])/);
      if (dm) { const gz = fixGanZhi(dm[1] + dm[2]); if (gz) out.dayGZ = gz; }
    }
    if (out.dayGZ) out.dayIdx = ganZhiIndex(out.dayGZ);
    // 年柱索引也留着：干支口装盘要 yearIdx（决定月干五虎遁）
    out.yearIdx = out.yearGZ ? ganZhiIndex(out.yearGZ) : -1;
    out.hourGZIdx = out.hourGZ ? ganZhiIndex(out.hourGZ) : -1;
    return out;
  }

  /* ---------- 2. 卦名 ---------- */

  const isCJK = function (ch) { return /[\u4e00-\u9fa5]/.test(ch); };

  /* 在（已压缩的）一行里挑最像卦名的那个：先精确，再容忍错 1 个字。
   *
   * 模糊匹配必须把「窗口里带标点」的候选排除掉：排盘宝的写法是「震:雷水解」，
   * 滑窗会取到「震:雷」——它与「震为雷」的编辑距离恰好是 1（:→为），
   * 会被当成命中，于是「震:雷水觧」被认成震为雷而不是雷水解（实测栽过）。 */
  function bestHexInLine(compact) {
    let best = null;
    for (let i = 0; i < HEX_FULL.length; i++) {
      const name = HEX_FULL[i];
      if (compact.indexOf(name) >= 0) return { name: name, dist: 0, at: compact.indexOf(name) };
    }
    for (let i = 0; i < HEX_FULL.length; i++) {
      const name = HEX_FULL[i];
      for (let s = 0; s + 3 <= compact.length; s++) {
        const seg = compact.slice(s, s + 3);
        // 三个字必须都是汉字：带「:」「、」「．」的窗口不是卦名
        if (!isCJK(seg[0]) || !isCJK(seg[1]) || !isCJK(seg[2])) continue;
        const d = editDist(seg, name);
        if (d <= 1 && (!best || d < best.dist)) best = { name: name, dist: d, at: s };
      }
    }
    return best;
  }

  /* 列出所有「卦名出现位置」：{name, dist, top, left, groupIdx, atInGroup} */
  function readHexNames(groups) {
    const found = [];
    groups.forEach(function (g, gi) {
      /* 一行里可能有两个卦名（本卦|变卦并排），所以要循环取而不是取一个就完。
       * 用 replace 打洞的办法避免同一名字被重复命中。 */
      let scan = g.compact;
      const guard = scan.length;
      for (let pass = 0; pass < 3; pass++) {
        const hit = bestHexInLine(scan);
        if (!hit) break;
        // 用该卦名占位，防止下一轮又命中同一个位置
        const left = g.items.reduce(function (acc, it) {
          return acc + (it.compact.indexOf(hit.name) >= 0 ? it.left : 0);
        }, 0);
        found.push({
          name: hit.name, dist: hit.dist, group: gi, top: g.top,
          left: left || g.minLeft, atInGroup: hit.at
        });
        const start = hit.at;
        let seg = scan.slice(0, start) + new Array(hit.name.length + 1).join('\u0001') + scan.slice(start + hit.name.length);
        // 模糊命中时，也要抹掉被误读的那三个字，否则会一直命中同一处
        seg = seg.replace(/\u0001+/g, '\u0001\u0001\u0001');
        if (seg === scan) break;
        scan = seg;
        if (guard !== scan.length) break;
      }
    });

    /* 同名只留第一次（表头、卦名、底部提示里可能各出现一次） */
    const uniq = [];
    const seen = {};
    found.forEach(function (h) {
      if (seen[h.name]) return;
      seen[h.name] = 1;
      uniq.push(h);
    });
    return uniq;
  }

  /* 本卦 / 变卦
   *   A（排盘宝）：同一横排「震:雷水解    坤为地」——左本右变
   *   B：「本卦:雷水解 变卦:雷天大壮」或有「之」字
   *   C：只有一卦（静卦） */
  function readPair(text, hexes) {
    if (!hexes.length) return { ben: null, bian: null, how: '' };

    const pick = function (snippet) {
      if (!snippet) return null;
      const hit = bestHexInLine(compactOf(snippet));
      return hit ? hit.name : null;
    };
    const benM = text.match(/(?:本卦|主卦)\s*:?\s*(.{0,8})/);
    const bianM = text.match(/(?:变卦|之卦)\s*:?\s*(.{0,8})/);
    let ben = pick(benM && benM[1]);
    let bian = pick(bianM && bianM[1]);
    let how = (ben || bian) ? 'label' : '';

    /* A：找「同一 group 里有两个不同卦名」的那一排，左本右变 */
    if (!ben) {
      const byGroup = {};
      hexes.forEach(function (h) { (byGroup[h.group] = byGroup[h.group] || []).push(h); });
      let chosen = null;
      Object.keys(byGroup).forEach(function (k) {
        const arr = byGroup[k];
        if (arr.length >= 2 && !chosen) {
          arr.sort(function (a, b) { return a.atInGroup - b.atInGroup; });
          if (arr[0].name !== arr[1].name) chosen = [arr[0].name, arr[1].name];
        }
      });
      if (chosen) { ben = chosen[0]; bian = chosen[1]; how = 'same-row'; }
    }

    if (!ben) { ben = hexes[0].name; how = 'first'; }
    if (!bian) {
      for (let i = 1; i < hexes.length; i++) {
        if (hexes[i].name !== ben) { bian = hexes[i].name; how = how || 'second'; break; }
      }
    }
    if (bian === ben) bian = null;
    return { ben: ben, bian: bian, how: how };
  }

  /* ---------- 3. 动爻 ---------- */

  /* 三路取动爻，按可靠性排序：
   *   ① 爻画行的 ○/×/✕（老阳/老阴标记）—— 符号就在爻位上，最准
   *   ② 本卦 + 变卦 的卦象差异反推（引擎侧也算，这里只给 pair 的差异便于预览）
   *   ③ 都没有 → 静卦
   * OCR 实测读不到 ○×（太小），所以②是主力。 */
  const DONG_RE = /[○×✕✖〇◎]/;

  function readMovingFromBeasts(groups) {
    /* 六神行是逐爻的：玄武=上、白虎=五、螣蛇=四、勾陈=三、朱雀=二、青龙=初。
     * 把每个六神所在的那一横排整体看一眼，有 ○× 就记该爻动。 */
    const byBeast = {};
    groups.forEach(function (g, gi) {
      const comp = g.compact;
      /* 只认「以六神开头」的行，避免把「天喜-未」这种误当六神 */
      for (const k in BEAST_ALIAS) {
        if (comp.indexOf(k) === 0 || comp.indexOf(k + ':') === 0) {
          if (!byBeast[BEAST_ALIAS[k]]) byBeast[BEAST_ALIAS[k]] = { g: g, gi: gi };
          break;
        }
      }
    });
    const names = Object.keys(byBeast);
    if (names.length < 6) return null;

    const dong = [];
    for (let i = 0; i < 6; i++) {
      const beast = BEAST_ORDER[i];
      const rec = byBeast[beast];
      if (!rec) continue;
      if (DONG_RE.test(rec.g.compact)) dong.push(i + 1);
    }
    return dong;
  }

  /* 由两卦差异反推动爻（本卦 010100 → 变卦 000000 → 动二、四） */
  function diffMoving(benBits, bianBits) {
    if (!benBits || !bianBits || benBits.length !== 6 || bianBits.length !== 6) return null;
    const d = [];
    for (let i = 0; i < 6; i++) if (benBits[i] !== bianBits[i]) d.push(i + 1);
    return d;
  }

  /* ---------- 4. 占问 / 方式 / 公历 ---------- */

  function readQuestion(fullCompact) {
    const m = fullCompact.match(/占(?:问|事|间|念)?:([^\n]{1,40}?)(?=卦身|神煞|时间|月日|方式|$)/);
    if (m && m[1]) return m[1];
    const m2 = fullCompact.match(/(?:问念|求测|测事|问题):([^\n]{1,40}?)(?=卦身|神煞|时间|月日|$)/);
    return m2 && m2[1] ? m2[1] : '';
  }

  function readMethod(fullCompact) {
    if (/电脑卦|电脑排卦/.test(fullCompact)) return '电脑卦';
    if (/手工卦|手工排卦/.test(fullCompact)) return '手工卦';
    if (/时间卦/.test(fullCompact)) return '时间卦';
    if (/数字卦/.test(fullCompact)) return '数字卦';
    return '';
  }

  function readSolar(fullCompact) {
    const m = fullCompact.match(/(?:阳历|公历)?(\d{4})年(\d{1,2})月(\d{1,2})日(\d{1,2})?[时点]?(\d{1,2})?分?/);
    if (!m) return null;
    const y = +m[1], mo = +m[2], d = +m[3];
    const hh = m[4] == null || m[4] === '' ? 0 : +m[4];
    const mm = m[5] == null || m[5] === '' ? 0 : +m[5];
    if (y < 1900 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return { y: y, m: mo, d: d, hh: hh, mm: mm };
  }

  /* ---------- 5. 总入口 ---------- */

  /* parse(raw) → {
   *   ok, benName, bianName, dong:[], dongFrom:'glyph'|'diff'|'none',
   *   pillars:{...}, question, method, solar, warnings:[], hexes:[], rows, raw }
   * benBits/bianBits 由调用方（app.js）按卦名算，本模块不依赖引擎。 */
  function parse(raw, opt) {
    opt = opt || {};
    const text = norm(raw);
    const built = toRows(raw);
    const groups = groupRows(built.rows);

    const fullCompact = compactOf(text.replace(/^\s*-?\d+\s*\t\s*-?\d+\s*\t/gm, ''));
    const pil = readPillars(fullCompact);
    const hexes = readHexNames(groups);
    const pair = readPair(text, hexes);
    const question = readQuestion(fullCompact);
    const method = readMethod(fullCompact);
    const solar = readSolar(fullCompact);

    /* 动爻取法（按可靠性排）：
     *   ① 本卦→变卦 的卦象差异——卦名是整段里最稳的东西，差异必然就是动爻，
     *      且天然自洽（重排后得到的变卦一定等于截图上的变卦）；
     *   ② 爻画行的 ○/× 符号——实测 886×1920 的手机截图里这些符号太小，
     *      Windows OCR 一个都读不出来，只能当补充；
     *   ③ 都没有 → 静卦。
     * 原来把①放在②后面，结果「读到六神行但没读到符号」会返回空数组，
     * 把真动爻盖掉（pan1 的二、四爻就是这么丢的）。 */
    let dong = [], dongFrom = 'none';
    const byDiff = (opt.benBits && opt.bianBits) ? diffMoving(opt.benBits, opt.bianBits) : null;
    const byGlyph = readMovingFromBeasts(groups);

    if (byDiff && byDiff.length) { dong = byDiff; dongFrom = 'diff'; }
    else if (byGlyph && byGlyph.length) { dong = byGlyph; dongFrom = 'glyph'; }

    const warnings = [];
    /* 只有「两路都真的读到了东西」且不一致才算冲突。
     * 实测 byGlyph 常是空数组（手机截图里的 ○× 太小读不出），
     * 旧条件会让它和 byDiff 一比就报「不一致」，纯属噪音。 */
    if (byGlyph && byGlyph.length && byDiff && byDiff.length && byGlyph.join(',') !== byDiff.join(',')) {
      warnings.push('爻画符号读到的动爻（' + (byGlyph.join('、') || '无') +
        '）与两卦差异（' + (byDiff.join('、') || '无') + '）不一致，已按两卦差异为准，请核对');
    }
    if (!pair.ben) warnings.push('没认出本卦卦名——请从下拉里手动选一个');
    if (pil.dayIdx < 0) warnings.push('没认出日柱干支——日干决定六神，必须手填');
    if (!solar) warnings.push('没认出公历时刻（只影响补录占时，不影响盘面）');
    if (!pair.bian && dongFrom === 'none') warnings.push('只有一卦、也没读到动爻符号——按静卦处理');
    const fuzzy = hexes.filter(function (h) { return h.dist > 0; });
    if (fuzzy.length) warnings.push('卦名是近似匹配：' + fuzzy.map(function (h) { return h.name; }).join('、') + '——请核对');

    return {
      ok: !!(pair.ben && pil.dayIdx >= 0),
      benName: pair.ben,
      bianName: pair.bian,
      pairHow: pair.how,
      dong: dong,
      dongFrom: dongFrom,
      pillars: pil,
      question: question,
      method: method,
      solar: solar,
      warnings: warnings,
      hexes: hexes.map(function (h) { return { name: h.name, dist: h.dist, top: h.top }; }),
      rowCount: groups.length,
      hasCoord: built.hasCoord,
      raw: text
    };
  }

  LY.ocrPaipan = {
    parse: parse,
    HEX_FULL: HEX_FULL,
    _internals: {
      norm: norm, compactOf: compactOf, fixGanZhi: fixGanZhi, ganZhiIndex: ganZhiIndex,
      toRows: toRows, groupRows: groupRows, readPillars: readPillars,
      readHexNames: readHexNames, readPair: readPair, diffMoving: diffMoving,
      readMovingFromBeasts: readMovingFromBeasts, readQuestion: readQuestion,
      readSolar: readSolar, bestHexInLine: bestHexInLine, editDist: editDist
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
