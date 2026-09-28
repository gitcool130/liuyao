#!/usr/bin/env node
/* ============================================================
 * 古籍卦例导入器 (tools/guji-import.mjs)
 *
 * 把《增删卜易》《卜筮正宗》等传世六爻经典中「带完整装卦」的
 * 实占卦例，从整卷文本中抽成结构化语料，供 tests/guji/run.mjs
 * 做古籍回归（golden test）。
 *
 * 卦例排版（定本通行式样，自「上爻」排到「初爻」共 6 行）：
 *     例：辰月戊申日占父近病，得乾为天变天小畜。
 *     父母戌土′世              妻财卯木′
 *     兄弟申金′                官鬼巳火′
 *     官鬼午火′    动          父母未土″应
 *     父母辰土′应              父母辰土′
 *     妻财寅木′                妻财寅木′
 *     子孙子水′                子孙子水′世
 *   ′ 阳爻　″ 阴爻　「动」为动爻　左侧本卦、右侧变卦
 *
 * 用法（文本可本地给，也可自动从公开仓库取）：
 *   npm run gen:guji                       # 用内置源自动下载并生成
 *   node tools/guji-import.mjs --src <文本路径> --out <语料路径> [--title 书名]
 *
 * 文本来源：《增删卜易》十二卷（清·野鹤老人传，李文辉增删，康熙三十年刊本），
 *   公有领域。取自私家古籍仓库 daizhige-org/daizhigev20（易藏/术数）。
 *   若需长期固定版本，请自备定本 PDF/文本并以 --src 传入。
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------- 参数 ----------
const argv = process.argv.slice(2);
function argOf(name, dflt) {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
}

const DEFAULT_SRC = path.join(__dirname, '..', 'tests', 'guji', '_src', 'zengshan-boyi.txt');
const DEFAULT_OUT = path.join(__dirname, '..', 'tests', 'guji', 'corpus', 'zengshan-boyi.json');
const DEFAULT_URL = 'https://raw.githubusercontent.com/daizhige-org/daizhigev20/data/' +
  '%E6%98%93%E8%97%8F/%E6%9C%AF%E6%95%B0/%E5%A2%9E%E5%88%AA%E5%8D%9C%E6%98%93.md';

const SRC = argOf('src', DEFAULT_SRC);
const OUT = argOf('out', DEFAULT_OUT);
const URL_ = argOf('url', DEFAULT_URL);
const TITLE = argOf('title', '增删卜易');
const REPO = argOf('repo', 'https://github.com/daizhige-org/daizhigev20');
const REPOPATH = argOf('path', '易藏/术数/增删卜易.md');

// ---------- 常量 ----------
const LQ = ['父母', '兄弟', '子孙', '妻财', '官鬼'];
const ZHI = [...'子丑寅卯辰巳午未申酉戌亥'];
const GAN = [...'甲乙丙丁戊己庚辛壬癸'];
const WX = ['金', '木', '水', '火', '土'];
const YY = '′″';
const LQRE = '(' + LQ.join('|') + ')';
const ZIRE = '[' + ZHI.join('') + ']';
const WXRE = '[' + WX.join('') + ']';
// 六神（书中有「元武」「媵蛇」等异写）
const BEAST = '青龙|朱雀|勾陈|螣蛇|媵蛇|腾蛇|白虎|元武|玄武';
// 伏神写法：伏神六亲支五行紧跟「/」，其后为本卦该爻（飞神），如「父母午火/ 兄弟丑土″」
const FU = '(?:(?<fulq>' + LQRE + ')(?<fuzhi>' + ZIRE + ')(?<fuwx>' + WXRE + ')/\\s*)?';
const FU2 = '(?:(?<fulq2>' + LQRE + ')(?<fuzhi2>' + ZIRE + ')(?<fuwx2>' + WXRE + ')/\\s*)?';
const YAO = '(?<lq>' + LQRE + ')(?<zhi>' + ZIRE + ')(?<wx>' + WXRE + ')(?<sym>[' + YY + '])(?<mark>[世应]?)';
const YAO2 = '(?<lq2>' + LQRE + ')(?<zhi2>' + ZIRE + ')(?<wx2>' + WXRE + ')(?<sym2>[' + YY + '])(?<mark2>[世应]?)';

const ROW_RE = new RegExp(
  '^\\s*(?:(?<beast>' + BEAST + ')\\s*)?' + FU + YAO +
  '(?<move>\\s*动)?' +
  '\\s*(?:' + FU2 + YAO2 + ')?\\s*$'
);
const DATE_RE = new RegExp('(?<month>' + ZIRE + ')月(?<dg>[甲乙丙丁戊己庚辛壬癸])(?<dz>' + ZIRE + ')日');
const CHAPTER_RE = /^(.{2,20}章第[一二三四五六七八九零十百又○]+)\s*$/;

// ---------- 取源文本 ----------
const API_DIR = 'https://api.github.com/repos/daizhige-org/daizhigev20/contents/' +
  '%E6%98%93%E8%97%8F/%E6%9C%AF%E6%95%B0?ref=data';

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
    if (isJson) return t;
    return t.length > 10000 ? t : null; // 404 页面等短内容一律视为失败
  } catch (e) {
    return null;
  }
}

async function loadText() {
  if (fs.existsSync(SRC)) {
    console.log('文本来源：本地 ' + SRC);
    return fs.readFileSync(SRC, 'utf8');
  }

  console.log('文本来源：在线获取（首次运行会自动缓存到 --src 路径）');
  let text = await getText(URL_);

  if (!text) {
    // GitHub raw 对含中文的路径偶发 404（同一 URL 用 curl 亦可复现），
    // 改走 Contents API 取真实 download_url 再下。
    console.log('  raw 直连不可用，改走 GitHub Contents API …');
    const metaRaw = await getText(API_DIR, true);
    if (metaRaw) {
      const base = REPOPATH.split('/').pop();
      const hit = (JSON.parse(metaRaw) || []).find(function (x) { return x.name === base; });
      if (hit && hit.download_url) {
        text = await getText(hit.download_url);
        if (!text) {
          const u = new URL(hit.download_url);
          const enc = u.origin + u.pathname.split('/')
            .map(function (s) { return s ? encodeURIComponent(decodeURIComponent(s)) : s; }).join('/');
          text = await getText(enc);
        }
      }
    }
  }

  if (!text) {
    throw new Error('自动获取失败。请自备定本并以 --src 传入，或将其放入 ' + SRC);
  }
  fs.mkdirSync(path.dirname(SRC), { recursive: true });
  fs.writeFileSync(SRC, text, 'utf8');
  console.log('  已缓存 ' + text.length + ' 字符 → ' + SRC);
  return text;
}

// ---------- 解析 ----------
function extract(raw) {
  const lines = raw.split(/\r?\n/);
  const cases = [], skipped = [];

  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (!DATE_RE.test(ln)) continue;

    const body = lines.slice(i + 1, i + 7);
    if (body.length < 6) continue;

    const rows = [];
    let ok = true;
    for (const b of body) {
      const m = ROW_RE.exec(b);
      if (!m) { ok = false; break; }
      rows.push(m.groups);
    }
    if (!ok) { skipped.push({ line: i + 1, head: ln.trim() }); continue; }

    let chapter = '';
    for (let j = i - 1; j >= Math.max(0, i - 60); j--) {
      const cm = CHAPTER_RE.exec(lines[j].trim());
      if (cm) { chapter = cm[1]; break; }
    }

    rows.reverse(); // 行序自上爻→初爻，翻转为初爻→上爻

    const pick = (r, suf) => ({
      lq: r['lq' + suf], zhi: r['zhi' + suf], wx: r['wx' + suf],
      yang: r['sym' + suf] === '′',
      moving: suf === '' ? Boolean(r.move) : false,
      shi: r['mark' + suf] === '世', ying: r['mark' + suf] === '应'
    });

    const dm = DATE_RE.exec(ln);
    const prefix = TITLE === '增删卜易' ? 'zsby' : 'guji';
    cases.push({
      id: prefix + '-' + String(i + 1).padStart(5, '0'),
      line: i + 1,
      chapter: chapter,
      head: ln.trim(),
      monthZhi: dm.groups.month,
      dayGZ: dm.groups.dg + dm.groups.dz,
      ben: rows.map((r) => pick(r, '')),
      bian: rows.map((r) => pick(r, '2')),
      // 六神与伏神：已提取备查，暂不纳入对账断言（书里印六神/伏神者仅少量卦例）
      beasts: rows.map((r) => r.beast || ''),
      fu: rows.map((r) => r.fulq ? { lq: r.fulq, zhi: r.fuzhi, wx: r.fuwx } : null),
      raw6: body.map((b) => b.trim()),
      conclusion: lines[i + 7] ? lines[i + 7].trim().slice(0, 240) : ''
    });
  }
  return { cases, skipped };
}

// ---------- 主 ----------
async function main() {
  const raw = await loadText();
  const { cases, skipped } = extract(raw);

  const corpus = {
    book: TITLE,
    source: {
      repo: REPO,
      path: REPOPATH,
      license: '公有领域',
      note: '传世定本之第三方录入文本，个别讹字以 tests/guji/run.mjs 对账后登记。'
    },
    generatedBy: 'tools/guji-import.mjs',
    counts: { cases: cases.length, skippedDateLines: skipped.length },
    cases: cases
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(corpus, null, 1), 'utf8');

  console.log('[' + TITLE + '] 提取卦例 ' + cases.length + ' 条 → ' + OUT);
  console.log('  含日期但非卦体、已跳过 ' + skipped.length + ' 处');
  skipped.slice(0, 5).forEach((s) => console.log('    L' + s.line + ' ' + s.head.slice(0, 60)));
}

main().catch(function (e) {
  console.error('导入失败：' + e.message);
  process.exit(1);
});
