/* ============================================================
 * 断语质量基线报告 (tests/drift/run.mjs)
 *
 * 用法：
 *   node tests/drift/run.mjs                 # 跑 corpus 全部 case，出报告，恒 exit 0
 *   node tests/drift/run.mjs --strict        # 未达门槛则 exit 1（用于「基线已认可后再收紧」）
 *   node tests/drift/run.mjs --json          # 机器可读
 *   node tests/drift/run.mjs --only=<id>      # 只跑某个 case
 *
 * 设计：默认不阻断。理由——基线本身未达标（见 corpus 里那两版真实断语），
 * 此时让 CI 变红只会逼人关掉它。先让它长期可见，等指标真的改善后再 --strict。
 * ============================================================ */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateCorpus, judge, THRESHOLDS } from './lib.mjs';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const core = require(path.join(repo, 'core.js'));

const args = process.argv.slice(2);
const strict = args.indexOf('--strict') >= 0;
const asJson = args.indexOf('--json') >= 0;
const onlyArg = args.find(function (a) { return a.indexOf('--only=') === 0; });
const only = onlyArg ? onlyArg.slice('--only='.length) : null;

// 读 corpus 目录下全部 json（新增语料＝新增文件，不改代码）
const cdir = path.join(here, 'corpus');
const files = fs.readdirSync(cdir).filter(function (f) { return /\.json$/.test(f); }).sort();
let cases = [];
files.forEach(function (f) {
  const j = JSON.parse(fs.readFileSync(path.join(cdir, f), 'utf8'));
  (j.cases || []).forEach(function (c) { cases.push(c); });
});
if (only) cases = cases.filter(function (c) { return c.id === only; });

if (!cases.length) {
  console.error('未找到语料（tests/drift/corpus/*.json）');
  process.exit(2);
}

const report = evaluateCorpus(cases, core);
const rows = judge(report);

if (asJson) {
  console.log(JSON.stringify({ report: report, verdict: rows }, null, 2));
} else {
  console.log('== 断语质量基线 · ' + report.caseCount + ' 个 case / ' + report.replies + ' 条断语 ==\n');

  report.perCase.forEach(function (c) {
    console.log('── ' + c.id);
    console.log('   问：' + c.question + '　用神：' + c.target + '　引擎 trend：' + c.trend);
    c.replies.forEach(function (r, i) {
      const lbl = ['甲', '乙', '丙', '丁', '戊'][i] || String(i + 1);
      const dir = r.direction || '未表态';
      const ag = r.agreesTrend === null ? '—' : (r.agreesTrend ? '一致' : '与引擎不符');
      console.log('   断语' + lbl + '：结论=' + dir + '（' + ag + '）　硬伤 ' + r.errors.length + ' 处'
        + (r.boundary.clean ? '' : '　独断词：' + r.boundary.dogma.join('/')));
      r.errors.forEach(function (e) {
        console.log('        · [' + e.layer + '] ' + e.type + '：「' + String(e.claimed).slice(0, 40) + '」');
      });
    });
    console.log('   同盘冲突度：' + fmtPct(c.drift) + '　方向分布：吉 ' + c.counts.吉 + ' / 平 ' + c.counts.平 + ' / 凶 ' + c.counts.凶);
    console.log('');
  });

  console.log('== 四指标 ==');
  rows.forEach(function (r) {
    if (r.got === null) {
      console.log('  ' + pad(r.label, 6) + ' ' + pad('—', 8) + ' ' + (r.note || ''));
      return;
    }
    console.log('  ' + pad(r.label, 6) + ' ' + pad(fmtPct(r.got), 8) + ' 门槛 ' + pad(r.want, 8) + ' ' + (r.ok ? 'PASS' : 'FAIL'));
  });

  const fails = rows.filter(function (r) { return r.ok === false; });
  console.log('');
  if (fails.length) {
    console.log('基线未达标：' + fails.map(function (r) { return r.label; }).join('、') + '。');
    console.log('（默认不阻断；指标改善后改用 --strict 把它变成门禁。改门槛须单独提交并说明理由。）');
  } else {
    console.log('全部达到门槛。');
  }
  console.log('\n注：四指标均为下限指标——全绿只等于「没犯可判定的错」，不等于断得准。');
}

if (strict && rows.some(function (r) { return r.ok === false; })) process.exit(1);

function pad(s, n) {
  s = String(s);
  let w = 0;
  for (const ch of s) w += /[\u4e00-\u9fa5]/.test(ch) ? 2 : 1;
  return s + ' '.repeat(Math.max(0, n - w));
}
function fmtPct(v) {
  return v === null || v === undefined ? '—' : (v * 100).toFixed(0) + '%';
}
