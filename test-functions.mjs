/* ============================================================
 * Functions 层单测 (test-functions.mjs)
 * 覆盖审计项：
 *   #6  超长 messages/tosses 落库前不得产生非法 JSON（旧版 stringify().slice() 会截断）
 *   #13 口令比较为常量时间（safeEqual）
 *   #14 CUSTOM_PROVIDERS 解析失败不再静默吞错
 *   #8  模型 id 字符集校验（XSS 上游根因）
 * 运行：npm run test:fn
 * ============================================================ */
import { jsonWithin, safeEqual } from './functions/api/records.js';
import { customProviders, gptModelList, isSafeModelId } from './functions/api/_lib.js';

let pass = 0, fail = 0;
function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; } else { fail++; console.log('FAIL', name, 'got=', JSON.stringify(got), 'want=', JSON.stringify(want)); }
}
function parses(s) { try { JSON.parse(s); return true; } catch (e) { return false; } }

// ---------- #6 jsonWithin：始终产出合法 JSON 且不超限 ----------
const bigMsgs = {};
for (let i = 0; i < 40; i++) {
  bigMsgs['model-' + i] = { history: [
    { role: 'assistant', content: 'A'.repeat(4000) },
    { role: 'user', content: '问'.repeat(4000) }
  ] };
}
const sBig = jsonWithin(bigMsgs, 100000);
eq('超长 messages 可 JSON.parse', parses(sBig), true);
eq('超长 messages 不超限', sBig.length <= 100000, true);
eq('超长 messages 有截断标记', JSON.parse(sBig)._truncated, true);
eq('截断后仍保留部分模型', Object.keys(JSON.parse(sBig)).length > 1, true);
// 对照：旧实现 stringify().slice() 的产物不可解析（证明修复必要性）
eq('旧实现字符串截断确实非法', parses(JSON.stringify(bigMsgs).slice(0, 100000)), false);

const bigTosses = [];
for (let i = 0; i < 500; i++) bigTosses.push({ coins: ['背', '字', '背'], backs: 2, val: 0, note: 'x'.repeat(50) });
const sToss = jsonWithin(bigTosses, 4000);
eq('超长 tosses 可 JSON.parse', parses(sToss), true);
eq('超长 tosses 不超限', sToss.length <= 4000, true);
eq('超长 tosses 保留前段元素', JSON.parse(sToss).length > 0, true);

// 边界：正常长度原样返回（不引入 _truncated）
const normal = { a: { history: [{ role: 'user', content: '问' }] } };
eq('正常长度原样序列化', jsonWithin(normal, 100000), JSON.stringify(normal));
eq('空数组', jsonWithin([], 4000), '[]');
eq('undefined → null', jsonWithin(undefined, 4000), 'null');
eq('不可序列化对象 → null（不抛）', jsonWithin({ x: 1n }, 4000), 'null');

// ---------- #13 常量时间口令比较 ----------
eq('同口令为真', await safeEqual('s3cret', 's3cret'), true);
eq('异口令为假', await safeEqual('s3cret', 's3creT'), false);
eq('长度不同为假', await safeEqual('s3cret', 's3cret-longer'), false);
eq('空对空为真', await safeEqual('', ''), true);
eq('空对非空为假', await safeEqual('', 'abc'), false);

// ---------- #14 CUSTOM_PROVIDERS 解析失败要告警（不再静默吞错） ----------
const warns = [];
const origWarn = console.warn;
console.warn = function () { warns.push(Array.prototype.slice.call(arguments).join(' ')); };
eq('非法 JSON → 空数组', customProviders({ CUSTOM_PROVIDERS: '{oops' }), []);
eq('非法 JSON 有告警', warns.some(function (w) { return w.indexOf('不是合法 JSON') >= 0; }), true);
eq('非数组 → 空数组', customProviders({ CUSTOM_PROVIDERS: '{"id":"kimi"}' }), []);
const warnsBefore = warns.length;
eq('未配置 → 空数组', customProviders({}), []);
eq('未配置不产生告警', warns.length, warnsBefore);

// ---------- #8 模型 id 字符集校验 ----------
eq('合法 id', isSafeModelId('gemini-3.6-flash'), true);
eq('含引号 id 非法', isSafeModelId('x"><script>'), false);
eq('含空格 id 非法', isSafeModelId('a b'), false);
const cp = customProviders({ CUSTOM_PROVIDERS: JSON.stringify([
  { id: 'kimi', label: 'Moonshot', base: 'https://x/v1', models: ['kimi-k2', 'evil"><img src=x onerror=alert(1)>'] },
  { id: 'Bad-Id', models: ['x'] },
  { id: 'qwen', models: [] }
]) });
eq('含注入字符的模型被剔除', cp[0].models, ['kimi-k2']);
eq('非法供应商 id 被剔除', cp.length, 1);
eq('GPT_MODELS 过滤注入名', gptModelList({ GPT_MODELS: 'gpt-6-luna,<img src=x>,gpt-6-sol' }), ['gpt-6-luna', 'gpt-6-sol']);
console.warn = origWarn;

console.log('PASS:', pass, ' FAIL:', fail);
if (fail > 0) process.exit(1);
