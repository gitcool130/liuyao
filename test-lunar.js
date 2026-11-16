/* 中国农历自检（core/lunar.js + data-lunar.js）
 *
 * 裁判：lunar-javascript（测试依赖，不随页面发布）。三条口径必须逐日一致——
 *   ① 农历年/月/日 + 闰月标记（data-lunar 的月序表对不对）
 *   ② 月名日名（正月初一 → 腊月三十 的写法）
 *   ③ 24 节气的日与时分（差分链解出来与库一致，允许 0 分钟差：同源）
 * 再钉几个众所周知的锚点（春节日期、闰月、丙午年），防止整表偏移一位。
 */
const C = require('./core.js');
const L = require('lunar-javascript');

let pass = 0, fail = 0;
function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++;
  else { fail++; if (fail <= 12) console.log('FAIL', name, '\n  got =', JSON.stringify(got), '\n  want=', JSON.stringify(want)); }
}
function ok(name, cond, extra) {
  if (cond) pass++;
  else { fail++; if (fail <= 12) console.log('FAIL', name, extra === undefined ? '' : extra); }
}

const luna = C.lunar;
ok('lunar 模块已挂载', luna && typeof luna.of === 'function');

/* ---------- 1. 逐日比对（1900–2100 全区间抽样，约 2.4 万天） ---------- */
let mismatch = 0, checked = 0, firstBad = null, outOfRange = 0;
for (let y = 1900; y <= 2100; y++) {
  for (let m = 1; m <= 12; m++) {
    const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
    for (let d = 1; d <= dim; d += 3) {
      const got = luna.of(y, m, d);
      const want = L.Solar.fromYmd(y, m, d).getLunar();
      checked++;
      // 1900 年元旦到正月初一之前的几天属于农历 1899 年腊月，表从 1900 正月起——按越界处理
      if (!got) { if (y === 1900 && m === 1 && d < 31) { outOfRange++; continue; } mismatch++; firstBad = firstBad || [y, m, d, 'null']; continue; }
      const wm = want.getMonth();
      if (got.year !== want.getYear() || got.month !== Math.abs(wm) || got.day !== want.getDay() ||
          got.leap !== (wm < 0)) {
        mismatch++;
        if (!firstBad) firstBad = [y, m, d, got.year + '/' + got.month + '/' + got.day + (got.leap ? '闰' : ''),
          want.getYear() + '/' + Math.abs(wm) + '/' + want.getDay() + (wm < 0 ? '闰' : '')];
      }
    }
  }
}
ok('逐日换算与裁判库一致（' + checked + ' 天，另有 ' + outOfRange + ' 天在表外）', mismatch === 0,
  '不一致 ' + mismatch + ' 天，首例 ' + JSON.stringify(firstBad));

/* ---------- 2. 月名/日名写法 ---------- */
eq('正月初一', [luna.of(2026, 2, 17).monthName, luna.of(2026, 2, 17).dayName], ['正月', '初一']);
eq('十月初八', [luna.of(2026, 11, 16).monthName, luna.of(2026, 11, 16).dayName], ['十月', '初八']);
eq('廿九', luna.of(2026, 2, 16).dayName, '廿九');
eq('三十的写法', (function () {
  // 从表里找一个 30 天的月：2026 闰月无，取 2026 正月（30 天）
  const t = luna.of(2026, 3, 18);   // 2026-03-18 = 正月三十
  return t ? t.monthName + t.dayName : '(null)';
})(), '正月三十');

/* ---------- 3. 闰月 ---------- */
eq('2025 闰六月存在', luna.of(2025, 7, 25).monthName, '闰六月');
eq('2025 闰六月标记', luna.of(2025, 7, 25).leap, true);
eq('2025 六月非闰', luna.of(2025, 7, 1).leap, false);

/* ---------- 4. 年干支与生肖 ---------- */
eq('2026 丙午马', [luna.of(2026, 6, 1).yearGZ, luna.of(2026, 6, 1).shengxiao], ['丙午', '马']);
eq('1984 甲子鼠', [luna.of(1984, 6, 1).yearGZ, luna.of(1984, 6, 1).shengxiao], ['甲子', '鼠']);

/* ---------- 5. 24 节气（全区间逐项比对到分钟） ---------- */
let jqBad = 0, jqChecked = 0, jqFirst = null;
for (let y = 1900; y <= 2100; y++) {
  const mine = luna.termsOfYear(y);
  if (mine.length !== 24) { jqBad++; continue; }
  for (let k = 0; k < 24; k++) {
    const name = mine[k].name;
    const t = L.Solar.fromYmd(y, 6, 15).getLunar().getJieQiTable()[name];
    let solar = t;
    if (name === '冬至') solar = L.Solar.fromYmd(y + 1, 1, 15).getLunar().getJieQiTable()['冬至'];
    if (!solar) { jqBad++; continue; }
    jqChecked++;
    const d = luna.jdnToYmd(mine[k].jdn);
    if (d.y !== solar.getYear() || d.m !== solar.getMonth() || d.d !== solar.getDay() ||
        mine[k].hh !== solar.getHour() || mine[k].mm !== solar.getMinute()) {
      jqBad++;
      if (!jqFirst) jqFirst = [y, name, d.y + '-' + d.m + '-' + d.d + ' ' + mine[k].hh + ':' + mine[k].mm,
        solar.toYmdHms()];
    }
  }
}
ok('24 节气与裁判库一致（' + jqChecked + ' 项，分钟级）', jqBad === 0,
  '不一致 ' + jqBad + ' 项，首例 ' + JSON.stringify(jqFirst));

/* ---------- 6. 某月两个节气 & 落月归属 ---------- */
const nov = luna.termsOfMonth(2026, 11);
eq('2026-11 两个节气', nov.map(function (t) { return t.name; }), ['立冬', '小雪']);
eq('立冬落在 11 月 7 日', luna.jdnToYmd(nov[0].jdn), { y: 2026, m: 11, d: 7 });
eq('立冬时分', [nov[0].hh, nov[0].mm], [17, 52]);
eq('小雪时分', [nov[1].hh, nov[1].mm], [15, 23]);

/* ---------- 7. 越界与边界 ---------- */
eq('1899 越界返回 null', luna.of(1899, 12, 31), null);
eq('2100 年末仍在表内', !!luna.of(2100, 12, 31), true);
ok('1900 年首日不早于正月初一', luna.of(1900, 1, 31) !== null);

console.log('\n农历自检：通过 ' + pass + '　失败 ' + fail);
process.exit(fail ? 1 : 0);
