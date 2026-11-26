/* 从《增删卜易》卦例的 head 里抽出「占问」原文（job）。
 *
 * 为什么要在数据层做：head 是原文一整句（含「例：」「如」「又如」等引语前缀
 * 和「得某卦变某卦」的卦名尾巴），前端直接拿去当占问只能得到半截残字
 * （王哥 2026-11-26 截图：盘面冒出「占: 官」，实为「占官得困之兑卦」被截断）。
 *
 * 《卜筮正宗》那本自带 job 字段（人工整理），本脚本只补《增删卜易》207 条。
 *
 * 切点判据（三档，从严到宽）：
 *   A 严格：切点落在句子边界（串首 / 「得」「化」处 / 紧跟标点或空白之后），
 *           且切点之后**整段**都能拼成「卦名词 + 之/变/化/卦/得」。
 *           挡住「占婚成否」把「成否」的「否」当卦名切掉。
 *   B 放宽：切点之后能看出「卦名+连接词+卦名」的完整结构（至少 2 个卦名、
 *           至少 1 个连接词），且该结构后紧跟标点或到串末。
 *           用于「得大有变睽，同时祖又占…」这种卦名后面拖注释的句子。
 *   C 反查：切出来是空（原文只写「占得某卦」没写占问），改取日期**之前**那句
 *           ——「曾有人占财福酉月壬辰日得恒卦」的占问在日期前面。
 *
 * 俗字表：原文有个别错字／异体（暌→睽、逐→遁、骞→谦、即济→既济），
 * 只在识别阶段按 1:1 字符替换，输出的 job 仍是原文原字。
 *
 * 用法：node tools/guji-extract-job.mjs [--write]
 *   不带 --write 只打印结果供核对，不改文件。
 */
import fs from 'node:fs';

const FILE = 'public/guji/zengshan-boyi.json';

const ZHI = '子丑寅卯辰巳午未申酉戌亥';
const GAN = '甲乙丙丁戊己庚辛壬癸';
const DATE_RE = new RegExp(`[${ZHI}]月[${GAN}][${ZHI}]日`, 'g');

/* ---------- 卦名表（取自 public/core/data.js，避免另抄一份） ---------- */
function loadHexNames() {
  const src = fs.readFileSync('public/core/data.js', 'utf8');
  const m = src.match(/HEXNAMES\s*=\s*\{([\s\S]*?)\}/);
  if (!m) throw new Error('未能从 public/core/data.js 取到 HEXNAMES');
  const names = [];
  const re = /['"]([\u4e00-\u9fa5]{2,4})['"]\s*:\s*['"]([\u4e00-\u9fa5]{2,4})['"]/g;
  let k;
  while ((k = re.exec(m[1])) !== null) names.push(k[2]);
  if (names.length !== 64) throw new Error('卦名数不是 64：' + names.length);
  return names;
}

const HEX = loadHexNames();
/* 古书里的简称：八纯卦用卦名首字（乾/坎/艮/震/巽/离/坤/兑），
 * 其余取「天地否 → 否」「天雷无妄 → 无妄」这样的核心二字 */
const SHORT = HEX.map(function (n) {
  return n.length === 3 && n.charAt(1) === '为' ? n.charAt(0) : n.slice(2);
});
/* 上下卦单字（天/地/水/火/雷/风/山/泽）与「畜」，用于「得乾为天变天小畜」
 * 「得大有变畜卦」这类省略写法 */
const EXTRA = ['天', '地', '水', '火', '雷', '风', '山', '泽', '畜'];
const WORDS = Array.from(new Set([].concat(HEX, SHORT, EXTRA)))
  .sort(function (a, b) { return b.length - a.length; });

const LINK = '之变化卦得';
const SEP = /[。．.，,；;：:、？?！!\s\u3000]/;
/* 俗字／异体字归一（1:1 同长度，不影响下标对齐） */
const VAR = { '暌': '睽', '逐': '遁', '骞': '谦', '即': '既' };

function shadow(s) {
  let o = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charAt(i);
    o += VAR[c] || c;
  }
  return o;
}

function tidy(s) {
  s = String(s || '').replace(/[\s\u3000]+/g, '');
  s = s.replace(/[。．.，,：:；;、？?！!]+$/, '');
  s = s.replace(/^[。．.，,：:；;、？?！!]+/, '');
  return s;
}

/* 从 i 起贪婪消费，返回 { len, words, hasLink, first }
 *   first  第一个卦名词的长度（1 表示是「否/泰/革/讼」这类单字卦名） */
function consume(str, i) {
  let p = i, words = 0, hasLink = false, first = 0;
  while (p < str.length) {
    const ch = str.charAt(p);
    if (LINK.indexOf(ch) >= 0) { hasLink = true; p++; continue; }
    let hit = '';
    for (const w of WORDS) {
      if (str.startsWith(w, p)) { hit = w; break; }
    }
    if (hit) {
      if (words === 0 && !hasLink) first = hit.length;
      p += hit.length;
      words++;
      continue;
    }
    break;
  }
  return { len: p - i, words: words, hasLink: hasLink, first: first };
}

/* 单字卦名（否/泰/革/讼/井/复…）极易被正文常用字伪装：
 * 「冬今得关差否水泽节变需卦」的「否」是疑问词，不是《天地否》。
 * 只允许它以「否之坤」这种带连接词的形态当首个卦名。 */
function okFirst(t, i, r) {
  if (r.first !== 1) return true;
  return '之变化'.indexOf(t.charAt(i + 1)) >= 0;
}

function cutIndex(tail) {
  const t = shadow(tail);
  const n = t.length;

  /* A：严格边界 + 整段可消费 */
  for (let i = 0; i < n; i++) {
    const atEdge = i === 0
      || t.charAt(i) === '得'
      || t.charAt(i) === '化'
      || SEP.test(t.charAt(i - 1));
    if (!atEdge) continue;
    const r = consume(t, i);
    const rest = t.slice(i + r.len).replace(/[。．.，,：:；;、？?！!\s\u3000]+$/, '');
    if (rest || r.words === 0) continue;
    if (!okFirst(t, i, r)) continue;
    return swallowSep(tail, i);
  }

  /* B：任意位置，能看出「卦名+连接词+卦名」的完整结构，后面跟标点或到串末 */
  for (let i = 0; i < n; i++) {
    if (i > 0 && SEP.test(t.charAt(i - 1))) continue;   /* 句首交给 A 已处理过 */
    const r = consume(t, i);
    if (r.words < 2 || !r.hasLink) continue;
    if (!okFirst(t, i, r)) continue;
    const rest = t.slice(i + r.len);
    if (rest && !SEP.test(rest.charAt(0))) continue;
    return swallowSep(tail, i);
  }
  return -1;
}

/* 切点往前吞掉紧邻的分隔标点，让 job 尾部干净 */
function swallowSep(tail, i) {
  while (i > 0 && SEP.test(tail.charAt(i - 1))) i--;
  return i;
}

/* 引语前缀（长的放前面） */
const PRE = [
  /^曾有邑宰问/, /^曾有邑宰/, /^曾有人占/, /^曾有/, /^曾/,
  /^例[：:]\s*/, /^又如[：:]\s*/, /^又如/, /^如[：:]\s*/, /^如/,
  /^又有/, /^曾于/, /^也曾于/, /^余于/, /^即如/, /^又占/, /^又/
];

/* 抽出句尾「得卦如下」这类说明语 */
const TAIL_NOISE = /(?:得卦如下|卦如下|得卦|卦象如下|如下)$/;

function clean(s) {
  s = tidy(s);
  s = s.replace(TAIL_NOISE, '');
  let changed = true;
  while (changed) {
    changed = false;
    for (const r of PRE) {
      const before = s;
      s = s.replace(r, '');
      if (s !== before) changed = true;
    }
  }
  s = tidy(s).replace(/^又占/, '').replace(/^余占/, '').replace(/^我占/, '')
    .replace(/^问/, '').replace(/^占/, '');
  return tidy(s);
}

/* 人工兜底：自动结果为空、或自动结果不对的，在此按原文手工定 */
const MANUAL = {
  // 'zsby-xxxxx': '占问原文',
};

function extract(c) {
  const head = String(c && c.head || '');
  if (MANUAL[c.id] !== undefined) return MANUAL[c.id];

  let last = -1, lastLen = 0, m;
  DATE_RE.lastIndex = 0;
  while ((m = DATE_RE.exec(head)) !== null) { last = m.index; lastLen = m[0].length; }
  if (last < 0) return clean(head);

  let tail = head.slice(last + lastLen);
  const at = cutIndex(tail);
  if (at >= 0) tail = tail.slice(0, at);
  let job = clean(tail);
  if (job) return job;

  /* C：日期之前那句才是占问 */
  const before = head.slice(0, last);
  job = clean(before);
  if (job.length > 40) job = job.slice(-40);
  return job;
}

const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const out = data.cases.map(function (c) {
  return { id: c.id, head: c.head, job: extract(c) };
});

const empty = out.filter(function (x) { return !x.job; });
console.log('总计 ' + out.length + ' ｜ 抽不出占问 ' + empty.length);
console.log('='.repeat(104));
out.forEach(function (x) {
  console.log((x.job ? '  ' + x.job : '  【空】') + '   ←   ' + String(x.head).slice(0, 70));
});

if (process.argv.includes('--write')) {
  const map = new Map(out.map(function (x) { return [x.id, x.job]; }));
  for (const c of data.cases) {
    const j = map.get(c.id);
    if (j) c.job = j; else delete c.job;
  }
  fs.writeFileSync(FILE, JSON.stringify(data, null, 1), 'utf8');
  console.log('\n已写入 ' + FILE);
}