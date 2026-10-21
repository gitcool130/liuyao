#!/usr/bin/env node
/* ============================================================
 * 线上产物逐字节校验 (tools/verify-live.mjs)
 *
 * 目的：守住「线上 == main」这条不变量。手工 curl + sha256sum 也能做，
 * 但 2026-10-21 实测踩到两个坑，都不该靠记忆防：
 *
 *   ① **下载失败 ≠ 产物不一致**。沙箱到 CF 的链路会退化到 ~8 B/s，
 *      curl 超时只下到 1440 字节，算出来的哈希必然不同。把它当成
 *      「线上与本地不符」会得出完全相反的结论。故本工具区分三态：
 *        OK / DIFF / UNKNOWN（下载不完整或超时）
 *   ② **index.html 恒不等于本地**。CF 边缘会往 </body> 前注入
 *      `/cdn-cgi/challenge-platform/scripts/jsd/main.js` 探针（JS
 *      Detections / Bot Fight Mode），改仓库删不掉。故先剥掉这段
 *      再比；剥完一致即判 OK，并注明「已剥边缘注入」。
 *
 * 用法：
 *   node tools/verify-live.mjs                          # 默认校验线上域名
 *   node tools/verify-live.mjs --host=https://xxx.pages.dev
 *   node tools/verify-live.mjs --proxy=http://127.0.0.1:7890
 *   node tools/verify-live.mjs --only=app.js            # 只校验一个文件
 *   node tools/verify-live.mjs --strict                 # UNKNOWN 也算失败（CI 用）
 *
 * 退出码：0 全 OK ／ 1 有 DIFF 或隔离泄露 ／ 2 有 UNKNOWN（网络未取全）
 *
 * 依赖：curl（本仓 CI 为 ubuntu-latest 自带；Windows Git Bash 亦自带）。
 *      不用 node fetch 是因为它不认 HTTP_PROXY，而本机常需要走 7890。
 * ============================================================ */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const pub = path.join(repo, 'public');

const args = process.argv.slice(2);
const arg = function (name, def) {
  const hit = args.find(function (a) { return a.indexOf('--' + name + '=') === 0; });
  return hit ? hit.slice(name.length + 3) : def;
};
const HOST = arg('host', 'https://liuyao.dhxlsfn.dpdns.org').replace(/\/+$/, '');
const PROXY = arg('proxy', '');
const ONLY = arg('only', '');
const TIMEOUT = parseInt(arg('timeout', '90'), 10);
const STRICT = args.indexOf('--strict') >= 0;
const CHUNK = parseInt(arg('chunk', '4096'), 10);   // 实测 8KB 段会卡，4KB 段稳（206 + 0.9s）
const RETRIES = parseInt(arg('retries', '2'), 10);   // 抖动链路上重试是刚需：实测小请求成功率仅 40%

// 配置型文件：位于 public/ 但**不作为资源下发**（Pages 把它读作规则，请求时回落到首页）。
// 不能参与逐字节比对——实测 /_headers 返回 19753B，恰是 index.html(18815)+CF注入(938)。
// 对它们的正确判据是「不可作为配置文件被下载」，见下方隔离检查。
const CONFIG_FILES = ['_headers', '_redirects'];

// 不该出现在公网的仓库文件：命中即判泄露
const MUST_NOT_LEAK = ['wrangler.toml', 'schema.sql', 'package.json', 'README.md', 'test-rules.js', '.gitignore'];

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push.apply(out, walk(p));
    else out.push(p);
  }
  return out;
}

function urlFor(rel) {
  // CF Pages 把 /index.html 308 重定向到 /（响应体为空）。若照直请求，
  // 会拿到 0 字节并被判成「不一致」——本轮实测 index.html 一直 DIFF 的真因。
  // 首页统一按根路径取；其余（含 -L 兜底）照常。
  const p = rel === 'index.html' ? '' : rel;
  return HOST + '/' + (p ? p + '?' : '?') + 'cb=' + Date.now() + Math.random().toString(36).slice(2, 8);
}

function curlToFile(rel, extra) {
  // 一律写临时文件，不用 `-o -` 走管道：Windows 的 schannel 版 curl 在把
  // 大体量响应写进管道时会 `Recv failure: Connection was reset`（实测
  // app.js 106KB 必挂、18KB 以下的小文件全过）。这不是网络问题，是输出通道问题。
  const tmp = path.join(os.tmpdir(), 'ly-v-' + process.pid + '-' + Math.random().toString(36).slice(2, 8));
  let lastErr = null;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    const argv = ['-sS', '-L', '--max-time', String(TIMEOUT), '-o', tmp, '-w', '%{http_code}'];
    argv.push('--noproxy', PROXY ? '' : '*');
    if (PROXY) argv.push('--proxy', PROXY);
    argv.push.apply(argv, extra || []);
    argv.push(urlFor(rel));
    try {
      const code = execFileSync('curl', argv, { encoding: 'utf8' }).trim();
      const buf = fs.readFileSync(tmp);
      if (code === '200' || code === '206') return { buf: buf, err: null };
      lastErr = 'HTTP ' + code;
      if (code === '404' || code === '403' || code === '308') break;   // 重试无意义
    } catch (e) {
      lastErr = e.message.split('\n')[0];
    }
  }
  try { fs.unlinkSync(tmp); } catch (e) { /* 没生成 */ }
  return { buf: Buffer.alloc(0), err: lastErr };
}

function fetchRanged(rel, limit) {
  const CH = CHUNK;
  const parts = [];
  let total = 0;
  while (total < limit + CH) {
    const p = curlToFile(rel, ['-r', total + '-' + (total + CH - 1)]);
    if (p.err || p.buf.length === 0) return null;
    parts.push(p.buf);
    total += p.buf.length;
    if (p.buf.length < CH) break;  // 短段 = 到文件尾
  }
  return { buf: Buffer.concat(parts), err: null, ranged: true };
}

function fetchBuf(rel, localSize) {
  // 大文件直接走分段：整包请求在这条链路上必被中途重置/超时（实测 106KB 必挂），
  // 先花一次超时毫无收益。
  if (localSize > 32768) {
    const r = fetchRanged(rel, localSize);
    if (r) return r;
  }
  const r = curlToFile(rel);
  if (!r.err) return r;
  const rr = fetchRanged(rel, localSize);
  return rr || r;
}

function headContentType(rel) {
  // 不用 `-o /dev/null`：Windows 的 schannel 版 curl 会报
  // `(23) client returned ERROR on write`，把一次正常响应变成失败（实测）。
  // 改为写临时文件，只要 -w 的结果。
  const tmp = path.join(os.tmpdir(), 'ly-verify-' + process.pid + '.bin');
  const argv = ['-sS', '-o', tmp, '-w', '%{http_code}|%{content_type}', '--max-time', String(TIMEOUT)];
  argv.push('--noproxy', PROXY ? '' : '*');
  if (PROXY) argv.push('--proxy', PROXY);
  argv.push(HOST + '/' + rel + '?cb=' + Date.now());
  try {
    return { ct: execFileSync('curl', argv, { encoding: 'utf8' }).trim(), err: null };
  } catch (e) {
    // 取不到就是取不到，绝不能当成「泄露」。这条与本文件头的原则①同源：
    // 网络失败与产物异常必须分开报，否则一次断网会报出 6 条假泄露。
    return { ct: '', err: e.message.split('\n')[0] };
  } finally {
    try { fs.unlinkSync(tmp); } catch (e) { /* 没生成则忽略 */ }
  }
}

const sha = function (b) { return createHash('sha256').update(b).digest('hex'); };

// CF 边缘注入探针：<script>...__CF$cv$params...</script>，可能跨行
function stripCFInject(html) {
  return html.replace(/<script[^>]*>(?:(?!<\/script>)[\s\S])*?__CF\$cv\$params[\s\S]*?<\/script>/g, '');
}

function pad(s, n) {
  s = String(s);
  let w = 0;
  for (const ch of s) w += /[\u4e00-\u9fa5\uff00-\uffef]/.test(ch) ? 2 : 1;
  return s + ' '.repeat(Math.max(0, n - w));
}

const files = walk(pub)
  .map(function (p) { return path.relative(pub, p).split(path.sep).join('/'); })
  .filter(function (r) { return !ONLY || r === ONLY; })
  .filter(function (r) { return CONFIG_FILES.indexOf(r) < 0; })
  .sort();

console.log('校验目标：' + HOST + (PROXY ? '（proxy ' + PROXY + '）' : '（直连）'));
console.log('本地文件：' + files.length + ' 个\n');
console.log(pad('文件', 30) + pad('本地', 9) + pad('线上', 9) + '判定');
console.log('-'.repeat(64));

let ok = 0, diff = 0, unknown = 0;
const problems = [];

for (const rel of files) {
  const local = fs.readFileSync(path.join(pub, rel));
  const r = fetchBuf(rel, local.length);
  if (r.err) {
    unknown++;
    console.log(pad(rel, 30) + pad(local.length, 9) + pad('-', 9) + 'UNKNOWN（' + r.err + '）');
    problems.push({ rel: rel, kind: 'UNKNOWN', detail: r.err });
    continue;
  }
  // 空响应同样是「没取到」而不是「不一致」：本地文件不可能为空，
  // 线上回 0 字节只可能是链路/中间层吞了包（本轮实测 index.html 就出现过）。
  if (r.buf.length === 0) {
    unknown++;
    console.log(pad(rel, 30) + pad(local.length, 9) + pad(0, 9) + 'UNKNOWN（空响应）');
    problems.push({ rel: rel, kind: 'UNKNOWN', detail: '空响应' });
    continue;
  }
  let live = r.buf;
  let note = '';
  if (rel.endsWith('.html')) {
    const before = live.length;
    live = Buffer.from(stripCFInject(live.toString('utf8')), 'utf8');
    if (live.length !== before) note = '（已剥 CF 边缘注入 ' + (before - live.length) + 'B）';
  }
  const same = sha(live) === sha(local);
  if (same) { ok++; console.log(pad(rel, 30) + pad(local.length, 9) + pad(live.length, 9) + 'OK' + note); }
  else {
    diff++;
    console.log(pad(rel, 30) + pad(local.length, 9) + pad(live.length, 9) + 'DIFF');
    problems.push({ rel: rel, kind: 'DIFF', detail: '本地 ' + local.length + 'B / 线上 ' + live.length + 'B' });
  }
}

console.log('\n配置型文件（应回落到首页，不得作为文件被下载）：');
console.log('-'.repeat(64));
let cfgLeak = 0;
for (const rel of CONFIG_FILES) {
  if (!fs.existsSync(path.join(pub, rel))) continue;
  if (ONLY) { console.log('（--only 模式跳过）'); break; }
  const h = headContentType(rel);
  if (h.err) { console.log(pad('/' + rel, 30) + 'UNKNOWN（' + h.err.slice(0, 40) + '）'); continue; }
  if (/text\/html/.test(h.ct)) console.log(pad('/' + rel, 30) + 'OK（回落首页，配置未下发）');
  else { cfgLeak++; console.log(pad('/' + rel, 30) + 'LEAK  ' + h.ct); }
}

console.log('\n隔离检查（仓库文件不得出现在公网）：');
console.log('-'.repeat(64));
let leak = cfgLeak, isoUnknown = 0;
if (ONLY) {
  // --only 是「只查这一个文件」的定向校验，再跑 6 项隔离检查纯属浪费时间：
  // 实测在网络差时，一次 --only 会被尾部隔离检查拖到超时。
  console.log('（--only 模式跳过；要查隔离请不带 --only 运行）');
}
for (const rel of (ONLY ? [] : MUST_NOT_LEAK)) {
  const h = headContentType(rel);
  if (h.err) {
    isoUnknown++;
    console.log(pad('/' + rel, 30) + 'UNKNOWN（' + h.err.slice(0, 40) + '）');
    continue;
  }
  // 本项目对未知路径有 SPA 回退：返回 text/html 才说明隔离正常。
  // 只看状态码会被 200 骗过去——必须比 Content-Type。
  const isFallback = /text\/html/.test(h.ct);
  if (isFallback) console.log(pad('/' + rel, 30) + 'OK（SPA 回退）');
  else { leak++; console.log(pad('/' + rel, 30) + 'LEAK  ' + h.ct); }
}

console.log('\n' + '='.repeat(64));
console.log('文件 ' + files.length + '：OK ' + ok + '　DIFF ' + diff + '　UNKNOWN ' + unknown
  + '　隔离泄露 ' + leak + (isoUnknown ? '　隔离未知 ' + isoUnknown : ''));

if (diff || leak) {
  console.log('\n判定：FAIL');
  problems.filter(function (p) { return p.kind === 'DIFF'; }).forEach(function (p) {
    console.log('  · DIFF ' + p.rel + '　' + p.detail);
  });
  process.exit(1);
}
if ((unknown || isoUnknown) && STRICT) {
  console.log('\n判定：FAIL（--strict：UNKNOWN 视为失败）');
  problems.forEach(function (p) { console.log('  · ' + p.kind + ' ' + p.rel + '　' + p.detail); });
  if (isoUnknown) console.log('  · 隔离检查有 ' + isoUnknown + ' 项未取到');
  process.exit(2);
}
if (unknown || isoUnknown) {
  console.log('\n判定：PASS（逐字节部分通过；有 ' + (unknown + isoUnknown)
    + ' 项因网络未取全，属取不到而非不一致）');
  console.log('提示：加 --proxy=http://127.0.0.1:7890 或调大 --timeout 后重跑。');
  process.exit(2);
}
console.log('\n判定：PASS —— 线上与本地逐字节一致，敏感文件未泄露');
