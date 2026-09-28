/* ============================================================
 * (tests/guji/lib/check.mjs)
 * 古籍对账内核 —— 供 run.mjs（报告）与 selftest.mjs（变异自检）共用。
 *
 * 断言方向：输入 = 书里的卦画（阴阳 + 动爻）
 *           期望 = 书里的装卦（六亲 / 纳甲地支 / 世应位 / 变卦）
 * 期望值全部取自古籍印刷内容，引擎只负责「由卦画推装卦」，无自证。
 * ============================================================ */
import LY from '../../../core.js';
import { dateForGZ, dateForDayGan } from './ganzhi.mjs';

const ZHI = LY.ZHI;

/** 由「卦画」生成引擎入参：1 少阳 / 0 少阴 / 9 老阳动 / 6 老阴动 */
export function tossOf(ben) {
  return ben.map(function (l) { return l.yang ? (l.moving ? 9 : 1) : (l.moving ? 6 : 0); });
}

function mk() {
  return { checks: 0, fails: 0, failLog: [], noDomain: [], byChapter: new Map(), cases: 0 };
}

/**
 * 排盘层对账：古籍印的装卦 vs 引擎排盘
 * @param {object} corpus tools/guji-import.mjs 产出的语料
 * @returns 统计对象
 */
export function checkCorpus(corpus) {
  const R = mk();

  function chk(c, field, got, want) {
    R.checks++;
    const key = c.chapter || '(无章节)';
    const b = R.byChapter.get(key) || { n: 0, bad: 0 };
    b.n++;
    if (got !== want) {
      b.bad++; R.fails++;
      R.failLog.push({ id: c.id, line: c.line, head: c.head, field: field, got: got, want: want });
    }
    R.byChapter.set(key, b);
  }

  (corpus.cases || []).forEach(function (c) {
    const mzIdx = ZHI.indexOf(c.monthZhi);
    const dt = dateForGZ(c.monthZhi, c.dayGZ);
    if (!dt) { R.noDomain.push({ id: c.id, line: c.line, head: c.head, monthZhi: c.monthZhi, dayGZ: c.dayGZ }); return; }

    const pan = LY.paipan(tossOf(c.ben), dt);
    R.cases++;

    // 等价性守卫（搜索器自检）：日期确应落在该月建与日辰
    if (pan.pillars.monthZhi !== mzIdx || pan.pillars.dayGZ !== c.dayGZ) {
      R.checks++; R.fails++;
      R.failLog.push({
        id: c.id, line: c.line, head: c.head, field: '[守卫] 等价日期不成立',
        got: pan.pillars.monthGZ + '月' + pan.pillars.dayGZ + '日',
        want: ZHI[mzIdx] + '月' + c.dayGZ + '日'
      });
      return;
    }

    // 本卦：纳甲地支 / 六亲 / 世应
    c.ben.forEach(function (b, i) {
      const L = pan.lines[i];
      chk(c, '本卦' + LY.LINE_NAMES[i] + '·地支', L.zhi, b.zhi);
      chk(c, '本卦' + LY.LINE_NAMES[i] + '·六亲', L.lq, b.lq);
      chk(c, '本卦' + LY.LINE_NAMES[i] + '·世', L.shi, !!b.shi);
      chk(c, '本卦' + LY.LINE_NAMES[i] + '·应', L.ying, !!b.ying);
    });

    // 变卦：仅当卦中有动爻（无动则书右半只是本卦照抄，非变卦）
    if (pan.hasBian) {
      const bInfo = LY.PALACE[pan.bianBits.join('')];
      c.bian.forEach(function (b2, i) {
        if (!b2 || !b2.zhi) return;
        const B = pan.lines[i].bian;
        chk(c, '变卦' + LY.LINE_NAMES[i] + '·地支', B.zhi, b2.zhi);
        chk(c, '变卦' + LY.LINE_NAMES[i] + '·六亲', B.lq, b2.lq);
        chk(c, '变卦' + LY.LINE_NAMES[i] + '·世', bInfo.shi === i, !!b2.shi);
        chk(c, '变卦' + LY.LINE_NAMES[i] + '·应', bInfo.ying === i, !!b2.ying);
      });
    }
  });

  return R;
}

/**
 * 表格式语料对账（《卜筮正宗》表格版）
 *
 * 期望值 = 书里表格印刷的「纳甲地支 / 六亲 / 六神 / 伏神」；
 * 输入   = 书里表格印刷的「卦名（→卦画）」+「日干」。
 *
 * 与 checkCorpus 的差别：
 *   1) 日支缺失 —— 表格只印日干与月建，故等价日期仅按日干搜索。
 *      由它驱动的对账**只对与月支/日支无关的字段有效**（地支/六亲/六神/伏神）。
 *   2) 世应列在转换文本中偶发串行，故本函数不对账世应（该维度已由
 *      《增删卜易》六行卦体语料覆盖）。
 *   3) 伏神按「值」对账而非「位置」：书上印出的伏神必须能在引擎侧寻得
 *      （转换文本的伏神列存在整体错位，见语料 textIssues）。
 *
 * @param {object} corpus tools/guji-import-bszz.mjs 产出的语料
 * @param {Array}  known  known-text-issues.json 中该书目的 items（已逐条回溯原文定性）
 */
export function checkTabCorpus(corpus, known) {
  const R = mk();
  R.noGan = 0;
  R.excluded = 0;

  // 已知文本缺陷：id + field 子串 → 该断言不再计入（单独统计，不静默丢弃）
  const reg = (known || []).map(function (it) {
    return { id: it.id, greps: it.greps || [], reason: it.reason };
  });
  function isKnownText(c, field) {
    for (const r of reg) {
      if (r.id !== c.id) continue;
      if (r.greps.some(function (g) { return field.indexOf(g) >= 0; })) return true;
    }
    return false;
  }

  function chk(c, key, field, got, want) {
    if (isKnownText(c, field)) { R.excluded++; R.checks++; return; }
    R.checks++;
    const b = R.byChapter.get(key) || { n: 0, bad: 0 };
    b.n++;
    if (got !== want) {
      b.bad++; R.fails++;
      R.failLog.push({ id: c.id, line: c.line, head: (c.job || c.guaRaw) + '　' + c.side, field: field, got: got, want: want });
    }
    R.byChapter.set(key, b);
  }

  (corpus.cases || []).forEach(function (c) {
    // 未印日干者：用一个任意日期驱动即可 —— 地支/六亲/伏神只取决于卦画，
    // 与日辰无关；仅「六神」一项因依赖日干而跳过（见下方 hasGan 守卫）。
    const hasGan = !!c.dayGan;
    const dt = hasGan ? dateForDayGan(c.dayGan) : new Date(2000, 0, 1, 12, 0, 0, 0);
    if (!dt) { R.noDomain.push({ id: c.id, line: c.line, head: c.guaRaw, monthZhi: '', dayGZ: c.dayGan || '' }); return; }
    if (!hasGan) R.noGan++;

    const pan = LY.paipan(c.toss, dt);
    R.cases++;
    const key = (corpus.book || '') + '·' + (c.chapter || '(无章节)');

    c.ben.forEach(function (b, i) {
      const L = pan.lines[i];
      const ln = LY.LINE_NAMES[i];
      chk(c, key, ln + '·地支', L.zhi, b.zhi);
      chk(c, key, ln + '·六亲', L.lq, b.lq);
      if (b.beast && hasGan) chk(c, key, ln + '·六神', L.beast, b.beast);
    });

    // 伏神：书上印出者，引擎侧必须存在同值伏神
    const engFu = pan.lines.filter(function (l) { return l.fu; })
      .map(function (l) { return l.fu.zhi + l.fu.lq; });
    c.ben.forEach(function (b, i) {
      if (!b.fu) return;
      const want = b.fu.zhi + b.fu.lq;
      const got = engFu.indexOf(want) >= 0 ? want : (engFu.join('|') || '(无)');
      chk(c, key, '伏神(' + LY.LINE_NAMES[i] + ')', got, want);
    });
  });

  return R;
}

/**
 * 规则层断言：cases/*.json —— 期望取自古籍断语（人工核对后录入）
 *
 * expect 项支持四种形态：
 *   { "trend": "凶" }                  整体粗判
 *   { "tag": "日冲", "rule": "日破" }   用神判定链中须出现该 tag(:rule)，只给 tag 则放宽
 *   { "atLine": 0, "monthGrade": "相" } 单爻视角：该爻在本月建下的旺相休囚死
 *   { "atLine": 0, "dayChong": "andong" } 单爻视角：日冲判定 kind
 *   { "atLine": 5, "dongBian": "回生" }  单爻视角：动变判定 kind
 * atLine 为 0–5（初爻→上爻）。
 */
export function checkCases(doc) {
  const R = mk();

  function bump(key) {
    R.checks++;
    const b = R.byChapter.get(key) || { n: 0, bad: 0 };
    b.n++;
    return b;
  }
  function record(c, key, b, label, got, want, ok) {
    if (!ok) {
      b.bad++; R.fails++;
      R.failLog.push({
        id: c.id, line: c.line || '', head: c.title + '　【' + label + '】',
        field: c.quote ? c.quote.slice(0, 40) : '', got: got, want: want
      });
    }
    R.byChapter.set(key, b);
  }

  (doc.cases || []).forEach(function (c) {
    const dt = c.date ? new Date(c.date) : dateForGZ(c.monthZhi, c.dayGZ);
    if (!dt) { R.noDomain.push({ id: c.id, head: c.title || '', monthZhi: c.monthZhi, dayGZ: c.dayGZ }); return; }

    const pan = LY.paipan(c.toss, dt);
    const pil = pan.pillars;
    const res = LY.analyze(pan, c.target || 'shi');
    R.cases++;
    const key = (doc.book || '') + '·' + (c.chapter || '');
    const at = function (i) { return pan.lines[i]; };
    const grade = function (i) { return LY.wangXiangXiuQiuSi(at(i).wx, pil.monthZhi); };

    (c.expect || []).forEach(function (e) {
      const b = bump(key);
      let label, got, want, ok;

      if (e.trend) {
        label = '粗判 trend'; got = res.trend; want = e.trend; ok = got === want;
      } else if (e.monthGrade) {
        label = '月建档@' + LY.LINE_NAMES[e.atLine]; got = grade(e.atLine); want = e.monthGrade; ok = got === want;
      } else if (e.dayChong) {
        label = '日冲@' + LY.LINE_NAMES[e.atLine];
        got = LY.ruleDayChong(at(e.atLine), pil, grade(e.atLine), '官鬼').kind;
        want = e.dayChong; ok = got === want;
      } else if (e.dongBian) {
        label = '动变@' + LY.LINE_NAMES[e.atLine];
        got = LY.ruleDongBian(at(e.atLine), '官鬼').kind;
        want = e.dongBian; ok = got === want;
      } else {
        label = '判定 ' + e.tag + (e.rule ? ':' + e.rule : '');
        got = res.judgments.some(function (j) {
          return j.tag === e.tag && (!e.rule || j.rule === e.rule);
        });
        want = true; ok = got === want;
      }

      record(c, key, b, label, got, want, ok);
    });
  });

  return R;
}
