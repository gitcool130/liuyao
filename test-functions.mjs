/* ============================================================
 * Functions 层单测 (test-functions.mjs)
 * 覆盖审计项：
 *   #6  超长 messages/tosses 落库前不得产生非法 JSON（旧版 stringify().slice() 会截断）
 *   #13 口令比较为常量时间（safeEqual）
 *   #14 CUSTOM_PROVIDERS 解析失败不再静默吞错
 *   #8  模型 id 字符集校验（XSS 上游根因）
 *   #15 /api/models 去重表不得被原型链污染（第二十轮）
 *   #16 读路径口令收口（与写同源）+ DELETE 的 ID_RE 校验（第二十轮）
 * 运行：npm run test:fn
 * ============================================================ */
import { jsonWithin, safeEqual, onRequestGet, onRequestDelete } from './functions/api/records.js';
import { customProviders, gptModelList, isSafeModelId } from './functions/api/_lib.js';
import { onRequestGet as modelsGet } from './functions/api/models.js';
import { onRequestPost as interpretPost, isRateLimited, __rlState } from './functions/api/interpret.js';

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

// ---------- #15 /api/models 去重表不得被原型链污染（第二十轮） ----------
// 旧实现 seen = {}；seen['constructor'] 命中 Object.prototype.constructor（truthy），
// 模型名恰为原型键时被静默判为「重复」而丢弃（与 interpret.js 白名单同一坑，此前未收口）
const mres = await modelsGet({ env: { CUSTOM_PROVIDERS: JSON.stringify([
  { id: 'p1', label: 'P1', base: 'https://x/v1', models: ['constructor', 'toString', 'normal-model'] },
  { id: 'p2', label: 'P2', base: 'https://x/v1', models: ['normal-model'] }
]) } });
const mIds = (await mres.json()).models.map(function (m) { return m.id; });
eq('原型键模型名 constructor 不被吞', mIds.indexOf('constructor') >= 0, true);
eq('原型键模型名 toString 不被吞', mIds.indexOf('toString') >= 0, true);
eq('去重逻辑仍生效（normal-model 只留一个）', mIds.filter(function (id) { return id === 'normal-model'; }).length, 1);

// ---------- #16 records.js：读路径口令收口 + DELETE 的 ID_RE 校验（第二十轮） ----------
// D1 最小桩：记录被下发的 SQL 与被绑定的参数，用于断言「非法 id 不下探数据库」
function mkDb() {
  const state = { sqls: [], bound: [] };
  return {
    state: state,
    prepare: function (sql) {
      state.sqls.push(sql);
      return {
        bind: function (v) {
          state.bound.push(v);
          return { run: async function () { return {}; }, first: async function () { return null; } };
        },
        all: async function () { return { results: [] }; }
      };
    }
  };
}
const db = mkDb();
const envLib = { LIUYAO_DB: db, LIB_CODE: 'k' };
const del = function (q, headers) {
  return onRequestDelete({ request: new Request('https://x/api/records' + q, { method: 'DELETE', headers: headers || {} }), env: envLib });
};
const get = function (q, headers, env) {
  return onRequestGet({ request: new Request('https://x/api/records' + (q || ''), { headers: headers || {} }), env: env || envLib });
};

eq('DELETE 无口令 → 401', (await del('?id=ok-1')).status, 401);
eq('DELETE 非法 id → 400', (await del('?id=bad%20id', { 'X-Access-Code': 'k' })).status, 400);
eq('DELETE 非法 id 不下探数据库', db.state.sqls.length, 0);
eq('DELETE 合法 id → 200', (await del('?id=ok-1', { 'X-Access-Code': 'k' })).status, 200);
eq('DELETE 合法 id 恰好下发一条 SQL', db.state.sqls.length, 1);

// A1 收口：读路径（列表 + 详情）与写路径同源，未带口令不得下发任何卦例内容
eq('未带口令读列表 → 401', (await get()).status, 401);
eq('未带口令读详情 → 401', (await get('?id=ok-1')).status, 401);
eq('带口令读列表 → 200', (await get('', { 'X-Access-Code': 'k' })).status, 200);
eq('未配置任何口令时读列表保持开放（向后兼容）', (await get('', {}, { LIUYAO_DB: mkDb() })).status, 200);
eq('读路径同样认 ACCESS_CODE（与写路径同源）',
  (await get('', { 'X-Access-Code': 'a' }, { LIUYAO_DB: mkDb(), ACCESS_CODE: 'a' })).status, 200);

// ---------- #17 上游超时与流式缓冲双守卫（第二十一轮 B4/B5） ----------
// 上游是「用户自配的 OpenAI 兼容中转」，属信任边界外的输入：可能挂起不返回、也可能
// 持续发送不含换行的数据或无限多条 data: 行。三处都必须有硬性收口。
let fetchChunks = [];
let fetchMode = 'bad';
const origFetch = globalThis.fetch;
globalThis.fetch = function (url, opts) {
  if (fetchMode === 'hang') {
    // 模拟上游挂起：不主动返回。带 signal 时于 abort 抛出（fetch 的真实行为）；
    // 无 signal 时 3s 后兜底返回 500 —— 使「缺超时保护」表现为 502 而非无限挂起，
    // 这样「有超时(504) / 无超时(502)」可判别，断言才不是空转。
    return new Promise(function (resolve, reject) {
      let done = false;
      const fb = setTimeout(function () {
        if (done) return; done = true;
        resolve(new Response('late', { status: 500 }));
      }, 3000);
      const sig = opts && opts.signal;
      if (sig) sig.addEventListener('abort', function () {
        if (done) return; done = true; clearTimeout(fb);
        const e = new Error('The operation was aborted'); e.name = 'AbortError'; reject(e);
      });
    });
  }
  if (fetchMode === 'bad') return Promise.resolve(new Response('upstream down', { status: 500 }));
  const enc = new TextEncoder();
  const body = new ReadableStream({
    start: function (c) { fetchChunks.forEach(function (s) { c.enqueue(enc.encode(s)); }); c.close(); }
  });
  return Promise.resolve(new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }));
};

const ENV_GPT = { GPT_API_KEY: 'k', GPT_MODELS: 'gpt-6-luna' };
const post = function (env, headers) {
  return interpretPost({
    request: new Request('https://x/api/interpret', {
      method: 'POST',
      headers: Object.assign({ 'content-type': 'application/json' }, headers || {}),
      body: JSON.stringify({ panText: '占测试', provider: 'gpt', model: 'gpt-6-luna' })
    }),
    env: env
  });
};
const sseLine = function (txt) {
  return 'data: ' + JSON.stringify({ choices: [{ delta: { content: txt } }] }) + '\n';
};

// B5：上游挂起 → AbortController 硬超时（旧版无 signal，请求会一直悬置）
fetchMode = 'hang';
const rTimeout = await post(Object.assign({ LLM_TIMEOUT_MS: '400' }, ENV_GPT));
const jTimeout = await rTimeout.json();
eq('上游挂起 → 504', rTimeout.status, 504);
eq('上游挂起 → 错误码 LLM_TIMEOUT', jTimeout.error, 'LLM_TIMEOUT');
eq('超时文案含秒数、不暴露堆栈', /秒内未返回完整响应/.test(jTimeout.message), true);

// B4 守卫①：上游持续发送不含 \n 的数据 → 行缓冲永不切分，撞上限即断开。
// 构造要点：把一段 data: 行「掐掉换行」后接 1.2 MB 无换行垃圾，再接一条正常 data: 行。
//   有守卫 → 在 1.2 MB 处断开，一条正文都没积出 → EMPTY
//   无守卫 → 垃圾与首行被并成一行而丢弃，但它会继续处理到后面那条正常行 → reply='乙'
// 两种结果不同，断言才有判别力（若只用「纯垃圾流」，有无守卫都会得到 EMPTY，等于没测）。
fetchMode = 'sse';
fetchChunks = [sseLine('佳').replace(/\n$/, '') + 'x'.repeat(1200000) + '\n' + sseLine('乙') + 'data: [DONE]\n'];
const rLine = await post(ENV_GPT);
eq('无换行的超长流被守卫断开（未积出正文 → EMPTY）', rLine.status, 502);
eq('无换行的超长流 → 错误码 EMPTY', (await rLine.json()).error, 'EMPTY');

// B4 守卫②：上游发送超量 data: 行 → 累计正文封顶后断开，保留已收部分
fetchChunks = [sseLine('甲'.repeat(3000)).repeat(100)];  // 正文 30 万字符 > SSE_MAX_REPLY(20 万)
const rFlood = await post(ENV_GPT);
const jFlood = await rFlood.json();
eq('超量流式正文 → 仍 200（保留已收部分，不整条丢弃）', rFlood.status, 200);
eq('超量流式正文 → 标记 REPLY_OVERFLOW', jFlood.truncated, 'REPLY_OVERFLOW');
eq('正文长度被封顶在 200000', jFlood.reply.length, 200000);

// 反向：正常长度的流不受守卫影响，且不引入 truncated 字段（不污染正常响应）
fetchChunks = [sseLine('吉'), sseLine('凶'), 'data: [DONE]\n'];
const rOk = await post(ENV_GPT);
const jOk = await rOk.json();
eq('正常流式仍原样拼接', jOk.reply, '吉凶');
eq('正常流不带 truncated 字段', 'truncated' in jOk, false);
eq('正常流带 provider/model', [jOk.provider, jOk.model], ['gpt', 'gpt-6-luna']);

// ---------- #18 限流滑动窗口：单 IP 计数必须有界（第二十一轮 C5） ----------
// 旧版每次请求都 hits.push()，数组随请求数无界增长；且 RL_HITS.size 超限时 clear()
// 会把正在被限流的访客一并放行。生产当前未设 RATE_LIMIT_PER_MIN，此为启用后的隐患。
fetchMode = 'bad';   // 上游返回 500 → 解释层给 502；用于区分「放行」与「429 被限流」
const envRL = Object.assign({ RATE_LIMIT_PER_MIN: '3' }, ENV_GPT);
const RL_IP = { 'CF-Connecting-IP': '203.0.113.7' };
const codes = [];
for (let i = 0; i < 20; i++) codes.push((await post(envRL, RL_IP)).status);
eq('窗口内前 3 次放行', codes.slice(0, 3), [502, 502, 502]);   // 502 = 走到上游（被 mock 成 500）
eq('第 4 次起一律 429', codes.slice(3), new Array(17).fill(429));
eq('单 IP 计数数组封顶在 limit（旧版会涨到 20）',
  __rlState().filter(function (x) { return x.ip === '203.0.113.7'; })[0].len, 3);
eq('不同 IP 独立计数（不受上者限流影响）',
  (await post(envRL, { 'CF-Connecting-IP': '203.0.113.8' })).status, 502);
// 未配置 RATE_LIMIT_PER_MIN 时恒不限流（＝当前生产状态，第十七轮撤销后）
eq('未设 RATE_LIMIT_PER_MIN → 不限流',
  isRateLimited(new Request('https://x/', { headers: RL_IP }), {}), false);

globalThis.fetch = origFetch;

console.log('PASS:', pass, ' FAIL:', fail);
if (fail > 0) process.exit(1);
