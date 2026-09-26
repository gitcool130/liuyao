/* ============================================================
 * 历法底座 (core/calendar.js)
 * JDN / 四柱 / 旬空 / 节气查表（十二节交节时刻，分钟级）
 * 依赖 core/data.js 与 core/data-jieqi.js 先行加载。
 *
 * —— 子时切分流派声明（M2）——
 * LY.nightZiMode = 'day'（默认）：23:00–24:00 为当日夜子时，
 *   日柱不变、时干依当日日干五鼠遁（主流派，与旧版行为一致）；
 * LY.nightZiMode = 'next'：23:00–24:00 归次日，日柱进一位
 *   （换日说，部分门派采用）。
 * ============================================================ */
(function (root) {
  const LY = root.LY = root.LY || {};
  const GAN = LY.GAN, ZHI = LY.ZHI, ZHI_WX = LY.ZHI_WX;
  const WUHU = { 甲: 2, 己: 2, 乙: 4, 庚: 4, 丙: 6, 辛: 6, 丁: 8, 壬: 8, 戊: 0, 癸: 0 }; // 五虎遁：年干 → 寅月天干
  const WUSHU = { 甲: 0, 己: 0, 乙: 2, 庚: 2, 丙: 4, 辛: 4, 丁: 6, 壬: 6, 戊: 8, 癸: 8 }; // 五鼠遁：日干 → 子时天干

  LY.nightZiMode = 'day'; // 'day' | 'next'

  // ---------- 儒略日数（格里历） ----------
  function jdn(y, m, d) {
    const a = Math.floor((14 - m) / 12);
    const yy = y + 4800 - a;
    const mm = m + 12 * a - 3;
    return d + Math.floor((153 * mm + 2) / 5) + 365 * yy + Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400) - 32045;
  }

  // JDN → 公历日期（Fliegel & Van Flandern 逆变换）
  function jdnToDate(j) {
    const a = j + 32044;
    const b = Math.floor((4 * a + 3) / 146097);
    const c = a - Math.floor(146097 * b / 4);
    const d = Math.floor((4 * c + 3) / 1461);
    const e = c - Math.floor(1461 * d / 4);
    const m = Math.floor((5 * e + 2) / 153);
    return {
      y: 100 * b + d - 4800 + Math.floor(m / 10),
      m: m + 3 - 12 * Math.floor(m / 10),
      d: e - Math.floor((153 * m + 2) / 5) + 1
    };
  }

  // ---------- 节气查表（十二节，分钟级，北京时 UTC+8） ----------
  // 差分链前缀和 → 绝对分钟表（模块加载时一次性展开，纯查表零计算）
  const TERM_ABS = (function () {
    const ds = LY.JIEQI_DELTAS;
    const abs = new Array(ds.length);
    let acc = 0;
    for (let i = 0; i < ds.length; i++) { acc += ds[i]; abs[i] = acc; }
    return abs;
  })();
  const YEAR0 = 1900;

  // 第 idx 个交节的绝对分钟数 → { y, m, d, hour, minute }
  function termAbsToDate(absMin) {
    const dayJdn = LY.JIEQI_ANCHOR_JDN + Math.floor(absMin / 1440);
    const date = jdnToDate(dayJdn);
    const rem = absMin % 1440;
    return { y: date.y, m: date.m, d: date.d, hour: Math.floor(rem / 60), minute: rem % 60 };
  }

  // year 年 month 月（公历）之「节」的交节时刻 → { y, m, day, hour, minute }
  // 月节对应：1月小寒 2月立春 … 12月大雪
  function termMoment(year, month) {
    if (year < YEAR0 || year > 2100) return null; // 表覆盖 1900-2100
    const idx = (year - YEAR0) * 12 + (month - 1);
    const t = termAbsToDate(TERM_ABS[idx]);
    return { y: t.y, m: t.m, day: t.d, hour: t.hour, minute: t.minute };
  }

  // 兼容旧 API：交节日（天粒度）。已废弃，仅供旧调用方，勿用于新逻辑。
  function termDay(year, month) {
    const t = termMoment(year, month);
    return t ? t.day : 1;
  }

  // 日柱：以 1949-10-01 甲子日校准 → index = (JDN + 49) % 60
  function dayGanZhiIndex(y, m, d) {
    return ((jdn(y, m, d) + 49) % 60 + 60) % 60;
  }

  // 月支：公历 y-m-d h:min 是否已过当月之节（精确到分钟）
  // 已过 → 本月支（1→丑 2→寅 … 12→子）；未过 → 前一月支
  function monthZhiIndex(y, m, d, hour, minute) {
    const t = termMoment(y, m);
    const hh = hour || 0, mm = minute || 0;
    if (!t) return d >= 15 ? (m % 12) : ((m - 1 + 12) % 12); // 超表范围兜底（不应发生于 1900-2100）
    const cur = d * 1440 + hh * 60 + mm;
    const term = t.day * 1440 + t.hour * 60 + t.minute;
    return cur >= term ? (m % 12) : ((m - 1 + 12) % 12);
  }

  // 年柱：以立春（精确到分钟）为界
  function yearGanZhiIndex(y, m, d, hour, minute) {
    let yy = y;
    if (m < 2) yy--;
    else if (m === 2) {
      const t = termMoment(y, 2); // 立春
      const cur = d * 1440 + (hour || 0) * 60 + (minute || 0);
      const term = t.day * 1440 + t.hour * 60 + t.minute;
      if (cur < term) yy--;
    }
    return ((yy - 4) % 60 + 60) % 60;
  }

  function ganzhiOfIndex(idx) {
    return GAN[idx % 10] + ZHI[idx % 12];
  }

  // ---------- 完整四柱 ----------
  // 月干依五虎遁，时干依五鼠遁；hour/minute 参与节气与子时边界判断
  function fourPillars(dt) {
    let y = dt.getFullYear(), m = dt.getMonth() + 1, d = dt.getDate();
    const h = dt.getHours(), min = dt.getMinutes();

    // 夜子时流派：23:00-24:00 日柱归属
    let nightZi = false;
    if (h === 23) {
      if (LY.nightZiMode === 'next') {
        nightZi = true;
        const nd = new Date(y, m - 1, d + 1); // 次日
        y = nd.getFullYear(); m = nd.getMonth() + 1; d = nd.getDate();
      }
    }

    const yIdx = yearGanZhiIndex(y, m, d, h, min);
    const mz = monthZhiIndex(y, m, d, h, min);
    const monthsFromYin = (mz - 2 + 12) % 12;
    const mGan = (WUHU[GAN[yIdx % 10]] + monthsFromYin) % 10;
    const dIdx = dayGanZhiIndex(y, m, d);
    const hZhi = Math.floor((h + 1) / 2) % 12;
    const hGan = (WUSHU[GAN[dIdx % 10]] + hZhi) % 10;
    // 旬空
    const xunStart = dIdx - (dIdx % 10);
    const startBranch = xunStart % 12;
    const kong = [(startBranch + 10) % 12, (startBranch + 11) % 12];
    return {
      yearIdx: yIdx, yearGZ: ganzhiOfIndex(yIdx),
      monthGZ: GAN[mGan] + ZHI[mz], monthZhi: mz, monthGan: mGan,
      dayIdx: dIdx, dayGZ: ganzhiOfIndex(dIdx), dayGan: dIdx % 10, dayZhi: dIdx % 12,
      hourGZ: GAN[hGan] + ZHI[hZhi], hourZhi: hZhi,
      nightZi: nightZi, nightZiMode: LY.nightZiMode,
      kong: kong, kongStr: ZHI[kong[0]] + ZHI[kong[1]]
    };
  }

  // 六神起法：甲乙青龙，丙丁朱雀，戊勾陈，己腾蛇，庚辛白虎，壬癸玄武
  function beastStart(dayGanIdx) {
    const g = dayGanIdx % 10;
    if (g === 0 || g === 1) return 0;
    if (g === 2 || g === 3) return 1;
    if (g === 4) return 2;
    if (g === 5) return 3;
    if (g === 6 || g === 7) return 4;
    return 5;
  }

  LY.jdn = jdn;
  LY.jdnToDate = jdnToDate;
  LY.termMoment = termMoment;
  LY.termDay = termDay;
  LY.dayGanZhiIndex = dayGanZhiIndex;
  LY.monthZhiIndex = monthZhiIndex;
  LY.yearGanZhiIndex = yearGanZhiIndex;
  LY.ganzhiOfIndex = ganzhiOfIndex;
  LY.fourPillars = fourPillars;
  LY.beastStart = beastStart;
})(typeof window !== 'undefined' ? window : globalThis);
