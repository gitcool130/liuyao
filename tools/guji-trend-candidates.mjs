/* ============================================================
 * (tools/guji-trend-candidates.mjs)
 * 从古籍全文语料中提取「断语极性」候选，供人工复核
 *
 * 背景：tests/guji 现有 404 条卦例，但只有 8 条带吉凶标签（expect.trend），
 * 不足以评估「模型断卦水平」。本工具从 corpus 的 conclusion 字段（原书断语全文）
 * 中按关键词初筛，把 404 条压成几十条「极性明确、值得标注」的候选。
 *
 * 定位：这是**标注辅助**，不是标注本身。输出一律标 needsReview: true，
 * 极性仅供人工确认——绝不可直接当作 golden 标签使用。
 *
 * 用法：node tools/guji-trend-candidates.mjs [--out tests/guji/trend-candidates.json]
 * ============================================================ */
import fs from 'fs';
import path from 'path';

const BOOKS = [
  { file: 'tests/guji/corpus/zengshan-boyi.json', book: '增删卜易' },
  { file: 'tests/guji/corpus/bushi-zhengzong.json', book: '卜筮正宗' }
];

// 强词：出现即可较有把握判断极性
const STRONG = {
  吉: ['必得', '必成', '许之', '果得', '果于', '即愈', '即归', '联捷', '高中', '白头相守', '无不遂', '遂意', '大喜', '竟得', '应手而愈'],
  凶: ['不吉', '大凶', '难成', '不成', '无成', '不利', '必败', '立败', '病重', '不治', '殁', '亡', '大祸', '非祸即灾', '折本', '退财']
};

// 弱词：需结合语境，单人不可定极性
const WEAK = {
  吉: ['得', '成', '吉', '愈', '归', '允', '遂', '验', '无碍'],
  凶: ['凶', '败', '破', '损', '危', '灾', '退', '散', '空']
};

// 否定前缀，用于避免「不得」「不成」被当作「得」「成」
const NEG = /(?:不|未|难以|未能|弗)/;

// 多卦串案检测：一段 conclusion 里出现两次以上「占…得」时，往往串了多个卦例
// （实测 zsby-02991 前半「果官至命事」吉、后半「降调而归」凶，整体极性无意义）。
// 这类不参与打分，单独列出供人工拆分。
function isMultiCase(text) {
  const m = text.match(/占[^。；]{0,14}?得/g) || [];
  return m.length >= 2 || /又[^。]{0,10}占/.test(text);
}

function score(text) {
  const hits = { 吉: [], 凶: [] };
  let strongG = 0, strongX = 0, weakG = 0, weakX = 0;

  for (const w of STRONG.吉) {
    let i = -1;
    while ((i = text.indexOf(w, i + 1)) >= 0) { hits.吉.push(w); strongG++; }
  }
  for (const w of STRONG.凶) {
    let i = -1;
    while ((i = text.indexOf(w, i + 1)) >= 0) { hits.凶.push(w); strongX++; }
  }
  for (const w of WEAK.吉) {
    let i = -1;
    while ((i = text.indexOf(w, i + 1)) >= 0) {
      // 「不得」「不成」等否定式不计入吉
      if (NEG.test(text.slice(Math.max(0, i - 2), i))) continue;
      hits.吉.push(w); weakG++;
    }
  }
  for (const w of WEAK.凶) {
    let i = -1;
    while ((i = text.indexOf(w, i + 1)) >= 0) { hits.凶.push(w); weakX++; }
  }

  let polarity = '', confidence = 'low';
  if (strongG > 0 && strongX === 0) { polarity = '吉'; confidence = strongG >= 2 ? 'high' : 'medium'; }
  else if (strongX > 0 && strongG === 0) { polarity = '凶'; confidence = strongX >= 2 ? 'high' : 'medium'; }
  else if (!strongG && !strongX) {
    if (weakG > weakX) { polarity = '吉'; confidence = 'low'; }
    else if (weakX > weakG) { polarity = '凶'; confidence = 'low'; }
    else { polarity = ''; confidence = 'none'; }
  } else {
    polarity = ''; confidence = 'conflict';
  }
  return { polarity, confidence, strongG, strongX, weakG, weakX, hits };
}

const outPath = (process.argv.indexOf('--out') > 0)
  ? process.argv[process.argv.indexOf('--out') + 1]
  : 'tests/guji/trend-candidates.json';

const result = { generatedBy: 'tools/guji-trend-candidates.mjs', at: new Date().toISOString(), books: [], items: [], multi: [] };
let total = 0;

for (const b of BOOKS) {
  if (!fs.existsSync(b.file)) { console.warn('缺语料:', b.file); continue; }
  const d = JSON.parse(fs.readFileSync(b.file, 'utf8'));
  const cs = d.cases || [];
  let withConc = 0;
  const stat = { high: 0, medium: 0, low: 0, conflict: 0, none: 0, multi: 0 };

  for (const c of cs) {
    const text = String(c.conclusion || '').trim();
    if (!text) continue;
    withConc++;
    if (isMultiCase(text)) {
      stat.multi = (stat.multi || 0) + 1;
      result.multi.push({ book: b.book, id: c.id, head: c.head, conclusion: text });
      continue;
    }
    const s = score(text);
    stat[s.confidence] = (stat[s.confidence] || 0) + 1;
    // 只输出 high / medium：low 与 conflict 供人工判读价值不大，避免噪音
    if (s.confidence !== 'high' && s.confidence !== 'medium') continue;
    result.items.push({
      book: b.book,
      id: c.id,
      chapter: c.chapter || '',
      head: c.head || '',
      monthZhi: c.monthZhi || '',
      dayGZ: c.dayGZ || '',
      polarity: s.polarity,
      confidence: s.confidence,
      hits: s.hits[s.polarity].slice(0, 6),
      // 断语全文保留：人工复核必须看上下文，不能只看关键词
      conclusion: text,
      needsReview: true
    });
    total++;
  }
  result.books.push({ book: b.book, cases: cs.length, withConclusion: withConc, ...stat });
  console.log(`${b.book}: ${cs.length} 条，有断语 ${withConc} 条 | high=${stat.high} medium=${stat.medium} low=${stat.low} conflict=${stat.conflict} multi=${stat.multi}`);
}

result.total = total;
fs.writeFileSync(outPath, JSON.stringify(result, null, 1));
console.log(`\n候选 ${total} 条 | 多卦串案 ${result.multi.length} 条（未计分）→ ${outPath}`);
console.log('注意：polarity 为关键词初筛结果，needsReview 恒为 true，须逐条对照原文确认后方可作标签。');
