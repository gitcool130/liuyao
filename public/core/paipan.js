/* ============================================================
 * 排盘事实引擎 (core/paipan.js)
 * 纳甲装卦 / 六亲 / 六神 / 世应 / 伏神。纯函数，零 I/O。
 * 依赖 core/data.js 与 core/calendar.js 先行加载。
 * AI 不算卦盘：本层只陈述排盘事实，不作吉凶判断。
 * ============================================================ */
(function (root) {
  const LY = root.LY = root.LY || {};
  const GAN = LY.GAN, ZHI = LY.ZHI, ZHI_WX = LY.ZHI_WX, BEASTS = LY.BEASTS;
  const TRIG = LY.TRIG, HEXNAMES = LY.HEXNAMES, LIUHE = LY.LIUHE;
  const SHENG = LY.SHENG, KE = LY.KE;

  // ---------- 五行关系 ----------
  function sheng(a, b) { return SHENG[a] === b; } // a 生 b
  function ke(a, b) { return KE[a] === b; }       // a 克 b
  function chong(a, b) { return ((a - b + 12) % 12) === 6; }
  function liuhe(a, b) { return LIUHE[a] === b; }

  // 六亲：palaceWx 卦宫五行（"我"），lineWx 爻支五行
  function liuqin(palaceWx, lineWx) {
    if (palaceWx === lineWx) return '兄弟';
    if (sheng(palaceWx, lineWx)) return '子孙'; // 我生
    if (sheng(lineWx, palaceWx)) return '父母'; // 生我
    if (ke(palaceWx, lineWx)) return '妻财';    // 我克
    if (ke(lineWx, palaceWx)) return '官鬼';    // 克我
    return '';
  }

  function trigOfBits(bits3) {
    for (const name of Object.keys(TRIG)) {
      if (TRIG[name].bits.join('') === bits3.join('')) return name;
    }
    return null;
  }

  function hexName(bits6) {
    return HEXNAMES[trigOfBits(bits6.slice(0, 3)) + trigOfBits(bits6.slice(3))];
  }

  // ---------- 八宫卦（京房）算法生成 ----------
  // 变爻次序：本宫(世5) → 一世(世0) → 二世(1) → 三世(2) → 四世(3) → 五世(4) → 游魂(世3) → 归魂(世2)
  const PALACE = (function () {
    const map = {};
    const palaces = ['乾', '坎', '艮', '震', '巽', '离', '坤', '兑'];
    const shiPos = [5, 0, 1, 2, 3, 4, 3, 2];
    const variants = [[], [0], [0, 1], [0, 1, 2], [0, 1, 2, 3], [0, 1, 2, 3, 4], [0, 1, 2, 4], [4]];
    palaces.forEach(function (p) {
      const pure = TRIG[p].bits.concat(TRIG[p].bits);
      variants.forEach(function (fl, i) {
        const bits = pure.slice();
        fl.forEach(function (k) { bits[k] ^= 1; });
        map[bits.join('')] = { palace: p, variant: i, shi: shiPos[i], ying: (shiPos[i] + 3) % 6 };
      });
    });
    return map;
  })();

  // ---------- 卦型判定：六冲卦 / 六合卦 / 游魂归魂 ----------
  // 六爻地支（初→上）：内卦取纳甲表前三位，外卦取后三位（同一卦内外纳甲相同，故表长 6）
  function lineZhis(bits6) {
    const lo = trigOfBits(bits6.slice(0, 3)), up = trigOfBits(bits6.slice(3));
    return TRIG[lo].najia.slice(0, 3).concat(TRIG[up].najia.slice(3))
      .map(function (c) { return ZHI.indexOf(c); });
  }
  const OPPO = [[0, 3], [1, 4], [2, 5]]; // 初-四 / 二-五 / 三-六
  // 六冲卦：三对地支皆相冲。全 64 卦共 10 个 —— 八纯卦 + 天雷无妄 + 雷天大壮。
  // 注：与「六冲卦」相对的「卦逢六冲」在断卦层另有含义，本函数只陈述卦画事实。
  // 注：本纳甲体系下内卦与外卦的纳支对应是刚性的，三对中任一对即等价于三对（实测
  //     「仅查初四」与「三对皆冲」给出同一集合）；此处仍按定义写全三对，冗余性由
  //     test-gua-types.js 第九节锁定，以便将来改动纳支表时得到提示。
  function chongGua(bits6) {
    const z = lineZhis(bits6);
    return OPPO.every(function (p) { return chong(z[p[0]], z[p[1]]); });
  }
  // 六合卦：三对地支皆六合。全 64 卦共 8 个 —— 地天泰·天地否·地雷复·雷地豫·水泽节·泽水困·山火贲·火山旅。
  function heGua(bits6) {
    const z = lineZhis(bits6);
    return OPPO.every(function (p) { return liuhe(z[p[0]], z[p[1]]); });
  }
  // 游魂/归魂：由八宫卦变爻次序定（京房八宫：第七变游魂、第八变归魂），各 8 个。
  // 取值来自 PALACE.variant（6=游魂 7=归魂），非查卦名表。
  function soulGua(bits6) {
    const p = PALACE[bits6.join('')];
    if (!p) return null;
    return p.variant === 6 ? '游魂' : p.variant === 7 ? '归魂' : null;
  }

  // ---------- 排盘主函数 ----------
  // tossVals: 自下而上 6 项；1=少阳(单) 0=少阴(拆) 9=老阳(重·动) 6=老阴(交·动)
  // 入参校验：本函数挂在 window.LY 上是公开 API，而内部换算 (v === 1 || v === 9) ? 1 : 0
  // 对非法值**静默错排**——传统铜钱记法 7/8 不在 {0,1,6,9} 内会被一律当作阴爻，排出一个
  // 毫不相干的卦却不报错；长度不足则抛 `Cannot read properties of undefined`。静默错排比
  // 报错危险得多（第十七轮就曾以 [6,7,7,7,7,7] 想排天风姤、实得坤为地），故此处显式拒绝。
  const TOSS_VALUES = [0, 1, 6, 9];
  function paipan(tossVals, dt) {
    if (!Array.isArray(tossVals) || tossVals.length !== 6) {
      throw new Error('paipan: tossVals 须为长度 6 的数组（自下而上），实得 ' +
        (Array.isArray(tossVals) ? '长度 ' + tossVals.length : Object.prototype.toString.call(tossVals)));
    }
    for (let i = 0; i < 6; i++) {
      const v = tossVals[i];
      if (typeof v !== 'number' || TOSS_VALUES.indexOf(v) < 0) {
        throw new Error('paipan: tossVals[' + i + '] = ' + JSON.stringify(v) +
          ' 非法，须为 1(少阳/单)、0(少阴/拆)、9(老阳/重·动)、6(老阴/交·动) 之一');
      }
    }
    // duck-typing 而非 instanceof：兼容跨 realm（vm / iframe）传入的 Date
    if (!dt || typeof dt.getTime !== 'function' || isNaN(dt.getTime())) {
      throw new Error('paipan: dt 须为有效 Date，实得 ' + Object.prototype.toString.call(dt));
    }
    const pil = LY.fourPillars(dt);
    const ben = tossVals.map(function (v) { return (v === 1 || v === 9) ? 1 : 0; });
    const moving = tossVals.map(function (v) { return (v === 9 || v === 6); });
    const bian = ben.map(function (b, i) { return moving[i] ? 1 - b : b; });

    const hasBian = moving.some(Boolean);
    const benKey = ben.join(''), bianKey = bian.join('');
    const benInfo = PALACE[benKey], bianInfo = PALACE[bianKey];
    const benLower = trigOfBits(ben.slice(0, 3)), benUpper = trigOfBits(ben.slice(3));
    const palaceWx = TRIG[benInfo.palace].wx; // "我"——变卦六亲亦以本卦宫五行为我
    const beastBase = LY.beastStart(pil.dayGan);

    const bianLower = hasBian ? trigOfBits(bian.slice(0, 3)) : null;
    const bianUpper = hasBian ? trigOfBits(bian.slice(3)) : null;

    // 首卦（本宫纯卦）反查伏神
    const benLqSet = {};
    for (let i = 0; i < 6; i++) {
      const zi = TRIG[i < 3 ? benLower : benUpper].najia[(i < 3 ? 0 : 3) + (i % 3)];
      const zhiIdx = ZHI.indexOf(zi);
      benLqSet[liuqin(palaceWx, ZHI_WX[zhiIdx])] = true;
    }
    const ALL_LQ = ['父母', '兄弟', '子孙', '妻财', '官鬼'];
    const missing = ALL_LQ.filter(function (l) { return !benLqSet[l]; });

    const lines = [];
    for (let i = 0; i < 6; i++) {
      const bTrig = i < 3 ? benLower : benUpper;
      const bPos = (i < 3 ? 0 : 3) + (i % 3); // 内卦取纳甲表前三位，外卦取后三位
      const ganC = TRIG[bTrig].gan[bPos];
      const zhiC = TRIG[bTrig].najia[bPos];
      const zhiIdx = ZHI.indexOf(zhiC);
      const wx = ZHI_WX[zhiIdx];
      let fu = null;
      if (missing.length) {
        const pureZhiC = TRIG[benInfo.palace].najia[i];
        const pureWx = ZHI_WX[ZHI.indexOf(pureZhiC)];
        const pureLq = liuqin(palaceWx, pureWx);
        if (missing.indexOf(pureLq) >= 0) {
          fu = { lq: pureLq, gan: TRIG[benInfo.palace].gan[i], zhi: pureZhiC, wx: pureWx, zhiIdx: ZHI.indexOf(pureZhiC) };
        }
      }
      lines.push({
        pos: i, gan: ganC, zhi: zhiC, zhiIdx: zhiIdx, wx: wx,
        lq: liuqin(palaceWx, wx),
        yang: ben[i] === 1, moving: moving[i], old: tossVals[i],
        beast: BEASTS[(beastBase + i) % 6],
        shi: benInfo.shi === i, ying: benInfo.ying === i,
        fu: fu,
        // `bian` 是「变卦**同位爻**的纳甲」，只要本卦有动爻（hasBian）六爻全有值——
        // **不是**「该爻发动后的值」。此为刻意设计：古籍排盘表的右半（变卦）对静爻位
        // 同样印出纳甲，回归比对必须能逐位取到；故**不可**改成「静爻 bian = null」。
        // 消费侧须自行判 L.moving（本仓 ruleDongBian / ruleMovingOthers / ruleSanHe 均已先判）。
        // 见 tests/verify/regress.mjs 的「API 语义陷阱」注与 tests/guji/lib/check.mjs。
        bian: hasBian ? (function () {
          const xTrig = i < 3 ? bianLower : bianUpper;
          const xPos = (i < 3 ? 0 : 3) + (i % 3);
          const xGan = TRIG[xTrig].gan[xPos], xZhi = TRIG[xTrig].najia[xPos];
          const xWx = ZHI_WX[ZHI.indexOf(xZhi)];
          return { gan: xGan, zhi: xZhi, wx: xWx, lq: liuqin(palaceWx, xWx) };
        })() : null
      });
    }

    return {
      tossVals: tossVals, benBits: ben, bianBits: bian, moving: moving, hasBian: hasBian,
      benName: hexName(ben), bianName: hasBian ? hexName(bian) : null,
      isLiuChong: chongGua(ben), isLiuHe: heGua(ben), soul: soulGua(ben),
      benLower: benLower, benUpper: benUpper,
      bianLower: bianLower, bianUpper: bianUpper,
      palace: benInfo.palace, palaceWx: palaceWx,
      bianPalace: hasBian ? bianInfo.palace : null,
      shi: benInfo.shi, ying: benInfo.ying,
      lines: lines, pillars: pil, date: dt
    };
  }

  LY.sheng = sheng; LY.ke = ke; LY.chong = chong; LY.liuhe = liuhe;
  LY.liuqin = liuqin; LY.trigOfBits = trigOfBits; LY.hexName = hexName;
  LY.chongGua = chongGua; LY.heGua = heGua; LY.soulGua = soulGua;
  LY.PALACE = PALACE; LY.paipan = paipan;
})(typeof window !== 'undefined' ? window : globalThis);
