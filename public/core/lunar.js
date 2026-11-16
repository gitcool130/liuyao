/* ============================================================
 * 中国农历（万年历）：农历日期换算 + 24 节气查表        (core/lunar.js)
 *
 * 数据来自 core/data-lunar.js（由 tools/gen-lunar.mjs 从 lunar-javascript 离线导出）：
 *   LUNAR_YEARS      每年：年,闰月(0=无),正月初一JDN,月大小串(3=30 2=29，含闰月，无闰补 0)
 *   JIEQI24_DELTAS   24 节气差分分钟链（首项为相对锚点 JDN 的分钟数）
 *
 * 只做两件事：① 公历 → 农历（年月日、闰月、月名日名、年干支、生肖）；
 *             ② 某公历月里的两个节气（名称 + 日 + 时分）。
 * 排盘的节气仍以 core/data-jieqi.js 为准（那是十二「节」，参与四柱），此处仅作日历展示。
 * 依赖 data.js（GAN/ZHI/jdn）先行加载。
 * ============================================================ */
(function (root) {
  'use strict';
  const LY = root.LY = root.LY || {};

  const MONTH_NAMES = ['正', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'];
  const DAY_NAMES = ['初一', '初二', '初三', '初四', '初五', '初六', '初七', '初八', '初九', '初十',
    '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十',
    '廿一', '廿二', '廿三', '廿四', '廿五', '廿六', '廿七', '廿八', '廿九', '三十'];
  const SHENGXIAO = ['鼠', '牛', '虎', '兔', '龙', '蛇', '马', '羊', '猴', '鸡', '狗', '猪'];

  let YEARS = null;          // [{ y, leap, jdn0, days: [30|29...] , ends: [jdn...] }]
  let JQ = null;             // { anchorJdn, abs: [绝对分钟...] }

  function ensureYears() {
    if (YEARS) return YEARS;
    const raw = LY.LUNAR_YEARS;
    if (!raw) throw new Error('lunar: 缺 LUNAR_YEARS（data-lunar.js 未加载）');
    YEARS = raw.split('\n').map(function (line) {
      const p = line.split(',');
      const days = [];
      for (let i = 0; i < p[3].length; i++) {
        const c = p[3].charAt(i);
        if (c === '3') days.push(30);
        else if (c === '2') days.push(29);
      }
      const y = +p[0];
      return { y: y, leap: +p[1], jdn0: +p[2], days: days };
    });
    return YEARS;
  }

  function ensureJieqi() {
    if (JQ) return JQ;
    const ds = LY.JIEQI24_DELTAS;
    if (!ds) throw new Error('lunar: 缺 JIEQI24_DELTAS（data-lunar.js 未加载）');
    const abs = new Array(ds.length);
    let acc = LY.JIEQI24_ANCHOR_JDN * 1440;
    for (let i = 0; i < ds.length; i++) { acc += ds[i]; abs[i] = acc; }
    JQ = { anchorJdn: LY.JIEQI24_ANCHOR_JDN, abs: abs };
    return JQ;
  }

  // 公历 y-m-d → JDN（与本仓 calendar.js 同一算式，纯整数，不受时区影响）
  function jdnOf(y, m, d) {
    if (typeof LY.jdn === 'function') return LY.jdn(y, m, d);
    const a = Math.floor((14 - m) / 12), yy = y + 4800 - a, mm = m + 12 * a - 3;
    return d + Math.floor((153 * mm + 2) / 5) + 365 * yy + Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400) - 32045;
  }

  function jdnToYmd(j) {
    if (typeof LY.jdnToDate === 'function') {
      const t = LY.jdnToDate(j);
      return { y: t.y, m: t.m, d: t.d };
    }
    return { y: 0, m: 0, d: 0 };
  }

  /** 公历日 → 农历。超出 1900–2100 返回 null（卡片上给一句提示，不猜）。 */
  function lunarOfDate(y, m, d) {
    const years = ensureYears();
    const j = jdnOf(y, m, d);
    const first = years[0], last = years[years.length - 1];
    if (j < first.jdn0) return null;
    const lastEnd = last.jdn0 + last.days.reduce(function (a, b) { return a + b; }, 0) - 1;
    if (j > lastEnd) return null;

    // 二分找所在农历年（jdn0 单调递增）
    let lo = 0, hi = years.length - 1, idx = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (years[mid].jdn0 <= j) { idx = mid; lo = mid + 1; } else { hi = mid - 1; }
    }
    const Y = years[idx];
    let rest = j - Y.jdn0;                 // 距正月初一的天数
    let mi = 0;
    while (mi < Y.days.length && rest >= Y.days[mi]) { rest -= Y.days[mi]; mi++; }
    if (mi >= Y.days.length) return null;  // 理论上不会发生（表覆盖到年末）

    // 闰月位置：leap 为「含闰的第几个月」（1 基）；mi 为 0 基
    /* leap 存的是「闰月在年内月序中的位置」（1 基，含闰月本身）：
     *   2025 年 months = [1,2,3,4,5,6,-6,7,...,12] → leap = 7（第 7 个是闰月）
     * 所以闰月那一位的**月号**等于它前一个月 = 位置 − 1；闰月之后的月号 = 位置。
     * 旧写法 `mi > leapAt ? mi : mi + 1` 把闰月自己算成了下一个月（2025 报「闰七月」）。 */
    const leapAt = Y.leap > 0 ? Y.leap - 1 : -1;
    const isLeap = mi === leapAt;
    const monthNo = (leapAt >= 0 && mi >= leapAt) ? mi : mi + 1;

    const yIdx = ((Y.y - 4) % 60 + 60) % 60;
    return {
      year: Y.y,
      month: monthNo,
      day: rest + 1,
      leap: isLeap,
      monthName: (isLeap ? '闰' : '') + MONTH_NAMES[monthNo - 1] + '月',
      dayName: DAY_NAMES[rest],
      yearGZ: LY.ganzhiOfIndex ? LY.ganzhiOfIndex(yIdx) : '',
      shengxiao: SHENGXIAO[((Y.y - 4) % 12 + 12) % 12],
      jdn: j
    };
  }

  /** 某公历年的 24 节气：[{name, jdn, hh, mm}]，按时间序 */
  function termsOfYear(y) {
    const q = ensureJieqi();
    const names = LY.LUNAR_TERMS || [];
    const base = (y - LY.LUNAR_YEAR_FIRST) * 24;
    if (base < 0 || base + 23 >= q.abs.length) return [];
    const out = [];
    for (let k = 0; k < 24; k++) {
      const abs = q.abs[base + k];
      const jdn = Math.floor(abs / 1440);
      const rem = abs - jdn * 1440;
      out.push({ name: names[k], jdn: jdn, hh: Math.floor(rem / 60), mm: rem % 60 });
    }
    return out;
  }

  /** 某公历月内的两个节气（节 + 中气） */
  function termsOfMonth(y, m) {
    const all = termsOfYear(y);
    const out = [];
    for (let i = 0; i < all.length; i++) {
      const d = jdnToYmd(all[i].jdn);
      if (d.y === y && d.m === m) out.push(all[i]);
    }
    return out;
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  LY.lunar = {
    of: lunarOfDate,
    termsOfYear: termsOfYear,
    termsOfMonth: termsOfMonth,
    jdnToYmd: jdnToYmd,
    jdnOf: jdnOf,
    pad2: pad2,
    MONTH_NAMES: MONTH_NAMES,
    DAY_NAMES: DAY_NAMES
  };
})(typeof window !== 'undefined' ? window : globalThis);
