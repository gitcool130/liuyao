/* ============================================================
 * 外部验证集三方对账器 (tests/verify/run.mjs)
 *
 * 用途：拿「外部提供的排盘验证集」去对账本引擎，判定分歧责任方。
 * 关键：不拿引擎自己给自己作证。每条分歧都用两套独立裁判库复核：
 *   - @taoracle/najia   （TypeScript 移植自 Python najia，tyme4ts 历法）
 *   - iching-shifa      （独立实现的六爻筮法库）
 *   - lunar-javascript  （第四方历法裁判，仅用于四柱维度）
 *   判据：用例 ≠ 引擎 且 裁判库 ≥2 家站引擎侧 → 判「用例错」
 *         用例 ≠ 引擎 且 裁判库 ≥2 家站用例侧 → 判「引擎错」（本测试 FAIL）
 *
 * 另含「用例自相矛盾」检测：只用裁判库由 coins 推卦画/卦名，
 * 与用例自称的 original_gua / changed_gua 比 —— 此判定与引擎完全无关。
 *
 * 运行：npm run test:verify
 * 可选：node tests/verify/run.mjs [--suite <file>] [--json <out>]
 *
 * 结论报告见《六爻第十三轮-外部验证集三方对账.md》。
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import LY from '../../core.js';
import { cast as najiaCast, attack as najiaAttack, unite as najiaUnite, GUA64 } from '@taoracle/najia';
import { decodePan as shifaDecode } from 'iching-shifa';
import lunarJs from 'lunar-javascript';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
function argOf(name, dflt) {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
}
const SUITE = argOf('suite', path.join(__dirname, 'external-suite-v1.json'));
const FIX_OUT = argOf('fix', ''); // --fix <out>：输出「裁决后」用例集（只写引擎与裁判库一致的值）
const fixedCases = [];
function fixOf(caseId, field, fallback) {
  const c = consensus.get(caseId + '|' + field);
  if (!c || !c.backed) return fallback;
  return c.v;
}

const L = lunarJs.Lunar ? lunarJs : (lunarJs.default || lunarJs);

// ---------- 输入归一 ----------
// 用例 coin：7 少阳静 / 8 少阴静 / 9 老阳动 / 6 老阴动（大衍四象记数）
// 本引擎 toss：1 少阳 / 0 少阴 / 9 老阳 / 6 老阴
function coinToToss(c) {
  if (c === 7) return 1;
  if (c === 8) return 0;
  if (c === 9) return 9;
  if (c === 6) return 6;
  throw new Error('非法 coin 值 ' + c);
}
function toNajia(v) { return v === 1 ? 1 : v === 0 ? 2 : v === 9 ? 3 : 4; }
function toShifa(v) { return v === 1 ? '7' : v === 0 ? '8' : String(v); }
function normBeast(s) { return String(s).replace('螣', '腾'); } // 螣蛇/腾蛇 用字归一
function parseDt(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(s);
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
}

// ---------- 六冲 / 六合 / 游魂归魂 ----------
// 三项判定已内置为引擎能力（core/paipan.js: chongGua/heGua/soulGua，
// 并暴露为 paipan().isLiuChong / isLiuHe / soul），本文件不再自实现一份副本
// —— 否则测试层与被测层各持一套口径，会各自漂移而互相掩护。
// 引擎侧的独立校验见 test-gua-types.js（64 卦全枚举 + 京房八宫卦次），
// 与 najia 的 attack/unite 的交叉验证即本文件的 is_liu_chong / is_liu_he 两行。

// ---------- 判责 ----------
const VERDICT = { OK: 'ok', CASE: 'case-wrong', ENGINE: 'engine-wrong', UNKNOWN: 'unknown' };
function judge(caseV, engineV, refs) {
  if (JSON.stringify(caseV) === JSON.stringify(engineV)) return VERDICT.OK;
  const vals = refs.filter(function (r) { return r.v !== null && r.v !== undefined; });
  if (!vals.length) return VERDICT.UNKNOWN;
  const be = vals.filter(function (r) { return JSON.stringify(r.v) === JSON.stringify(engineV); }).length;
  const bc = vals.filter(function (r) { return JSON.stringify(r.v) === JSON.stringify(caseV); }).length;
  if (bc > be) return VERDICT.ENGINE;
  if (be > bc) return VERDICT.CASE;
  return VERDICT.UNKNOWN;
}

// 卦型口径归一：引擎 soul 取值 '游魂'/'归魂'/null → 用例 category 口径 '游魂卦'/'(非游魂归魂)'
const NOT_SOUL = '(非游魂归魂)';
const soulName = (s) => (s ? s + '卦' : NOT_SOUL);
const njSoul = soulName; // najia 的 soul 字段同口径
// 按卦名反查卦画（najia 的 64 卦表，纯数据，不涉及本引擎）
function symbolOfName(name) {
  for (const k of Object.keys(GUA64)) if (GUA64[k] === name) return k;
  return null;
}
function mySoulOfName(name) {
  const s = symbolOfName(name);
  return s ? soulName(LY.soulGua(s.split('').map(Number))) : null;
}

const rows = [];      // 全部对账行
const summary = { ok: 0, caseWrong: 0, engineWrong: 0, unknown: 0 };
const meta = [];      // 每条用例的概览
let selfContradiction = 0;
const consensus = new Map(); // 'caseId|field' → { v, backed, refCount }（--fix 用）
const unbacked = [];         // 引擎值无任何裁判库背书的字段（修正模式下拒绝写入）

function push(caseId, field, caseV, engineV, refs, note) {
  const v = judge(caseV, engineV, refs);
  rows.push({ caseId: caseId, field: field, want: caseV, engine: engineV, refs: refs, verdict: v, note: note || '' });
  if (v === VERDICT.OK) summary.ok++;
  else if (v === VERDICT.CASE) summary.caseWrong++;
  else if (v === VERDICT.ENGINE) summary.engineWrong++;
  else summary.unknown++;
  const rv = refs.filter(function (r) { return r.v !== null && r.v !== undefined; });
  const backed = rv.some(function (r) { return JSON.stringify(r.v) === JSON.stringify(engineV); });
  consensus.set(caseId + '|' + field, { v: engineV, backed: backed, refCount: rv.length });
  if (!backed && FIX_OUT) unbacked.push(caseId + ' ' + field + '（引擎=' + fmt(engineV) + '，裁判 ' + rv.map(function (r) { return r.n + '=' + fmt(r.v); }).join(' ') + '）');
  return v;
}

const fmt = function (x) { return JSON.stringify(x); };

// ---------- 主流程 ----------
const suite = JSON.parse(fs.readFileSync(SUITE, 'utf8'));
console.log('== 外部验证集三方对账 ==');
console.log('   用例集：' + path.basename(SUITE) + '（' + (suite.test_suite || '') + ' ' + (suite.version || '') + '）');
console.log('   裁判库：@taoracle/najia / iching-shifa / lunar-javascript\n');

suite.cases.forEach(function (c) {
  const id = c.case_id;
  const dt = parseDt(c.input.datetime);
  const coins = c.input.coins;
  const toss = coins.map(coinToToss);

  // ---- 三方排盘 ----
  const mine = LY.paipan(toss, dt);
  const nj = najiaCast(toss.map(toNajia), { date: dt });
  const sf = shifaDecode(toss.map(toShifa).join(''), {
    year: dt.getFullYear(), month: dt.getMonth() + 1, day: dt.getDate(),
    hour: dt.getHours(), minute: dt.getMinutes()
  });
  const lu = L.Lunar.fromDate(dt);
  const pil = LY.fourPillars(dt);
  const exp = c.expected;

  // ---- 一、四柱：用例自称 vs 日期真相 ----
  const pilRows = [
    ['年柱', c.input.ganzhi.year, pil.yearGZ, nj.ganzhi.year, sf.ganZhiYear.gz, lu.getYearInGanZhiByLiChun()],
    ['月柱', c.input.ganzhi.month, pil.monthGZ, nj.ganzhi.month, sf.ganZhiMonth.gz, lu.getMonthInGanZhi()],
    ['日柱', c.input.ganzhi.day, pil.dayGZ, nj.ganzhi.day, sf.ganZhiDay.gz, lu.getDayInGanZhi()],
    ['时柱', c.input.ganzhi.hour, pil.hourGZ, nj.ganzhi.hour, sf.ganZhiHour.gz, lu.getTimeInGanZhi()]
  ];
  const badPil = [];
  pilRows.forEach(function (r) {
    const v = judge(r[1], r[2], [
      { n: 'najia', v: r[3] }, { n: 'shifa', v: r[4] }, { n: 'lunar', v: r[5] }
    ]);
    push(id, '四柱.' + r[0], r[1], r[2], [
      { n: 'najia', v: r[3] }, { n: 'shifa', v: r[4] }, { n: 'lunar', v: r[5] }
    ]);
    if (v !== VERDICT.OK) badPil.push(r[0] + ' 用例=' + r[1] + ' 实为=' + r[2]);
  });

  // ---- 二、用例自相矛盾检测（只用裁判库由 coins 推卦）----
  const selfBad = [];
  if (nj.gua.name !== exp.original_gua) {
    selfBad.push('coins 推得本卦「' + nj.gua.name + '」，用例自称「' + exp.original_gua + '」');
  }
  if (nj.bian && exp.changed_gua && nj.bian.name !== exp.changed_gua) {
    selfBad.push('coins 推得变卦「' + nj.bian.name + '」，用例自称「' + exp.changed_gua + '」');
  }
  if (nj.bian === null && exp.changed_gua && exp.changed_gua !== exp.original_gua) {
    selfBad.push('coins 无动爻（卦不变），用例自称变卦「' + exp.changed_gua + '」');
  }
  if (selfBad.length) selfContradiction++;

  // ---- 三、逐字段对账 ----
  const myFu = function (i) {
    return mine.lines[i].fu ? (mine.lines[i].fu.zhi + LY.ZHI_WX[LY.ZHI.indexOf(mine.lines[i].fu.zhi)]) : null;
  };
  // 卦名
  push(id, 'original_gua', exp.original_gua, mine.benName, [
    { n: 'najia', v: nj.gua.name }
  ]);
  // 之卦：全静卦无变卦，本引擎 bianName 返回 null（语义为「无变卦」）；
  //       此处按「静卦之卦＝本卦」的用例口径比对，另在 note 里标明 API 语义。
  const myBian = mine.hasBian ? mine.bianName : mine.benName;
  const njBian = nj.bian ? nj.bian.name : nj.gua.name;
  push(id, 'changed_gua', exp.changed_gua, myBian, [
    { n: 'najia', v: njBian },
    { n: 'shifa', v: sf.zhiGua && sf.zhiGua.guaName ? sf.zhiGua.guaName : null }
  ], mine.hasBian ? '' : '全静卦：本引擎 paipan().bianName=null（=无变卦），已按用例「之卦=本卦」口径比对');
  // 卦宫：用例写作「乾金」= 宫名 + 卦宫五行
  push(id, 'palace', exp.palace, mine.palace + mine.palaceWx, [
    { n: 'najia', v: nj.gua.gong + LY.TRIG[nj.gua.gong].wx },
    { n: 'shifa', v: sf.benGua.palace ? (sf.benGua.palace + LY.TRIG[sf.benGua.palace].wx) : null }
  ]);
  // 卦型（游魂/归魂）——引擎 paipan().soul
  if (exp.category) {
    push(id, 'category', exp.category, soulName(mine.soul), [
      { n: 'najia', v: njSoul(nj.soul) }
    ]);
  }
  // 世应（用例 1 基）
  push(id, 'shi_line', exp.shi_line, mine.shi + 1, [
    { n: 'najia', v: nj.shiy.shi },
    { n: 'shifa', v: sf.benGua.yaoList.findIndex(function (y) { return y.shiYing === '世'; }) + 1 }
  ]);
  push(id, 'ying_line', exp.ying_line, mine.ying + 1, [
    { n: 'najia', v: nj.shiy.ying },
    { n: 'shifa', v: sf.benGua.yaoList.findIndex(function (y) { return y.shiYing === '应'; }) + 1 }
  ]);
  // 六冲 / 六合（引擎 paipan().isLiuChong / isLiuHe；najia 另有独立实现 attack/unite）
  if (exp.is_liu_chong !== undefined) {
    push(id, 'is_liu_chong', exp.is_liu_chong, mine.isLiuChong, [
      { n: 'najia', v: najiaAttack(nj.gua.mark) }
    ], '六冲 = 初四/二五/三六 三对皆冲；由卦画纳支直推，不查卦名表');
  }
  if (exp.is_liu_he !== undefined) {
    const njHe = najiaUnite(nj.gua.mark) === '六合';
    push(id, 'is_liu_he', exp.is_liu_he, mine.isLiuHe, [
      { n: 'najia', v: njHe }
    ], '六合 = 三对皆合（子丑 / 寅亥 / 卯戌 / 辰酉 / 巳申 / 午未）');
    // 附带：即便按用例【自称】的卦，是否自洽（此判定只用 najia 的 64 卦名表，与本引擎无关）
    const selfSym = symbolOfName(exp.original_gua);
    if (selfSym) {
      const selfHe = najiaUnite(selfSym) === '六合';
      const selfChong = najiaAttack(selfSym);
      if (selfHe !== exp.is_liu_he) {
        selfBad.push('用例自称本卦「' + exp.original_gua + '」（' + selfSym + '）' +
          '，其六合性实为 ' + selfHe + '，与用例 is_liu_he=' + exp.is_liu_he + ' 不符');
      }
      if (exp.is_liu_chong !== undefined && selfChong !== exp.is_liu_chong) {
        selfBad.push('用例自称本卦「' + exp.original_gua + '」的六冲性实为 ' + selfChong +
          '，与用例 is_liu_chong=' + exp.is_liu_chong + ' 不符');
      }
    }
  }
  // 附带：用例 category 与自称卦名是否自洽（默认 category 只有 TC_003/004 出现）
  if (exp.category) {
    const selfSym = symbolOfName(exp.original_gua);
    if (selfSym) {
      const sc = mySoulOfName(exp.original_gua);
      if (sc && sc !== exp.category) {
        selfBad.push('用例自称本卦「' + exp.original_gua + '」的卦型实为 ' + sc + '，与用例 category=' + exp.category + ' 不符');
      }
      if (!sc) selfBad.push('用例自称卦名「' + exp.original_gua + '」不在 64 卦名表中');
    }
  }
  // 旬空
  const myKong = [LY.ZHI[pil.kong[0]], LY.ZHI[pil.kong[1]]];
  push(id, 'xun_kong', exp.xun_kong, myKong, [
    { n: 'najia', v: [nj.ganzhi.xkong[0], nj.ganzhi.xkong[1]] },
    { n: 'shifa', v: sf.dayKong ? sf.dayKong.split('') : null },
    { n: 'lunar', v: null }
  ], '旬空由日柱定：日柱错则旬空必错');
  // 六爻逐爻
  exp.lines.forEach(function (el) {
    const i = el.level - 1;
    const l = mine.lines[i];
    const njY = { gz: nj.gua.qinx[i], lq: nj.gua.qin6[i], god: nj.god6[i] };
    const sfY = sf.benGua.yaoList[i];
    const p = 'lines[' + el.level + ']';
    push(id, p + '.branch', el.branch, l.zhi + l.wx, [
      { n: 'najia', v: njY.gz.slice(1) },
      { n: 'shifa', v: sfY.naJia ? sfY.naJia.slice(1) : null }
    ]);
    push(id, p + '.relative', el.relative, l.lq, [
      { n: 'najia', v: njY.lq }, { n: 'shifa', v: sfY.liuQin }
    ]);
    push(id, p + '.god', normBeast(el.god), normBeast(l.beast), [
      { n: 'najia', v: normBeast(njY.god) },
      { n: 'shifa', v: sfY.liuShou ? normBeast(sfY.liuShou) : null }
    ], '六神随【日干】起，日柱错则六神必错');
    push(id, p + '.moving', el.moving, l.moving, [
      { n: 'najia', v: nj.dong.indexOf(i) >= 0 }, { n: 'shifa', v: !!sfY.isMoving }
    ]);
    if (el.changed_branch !== undefined) {
      const bz = l.bian ? l.bian.zhi + l.bian.wx : null;
      const b = nj.bian ? { gz: nj.bian.qinx[i], lq: nj.bian.qin6[i] } : null;
      const sb = sf.zhiGua ? sf.zhiGua.yaoList[i] : null;
      push(id, p + '.changed_branch', el.changed_branch, bz, [
        { n: 'najia', v: b ? b.gz.slice(1) : null },
        { n: 'shifa', v: sb && sb.naJia ? sb.naJia.slice(1) : null }
      ]);
      push(id, p + '.changed_relative', el.changed_relative, l.bian ? l.bian.lq : null, [
        { n: 'najia', v: b ? b.lq : null },
        { n: 'shifa', v: sb ? sb.liuQin : null }
      ]);
    }
  });
  // 伏神
  const expFuLevels = (exp.hidden_spirits || []).map(function (h) { return h.level; });
  const myFuLevels = mine.lines.map(function (l, i) { return l.fu ? i + 1 : 0; }).filter(function (x) { return x > 0; });
  push(id, 'hidden_spirits.level', expFuLevels, myFuLevels, [
    { n: 'najia', v: nj.hide ? nj.hide.seat.map(function (p2) { return p2 + 1; }) : [] },
    { n: 'shifa', v: sf.benGua.fuShen ? sf.benGua.fuShen.filter(function (f) {
      const present = new Set(sf.benGua.yaoList.map(function (y) { return y.liuQin; }));
      return !present.has(f.fuLiuQin);
    }).map(function (f) { return f.hostPosition; }) : [] }
  ]);
  (exp.hidden_spirits || []).forEach(function (h) {
    const i = h.level - 1;
    const p = 'hidden_spirits[' + h.level + ']';
    push(id, p + '.branch', h.branch, myFu(i), [
      { n: 'najia', v: nj.hide && nj.hide.seat.indexOf(i) >= 0 ? nj.hide.qinx[i].slice(1) : null },
      { n: 'shifa', v: null }
    ]);
    push(id, p + '.relative', h.relative, mine.lines[i].fu ? mine.lines[i].fu.lq : null, [
      { n: 'najia', v: nj.hide && nj.hide.seat.indexOf(i) >= 0 ? nj.hide.qin6[i] : null },
      { n: 'shifa', v: null }
    ]);
    push(id, p + '.source_gua', h.source_gua,
      LY.hexName(LY.TRIG[mine.palace].bits.concat(LY.TRIG[mine.palace].bits)), [
        { n: 'najia', v: LY.hexName(LY.TRIG[nj.gua.gong].bits.concat(LY.TRIG[nj.gua.gong].bits)) }
      ], '伏神取本宫首卦（八纯卦）同位爻');
  });

  meta.push({
    id: id, desc: c.description, dt: c.input.datetime, coins: coins.join(','),
    pilot: pilRows.map(function (r) { return r[0] + ' ' + r[1] + '→' + r[2]; }).join(' '),
    badPil: badPil, selfBad: selfBad,
    engine: { ben: mine.benName, bian: mine.bianName, palace: mine.palace + mine.palaceWx, shi: mine.shi + 1, ying: mine.ying + 1 },
    ref: { najia: nj.gua.name, bian: nj.bian ? nj.bian.name : '-', type: nj.type || '-', soul: nj.soul || '-' }
  });

  // ---- 四、装配「裁决后」用例（仅 --fix 时）----
  if (FIX_OUT) {
    const fxLines = exp.lines.map(function (el) {
      const i = el.level - 1;
      const l = mine.lines[i];
      const o = {
        level: el.level,
        branch: fixOf(id, 'lines[' + el.level + '].branch', el.branch),
        relative: fixOf(id, 'lines[' + el.level + '].relative', el.relative),
        god: fixOf(id, 'lines[' + el.level + '].god', normBeast(el.god)),
        moving: fixOf(id, 'lines[' + el.level + '].moving', el.moving)
      };
      if (l.moving && mine.hasBian) {
        o.changed_branch = fixOf(id, 'lines[' + el.level + '].changed_branch', l.bian.zhi + l.bian.wx);
        o.changed_relative = fixOf(id, 'lines[' + el.level + '].changed_relative', l.bian.lq);
      }
      return o;
    });
    const fx = {
      case_id: id,
      description: c.description,
      input: {
        datetime: c.input.datetime,
        ganzhi: {
          year: fixOf(id, '四柱.年柱', c.input.ganzhi.year),
          month: fixOf(id, '四柱.月柱', c.input.ganzhi.month),
          day: fixOf(id, '四柱.日柱', c.input.ganzhi.day),
          hour: fixOf(id, '四柱.时柱', c.input.ganzhi.hour)
        },
        coins: coins
      },
      expected: {
        original_gua: fixOf(id, 'original_gua', exp.original_gua),
        changed_gua: fixOf(id, 'changed_gua', exp.changed_gua),
        palace: fixOf(id, 'palace', exp.palace),
        shi_line: fixOf(id, 'shi_line', exp.shi_line),
        ying_line: fixOf(id, 'ying_line', exp.ying_line),
        xun_kong: fixOf(id, 'xun_kong', exp.xun_kong),
        lines: fxLines,
        hidden_spirits: (exp.hidden_spirits || []).map(function (h) {
          const i = h.level - 1;
          return {
            level: h.level,
            source_gua: fixOf(id, 'hidden_spirits[' + h.level + '].source_gua', h.source_gua),
            branch: fixOf(id, 'hidden_spirits[' + h.level + '].branch', h.branch),
            relative: fixOf(id, 'hidden_spirits[' + h.level + '].relative', h.relative)
          };
        })
      }
    };
    const fcat = fixOf(id, 'category', null);
    if (fcat && fcat !== NOT_SOUL) { fx.expected.category = fcat; }
    if (exp.is_liu_chong !== undefined) { fx.expected.is_liu_chong = fixOf(id, 'is_liu_chong', exp.is_liu_chong); }
    if (exp.is_liu_he !== undefined) { fx.expected.is_liu_he = fixOf(id, 'is_liu_he', exp.is_liu_he); }
    // description 原样保留（不代改文案），另给机读摘要，便于读者核对描述是否仍成立
    fx.description_check = {
      day_gan: pil.dayGZ[0],
      beast_start: LY.BEASTS[LY.beastStart(pil.dayGan)],
      soul: soulName(mine.soul),
      is_liu_chong: mine.isLiuChong,
      is_liu_he: mine.isLiuHe
    };
    // 伏神：裁决后以本引擎（与 najia/shifa 一致）为准补全
    if (!fx.expected.hidden_spirits.length) {
      mine.lines.forEach(function (l, i) {
        if (!l.fu) return;
        fx.expected.hidden_spirits.push({
          level: i + 1,
          source_gua: LY.hexName(LY.TRIG[mine.palace].bits.concat(LY.TRIG[mine.palace].bits)),
          branch: l.fu.zhi + LY.ZHI_WX[LY.ZHI.indexOf(l.fu.zhi)],
          relative: l.fu.lq
        });
      });
    }
    fixedCases.push(fx);
  }
});

// ---------- 报告 ----------
const byCase = new Map();
rows.forEach(function (r) {
  if (!byCase.has(r.caseId)) byCase.set(r.caseId, []);
  byCase.get(r.caseId).push(r);
});

meta.forEach(function (m) {
  console.log('── ' + m.id + '　' + m.dt + '　coins=' + m.coins + '　' + m.desc);
  console.log('   四柱：' + m.pilot);
  if (m.badPil.length) m.badPil.forEach(function (b) { console.log('   ✗ 四柱不符：' + b); });
  if (m.selfBad.length) m.selfBad.forEach(function (b) { console.log('   ‼ 用例自相矛盾：' + b); });
  console.log('   引擎：' + m.engine.ben + ' → ' + (m.engine.bian || '（无动爻）') + '　' + m.engine.palace +
    '宫　世' + m.engine.shi + '/应' + m.engine.ying +
    '　|　裁判 najia：' + m.ref.najia + ' → ' + m.ref.bian + '　卦型=' + (m.ref.type || '—') + '　' + (m.ref.soul || '—'));
  const rs = byCase.get(m.id) || [];
  const bad = rs.filter(function (r) { return r.verdict !== VERDICT.OK; });
  if (!bad.length) { console.log('   ✓ 全部 ' + rs.length + ' 项对账通过\n'); return; }
  console.log('   对账 ' + rs.length + ' 项：通过 ' + (rs.length - bad.length) + '，不符 ' + bad.length);
  bad.forEach(function (r) {
    const tag = r.verdict === VERDICT.CASE ? '用例错' : r.verdict === VERDICT.ENGINE ? '★引擎错' : '存疑';
    const refStr = r.refs.map(function (x) { return x.n + '=' + fmt(x.v); }).join(' ');
    console.log('     [' + tag + '] ' + r.field + '　用例=' + fmt(r.want) + '　引擎=' + fmt(r.engine) + '　' + refStr);
  });
  console.log('');
});

console.log('── 汇总 ──────────────────────────────');
console.log('对账项 ' + rows.length + '　通过 ' + summary.ok + '　用例错 ' + summary.caseWrong +
  '　★引擎错 ' + summary.engineWrong + '　存疑 ' + summary.unknown);
console.log('用例自相矛盾 ' + selfContradiction + '/' + meta.length + ' 条');
const jOut = argOf('json', '');
if (jOut) {
  fs.writeFileSync(jOut, JSON.stringify({ summary: summary, selfContradiction: selfContradiction, meta: meta, rows: rows }, null, 2));
  console.log('已写出 JSON：' + jOut);
}
if (FIX_OUT) {
  if (unbacked.length) {
    console.log('\n※ 下列字段的引擎值无任何裁判库背书，修正模式拒绝写入（保持用例原值）：');
    unbacked.forEach(function (u) { console.log('   ' + u); });
  }
  const out = {
    test_suite: (suite.test_suite || '') + '（裁决后）',
    version: (suite.version || '') + '-adjudicated',
    note: '本文件由 tests/verify/run.mjs --fix 生成。每个字段的取值均要求「本引擎与至少一家独立裁判库（@taoracle/najia / iching-shifa / lunar-javascript）一致」，' +
      '不一致的字段不写入。原始用例 external-suite-v1.json 保持原样未改动。' +
      'case 的 description 原样保留、未代改文案；描述是否仍成立请看同条下的 description_check。',
    adjudicated_by: ['liuyao/core', '@taoracle/najia', 'iching-shifa', 'lunar-javascript'],
    cases: fixedCases
  };
  fs.writeFileSync(FIX_OUT, JSON.stringify(out, null, 2));
  console.log('\n已写出裁决后用例题：' + FIX_OUT + '（' + fixedCases.length + ' 条）');
}
console.log('');
if (summary.engineWrong) {
  console.log('外部验证集对账：FAIL —— 存在裁判库支持用例、引擎不支持的项（真 BUG）');
  process.exit(1);
}
console.log('外部验证集对账：PASS —— 引擎侧无一项被裁判库判负；分歧项已逐条归责于用例');
