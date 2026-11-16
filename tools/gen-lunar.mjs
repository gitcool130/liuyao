/**
 * 生成 public/core/data-lunar.js（农历年表 + 24 节气差分链）
 *
 * 为什么要生成而不是手写：
 *   农历要靠「每年月序/闰月/月大小」的权威表，24 节气要靠天文历算——两者都不该由我凭记忆敲。
 *   本仓的测试依赖里已有 lunar-javascript（tests 的裁判库），直接拿它当一次性生成器，
 *   生成结果作为**静态数据**随页面走；运行时不依赖该库，也不给它背包袱。
 *
 * 用法：node tools/gen-lunar.mjs
 * 范围：1900–2100（与 core/data-jieqi.js 的节气表同界）
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const LunarLib = require('lunar-javascript');

const YEAR0 = 1900, YEAR1 = 2100;
const TERMS = ['小寒', '大寒', '立春', '雨水', '惊蛰', '春分', '清明', '谷雨',
  '立夏', '小满', '芒种', '夏至', '小暑', '大暑', '立秋', '处暑',
  '白露', '秋分', '寒露', '霜降', '立冬', '小雪', '大雪', '冬至'];

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outFile = path.join(root, 'public', 'core', 'data-lunar.js');

// ---------- 1) 农历年表 ----------
// 每年一行： 年,闰月(0=无),正月初一JDN,月大小串（每字符 3=30天 2=29天，含闰月，共 12 或 13 位）
const yearLines = [];
for (let y = YEAR0; y <= YEAR1; y++) {
  const months = LunarLib.LunarYear.fromYear(y).getMonths()
    .filter((m) => m.getYear() === y)
    .sort((a, b) => a.getFirstJulianDay() - b.getFirstJulianDay());
  if (!months.length) throw new Error('农历年表缺 ' + y);
  const first = months[0];
  if (first.getMonth() !== 1) throw new Error(y + ' 首月不是正月：' + first.getMonth());
  let leap = 0;
  const days = months.map((m, i) => {
    const mo = m.getMonth();
    if (mo < 0) { leap = i + 1; return m.getDayCount() === 30 ? '3' : '2'; }
    return m.getDayCount() === 30 ? '3' : '2';
  }).join('');
  if (days.length < 12 || days.length > 13) throw new Error(y + ' 月数异常：' + days.length);
  // 13 位补齐：无闰月的年份末位补 0（解析端按长度判断即可，这里补齐便于定宽）
  const padded = days.length === 12 ? days + '0' : days;
  yearLines.push([y, leap, first.getFirstJulianDay(), padded].join(','));
}

// ---------- 2) 24 节气（北京时，分钟精度） ----------
// 差分链：第 i 项 = 与上一项相差的分钟数（跨年累加），与 core/data-jieqi.js 同一存法
/* lunar-javascript 的节气表以「农历年」为上下文：一年的表里，冬至归属上一年。
 * 所以：小寒…大雪（23 个）取本年的表，冬至单独从下一年的表里取（那里它才是本年 12 月那个）。 */
function solarToAbsMin(solar) {
  const jdn = Math.round(Date.UTC(solar.getYear(), solar.getMonth() - 1, solar.getDay()) / 86400000) + 2440588;
  return jdn * 1440 + solar.getHour() * 60 + solar.getMinute();
}
const absMins = [];
for (let y = YEAR0; y <= YEAR1; y++) {
  const table = LunarLib.Solar.fromYmd(y, 6, 15).getLunar().getJieQiTable();
  for (const name of TERMS) {
    let solar = table[name];
    if (name === '冬至') {
      solar = LunarLib.Solar.fromYmd(y + 1, 1, 15).getLunar().getJieQiTable()['冬至'];
    }
    if (!solar) throw new Error(y + ' 缺节气 ' + name);
    if (solar.getYear() !== y) throw new Error(`${y} 的 ${name} 落在 ${solar.getYear()} 年`);
    const abs = solarToAbsMin(solar);
    if (absMins.length && abs <= absMins[absMins.length - 1]) {
      throw new Error(`${y} 的 ${name} 次序不对（${abs} <= ${absMins[absMins.length - 1]}）`);
    }
    absMins.push(abs);
  }
}
const anchorJdn = Math.floor(absMins[0] / 1440);
const deltas = absMins.map((v, i) => (i === 0 ? v - anchorJdn * 1440 : v - absMins[i - 1]));

// ---------- 3) 落盘 ----------
const body = `/* 自动生成，勿手改（node tools/gen-lunar.mjs）
 *
 * 数据来源：lunar-javascript（测试裁判库）离线导出，一次生成、随页面静态加载。
 *   LUNAR_YEARS   农历年表 1900–2100：年,闰月(0=无),正月初一JDN,月大小串(3=30 2=29 末位0=无闰)
 *   JIEQI24_*     24 节气差分链：绝对分钟 → 差分（首项为相对锚点日的分钟数）
 * 运行时不依赖 lunar-javascript；产物约 ${Math.round((yearLines.join('\n').length + deltas.join(',').length) / 1024)}KB。
 */
(function (root) {
  const LY = root.LY = root.LY || {};

  LY.LUNAR_YEAR_FIRST = ${YEAR0};
  LY.LUNAR_YEAR_LAST = ${YEAR1};

  LY.LUNAR_YEARS = ${JSON.stringify(yearLines.join('\n'))};

  LY.LUNAR_TERMS = ${JSON.stringify(TERMS)};
  LY.JIEQI24_ANCHOR_JDN = ${anchorJdn};
  LY.JIEQI24_DELTAS = [${deltas.join(',')}];
})(typeof window !== 'undefined' ? window : globalThis);
`;

fs.writeFileSync(outFile, body, 'utf8');
console.log('写入', path.relative(root, outFile), (Buffer.byteLength(body) / 1024).toFixed(1) + 'KB',
  '| 农历年', yearLines.length, '| 节气', deltas.length);
