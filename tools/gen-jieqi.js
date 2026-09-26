/* ============================================================
 * 节气表离线生成器（仅开发用，不进生产运行链路）
 * 用 lunar-javascript 枚举 1900-2100 年十二节交节时刻（分钟级），
 * 产出 core/data-jieqi.js（锚点 JDN + 逐条分钟差分链）。
 *
 * 运行：npm run gen:jieqi
 * ============================================================ */
const L = require('lunar-javascript');
const fs = require('fs');
const path = require('path');

// 时区守卫：表以北京时（UTC+8）语义生成，机器时区不符则拒绝
if (new Date().getTimezoneOffset() !== -480) {
  console.error('本生成器须在 UTC+8 时区运行（当前 offset=' + new Date().getTimezoneOffset() + '）');
  process.exit(1);
}

// 十二节及其公历月：小寒→1月 … 大雪→12月
const TERMS = [
  ['小寒', 1], ['立春', 2], ['惊蛰', 3], ['清明', 4], ['立夏', 5], ['芒种', 6],
  ['小暑', 7], ['立秋', 8], ['白露', 9], ['寒露', 10], ['立冬', 11], ['大雪', 12]
];

// 与 core/calendar.js 保持一致的 JDN 公式（复制一份，避免依赖生产文件）
function jdn(y, m, d) {
  const a = Math.floor((14 - m) / 12);
  const yy = y + 4800 - a;
  const mm = m + 12 * a - 3;
  return d + Math.floor((153 * mm + 2) / 5) + 365 * yy + Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400) - 32045;
}

const ANCHOR_JDN = jdn(1900, 1, 1); // 2415021，即 1900-01-01 00:00

const YEAR0 = 1900, YEAR1 = 2100;
const absolute = []; // 全部交节时刻：距 1900-01-01 00:00 的分钟数（升序）

for (let y = YEAR0; y <= YEAR1; y++) {
  // 从上一年 12 月中旬起扫，确保拿到本年 1 月的小寒
  let d = new Date(y, 0, 1);
  const got = []; // {name, y, m, d, h, min, absMin}
  let cursor = new Date(y - 1, 11, 15);
  for (let i = 0; i < 15; i++) {
    const lunar = L.Lunar.fromDate(cursor);
    const jq = lunar.getNextJie();
    const s = jq.getSolar();
    if (s.getYear() === y) {
      got.push({ name: jq.getName(), y: s.getYear(), m: s.getMonth(), d: s.getDay(), h: s.getHour(), min: s.getMinute() });
    }
    if (s.getYear() > y) break;
    cursor = new Date(s.getYear(), s.getMonth() - 1, s.getDay(), s.getHour(), s.getMinute() + 1);
    if (cursor > new Date(y, 11, 31)) break;
  }
  // 校验：恰好 12 节、名称与月份一一对应
  if (got.length !== 12) throw new Error(y + ' 年节数异常: ' + got.length + ' 条');
  got.forEach(function (g, i) {
    if (g.name !== TERMS[i][0]) throw new Error(y + ' 年第 ' + (i + 1) + ' 节应为 ' + TERMS[i][0] + '，实得 ' + g.name);
    if (g.m !== TERMS[i][1]) throw new Error(y + ' 年 ' + g.name + ' 月份异常: ' + g.m);
    g.absMin = (jdn(g.y, g.m, g.d) - ANCHOR_JDN) * 1440 + g.h * 60 + g.min;
  });
  for (let i = 1; i < 12; i++) {
    if (got[i].absMin <= got[i - 1].absMin) throw new Error(y + ' 年交节时刻非升序');
  }
  absolute.push.apply(absolute, got.map(function (g) { return g.absMin; }));
}

// 差分链（相邻交节分钟差）
const deltas = absolute.map(function (v, i) { return i === 0 ? v : v - absolute[i - 1]; });
const maxAbs = absolute[absolute.length - 1];
if (maxAbs >= 4294967296) throw new Error('偏移超 Uint32');

// 输出 core/data-jieqi.js
const lines = [];
for (let i = 0; i < deltas.length; i += 20) {
  lines.push(deltas.slice(i, i + 20).join(','));
}
const out = [
  '/* ============================================================',
  ' * 十二节交节时刻表（1900-2100，分钟级，北京时 UTC+8）',
  ' * 由 tools/gen-jieqi.js 用 lunar-javascript 离线生成，请勿手改。',
  ' * 结构：JIEQI_ANCHOR_JDN 为 1900-01-01 的 JDN；',
  ' *   JIEQI_DELTAS 为 2412 条差分链，顺序为',
  ' *   1900小寒、1900立春 … 1900大雪、1901小寒 … 2100大雪。',
  ' *   第 idx 条的绝对分钟数 = 前缀和；交节时刻 = 锚点 + 前缀和。',
  ' * 运行时零计算，仅查表（core/calendar.js 消费）。',
  ' * ============================================================ */',
  '(function (root) {',
  '  root.LY = root.LY || {};',
  '  LY.JIEQI_ANCHOR_JDN = ' + ANCHOR_JDN + ';',
  '  LY.JIEQI_DELTAS = [',
  ...lines.map(function (l) { return '    ' + l + (lines[lines.length - 1] === l ? '' : ','); }),
  '  ];',
  '})(typeof window !== \'undefined\' ? window : globalThis);',
  ''
].join('\n');

fs.writeFileSync(path.join(__dirname, '..', 'core', 'data-jieqi.js'), out);

// 摘要 + 人工抽查样本
console.log('生成完成：' + (YEAR1 - YEAR0 + 1) * 12 + ' 条交节时刻');
console.log('文件大小：' + (out.length / 1024).toFixed(1) + ' KB');
console.log('最大绝对偏移：' + maxAbs + ' 分钟（< 2^32 ✓）');
const samples = [[1900, 1], [1966, 2], [2026, 2], [2026, 9], [2100, 12]];
samples.forEach(function (sm) {
  const idx = (sm[0] - YEAR0) * 12 + (sm[1] - 1);
  const abs = absolute[idx];
  // 还原日期展示
  const j = ANCHOR_JDN + Math.floor(abs / 1440);
  const a = j + 32044, b = Math.floor((4 * a + 3) / 146097), c = a - Math.floor(146097 * b / 4);
  const dd = Math.floor((4 * c + 3) / 1461), e = c - Math.floor(1461 * dd / 4);
  const mm = Math.floor((5 * e + 2) / 153);
  const day = e - Math.floor((153 * mm + 2) / 5) + 1;
  const month = mm + 3 - 12 * Math.floor(mm / 10);
  const year = 100 * b + dd - 4800 + Math.floor(mm / 10);
  const rem = abs % 1440;
  console.log('抽查 ' + sm[0] + '年' + sm[1] + '月节: ' + year + '-' + month + '-' + day + ' ' +
    Math.floor(rem / 60) + ':' + (rem % 60 < 10 ? '0' : '') + (rem % 60) + '（' + TERMS[sm[1] - 1][0] + '）');
});
