/* ============================================================
 * 盘面分享链接 (core/share.js)
 *
 * 只序列化「种子」：占时（北京墙上时间，分钟级）+ 六爻爻值 + 所测之事 + 用神类别。
 * 不序列化任何 AI 断语、判语、结论。
 *
 * 为什么只存种子：
 *   排盘是确定性重编码——同一 (爻值, 占时) 在任何浏览器重算必得同一盘。
 *   断语属条件生成（同一盘同一次调用也会不同），把它塞进 URL 会让链接变成
 *   断语的二手存档：收链接的人看到的是「别人家的模型当时怎么说的」，
 *   而不是「这张盘是什么」。盘面是公共事实，断语不是。
 *
 * 为什么存「墙上时间」而不是 epoch 毫秒：
 *   本仓的占时口径固定为北京时间（见 app.js beijingNow / calendar.js fourPillars）。
 *   若存 epoch 再在收链接一方的本机时区反解，UTC+8 以外的人会读出不同年月柱
 *   （实测同一 UTC 时刻，上海得丙午年庚寅月、纽约得乙巳年己丑月）。
 *   故此处存「公历年月日时分」的分量，解码后经 __wall 锚点还原，
 *   与 fourPillars 的取时口径天然同源。
 *
 * 格式（版本化，便于将来改字段而不破坏旧链接）：
 *   1.<wall_minutes_base36>.<6 个爻值字母>.<用神代码>[-].<所测 base64url>
 *   爻值字母：a=1 少阳(单) / b=0 少阴(拆) / c=9 老阳(重·动) / d=6 老阴(交·动)
 * ============================================================ */
(function (root) {
  const LY = root.LY = root.LY || {};

  const VER = '1';
  const TO_CODE = { 1: 'a', 0: 'b', 9: 'c', 6: 'd' };
  const FROM_CODE = { a: 1, b: 0, c: 9, d: 6 };
  const USE_TO_CODE = {
    '妻财': 'c', '官鬼': 'g', '父母': 'f', '子孙': 'z', '兄弟': 'x',
    'shi': 's', '__custom__': 'u'
  };
  const CODE_TO_USE = (function () {
    const m = {};
    Object.keys(USE_TO_CODE).forEach(function (k) { m[USE_TO_CODE[k]] = k; });
    return m;
  })();

  // 1900-01-01 作为墙钟分钟数的零点；范围外一律拒收（与节气表覆盖范围一致）
  const YEAR_MIN = 1900, YEAR_MAX = 2100;
  const BASE_JDN = (typeof LY.jdn === 'function') ? LY.jdn(YEAR_MIN, 1, 1) : 2415021;

  const MAX_LEN = 420;
  // 所测之事上限与 #useCustom 的 maxlength 一致（界面本就只允许 60 字）。
  // 60 个汉字 → UTF-8 180 字节 → base64url 240 字符，故字段上限取 260。
  const Q_MAX = 60;
  const Q_CODE_MAX = 260;

  // 严格全串正则：先卡形态再解析，任何多余字符都判非法（防把任意字符串当种子）
  const RE = /^1\.[0-9a-z]{1,9}\.[abcd]{6}(?:\.[a-z\-])?(?:\.[A-Za-z0-9_-]{1,260})?$/;

  function b64urlEncode(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function b64urlDecode(s) {
    const b = s.replace(/-/g, '+').replace(/_/g, '/');
    const pad = (b.length % 4) ? '===='.slice(0, 4 - (b.length % 4)) : '';
    const bin = atob(b + pad);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  // 北京墙上时间分量：与 fourPillars 同源（优先 __wall 锚点，其次本机 getters）
  function wallOf(dt) {
    const w = dt && dt.__wall;
    if (w && typeof w.y === 'number' && typeof w.m === 'number' && typeof w.d === 'number' &&
        typeof w.h === 'number' && typeof w.min === 'number') {
      return { y: w.y, m: w.m, d: w.d, h: w.h, min: w.min };
    }
    if (!dt || typeof dt.getTime !== 'function' || isNaN(dt.getTime())) return null;
    return { y: dt.getFullYear(), m: dt.getMonth() + 1, d: dt.getDate(), h: dt.getHours(), min: dt.getMinutes() };
  }

  function wallToMinutes(w) {
    if (typeof LY.jdn !== 'function') return null;
    return (LY.jdn(w.y, w.m, w.d) - BASE_JDN) * 1440 + w.h * 60 + w.min;
  }

  /**
   * @param {object} o { time: Date|number, vals: number[6], use: string, question: string }
   * @returns {string} 分享码；输入非法时返回 ''（调用方据此禁用分享按钮）
   */
  function encodeCast(o) {
    if (!o) return '';
    const dt = (o.time instanceof Date) ? o.time
      : (typeof o.time === 'number' ? new Date(o.time) : null);
    const w = dt ? wallOf(dt) : null;
    if (!w || w.y < YEAR_MIN || w.y > YEAR_MAX) return '';

    const vals = Array.isArray(o.vals) ? o.vals : [];
    if (vals.length !== 6) return '';
    for (let i = 0; i < 6; i++) {
      if (!Object.prototype.hasOwnProperty.call(TO_CODE, String(vals[i]))) return '';
    }

    const mins = wallToMinutes(w);
    if (mins === null || mins < 0) return '';

    let s = VER + '.' + mins.toString(36) + '.' + vals.map(function (v) { return TO_CODE[v]; }).join('');
    s += '.' + (USE_TO_CODE[o.use] || '-');

    const q = String(o.question == null ? '' : o.question).trim().slice(0, Q_MAX);
    if (q) {
      let enc = '';
      try { enc = b64urlEncode(q); } catch (e) { enc = ''; }
      if (enc && enc.length <= Q_CODE_MAX) s += '.' + enc;
    }

    return s.length <= MAX_LEN ? s : '';
  }

  /**
   * @param {string} s 分享码
   * @returns {object} { ok:true, code, wall:{y,m,d,h,min}, vals:number[6], use, question }
   *                   或 { ok:false, reason }
   */
  function decodeCast(s) {
    const bad = function (reason) { return { ok: false, reason: reason }; };
    if (typeof s !== 'string' || !s) return bad('缺少分享参数');
    if (s.length > MAX_LEN) return bad('分享参数过长');
    if (!RE.test(s)) return bad('分享参数格式非法');
    if (typeof LY.jdnToDate !== 'function') return bad('历法模块未加载');

    const p = s.split('.');
    const mins = parseInt(p[1], 36);
    if (!isFinite(mins) || mins < 0) return bad('占时非法');

    const days = Math.floor(mins / 1440);
    const rem = mins % 1440;
    const date = LY.jdnToDate(BASE_JDN + days);
    const wall = { y: date.y, m: date.m, d: date.d, h: Math.floor(rem / 60), min: rem % 60 };
    if (wall.y < YEAR_MIN || wall.y > YEAR_MAX) return bad('占时超出 1900–2100');
    if (wall.h > 23 || wall.min > 59 || wall.m > 12 || wall.d > 31) return bad('占时分量非法');

    const vals = p[2].split('').map(function (c) { return FROM_CODE[c]; });
    for (let i = 0; i < 6; i++) {
      if (vals[i] === undefined) return bad('爻值非法');
    }

    const use = (p[3] && p[3] !== '-') ? (CODE_TO_USE[p[3]] || '') : '';
    let question = '';
    if (p[4]) {
      try { question = b64urlDecode(p[4]).slice(0, Q_MAX); } catch (e) { return bad('所测之事解码失败'); }
    }

    return { ok: true, code: s, wall: wall, vals: vals, use: use, question: question };
  }

  // 由解码结果构造可交给 paipan/fourPillars 的 Date：
  // 用本地构造器保证 getters 恰等于该分量（任意时区一致），并挂 __wall 锚点兜住 DST 缺口。
  function dateOfWall(w) {
    const dt = new Date(w.y, w.m - 1, w.d, w.h, w.min, 0);
    dt.__wall = { y: w.y, m: w.m, d: w.d, h: w.h, min: w.min };
    return dt;
  }

  // 绝对分享地址：以当前页面为基（不写死域名，本地/预览/自定义域名都能用）
  function shareUrl(code, baseHref) {
    if (!code) return '';
    let base = baseHref;
    if (!base && typeof location !== 'undefined') base = location.href;
    if (!base) return '?s=' + code;
    try {
      const u = new URL(base);
      u.search = '?s=' + code;
      u.hash = '';
      return u.toString();
    } catch (e) {
      return '?s=' + code;
    }
  }

  LY.encodeCast = encodeCast;
  LY.decodeCast = decodeCast;
  LY.dateOfWall = dateOfWall;
  LY.shareUrl = shareUrl;
})(typeof window !== 'undefined' ? window : globalThis);
