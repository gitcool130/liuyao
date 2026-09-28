#!/usr/bin/env node
/* ============================================================
 * 古籍卦例导入器 · 表格版 (tools/guji-import-bszz.mjs)
 *
 * 处理《卜筮正宗》（清·王洪绪）「十八论」等处以**表格**印刷的卦例
 * ——其排版与《增删卜易》的「六行卦体」完全不同，故单列一支。
 *
 * 表格版式（tab 分隔；空单元格会被省略，故不可依赖固定列号）：
 *   占事\t父为女择婿
 *   卦名\t天地否
 *   卦宫\t干金\t空亡\t子丑\t缺爻\t子水孙爻
 *   六兽\t世应\t卦
 *   爻\t干
 *   支\t六神\t干支\t六神\t伏
 *   神\t卦身\t日
 *   辰\t月建\t太岁
 *   武\t\t\t戌\t父\t\t\t\t\t乙\t午      ← 本卦 上爻
 *   ...
 *   龙\t\t\t未\t父\t\t\t子孙\t\t\t\t      ← 本卦 初爻
 *   （双栏时一行并排两卦，右栏自第 13 列起；93/105 例为双栏）
 *
 * 列语义（自左至右 12 列）：
 *   六神 | 世应 | 卦画(O/ｘ=动) | 本卦地支 | 本卦六亲 |
 *   变卦地支 | 变卦六亲 | 伏神(如「巳父」) | 卦身 | 日干 | 月建 | 太岁
 *
 * ⚠ 文本源限制（已在 tests/guji/README.md 登记）：
 *   1) 表格只印「日干 + 月建」，**不印日支**；且相当一部分卦例未印日辰。
 *      因此本语料只能对账「与日支无关」的装卦字段：纳甲地支/六亲/六神/伏神。
 *      六神只由日干决定，故可对账；日冲、暗动等规则**不在本语料射程**。
 *   2) 转换文本存在个别 td 错位（世应列、伏神列）与讹字，详见语料内
 *      textIssues 字段——该字段如实登记，不做静默剔除。
 *
 * 用法：
 *   npm run gen:guji:bszz
 *   node tools/guji-import-bszz.mjs [--src <文本>] [--out <语料>] [--url <下载源>]
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nameToBits, splitBiangua } from '../tests/guji/lib/hexname.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const argv = process.argv.slice(2);
function argOf(name, dflt) {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
}

const SRC = argOf('src', path.join(__dirname, '..', 'tests', 'guji', '_src', 'bushi-zhengzong.txt'));
const OUT = argOf('out', path.join(__dirname, '..', 'tests', 'guji', 'corpus', 'bushi-zhengzong.json'));
const TITLE = argOf('title', '卜筮正宗');
const REPOPATH = argOf('path', '易藏/术数/卜筮正宗.md');
const URL_ = argOf('url', 'https://raw.githubusercontent.com/daizhige-org/daizhigev20/data/' +
  '%E6%98%93%E8%97%8F/%E6%9C%AF%E6%95%B0/%E5%8D%9C%E7%AD%AE%E6%AD%A3%E5%AE%97.md');
const API_DIR = 'https://api.github.com/repos/daizhige-org/daizhigev20/contents/' +
  '%E6%98%93%E8%97%8F/%E6%9C%AF%E6%95%B0?ref=data';

const ZHI = '子丑寅卯辰巳午未申酉戌亥';
const GAN = '甲乙丙丁戊己庚辛壬癸';
const LQ1 = '父兄孙财官';
const LQ_FULL = { 父: '父母', 兄: '兄弟', 孙: '子孙', 财: '妻财', 官: '官鬼' };
const BEAST1 = { 龙: '青龙', 雀: '朱雀', 陈: '勾陈', 蛇: '腾蛇', 虎: '白虎', 武: '玄武' };
const YANG_MOVE = 'OＯo0０';      // 阳动（0/０ 系 OCR 将 O 误识）
const YIN_MOVE = 'ｘxＸ×Ｘ';      // 阴动

// ---------- 取源 ----------
async function getText(url, isJson) {
  try {
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'liuyao-guji-import/1.0 (+https://github.com/idavailable/liuyao)',
        'Accept': isJson ? 'application/vnd.github+json' : '*/*'
      }
    });
    if (!r.ok) return null;
    const t = await r.text();
    return isJson ? t : (t.length > 10000 ? t : null);
  } catch (e) { return null; }
}

async function loadText() {
  if (fs.existsSync(SRC)) { console.log('文本来源：本地 ' + SRC); return fs.readFileSync(SRC, 'utf8'); }
  console.log('文本来源：在线获取（首次运行会缓存到 --src 路径）');
  let text = await getText(URL_);
  if (!text) {
    console.log('  raw 直连不可用，改走 GitHub Contents API …');
    const meta = await getText(API_DIR, true);
    if (meta) {
      const base = REPOPATH.split('/').pop();
      const hit = (JSON.parse(meta) || []).find(function (x) { return x.name === base; });
      if (hit && hit.download_url) text = await getText(hit.download_url);
    }
  }
  if (!text) throw new Error('自动获取失败。请自备定本并以 --src 传入，或放入 ' + SRC);
  fs.mkdirSync(path.dirname(SRC), { recursive: true });
  fs.writeFileSync(SRC, text, 'utf8');
  console.log('  已缓存 ' + text.length + ' 字符 → ' + SRC);
  return text;
}

// ---------- 解析 ----------
const cap = function (s) { return String(s == null ? '' : s).replace(/\s+$/, ''); };
const cellsOf = function (s) { return cap(s).split('\t'); };
const isLq = function (x) { return x && (Object.prototype.hasOwnProperty.call(LQ_FULL, x) || Object.values(LQ_FULL).indexOf(x) >= 0); };
const lqFull = function (x) { return Object.prototype.hasOwnProperty.call(LQ_FULL, x) ? LQ_FULL[x] : x; };
const isYaoRow = function (c) {
  if (c.length < 5) return false;
  const head = c[0] === '' || Object.prototype.hasOwnProperty.call(BEAST1, c[0]);
  if (!head) return false;
  return (ZHI.indexOf(c[3]) >= 0 && isLq(c[4])) || (isLq(c[3]) && ZHI.indexOf(c[4]) >= 0);
};

const CHAPTER_RE = /^(.{2,24})[：:]?$/;

function chapterAt(lines, i) {
  for (let j = i - 1; j >= Math.max(0, i - 220); j--) {
    const s = lines[j].trim();
    if (!s || s.indexOf('\t') >= 0) continue;
    if (s.length <= 24 && /[：:论诀歌赋例诀]$/.test(s)) return s.replace(/[：:]$/, '');
  }
  return '';
}

/** 解析一个 side（左栏 base=0 / 右栏 base=13） */
function parseSide(c, base) {
  const at = function (k) { return base + k < c.length ? c[base + k] : ''; };
  // 转换文本偶见「地支 / 六亲」列序颠倒（HTML 合并单元格所致），两种顺序均接受
  const a = at(3), b = at(4);
  let zhi, lq;
  if (ZHI.indexOf(a) >= 0 && isLq(b)) { zhi = a; lq = b; }
  else if (isLq(a) && ZHI.indexOf(b) >= 0) { zhi = b; lq = a; }
  else return null;
  const sym = at(2);
  const mv = (function () {
    for (const ch of sym) { if (YANG_MOVE.indexOf(ch) >= 0) return 9; if (YIN_MOVE.indexOf(ch) >= 0) return 6; }
    return null;
  })();
  let fu = null;
  for (let q = 5; q <= 12; q++) {
    const x = at(q);
    if (x && x.length === 2 && ZHI.indexOf(x[0]) >= 0 && LQ1.indexOf(x[1]) >= 0) {
      fu = { lq: lqFull(x[1]), zhi: x[0] };
      break;
    }
  }
  return {
    lq: lqFull(lq), zhi: zhi, moving: mv,
    shi: at(1) === '世', ying: at(1) === '应',
    beast: BEAST1[at(0)] || null,
    fu: fu
  };
}

function extract(raw) {
  const lines = raw.split(/\r?\n/);
  const occ = [];
  for (let i = 0; i < lines.length; i++) if (lines[i].indexOf('占事\t') === 0) occ.push(i);

  const cases = [], issues = [], skipped = [];

  for (const st of occ) {
    const dual = (lines[st].match(/占事/g) || []).length >= 2;
    const dataRows = [];
    let nameVals = null, gongVals = null;

    for (let j = st; j < Math.min(lines.length, st + 40) && dataRows.length < 6; j++) {
      const l = lines[j], c = cellsOf(l);
      if (l.indexOf('卦名\t') === 0) nameVals = c.filter(function (x) { return x && x !== '卦名'; });
      if (l.indexOf('卦宫\t') === 0) gongVals = c;
      if (isYaoRow(c)) dataRows.push({ line: j + 1, c: c });
    }
    if (!nameVals || dataRows.length !== 6) { skipped.push({ line: st + 1, reason: '数据行不足 6' }); continue; }

    const chapter = chapterAt(lines, st);
    const sides = dual ? [0, 1] : [0];

    sides.forEach(function (si) {
      const base = si * 13;
      const guaRaw = nameVals[si];
      if (!guaRaw) return;
      const sp = splitBiangua(guaRaw);
      const nb = nameToBits(sp.ben);
      if (!nb) { skipped.push({ line: st + 1, reason: '卦名无法解析：' + guaRaw }); return; }

      const rows = dataRows.map(function (r) { return parseSide(r.c, base); });
      if (rows.some(function (r) { return !r; })) { skipped.push({ line: st + 1, reason: '第' + (si + 1) + '栏列结构不符' }); return; }

      // 日干：本栏第 10 列（base+9）；缺失时在本栏范围内回退扫描
      let dayGan = null;
      for (const r of dataRows) { const x = (base + 9 < r.c.length) ? r.c[base + 9] : ''; if (x && GAN.indexOf(x) >= 0) { dayGan = x; break; } }
      if (!dayGan) {
        outer: for (const r of dataRows) {
          for (let q = base; q < Math.min(r.c.length, base + 12); q++) {
            const x = r.c[q];
            if (x && x.length === 1 && GAN.indexOf(x) >= 0) { dayGan = x; break outer; }
          }
        }
      }

      // 行序为上爻→初爻，翻转为初爻→上爻
      rows.reverse();
      const bits = nb.bits;
      const toss = bits.map(function (b, i) {
        const mv = rows[i].moving;
        if (b) return mv === 9 ? 9 : 1;
        return mv === 6 ? 6 : 0;
      });
      if (rows.some(function (r, i) { return r.moving != null && ((r.moving === 9) !== Boolean(bits[i])); })) {
        issues.push({ line: st + 1, side: si ? 'R' : 'L', kind: '卦画与卦名不符', detail: guaRaw });
      }

      cases.push({
        id: 'bszz-' + String(st + 1).padStart(5, '0') + (dual ? (si ? '-R' : '-L') : ''),
        line: st + 1,
        side: si ? 'R' : 'L',
        chapter: chapter,
        job: (function () {
          const j = cap(lines[st]).split('\t');   // 不去空：左栏值在 [1]，双栏右栏值在 [4]
          const v = (si === 0 ? j[1] : j[4]) || '';
          return v === '占事' ? '' : v;
        })(),
        guaRaw: guaRaw,
        gua: nb.name,
        bianGua: sp.bian,
        gong: gongVals && gongVals[1 + si * 7] ? gongVals[1 + si * 7] : '',
        dayGan: dayGan,
        toss: toss,
        ben: rows,
        raw6: dataRows.map(function (r) { return cap(r.c.slice(base, base + 11).join('\t')); })
      });
    });
  }
  return { cases: cases, issues: issues, skipped: skipped };
}

// ---------- 主 ----------
async function main() {
  const raw = await loadText();
  const { cases, issues, skipped } = extract(raw);

  const corpus = {
    book: TITLE,
    format: 'table',
    source: {
      repo: 'https://github.com/daizhige-org/daizhigev20',
      path: REPOPATH,
      license: '公有领域',
      note: '传世定本之第三方录入文本（节本），表格型排版；td 错位与讹字已在 textIssues 登记。'
    },
    generatedBy: 'tools/guji-import-bszz.mjs',
    counts: { cases: cases.length, skipped: skipped.length },
    textIssues: issues,
    cases: cases
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(corpus, null, 1), 'utf8');

  console.log('[' + TITLE + '·表格] 提取卦例 ' + cases.length + ' 条 → ' + OUT);
  console.log('  未印日干（六神不可对账）' + cases.filter(function (c) { return !c.dayGan; }).length + ' 条');
  console.log('  含伏神 ' + cases.filter(function (c) { return c.ben.some(function (b) { return b.fu; }); }).length + ' 条');
  console.log('  跳过 ' + skipped.length + ' 处');
  skipped.slice(0, 5).forEach(function (s) { console.log('    L' + s.line + ' ' + s.reason); });
}

main().catch(function (e) { console.error('导入失败：' + e.message); process.exit(1); });
