/* 从 functions/api/interpret.js 抽出 SYSTEM_PROMPT，写成 public/core/prompt.js
 *
 * 为什么不在前端再抄一份：服务端提示词是断卦质量的唯一来源，抄第二份必然漂移；
 * 仓库里已有「app.js 副本 vs 服务端」的一致性断言，再抄第三份等于给自己埋雷。
 * 构建时抽取 → 永远同源。
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const SRC = path.join(ROOT, 'functions/api/interpret.js');
const OUT = path.join(ROOT, 'public/core/prompt.js');

const src = fs.readFileSync(SRC, 'utf8');
const marker = 'export const SYSTEM_PROMPT = [';
const at = src.indexOf(marker);
if (at < 0) throw new Error('未找到 SYSTEM_PROMPT 声明');

// 从 '[' 开始做括号配对，跳过字符串与注释
let i = src.indexOf('[', at);
let depth = 0, quote = null, out = '';
let lineComment = false, blockComment = false;
for (; i < src.length; i++) {
  const c = src[i], n = src[i + 1];
  out += c;
  if (lineComment) { if (c === '\n') lineComment = false; continue; }
  if (blockComment) { if (c === '*' && n === '/') { out += n; i++; blockComment = false; } continue; }
  if (quote) {
    if (c === '\\') { out += n; i++; continue; }
    if (c === quote) quote = null;
    continue;
  }
  if (c === '/' && n === '/') { lineComment = true; continue; }
  if (c === '/' && n === '*') { blockComment = true; continue; }
  if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
  if (c === '[') depth++;
  else if (c === ']') { depth--; if (depth === 0) break; }
}

const literal = out;
const parts = new Function('return ' + literal)();
if (!Array.isArray(parts) || !parts.length) throw new Error('SYSTEM_PROMPT 解析结果异常');
if (parts.some((s) => typeof s !== 'string')) throw new Error('SYSTEM_PROMPT 含非字符串元素');

const banner =
  '/* 自动生成，请勿手改 —— 来源：functions/api/interpret.js 的 SYSTEM_PROMPT\n' +
  ' * 由 tools/gen-local-prompt.mjs 在构建时抽取，供离线版 core/local-api.js 使用。\n' +
  ' * 行数：' + parts.length + ' 段，共 ' + parts.join('').length + ' 字。\n' +
  ' */\n';
const body = 'window.LY_SYSTEM_PROMPT = ' + JSON.stringify(parts, null, 0) + ';\n';
fs.writeFileSync(OUT, banner + body, 'utf8');
console.log('已生成 ' + path.relative(ROOT, OUT) + '：' + parts.length + ' 段 / ' + parts.join('').length + ' 字');
