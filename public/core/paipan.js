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

  // ---------- 排盘主函数 ----------
  // tossVals: 自下而上 6 项；1=少阳(单) 0=少阴(拆) 9=老阳(重·动) 6=老阴(交·动)
  function paipan(tossVals, dt) {
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
  LY.PALACE = PALACE; LY.paipan = paipan;
})(typeof window !== 'undefined' ? window : globalThis);
