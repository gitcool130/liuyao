/* ============================================================
 * 三库交叉差分基准 (test-diff.mjs)
 * 裁判库（devDependencies，不进浏览器生产）：
 *   - @taoracle/najia   排盘主裁判（tyme4ts 历法，独立实现）
 *   - iching-shifa      交叉裁判（GPL，仅测试层引用）
 *   - lunar-javascript  历法裁判（节气/干支基准，也是节气表生成源）
 *
 * 收敛判据：
 *   mine 与两库均不一致 → BUG（本测试 FAIL）
 *   mine 与一库不一致 → 流派差异候选（单列 KNOWN DIVERGENCE 归档，人工裁决）
 *
 * 运行：npm run test:diff
 * ============================================================ */
import LY from './core.js';
import { cast as najiaCast } from '@taoracle/najia';
import { decodePan as shifaDecode } from 'iching-shifa';
import lunarJs from 'lunar-javascript';

const L = lunarJs.Lunar ? lunarJs : (lunarJs.default || lunarJs);

let bug = 0, divergence = 0, checked = 0;
const divergenceLog = [];
const bugLog = [];

function normBeast(s) { return s.replace('螣', '腾'); } // 螣蛇/腾蛇 用字归一

// 爻值映射：mine 1/0/9/6 → najia 1单/2拆/3重/4交 → shifa '7'/'8'/'9'/'6'
function toNajia(v) { return v === 1 ? 1 : v === 0 ? 2 : v === 9 ? 3 : 4; }
function toShifa(v) { return v === 1 ? '7' : v === 0 ? '8' : String(v); }

// ---------- 一、历法差分（日期维度） ----------
// 日期避开交节临界日与 23 时（晚子时流派差异单列）
const DATES = [
  [1949, 10, 1, 12, 0], [1966, 3, 15, 10, 30], [1984, 6, 15, 11, 0], [1997, 7, 1, 9, 30],
  [2000, 1, 10, 15, 0], [2008, 8, 20, 14, 0], [2020, 5, 20, 8, 0], [2024, 2, 20, 13, 45],
  [2026, 2, 10, 9, 0], [2026, 9, 24, 9, 0], [2026, 12, 25, 16, 20], [2038, 4, 8, 10, 0],
  [2050, 10, 18, 12, 0], [2077, 11, 11, 10, 30], [2099, 6, 6, 6, 0], [2100, 12, 30, 11, 0]
];
const CAL_TOSSES = [1, 0, 9, 1, 0, 6]; // 固定一卦（含动静爻），历法维度与卦无关

function cmp(label, mine, ref, refName, combo) {
  if (mine === ref) return true;
  // 双库皆不一致 → bug；单库不一致 → 流派差异候选
  return { label, mine, ref, refName, combo };
}

function diffCalendar() {
  console.log('== 历法差分（' + DATES.length + ' 个时点 × 四柱/旬空/六神） ==');
  DATES.forEach(function (d) {
    const dt = new Date(d[0], d[1] - 1, d[2], d[3], d[4]);
    const pil = LY.fourPillars(dt);

    const nToss = CAL_TOSSES.map(toNajia);
    const nj = najiaCast(nToss, { date: dt });
    const sStr = CAL_TOSSES.map(toShifa).join('');
    const sf = shifaDecode(sStr, { year: d[0], month: d[1], day: d[2], hour: d[3], minute: d[4] });
    const lu = L.Lunar.fromDate(dt);

    const fields = [
      ['年柱', pil.yearGZ, nj.ganzhi.year, sf.ganZhiYear.gz, lu.getYearInGanZhiByLiChun()],
      ['月柱', pil.monthGZ, nj.ganzhi.month, sf.ganZhiMonth.gz, lu.getMonthInGanZhi()],
      ['日柱', pil.dayGZ, nj.ganzhi.day, sf.ganZhiDay.gz, lu.getDayInGanZhi()],
      ['时柱', pil.hourGZ, nj.ganzhi.hour, sf.ganZhiHour.gz, lu.getTimeInGanZhi()],
      ['旬空', pil.kongStr, nj.ganzhi.xkong, sf.dayKong, '']
    ];
    fields.forEach(function (f) {
      checked++;
      const mine = f[1];
      const refs = { najia: f[2], shifa: f[3], lunar: f[4] };
      const agree = Object.keys(refs).filter(function (k) { return refs[k] && refs[k] === mine; });
      const disagree = Object.keys(refs).filter(function (k) { return refs[k] && refs[k] !== mine; });
      if (disagree.length > 0) {
        if (agree.length === 0) { bug++; bugLog.push('[' + f[0] + '] ' + d.join('-') + ' mine=' + mine + ' refs=' + JSON.stringify(refs)); }
        else { divergence++; divergenceLog.push('[' + f[0] + '] ' + d.join('-') + ' mine=' + mine + ' 不一致:' + JSON.stringify(disagree.map(function (k) { return k + '=' + refs[k]; }))); }
      }
    });

    // 六神（随日干）
    const myBeasts = LY.paipan(CAL_TOSSES, dt).lines.map(function (l) { return l.beast; });
    const njBeasts = nj.god6.map(normBeast);
    const sfBeasts = sf.benGua.yaoList.map(function (y) { return normBeast(y.liuShou); });
    checked++;
    if (JSON.stringify(myBeasts) !== JSON.stringify(njBeasts) || JSON.stringify(myBeasts) !== JSON.stringify(sfBeasts)) {
      bug++; bugLog.push('[六神] ' + d.join('-') + ' mine=' + myBeasts.join(',') + ' najia=' + njBeasts.join(',') + ' shifa=' + sfBeasts.join(','));
    }
  });
}

// ---------- 二、排盘差分（4096 爻组合 × 固定日期） ----------
const DIFF_DATE = [2026, 9, 24, 9, 0]; // 避开交节日与 23 时

function allTosses() {
  const vals = [1, 0, 9, 6];
  const out = [];
  for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) for (let c = 0; c < 4; c++)
    for (let d = 0; d < 4; d++) for (let e = 0; e < 4; e++) for (let f = 0; f < 4; f++)
      out.push([vals[a], vals[b], vals[c], vals[d], vals[e], vals[f]]);
  return out;
}

function diffPaipan() {
  console.log('== 排盘差分（4096 爻组合，逐爻比对） ==');
  const dt = new Date(DIFF_DATE[0], DIFF_DATE[1] - 1, DIFF_DATE[2], DIFF_DATE[3], DIFF_DATE[4]);
  const combos = allTosses();
  combos.forEach(function (toss, ci) {
    const mine = LY.paipan(toss, dt);
    const nj = najiaCast(toss.map(toNajia), { date: dt });
    const sf = shifaDecode(toss.map(toShifa).join(''), {
      year: DIFF_DATE[0], month: DIFF_DATE[1], day: DIFF_DATE[2], hour: DIFF_DATE[3], minute: DIFF_DATE[4]
    });
    const tag = '#' + ci + ' ' + toss.join('');

    function field(name, mineV, njV, sfV) {
      checked++;
      const njOk = (njV === null) || mineV === njV;          // null = 该库无比对项（如 shifa 卦名用单字简名，另以卦形比对）
      const sfOk = (sfV === null) || mineV === sfV;
      if (njOk && sfOk) return;
      if (!njOk && !sfOk) { bug++; bugLog.push('[' + name + '] ' + tag + ' mine=' + mineV + ' najia=' + njV + ' shifa=' + sfV); }
      else { divergence++; divergenceLog.push('[' + name + '] ' + tag + ' mine=' + mineV + (!njOk ? ' najia=' + njV : '') + (!sfOk ? ' shifa=' + sfV : '')); }
    }

    // 卦名 / 卦宫 / 卦形
    // shifa 卦名为单字/双字简名（夬、贲、同人），与全名无法机械换算，故以卦形 bits+卦宫比对
    const sfBits = sf.benGua.yaoList.map(function (y) { return (y.yaoValue === 7 || y.yaoValue === 9) ? 1 : 0; }).join('');
    field('卦形', mine.benBits.join(''), nj.gua.mark, sfBits);
    field('卦名', mine.benName, nj.gua.name, null);
    field('卦宫', mine.palace, nj.gua.gong, sf.benGua.palace);
    // 本卦爻：干支 / 六亲
    for (let i = 0; i < 6; i++) {
      const sfY = sf.benGua.yaoList[i];
      field('干支' + i, mine.lines[i].gan + mine.lines[i].zhi, nj.gua.qinx[i].slice(0, 2), sfY.naJia);
      field('六亲' + i, mine.lines[i].lq, nj.gua.qin6[i], sfY.liuQin);
    }
    // 世应（najia 1 基，shifa 字串）
    const sfShi = sf.benGua.yaoList.findIndex(function (y) { return y.shiYing === '世'; });
    const sfYing = sf.benGua.yaoList.findIndex(function (y) { return y.shiYing === '应'; });
    field('世爻', mine.shi + 1, nj.shiy.shi, sfShi + 1);
    field('应爻', mine.ying + 1, nj.shiy.ying, sfYing + 1);
    // 动爻
    const myDong = mine.moving.map(function (m, i) { return m ? i : -1; }).filter(function (i) { return i >= 0; });
    field('动爻', JSON.stringify(myDong), JSON.stringify(nj.dong), JSON.stringify(sf.benGua.yaoList.map(function (y, i) { return y.isMoving ? i : -1; }).filter(function (i) { return i >= 0; })));
    // 变卦：卦名 / 卦宫 / 动爻变支
    if (mine.hasBian) {
      const sfBianBits = sf.zhiGua.yaoList.map(function (y) { return (y.yaoValue === 7 || y.yaoValue === 9) ? 1 : 0; }).join('');
      field('变卦形', mine.bianBits.join(''), nj.bian.mark, sfBianBits);
      field('变卦名', mine.bianName, nj.bian.name, null);
      field('变卦宫', mine.bianPalace, nj.bian.gong, sf.zhiGua.palace);
      for (let i = 0; i < 6; i++) {
        if (!mine.lines[i].moving) continue;
        field('变支' + i, mine.lines[i].bian.gan + mine.lines[i].bian.zhi, nj.bian.qinx[i].slice(0, 2), sf.zhiGua.yaoList[i].naJia);
      }
    }
    // 伏神：仅缺之六亲（najia 六亲全时 hide=null；shifa fuShen 为首卦全表，过滤缺项）
    const myFu = mine.lines.filter(function (l) { return l.fu; }).map(function (l) { return l.fu.lq + l.fu.gan + l.fu.zhi + '@' + l.pos; }).sort().join('|');
    const njFu = !nj.hide ? '' : nj.hide.seat.map(function (p) { return nj.hide.qin6[p] + nj.hide.qinx[p].slice(0, 2) + '@' + p; }).sort().join('|');
    const present = new Set(sf.benGua.yaoList.map(function (y) { return y.liuQin; }));
    const sfFu = sf.benGua.fuShen.filter(function (f) { return !present.has(f.fuLiuQin); })
      .map(function (f) { return f.fuLiuQin + f.fuNaJia + '@' + (f.hostPosition - 1); }).sort().join('|');
    field('伏神', myFu, njFu, sfFu);
  });
}

// ---------- 三、节气表全量解码校验（M1 验收） ----------
function diffJieqi() {
  console.log('== 节气表全量校验（1900-2100 × 12 节 = 2412 项，vs lunar-javascript） ==');
  const TERMS = ['小寒', '立春', '惊蛰', '清明', '立夏', '芒种', '小暑', '立秋', '白露', '寒露', '立冬', '大雪'];
  for (let y = 1900; y <= 2100; y++) {
    let cursor = new Date(y - 1, 11, 15);
    const got = {};
    for (let i = 0; i < 15; i++) {
      const lunar = L.Lunar.fromDate(cursor);
      const jq = lunar.getNextJie();
      const s = jq.getSolar();
      if (s.getYear() === y) got[jq.getName()] = s;
      if (s.getYear() > y) break;
      cursor = new Date(s.getYear(), s.getMonth() - 1, s.getDay(), s.getHour(), s.getMinute() + 1);
    }
    for (let m = 1; m <= 12; m++) {
      checked++;
      const mine = LY.termMoment(y, m);
      const ref = got[TERMS[m - 1]];
      if (!ref) { bug++; bugLog.push('[节气] ' + y + '-' + m + ' lunar-javascript 未枚举到 ' + TERMS[m - 1]); continue; }
      const ok = mine && mine.day === ref.getDay() && mine.hour === ref.getHour() && mine.minute === ref.getMinute() &&
        mine.y === ref.getYear() && mine.m === ref.getMonth();
      if (!ok) { bug++; bugLog.push('[节气] ' + y + '-' + m + ' mine=' + JSON.stringify(mine) + ' ref=' + ref.toYmd() + ' ' + ref.getHour() + ':' + ref.getMinute()); }
    }
  }
}

// ---------- 运行 ----------
diffCalendar();
diffPaipan();
diffJieqi();

console.log('');
console.log('比对字段总数: ' + checked);
console.log('BUG（与两库均不一致）: ' + bug);
console.log('流派差异候选（与单库不一致）: ' + divergence);
if (divergenceLog.length) {
  console.log('\n-- 流派差异明细（前 30 条）--');
  divergenceLog.slice(0, 30).forEach(function (l) { console.log('  ' + l); });
}
if (bugLog.length) {
  console.log('\n-- BUG 明细（前 30 条）--');
  bugLog.slice(0, 30).forEach(function (l) { console.log('  ' + l); });
  process.exit(1);
}
console.log(bug === 0 ? '\n全部通过 ✓（差分零 BUG）' : '\n存在 BUG，须修复后重跑');
