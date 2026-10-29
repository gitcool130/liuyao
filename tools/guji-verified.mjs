/* ============================================================
 * (tools/guji-verified.mjs)
 * 从《增删卜易》语料里抽出「事前有断、事后有验」的卦例，做成可回填的清单。
 *
 * 为什么需要它：本仓库 12,148 项断言全部只验证「卦画 → 装卦」与「原文断语 → 判定链」，
 * 没有任何一条检验「引擎判的吉凶，和书里记的结局是不是一回事」。要做命中率、Brier、
 * 过度自信分桶，前提是有「预测 + 结果」成对的数据 —— 而这类数据在语料里本来就存在：
 * 原文常在断语之后补一句「果于寅日得财」「果卒于癸卯日」。
 *
 * 本工具只做**机械抽取**，不做学术裁断：
 *   · prediction = 原文「果…」之前的断语原句
 *   · outcome    = 原文「果…」起的应验句
 *   · resultGuess= 由应验句里的动词机械猜出的极性（POS/NEG/MIXED/UNKNOWN），
 *                  仅作**人工复核的排序依据**，不是标签。confidence=high 才建议直接采信。
 *   · engine     = 引擎对 6 个用神视角各判的 trend（吉/凶/平）
 *
 * 铁律沿用 tests/guji/README.md：期望值不来自被测引擎。所以 outcome 一律是原文，
 * resultGuess 只是检索提示；engine 与 outcome 的对照（align）才是有信息量的那一层。
 *
 * 跑法：npm run guji:verified
 * 产出：tests/guji/verified-cases.json（结构化）、docs/verified-cases.md（人读）
 * ============================================================ */
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import LY from '../core.js';
import { dateForGZ } from '../tests/guji/lib/ganzhi.mjs';
import { tossOf } from '../tests/guji/lib/check.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const require = createRequire(import.meta.url);
const corpus = require('../tests/guji/corpus/zengshan-boyi.json');

/* ---------- 一、识别「应验句」 ---------- */

// 起点标记：原文记事成之后常用这几个词起句。按出现位置取**最早**的一个，
// 因为个别卦例会先说「果于某日…」，后面再补一段事后议论（议论不算 outcome）。
const OUTCOME_MARK = /(果於|果于|果卒|果至|果得|果以|果驗|果验|果應|果应|果然|竟於|竟于|竟以|應驗|应验|不驗|不验|後於|后于|遂於|遂于|已而|至期|到期)/;

// 极性线索。分强弱两档：强档单一命中即可定，弱档需人工看一眼。
// 刻意不收「雨／晴／到／至／起」这类词：占天时与占行人只问准不准，吉凶口径不适用（见 §三末）。
const POS_STRONG = ['得财', '得見', '得见', '得之', '得財', '痊', '愈', '救活', '平安', '升任', '成婚',
  '成家', '生子', '中举', '中式', '得官', '归家', '歸家', '到家', '获胜', '得勝', '復職', '复职',
  '允婚', '還鄉', '还乡', '得中', '得名', '獲', '获', '全生', '脫', '脱', '病癒', '病愈',
  '登科', '登第', '及第', '升遷', '升迁', '升督', '到任', '得缺', '得差', '報捷', '报捷',
  '相逢', '相會', '相会', '團聚', '团聚', '無恙', '无恙', '太平', '和好', '復合', '复合',
  '退敵', '退敌', '得勝', '完璧', '如願', '如愿', '遂意', '無礙', '无碍', '並無阻滯', '并无阻滞'];
const NEG_STRONG = ['卒', '死', '亡', '重刑', '下狱', '下獄', '盗尽', '盜盡', '不成', '不允', '不验',
  '不驗', '未成', '失手', '大败', '大敗', '破财', '破財', '病重', '不起',
  '罢官', '罷官', '免官', '亏', '虧', '逃走', '火災', '火灾', '溺', '不得', '落空', '敗', '败',
  '氣絕', '气绝', '絕命', '绝命', '亡故', '死亡', '而亡', '遂亡',
  '革职', '革職', '拿问', '拿問', '被論', '被论', '消索', '惊风', '驚風', '席卷一空', '席捲一空',
  '所伤', '所傷', '被盜', '被盗', '被贼', '被賊', '失竊', '失窃', '失落', '退婚', '離異', '离异',
  '被責', '被责', '被逐', '被罚', '被罰', '受刑', '遭刑', '損財', '损财', '大損', '大损'];
const POS_WEAK = ['成', '得', '安', '好', '見', '见', '生', '遷', '迁', '進', '进', '復', '复', '歸', '归'];

/* 匹配前先抹掉这些**术语**：它们只是一个词的一部分，不代表结局。
 * 典型坑：「空亡」里的「亡」会被当成死亡（zsby-00645 实测误判 NEG）。 */
const TERM_NOISE = /(空亡|旬空|入墓|月破|日破|相合|回头|化空|伏神|飞神)/g;

/* 命中的词若紧跟在否定词后面，不算数：「不愈」「无伤」「未成」不能按「愈」「伤」「成」算。 */
const NEG_PREFIX = /(不|无|無|未|非|莫|豈|岂|弗)$/;

function hits(text, words) {
  const out = [];
  const s = String(text).replace(TERM_NOISE, '　');
  words.forEach(function (w) {
    let i = s.indexOf(w);
    while (i >= 0) {
      const pre = s.slice(Math.max(0, i - 2), i);
      if (!NEG_PREFIX.test(pre)) out.push(w);
      i = s.indexOf(w, i + w.length);
    }
  });
  return out;
}

function guessPolarity(outcome) {
  // 「不验」是**预测失败**的自述，与吉凶无关，必须单列——它是本清单里最值钱的一类：
  // 书里明说「这么断，没应」，等于一个标注好的反例（zsby-02691 实测）。
  if (/^(不验|不驗|竟不验|竟不驗)/.test(outcome.trim())) {
    return { resultGuess: 'MISMATCH', confidence: 'high', words: ['不验(断而未应)'] };
  }
  const hitPosS = hits(outcome, POS_STRONG);
  const hitNegS = hits(outcome, NEG_STRONG);
  if (hitPosS.length && hitNegS.length) {
    return { resultGuess: 'MIXED', confidence: 'high', words: hitPosS.concat(hitNegS) };
  }
  if (hitNegS.length) return { resultGuess: 'NEG', confidence: 'high', words: hitNegS };
  if (hitPosS.length) return { resultGuess: 'POS', confidence: 'high', words: hitPosS };
  const hitPosW = hits(outcome, POS_WEAK);
  if (hitPosW.length) return { resultGuess: 'POS', confidence: 'low', words: hitPosW };
  return { resultGuess: 'UNKNOWN', confidence: 'low', words: [] };
}

/* ---------- 二、引擎侧：六视角 trend ---------- */

const TARGETS = ['shi', '妻财', '官鬼', '父母', '兄弟', '子孙'];
const TREND_POL = { 吉: 'POS', 凶: 'NEG', 平: null };

function engineTrends(c) {
  const dt = dateForGZ(c.monthZhi, c.dayGZ);
  if (!dt) return null;
  const pan = LY.paipan(tossOf(c.ben), dt);
  const out = {};
  TARGETS.forEach(function (t) {
    try {
      const r = LY.analyze(pan, t);
      out[t] = r.trend;
    } catch (e) {
      out[t] = null;
    }
  });
  // 语料里没有卦名字段，卦名由引擎从卦画反查 —— 只用于人读定位，不参与任何断言。
  return { trends: out, benName: pan.benName, bianName: pan.hasBian ? pan.bianName : null, palace: pan.palace };
}

/* ---------- 三、抽取主流程 ---------- */

const rows = [];
const skipped = [];

(corpus.cases || []).forEach(function (c) {
  const cons = String(c.conclusion || '');
  const m = OUTCOME_MARK.exec(cons);
  if (!m) { skipped.push({ id: c.id, why: '无应验句' }); return; }

  const cut = m.index;
  const prediction = cons.slice(0, cut).trim();
  const outcome = cons.slice(cut).trim();
  // 断语为空或极短时，正文无信息量，不入列
  if (prediction.length < 15) { skipped.push({ id: c.id, why: '「果…」之前无实质断语' }); return; }

  const pol = guessPolarity(outcome);
  const eng = engineTrends(c);
  if (!eng) { skipped.push({ id: c.id, why: '月支+日干支无等价日期' }); return; }
  const trends = eng.trends;

  // 只有 POS/NEG 才谈得上「同向」；MIXED（先成后败）、UNKNOWN（只报事件）、
  // MISMATCH（原文自认断错）都不进同向率统计，否则分母全是噪声。
  const polar = (pol.resultGuess === 'POS' || pol.resultGuess === 'NEG');
  const align = {};
  TARGETS.forEach(function (t) {
    const p = TREND_POL[trends[t]];
    align[t] = (polar && p) ? (p === pol.resultGuess) : null;
  });

  rows.push({
    id: c.id,
    line: c.line,
    chapter: c.chapter,
    head: c.head,
    monthZhi: c.monthZhi,
    dayGZ: c.dayGZ,
    gua: eng.benName || null,
    bian: eng.bianName || null,
    palace: eng.palace || null,
    prediction: prediction,
    outcome: outcome,
    resultGuess: pol.resultGuess,
    confidence: pol.confidence,
    guessWords: pol.words,
    engine: trends,
    align: align
  });
});

/* ---------- 四、统计 ---------- */

function tally(key) {
  const o = {};
  rows.forEach(function (r) { const v = r[key] || '(无)'; o[v] = (o[v] || 0) + 1; });
  return o;
}
const targetStats = {};
TARGETS.forEach(function (t) {
  const judged = rows.filter(function (r) { return r.align[t] !== null; });
  const hit = judged.filter(function (r) { return r.align[t] === true; });
  targetStats[t] = { judged: judged.length, hit: hit.length, rate: judged.length ? +(hit.length / judged.length * 100).toFixed(1) : null };
});
const hiConf = rows.filter(function (r) { return r.confidence === 'high'; });

const summary = {
  total: rows.length,
  fromCorpus: (corpus.cases || []).length,
  skipped: skipped.length,
  byGuess: tally('resultGuess'),
  byConfidence: tally('confidence'),
  highConfidence: hiConf.length,
  byTarget: targetStats,
  note: 'resultGuess 由应验句动词机械猜测，未经人工裁定；align 只统计非 MIXED/UNKNOWN 的条目。'
};

/* ---------- 五、落盘 ---------- */

const outJson = {
  book: corpus.book,
  source: corpus.source,
  generatedBy: 'tools/guji-verified.mjs',
  purpose: '「事前断语 + 事后应验」成对清单，供事后回填、命中率与过度自信分桶使用。',
  caveats: [
    'prediction / outcome 均为原文切片，未改写；resultGuess 是机械猜测，不是标签。',
    'engine 为引擎对 6 个视角各判的 trend —— 原文用神未必是其中之一，故 align 只作线索。',
    '「应验」取自书中自述，本工具无法校验其真实性（古书自述应验本就有选样偏差）。'
  ],
  summary: summary,
  cases: rows
};
writeFileSync(path.join(ROOT, 'tests/guji/verified-cases.json'), JSON.stringify(outJson, null, 2) + '\n');

function esc(s) { return String(s == null ? '' : s).replace(/\|/g, '\\|'); }

const md = [];
md.push('# 有断有验的古卦清单（《增删卜易》）');
md.push('');
md.push('> 由 `npm run guji:verified` 从 `tests/guji/corpus/zengshan-boyi.json` 机械抽取，**勿手改**。');
md.push('> 用途：给六爻引擎补上「预测 vs 结果」这一层——现有 12,148 项断言只验证排盘与判定链，');
md.push('> 从不检验「判的吉凶与书里记的结局是否同向」。');
md.push('');
md.push('## 一、口径');
md.push('');
md.push('| 字段 | 含义 | 可信度 |');
md.push('|---|---|---|');
md.push('| `prediction` | 原文「果…」之前的断语原句 | 原文，可直接引用 |');
md.push('| `outcome` | 从「果于／果卒／果至…」起至段末的应验句 | 原文，可直接引用 |');
md.push('| `resultGuess` | 由应验句动词猜出的极性 POS／NEG／MIXED／UNKNOWN | **机械猜测，待人工裁定** |');
md.push('| `confidence` | high＝命中强线索词；low＝只命中弱线索词 | 仅用于排序复核优先级 |');
md.push('| `engine` | 引擎对 shi／妻财／官鬼／父母／兄弟／子孙 六视角各判的 trend | 引擎输出 |');
md.push('| `align` | 该视角 trend 与 `resultGuess` 是否同向 | 仅当 resultGuess 非 MIXED/UNKNOWN 才有值 |');
md.push('');
md.push('## 二、概览');
md.push('');
md.push('- 语料 ' + summary.fromCorpus + ' 例 → 有应验句且断语可用 **' + summary.total + '** 例（跳过 ' + summary.skipped + ' 例）。');
md.push('- 极性猜测分布：' + Object.keys(summary.byGuess).map(function (k) { return k + ' ' + summary.byGuess[k]; }).join(' · '));
md.push('- 其中高置信（建议优先人工复核）：**' + summary.highConfidence + '** 例。');
md.push('');
md.push('### 引擎 trend 与「自述结局」的同向率');
md.push('');
md.push('| 视角 | 参与判定 | 同向 | 同向率 |');
md.push('|---|---|---|---|');
TARGETS.forEach(function (t) {
  const s = targetStats[t];
  md.push('| ' + (t === 'shi' ? '世爻' : t) + ' | ' + s.judged + ' | ' + s.hit + ' | ' + (s.rate == null ? '—' : s.rate + '%') + ' |');
});
md.push('');
md.push('> ⚠ 这不是引擎命中率。原文用神各例不同，六视角里必然有「非该例用神」的视角；');
md.push('> 上表只能说「若按世爻／若按某六亲取用，与结局同向的比例」，两者都含系统性偏差。');
md.push('> 真正要算命中率，得先把每例的原文用神标出来——那是人工活，本清单就是把活摊开给人做。');
md.push('');
md.push('## 三、断而不验（最值钱的一类）');
md.push('');
md.push('原文自称「不验」的卦例——书里明说**这么断，没应**。这是天然标注好的反例：');
md.push('不需要人工裁定结果，也不需要猜用神，直接就是「规则链在这类盘上失效」的证据。');
md.push('');
const mism = rows.filter(function (r) { return r.resultGuess === 'MISMATCH'; });
if (!mism.length) {
  md.push('（本词语料内暂无 `不验` 起句的条目。）');
} else {
  mism.forEach(function (r) {
    md.push('- **`' + r.id + '`**　' + r.monthZhi + '月' + r.dayGZ + '日　' + (r.gua || ''));
    md.push('  - 断语：' + esc(r.prediction));
    md.push('  - 原文：' + esc(r.outcome.slice(0, 120)));
  });
}
md.push('');
md.push('## 四、逐例清单');
md.push('');
md.push('按 `confidence` 降序、同置信内按原文行号排列。**复核时先看 align 全为 false 的那些**——');
md.push('它们要么是引擎判错，要么是 resultGuess 猜错，两种都值得记一笔。');
md.push('');

const order = { high: 0, low: 1 };
rows.filter(function (r) { return r.resultGuess !== 'MISMATCH'; })
  .sort(function (a, b) {
    const d = order[a.confidence] - order[b.confidence];
    return d !== 0 ? d : a.line - b.line;
  }).forEach(function (r, i) {
  const eg = TARGETS.map(function (t) { return (t === 'shi' ? '世' : t) + ':' + (r.engine[t] || '?'); }).join(' ');
  md.push('### ' + (i + 1) + '. `' + r.id + '`　' + r.monthZhi + '月' + r.dayGZ + '日　' + (r.gua || '') + (r.bian ? ' 之 ' + r.bian : ''));
  md.push('');
  md.push('- 原书：' + esc(r.chapter) + '（第 ' + r.line + ' 行）');
  md.push('- 卦例：' + esc(r.head));
  md.push('- 断语：' + esc(r.prediction));
  md.push('- 应验：**' + esc(r.outcome) + '**');
  md.push('- 猜测：`' + r.resultGuess + '`（' + r.confidence + (r.guessWords.length ? '／线索：' + r.guessWords.join('、') : '') + '）');
  md.push('- 引擎：' + eg);
  md.push('- align：' + TARGETS.map(function (t) {
    const v = r.align[t];
    return (t === 'shi' ? '世' : t) + (v === null ? '—' : (v ? '✓' : '✗'));
  }).join(' '));
  md.push('');
});

md.push('## 五、引擎与结局相悖（世爻视角，优先排查）');
md.push('');
const shiConflicts = rows.filter(function (r) { return r.confidence === 'high' && r.align.shi === false; });
md.push('高置信条目中，**按世爻取用**判出的 trend 与原文结局相反的 ' + shiConflicts.length + ' 例。');
md.push('在没标出原文用神之前，世爻是唯一机器可用的口径（且自占类卦例本就用世爻），');
md.push('故这批是最省力气的排查入口：要么引擎漏了一条伤克，要么 resultGuess 猜错——两种都要看一眼原文。');
md.push('');
if (!shiConflicts.length) {
  md.push('（无。）');
} else {
  md.push('| id | 日月 | 卦 | 引擎世爻 | 结局猜测 | 断语（节选） |');
  md.push('|---|---|---|---|---|---|');
  shiConflicts.forEach(function (r) {
    md.push('| `' + r.id + '` | ' + r.monthZhi + '月' + r.dayGZ + ' | ' + (r.gua || '') +
      (r.bian ? ' 之 ' + r.bian : '') + ' | ' + (r.engine.shi || '?') + ' | ' + r.resultGuess +
      ' | ' + esc(r.prediction.slice(-46)) + ' |');
  });
}
md.push('');
md.push('## 六、下一步（人工，不要交给脚本）');
md.push('');
md.push('1. 对 `confidence: high` 的 ' + summary.highConfidence + ' 例，逐条标注真实 `result`：成／不成／吉／凶／应期是否如断。');
md.push('2. 标出每例**原文实际取用的用神**（`target`），这是唯一能消掉六视角偏差的办法。');
md.push('3. 只有完成 1、2 之后，`align` 才算得上命中率；此前它只是「值得看一眼」的排序键。');
md.push('4. 反例优先：`resultGuess` 与断语句意相反的条目（原文断吉而应凶、断凶而应吉）价值最高——');
md.push('   它们直接指向规则链的缺口，而不是文风差异。');
md.push('');

writeFileSync(path.join(ROOT, 'docs/verified-cases.md'), md.join('\n'));

/* ---------- 六、控制台摘要 ---------- */

console.log('[guji-verified] 语料 ' + (corpus.cases || []).length + ' 例 → 抽到 ' + rows.length + ' 例（跳过 ' + skipped.length + '）');
console.log('  极性猜测：' + Object.keys(summary.byGuess).map(function (k) { return k + '=' + summary.byGuess[k]; }).join(' '));
console.log('  置信分布：' + Object.keys(summary.byConfidence).map(function (k) { return k + '=' + summary.byConfidence[k]; }).join(' '));
console.log('  六视角同向率：' + TARGETS.map(function (t) {
  const s = targetStats[t];
  return (t === 'shi' ? '世' : t) + ' ' + (s.rate == null ? '—' : s.rate + '%') + '(' + s.hit + '/' + s.judged + ')';
}).join('  '));
console.log('  → tests/guji/verified-cases.json / docs/verified-cases.md');
