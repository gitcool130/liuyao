/* ============================================================
 * 断卦规则覆盖率报告 (tests/guji/coverage.mjs)
 *
 * 运行：npm run guji:coverage
 *
 * 分子 = cases/*.json 中断言到的 rule（期望取自古籍断语）
 * 分母 = public/core/analyze.js 中声明的 rule（静态提取字面量）
 *
 * 注意分母口径：analyze.js 另有少量**运行时生成**的 rule 名（三合局名如
 * 「申子辰三合水局」、相刑名如「子卯相刑（无礼之刑）」），其字面量不以
 * `rule: '…'` 形式出现，故不计入本表分母。它们属「事实陈述类」，
 * 已由《卜筮正宗》/《增删卜易》语料层覆盖到装卦与日月层面。
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

/* ---- 分母：引擎声明的 rule 全集 ---- */
const src = fs.readFileSync(path.join(ROOT, 'public/core/analyze.js'), 'utf8');
const engine = new Map(); // rule -> tag（同一 rule 名可能出现在不同 tag 下）
const re = /tag:\s*'([^']+)'\s*,\s*rule:\s*'([^']+)'/g;
let m;
while ((m = re.exec(src))) engine.set(m[2], m[1]);
// 补捕跨行的 tag/rule（个别 push 体量较大换行）
src.replace(/rule:\s*'([^']+)'/g, (mm, r) => { if (!engine.has(r)) engine.set(r, '?'); return mm; });

/* ---- 分子：用例断言到的 rule ---- */
const casesDir = path.join(__dirname, 'cases');
const covered = new Map(); // rule -> [caseId]
for (const f of fs.readdirSync(casesDir).filter(x => x.endsWith('.json')).sort()) {
  const d = JSON.parse(fs.readFileSync(path.join(casesDir, f), 'utf8'));
  for (const c of d.cases || []) {
    for (const e of c.expect || []) {
      if (!e.rule) continue;
      if (!covered.has(e.rule)) covered.set(e.rule, []);
      covered.get(e.rule).push(c.id);
    }
  }
}

const all = [...engine.keys()].sort();
const hit = all.filter(r => covered.has(r));
const miss = all.filter(r => !covered.has(r));

console.log('== 断卦规则覆盖率（rule 层）==\n');
console.log(`分母（引擎声明的 rule）：${all.length}`);
console.log(`分子（用例断言到的 rule）：${hit.length}`);
console.log(`覆盖率：${hit.length} / ${all.length} = ${(hit.length / all.length * 100).toFixed(1)}%\n`);

console.log('-- 已覆盖 --');
hit.forEach(r => console.log(`  ✓ ${(engine.get(r) + ':' + r).padEnd(24)}  ${covered.get(r).join(', ')}`));

console.log('\n-- 未覆盖（待补用例）--');
miss.forEach(r => console.log(`  · ${engine.get(r)}:${r}`));
