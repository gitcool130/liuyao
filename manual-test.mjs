/* 手动测试探针（不是断言脚本）
 *
 * 目的：打印「请求入参 → 真实响应」，供人工逐条核对，而不是自动判定 PASS/FAIL。
 * 用法：node manual-test.mjs
 *
 * 覆盖本轮修复中**不依赖部署环境**的 5 项：
 *   ① provider 原型链查找      ② 访问口令常量时间比较
 *   ③ 按 IP 限流              ④ 入模规模上限（stub 上游，看实际 payload）
 *   ⑤ 读路径非法 id 过滤（mock D1）
 * 前端两项（属性位转义 / loadCast 错误提示）见 手动测试手册.md 第三、四节。
 */

import { onRequestPost } from './functions/api/interpret.js';
import { onRequestGet } from './functions/api/records.js';

const EP = 'https://liuyao.test/api/interpret';
let n = 0;

function hr(t) { console.log('\n' + '─'.repeat(74) + '\n' + t + '\n' + '─'.repeat(74)); }

async function call(label, body, env, headers) {
  n++;
  const raw = JSON.stringify(body || {});
  console.log('\n[' + n + '] ' + label);
  console.log('    请求  : ' + raw.slice(0, 130) + (raw.length > 130 ? ' …' : ''));
  const req = new Request(EP, {
    method: 'POST',
    headers: Object.assign({ 'content-type': 'application/json' }, headers || {}),
    body: raw
  });
  try {
    const r = await onRequestPost({ request: req, env: env || {} });
    const t = await r.text();
    console.log('    响应  : HTTP ' + r.status + '  ' + t.slice(0, 150));
    return r.status;
  } catch (e) {
    console.log('    响应  : ❌ 未捕获异常 ' + e.constructor.name + ': ' + e.message);
    console.log('            线上即 HTTP 500 —— 修复前 provider=constructor 就是这个表现');
    return 0;
  }
}

// ── ① provider 原型链 ───────────────────────────────────────────────
hr('① provider 走原型链查找（P1）— 期望全部 400，无一抛异常');
for (const pv of ['constructor', 'toString', 'valueOf', 'hasOwnProperty', 'isPrototypeOf', '__proto__', 'nope']) {
  await call('provider = "' + pv + '"', { panText: '占得乾为天', provider: pv, model: 'gpt-6-luna' });
}
console.log('\n  看点：修复前 constructor/toString/valueOf/hasOwnProperty/isPrototypeOf 会抛');
console.log('        TypeError: wl[provider].indexOf is not a function → 边缘 500；现在稳定 400。');

// ── ② 口令 ──────────────────────────────────────────────────────────
hr('② 访问口令（P1 · 与 records.js 共用 safeEqual）');
const body2 = { panText: '占得乾为天', provider: 'gemini', model: 'gemini-3.6-flash' };
await call('未配置 ACCESS_CODE → 应越过口令检查（此处止于 NO_KEY 500）', body2, {});
await call('配置 ACCESS_CODE，但请求不带口令头', body2, { ACCESS_CODE: 's3cret' });
await call('配置 ACCESS_CODE，口令错误', body2, { ACCESS_CODE: 's3cret' }, { 'X-Access-Code': 'wrong' });
await call('配置 ACCESS_CODE，口令正确 → 越过检查，止于 NO_KEY', body2, { ACCESS_CODE: 's3cret' }, { 'X-Access-Code': 's3cret' });
console.log('\n  看点：无头/错口令必须 401；对口令才继续。此处 500=NO_KEY 属正常（本机无密钥）。');

// ── ③ 限流 ──────────────────────────────────────────────────────────
hr('③ 按 IP 限流（P1 · RATE_LIMIT_PER_MIN，未配置则该功能关闭）');
console.log('  子测 A：不配置限流变量，连发 3 次 —— 期望全部放行');
for (let i = 1; i <= 3; i++) await call('第 ' + i + ' 次（未配置限流）', body2, {});
console.log('\n  子测 B：配置 RATE_LIMIT_PER_MIN=2，同 IP 连发 4 次 —— 第 3 次起期望 429');
const env3 = { RATE_LIMIT_PER_MIN: '2' };
for (let i = 1; i <= 4; i++) await call('第 ' + i + ' 次（上限 2/分钟）', body2, env3);

// ── ④ 入模规模上限 ──────────────────────────────────────────────────
hr('④ 入模规模上限（P1 · 8,000+20×4,000≈88,000 → 4,000+8×2,000≈20,000）');
const captured = [];
globalThis.fetch = async (url, init) => {
  captured.push(JSON.parse(init.body));
  return new Response('data: {"choices":[{"delta":{"content":"断：吉。"}}]}\n\ndata: [DONE]\n\n', {
    status: 200, headers: { 'content-type': 'text/event-stream' }
  });
};
await call('panText=2 万字符 + 30 轮历史（每轮 9 千字符）', {
  panText: '甲'.repeat(20000),
  provider: 'gpt',
  model: 'gpt-6-luna',
  messages: Array.from({ length: 30 }, function (_, i) { return { role: i % 2 ? 'assistant' : 'user', content: '乙'.repeat(9000) }; })
}, { GPT_API_KEY: 'fake-key-for-local-probe' });

const p = captured[0];
if (p) {
  const sys = p.messages[0], pan = p.messages[1], hist = p.messages.slice(2);
  const total = p.messages.reduce(function (a, m) { return a + m.content.length; }, 0);
  console.log('    实际发给上游：');
  console.log('      system 提示词 : ' + sys.content.length.toLocaleString() + ' 字符');
  console.log('      panText       : ' + pan.content.length.toLocaleString() + ' 字符（上限 4,000；原样传 20,000 → 已截）');
  console.log('      历史消息      : ' + hist.length + ' 条（原样传 30 条 → 已截为 8）');
  if (hist.length) {
    const hs = hist.map(function (m) { return m.content.length; });
    console.log('        其中最长    : ' + Math.max.apply(null, hs).toLocaleString() + ' 字符（每条上限 2,000；原样每轮 9,000 → 已截）');
  }
  console.log('      ── 入模总字符 : ' + total.toLocaleString() + '（修复前约 88,000）');
}
console.log('\n  看点：总字符应 ≈20,000 —— panText 截 4,000、历史截为 8 条×2,000、system 约 300。');

// ── ⑤ 读路径非法 id ─────────────────────────────────────────────────
hr('⑤ 读路径非法 id 过滤（P0 配套 / P2 · records.js）');
function mockDB(rows) {
  return {
    prepare() {
      const st = {
        _v: undefined,
        bind(v) { st._v = v; return st; },
        async first() { return rows.filter(function (r) { return r.id === st._v; })[0] || null; },
        async all() { return { results: rows }; }
      };
      return st;
    }
  };
}
const ROWS = [
  { id: 'ok-1234', created_at: '2026-09-28', hex: '乾为天', question: '正常记录', pillars: '甲子年', datetime: '2026-09-28 10:00', messages: '{}' },
  { id: 'x" onmouseover="alert(1)', created_at: '2026-09-25', hex: '坤为地', question: '存量脏 id', pillars: '', datetime: '', messages: '{"m":[{"role":"user","content":"x"}]}' },
  { id: 'a'.repeat(80), created_at: '2026-09-25', hex: '水雷屯', question: '超长 id', pillars: '', datetime: '', messages: '{}' }
];
async function get(url) {
  n++;
  console.log('\n[' + n + '] GET ' + url.replace('https://liuyao.test', ''));
  const r = await onRequestGet({ request: new Request(url), env: { LIUYAO_DB: mockDB(ROWS) } });
  const t = await r.text();
  const shown = t.length > 200 ? t.slice(0, 200) + ' …' : t;
  console.log('    响应  : HTTP ' + r.status + '  ' + shown);
  return r.status;
}
console.log('  库里故意放了 3 条：1 条合法 + 1 条含引号的脏 id + 1 条 80 字符超长 id');
await get('https://liuyao.test/api/records');
await get('https://liuyao.test/api/records?id=' + encodeURIComponent('x" onmouseover="alert(1)'));
await get('https://liuyao.test/api/records?id=' + 'a'.repeat(80));
await get('https://liuyao.test/api/records?id=ok-1234');
console.log('\n  看点：列表只下发合法 id；非法 id 详情 → 400 BAD_ID；合法 id → 200。');

console.log('\n' + '═'.repeat(74));
console.log('以上为原始输出，请自行核对每条的 HTTP 状态与文案。');
console.log('═'.repeat(74));
