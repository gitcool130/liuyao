/* ============================================================
 * Functions 层单测 (test-functions.mjs)
 * 覆盖审计项：
 *   #6  超长 messages/tosses 落库前不得产生非法 JSON（旧版 stringify().slice() 会截断）
 *   #13 口令比较为常量时间（safeEqual）
 *   #14 CUSTOM_PROVIDERS 解析失败不再静默吞错
 *   #8  模型 id 字符集校验（XSS 上游根因）
 *   #15 /api/models 去重表不得被原型链污染（第二十轮）
 *   #16 读路径口令收口（与写同源）+ DELETE 的 ID_RE 校验（第二十轮）
 *   #19 结果回执（M16）：sanitizeOutcome 白名单三态、回填端点三关拦截、主 POST 不触碰 outcome 列
 *   #20 gemini 跨模型降级：可恢复失败（429/5xx/网络错误）自动落同族备选，4xx 不降级（2026-10-12）
 *   #21 SSE 透传剥离 reasoning_content：思考草稿不得下传，防 fact-audit 假阳性（2026-10-13）
 *   #22 SSE 心跳必须真实写出（writer 释放后不可再写）+ Google 原生 alt=sse 解析（2026-10-17）
 *   #23 排盘文本超限显式 413 + 客户端断开即掐断上游（2026-10-17）
 *   #24 按盘 OG 预览（M17-B 阶段一）：functions/index.js 按 ?s= 注入 og meta——
 *       四锚点全或无改写、畸形码回落默认 meta（不 500）、旧格式（三段最小）码照常改写、
 *       question 属性转义、_share 门面与 core.js 的 decodeCast 同一引用（防漂移）、
 *       import 白名单封闭（断语层模块物理不可达）
 * 运行：npm run test:fn
 * ============================================================ */
import { jsonWithin, safeEqual, onRequestGet, onRequestDelete, onRequestPost, sanitizeOutcome } from './functions/api/records.js';
import { customProviders, gptModelList, isSafeModelId } from './functions/api/_lib.js';
import { onRequestGet as modelsGet } from './functions/api/models.js';
import { onRequestPost as interpretPost, isRateLimited, __rlState, SYSTEM_PROMPT, deltaText, deltaReasoning } from './functions/api/interpret.js';
import { onRequestGet as ogGet } from './functions/index.js';
import { onRequestGet as readingsGet, onRequestPost as readingsPost, beijingToday } from './functions/api/readings.js';
import { onRequestPost as votePost, onRequestGet as voteGet, _internals as voteInternals } from './functions/api/vote.js';
const _vCleanBasis = voteInternals.cleanBasis;
import { decodeCast as facadeDecode } from './functions/api/_share.js';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

let pass = 0, fail = 0;
// 服务端每次收流会打一行 {"ev":"stream_end",…} 采样日志（2026-10-21 加，用于区分
// 「模型自停」与「流被提前关闭」）。本文件会驱动上百次流，不加过滤会把断言输出淹没。
// 只滤这一种事件，FAIL 与其它输出原样保留。
const rawLog = console.log.bind(console);
console.log = function () {
  const a = arguments;
  if (a.length && typeof a[0] === 'string' && a[0].indexOf('"ev":"stream_end"') !== -1) return;
  rawLog.apply(null, a);
};
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
eq('GPT_MODELS 禁用 gpt-5.2 类中转站', gptModelList({ GPT_MODELS: 'gpt-5.2,gpt5.2,gpt-6-luna' }), ['gpt-6-luna']);
const cpBanned = customProviders({ CUSTOM_PROVIDERS: JSON.stringify([{ id: 'foo', models: ['gpt-5.2', 'ok-model'] }]) });
eq('CUSTOM_PROVIDERS 也剔除被禁模型', cpBanned[0].models, ['ok-model']);
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
// bind 可变参（UPDATE 等多参语句全部记录）；run 的 meta.changes 可由 state.changes 控制（默认 1）
function mkDb() {
  const state = { sqls: [], bound: [], changes: 1, rows: [] };
  return {
    state: state,
    prepare: function (sql) {
      state.sqls.push(sql);
      return {
        bind: function () {
          const args = Array.prototype.slice.call(arguments);
          state.bound.push(args);
          return {
            run: async function () { return { meta: { changes: state.changes } }; },
            first: async function () { return null; },
            // 列表查询走 bind(...).all()（分页参数为占位符）。桩按 args 模拟
            // LIMIT ? OFFSET ?：last 两个参数是 [limit, offset]，否则原样返回。
            all: async function () {
              if (args.length >= 2 && state.rows.length) {
                const lim = Number(args[args.length - 2]);
                const off = Number(args[args.length - 1]);
                if (lim > 0) return { results: state.rows.slice(off, off + lim) };
              }
              return { results: state.rows };
            }
          };
        },
        all: async function () { return { results: state.rows }; }
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

// ---------- 列表分页（L2）：limit/offset 占位符 + hasMore ----------
const dbPage = mkDb();
dbPage.state.rows = [0, 1, 2].map(function (i) {
  return { id: 'r' + i, created_at: '2026-10-0' + (i + 1), question: 'q' + i, hex: 'h', pillars: 'p', outcome: null };
});
const envPage = { LIUYAO_DB: dbPage, LIB_CODE: 'k' };
const lastBound = function () { return dbPage.state.bound[dbPage.state.bound.length - 1]; };
const jPage = await (await get('?limit=2&offset=0', { 'X-Access-Code': 'k' }, envPage)).json();
eq('分页：SQL 走 LIMIT ? OFFSET ?', /LIMIT \? OFFSET \?/.test(dbPage.state.sqls[dbPage.state.sqls.length - 1]), true);
eq('分页：多取一条判 hasMore（limit+1, offset）', lastBound(), [3, 0]);
eq('分页：只下发 limit 条', jPage.records.length, 2);
eq('分页：hasMore 为真', jPage.hasMore, true);
eq('分页：回显 limit/offset', [jPage.limit, jPage.offset], [2, 0]);
const jPage2 = await (await get('?limit=2&offset=2', { 'X-Access-Code': 'k' }, envPage)).json();
eq('分页：offset 透传', lastBound(), [3, 2]);
eq('分页：末页 hasMore 为假', jPage2.hasMore, false);
eq('分页：超上限收敛到 200', (await get('?limit=9999', { 'X-Access-Code': 'k' }, envPage), lastBound()), [201, 0]);
eq('分页：缺省仍是 100', (await get('', { 'X-Access-Code': 'k' }, envPage), lastBound()), [101, 0]);

// ---------- 请求体总大小闸门（L1）：早于 request.json() 拒绝 ----------
const big = await interpretPost({
  request: new Request('https://x/api/interpret', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'content-length': String(600 * 1024), 'X-Access-Code': 'a' },
    body: '{}'
  }),
  env: { ACCESS_CODE: 'a' }
});
eq('超大 Content-Length → 413', big.status, 413);
eq('413 错误码固定', (await big.json()).error, 'BODY_TOO_LARGE');
const bigRec = await onRequestPost({
  request: new Request('https://x/api/records', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'content-length': String(600 * 1024), 'X-Access-Code': 'k' },
    body: '{}'
  }),
  env: envLib
});
eq('records 同样 413', bigRec.status, 413);

// ---------- 口令爆破限速：同 IP 错 20 次后 429 ----------
const bruteCode = { LIUYAO_DB: mkDb(), LIB_CODE: 'k' };
const bruteIp = { 'X-Access-Code': 'wrong', 'CF-Connecting-IP': '203.0.113.7' };
let bruteStatus = 0;
for (let i = 0; i < 21; i++) {
  bruteStatus = (await get('', bruteIp, bruteCode)).status;
}
eq('连续错口令第 21 次 → 429', bruteStatus, 429);
eq('换 IP 不受影响（仍是 401）',
  (await get('', { 'X-Access-Code': 'wrong', 'CF-Connecting-IP': '203.0.113.8' }, bruteCode)).status, 401);
eq('正确口令不受计数影响',
  (await get('', { 'X-Access-Code': 'k', 'CF-Connecting-IP': '203.0.113.9' }, bruteCode)).status, 200);

// interpret 的 ACCESS_CODE 分支与 records 共用同一份计数（_lib.js requireCode）：
// 旧版这里只有 safeEqual，没有失败计数——单独启用 ACCESS_CODE 时是无限速爆破口。
const acEnv = { ACCESS_CODE: 'a' };
const acReq = function (ip, code) {
  return new Request('https://x/api/interpret', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'CF-Connecting-IP': ip, 'X-Access-Code': code },
    body: '{}'
  });
};
let acStatus = 0;
for (let i = 0; i < 21; i++) {
  acStatus = (await interpretPost({ request: acReq('198.51.100.5', 'bad'), env: acEnv })).status;
}
eq('interpret 错口令第 21 次 → 429', acStatus, 429);
eq('interpret 换 IP 仍只 401',
  (await interpretPost({ request: acReq('198.51.100.6', 'bad'), env: acEnv })).status, 401);
// 越过口令闸后落到「缺排盘文本」，用 400 证明闸门确实放行
eq('interpret 正确口令放行（→400 NO_PAN）',
  (await interpretPost({ request: acReq('198.51.100.7', 'a'), env: acEnv })).status, 400);

// ---------- #19 结果回执（M16）：白名单校验 + 只写 outcome 列 + 不被自动保存冲掉 ----------
// sanitizeOutcome 三态：object = 合法；null = 显式清除；undefined = 非法
eq('回执 null → 清除', sanitizeOutcome(null), null);
eq('回执非对象 → 非法', sanitizeOutcome('成了'), undefined);
eq('回执数组 → 非法', sanitizeOutcome(['success']), undefined);
eq('回执空对象 → 非法（至少居其一）', sanitizeOutcome({}), undefined);
eq('回执枚举外取值 → 非法', sanitizeOutcome({ result: '成了' }), undefined);
eq('回执 note 修剪并截断 200', (function () {
  const o = sanitizeOutcome({ result: 'success', note: '  ' + '备'.repeat(300) + '  ' });
  return o.note.length === 200;
})(), true);
eq('回执合法全字段', (function () {
  const o = sanitizeOutcome({ result: 'partial', yingqi: 'on_time', note: '如期' });
  return [o.result, o.yingqi, o.note, typeof o.updated_at];
})(), ['partial', 'on_time', '如期', 'string']);

// 应验窗口分桶（M17）：枚举白名单 + 只有窗口没有成败/应期时仍判非法。
// 分桶口径的价值全在「桶内自洽」：3 日与 90 日是两套应期机制，跨桶相加没有意义。
eq('回执窗口枚举内 → 保留', sanitizeOutcome({ result: 'success', window: 'd7' }).window, 'd7');
eq('回执窗口枚举外 → 丢弃该字段但回执本身合法', (function () {
  const o = sanitizeOutcome({ result: 'success', window: 'd5' });
  return [o.result, o.window];
})(), ['success', undefined]);
eq('回执只有窗口 → 非法（窗口不能单独成回执）', sanitizeOutcome({ window: 'd3' }), undefined);
eq('回执四档窗口全部接受', ['d3', 'd7', 'd30', 'd90'].filter(function (k) {
  return sanitizeOutcome({ result: 'fail', window: k }).window === k;
}).length, 4);

// 回填端点：口令 / id / 回执三关各自独立拦截，且非法输入一律不下探数据库
const postRaw = function (q, body, headers, env) {
  return onRequestPost({
    request: new Request('https://x/api/records' + q, {
      method: 'POST',
      headers: Object.assign({ 'content-type': 'application/json' }, headers || {}),
      body: JSON.stringify(body)
    }),
    env: env || envLib
  });
};
const dbOc = mkDb();
const envOc = { LIUYAO_DB: dbOc, LIB_CODE: 'k' };
eq('回填无口令 → 401', (await postRaw('?outcome=1', { id: 'ok-1', outcome: { result: 'success' } }, {}, envOc)).status, 401);
eq('回填非法 id → 400', (await postRaw('?outcome=1', { id: 'bad id', outcome: { result: 'success' } }, { 'X-Access-Code': 'k' }, envOc)).status, 400);
eq('回填非法回执 → 400', (await postRaw('?outcome=1', { id: 'ok-1', outcome: { result: '成了' } }, { 'X-Access-Code': 'k' }, envOc)).status, 400);
eq('回填三关拦截均不下探数据库', dbOc.state.sqls.length, 0);
const rOcOk = await postRaw('?outcome=1', { id: 'ok-1', outcome: { result: 'success', yingqi: 'pending' } }, { 'X-Access-Code': 'k' }, envOc);
eq('回填合法 → 200', rOcOk.status, 200);
eq('回填只写 outcome 列', /^UPDATE casts SET outcome = \? WHERE id = \?$/.test(dbOc.state.sqls[0]), true);
eq('回填绑定参数（回执 JSON 可解析 + id 正确）', (function () {
  const b = dbOc.state.bound[0];
  return parses(b[0]) && JSON.parse(b[0]).result === 'success' && b[1] === 'ok-1';
})(), true);
dbOc.state.changes = 0;
eq('回填不存在的卦例 → 404', (await postRaw('?outcome=1', { id: 'ok-9', outcome: { result: 'fail' } }, { 'X-Access-Code': 'k' }, envOc)).status, 404);
dbOc.state.changes = 1;
const rOcClear = await postRaw('?outcome=1', { id: 'ok-1', outcome: null }, { 'X-Access-Code': 'k' }, envOc);
eq('清除回执 → 200 且落库值为 SQL NULL', rOcClear.status === 200 && dbOc.state.bound[dbOc.state.bound.length - 1][0] === null, true);

// 列表下发 outcome（前端徽标与命中率统计的数据源）
const dbList = mkDb();
await get('', { 'X-Access-Code': 'k' }, { LIUYAO_DB: dbList, LIB_CODE: 'k' });
eq('卦例列表 SQL 含 outcome 列', /SELECT id, created_at, datetime, question, hex, pillars, outcome FROM casts/.test(dbList.state.sqls[0]), true);

// 反向锁定：断卦后的自动保存（主 POST）绝不得触碰 outcome 列——否则回填会被下一次保存冲掉
const dbMain = mkDb();
await postRaw('', { panText: '排盘', tosses: [], messages: [] }, { 'X-Access-Code': 'k' }, { LIUYAO_DB: dbMain, LIB_CODE: 'k' });
eq('主 POST 的 INSERT 不含 outcome 列', dbMain.state.sqls[0].indexOf('outcome') < 0, true);

// ---------- 判据快照（M17-A 阶段二）：baseline 随主 POST 落库，与 outcome 隔离 ----------
// proposal-baseline-column.md §六 的五项增补（既有 180 项断言一字不动）：
const dbBl = mkDb();
await postRaw('', { panText: '排盘', tosses: [], messages: [],
  baseline: { yongshen: '妻财 己卯', trend: '吉', window: null, confidence: null, spread: null } },
  { 'X-Access-Code': 'k' }, { LIUYAO_DB: dbBl, LIB_CODE: 'k' });
const sqlBl = dbBl.state.sqls[0];
eq('主 INSERT 含 baseline 列且不含 outcome', sqlBl.indexOf('baseline') >= 0 && sqlBl.indexOf('outcome') < 0, true);
eq('ON CONFLICT 清单含 baseline 不含 outcome', sqlBl.indexOf('baseline = excluded.baseline') >= 0 && sqlBl.indexOf('excluded.outcome') < 0, true);
eq('合法 baseline 经 jsonWithin 落库可 parse', (function () {
  const b = dbBl.state.bound[0];
  return parses(b[9]) && JSON.parse(b[9]).yongshen === '妻财 己卯';
})(), true);
const dbBadBl = mkDb();
await postRaw('', { panText: '排盘', tosses: [], messages: [], baseline: '垃圾' }, { 'X-Access-Code': 'k' }, { LIUYAO_DB: dbBadBl, LIB_CODE: 'k' });
const dbArrBl = mkDb();
await postRaw('', { panText: '排盘', tosses: [], messages: [], baseline: ['x'] }, { 'X-Access-Code': 'k' }, { LIUYAO_DB: dbArrBl, LIB_CODE: 'k' });
eq('非对象 baseline（字符串/数组）落库为 null', dbBadBl.state.bound[0][9] === null && dbArrBl.state.bound[0][9] === null, true);
eq('列表 SELECT 仍不含 baseline', dbList.state.sqls[0].indexOf('baseline') < 0, true);

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

// 读取 SSE 响应体：跳过 : 注释行（心跳/ping），收集 data: 行的 JSON 事件。
// 流式语义下 interpret 的响应恒为 200 text/event-stream，断流/截断信息以
// 流内 data:{"error":...} 传达（客户端 readStreamSSE 据此 throw 走重试），
// 不再有旧版「非流式缓冲后返回 JSON」的 502/EMPTY/truncated 形态。
const readSSEEvents = async function (resp) {
  const txt = await resp.text();
  const events = [];
  txt.split('\n').forEach(function (l) {
    l = l.trim();
    if (l.indexOf('data:') === 0) {
      try { events.push(JSON.parse(l.slice(5).trim())); } catch (e) { /* 忽略 */ }
    }
  });
  return events;
};
// 流内正文事件（t 字段）拼接为完整答复
const sseText = function (events) {
  return events.filter(function (e) { return typeof e.t === 'string'; })
    .map(function (e) { return e.t; }).join('');
};

// B4 守卫①：上游持续发送不含 \n 的数据 → 行缓冲永不切分，撞上限即断开。
// 构造要点：把一段 data: 行「掐掉换行」后接 1.2 MB 无换行垃圾，再接一条正常 data: 行。
//   有守卫 → 在 1.2 MB 处断开，一条正文都没积出
//   无守卫 → 垃圾与首行被并成一行而丢弃，但它会继续处理到后面那条正常行 → 正文='乙'
// 两种结果不同，断言才有判别力（若只用「纯垃圾流」，有无守卫都不积正文，等于没测）。
fetchMode = 'sse';
fetchChunks = [sseLine('佳').replace(/\n$/, '') + 'x'.repeat(1200000) + '\n' + sseLine('乙') + 'data: [DONE]\n'];
const rLine = await post(ENV_GPT);
const evLine = await readSSEEvents(rLine);
eq('无换行的超长流被守卫断开（仍 200，断流走流内事件）', rLine.status, 200);
eq('无换行的超长流 → 流内错误码 LINE_OVERFLOW', evLine.some(function (e) { return e.error === 'LINE_OVERFLOW'; }), true);
eq('无换行的超长流 → 未积出任何正文（无 t 事件）', sseText(evLine), '');

// B4 守卫②：上游发送超量 data: 行 → 累计正文封顶后断开，保留已收部分。
// 封顶语义：按「先累计后写」逐行收口——第 67 行累计到 201000 > 200000 即断，
// 该行不写出，故实收 66 行 × 3000 = 198000 字符（封顶是天花板，不是凑整目标）。
fetchChunks = [sseLine('甲'.repeat(3000)).repeat(100)];  // 正文 30 万字符 > SSE_MAX_REPLY(20 万)
const rFlood = await post(ENV_GPT);
const evFlood = await readSSEEvents(rFlood);
eq('超量流式正文 → 仍 200（保留已收部分，不整条丢弃）', rFlood.status, 200);
eq('超量流式正文 → 流内标记 REPLY_OVERFLOW', evFlood.some(function (e) { return e.error === 'REPLY_OVERFLOW'; }), true);
eq('正文长度被封顶在 200000 内', sseText(evFlood).length <= 200000, true);
eq('正文长度实收 66 行（198000）', sseText(evFlood).length, 198000);

// 反向：正常长度的流不受守卫影响，无 error 事件（不污染正常响应）
fetchChunks = [sseLine('吉'), sseLine('凶'), 'data: [DONE]\n'];
const rOk = await post(ENV_GPT);
const evOk = await readSSEEvents(rOk);
eq('正常流式仍原样拼接', sseText(evOk), '吉凶');
eq('正常流无 error 事件', evOk.some(function (e) { return e.error; }), false);

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

// ---------- #20 gemini 跨模型降级（2026-10-12） ----------
// gemini-3.8-flash 常因 Google 侧 high demand 整段 503（AI Gateway 日志自 2026-10-01 反复出现），
// 网关 3 次重试盖不住持续拥塞，故在 Functions 层对可恢复失败（429/5xx/网络错误）自动落同族备选模型；
// 4xx 属配置/请求错误，换模型同样失败，不降级。
const gemCalls = [];
let gemQueue = [];
globalThis.fetch = function (url) {
  gemCalls.push(url);
  const r = gemQueue.shift();
  return Promise.resolve(typeof r === 'function' ? r() : r);
};
const gemOk = function (txt) {
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: txt }] } }] }), { status: 200 });
};
const postGem = function (model) {
  return interpretPost({
    request: new Request('https://x/api/interpret', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ panText: '占测试', provider: 'gemini', model: model })
    }),
    env: { GEMINI_API_KEY: 'k' }
  });
};

// 主模型 503 → 自动降级备选，响应标出实际兜底模型
gemQueue = [new Response('high demand', { status: 503 }), gemOk('降级正文')];
gemCalls.length = 0;
const rFb = await postGem('gemini-3.8-flash');
const jFb = await rFb.json();
eq('主模型 503 → 降级后 200', rFb.status, 200);
eq('降级正文来自备选', jFb.reply, '降级正文');
eq('model 字段为实际兜底模型', jFb.model, 'gemini-3.6-flash');
eq('fallback 字段标出兜底', jFb.fallback, 'gemini-3.6-flash');
eq('两次调用依次命中主/备模型', [gemCalls[0].indexOf('gemini-3.8-flash') >= 0, gemCalls[1].indexOf('gemini-3.6-flash') >= 0], [true, true]);
eq('降级恰好两次调用', gemCalls.length, 2);

// 反向：主模型直接成功时不触发降级、不引入 fallback 字段（不污染正常响应）
gemQueue = [gemOk('正文')];
gemCalls.length = 0;
const rDirect = await postGem('gemini-3.6-flash');
const jDirect = await rDirect.json();
eq('主模型成功不触发降级', gemCalls.length, 1);
eq('成功响应不带 fallback 字段', 'fallback' in jDirect, false);

// 4xx（客户端错误）不降级：换模型同样失败，重试无意义
gemQueue = [new Response('bad request', { status: 400 })];
gemCalls.length = 0;
const r400 = await postGem('gemini-3.8-flash');
eq('4xx 不降级（仅一次调用）', gemCalls.length, 1);
eq('4xx 原样 502 透出', r400.status, 502);
eq('4xx 错误码 LLM_ERROR', (await r400.json()).error, 'LLM_ERROR');

// 主备皆挂 → 保留**首次**错误返回（更贴近用户所选模型的真实状态）。
// 注：上游原始错误体只进服务端日志、不回传客户端（防中转站经错误体回显 key），
// 故用「主 503 / 备 429」让两次失败可区分：message 必须报首次的 503。
gemQueue = [new Response('主模型503', { status: 503 }), new Response('备选429', { status: 429 })];
gemCalls.length = 0;
const rBoth = await postGem('gemini-3.8-flash');
const jBoth = await rBoth.json();
eq('主备皆挂 → 尝试两次后 502', [rBoth.status, gemCalls.length], [502, 2]);
eq('主备皆挂 → message 保留首次错误（503 而非备选 429）', jBoth.message, '大模型接口返回 503，请稍后重试');
eq('主备皆挂 → 不回传上游错误体（detail 不在响应里）', 'detail' in jBoth, false);

// 主备皆 429 → 透传 429（上游配额/速率用尽），不再笼统 502。
// 旧版把 429 也归成 502，前端按「接口未就绪」重试 20 轮、耗三分钟才降级，
// 用户看到的是「接口暂未就绪」而非真实原因（2026-10-21 实测 Gemini 配额打满）。
gemQueue = [new Response('quota exceeded', { status: 429 }), new Response('quota exceeded', { status: 429 })];
gemCalls.length = 0;
const r429 = await postGem('gemini-3.8-flash');
const j429 = await r429.json();
eq('主备皆 429 → 状态码 429', r429.status, 429);
eq('主备皆 429 → 错误码 UPSTREAM_RATE_LIMITED', j429.error, 'UPSTREAM_RATE_LIMITED');
eq('主备皆 429 → 带 Retry-After', r429.headers.get('Retry-After'), '60');
eq('主备皆 429 → 仍先试过备选（降级不跳过）', gemCalls.length, 2);

// 非 gemini 供应商不做跨模型降级（无同族备选语义，防误伤 gpt/deepseek 错误透传）
gemQueue = [new Response('gpt down', { status: 500 })];
gemCalls.length = 0;
const rNoFb = await interpretPost({
  request: new Request('https://x/api/interpret', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ panText: '占测试', provider: 'gpt', model: 'gpt-6-luna' })
  }),
  env: { GPT_API_KEY: 'k', GPT_MODELS: 'gpt-6-luna' }
});
eq('非 gemini 供应商不降级（仅一次调用）', gemCalls.length, 1);
eq('非 gemini 失败原样 502', rNoFb.status, 502);

globalThis.fetch = origFetch;

// ---------- 上层契约：app.js 与 interpret.js 的 SYSTEM_PROMPT 必须同源 ----------
// 两份提示词是同一契约的两个副本（app.js 那份用于「复制请求内容手动断卦」的降级路径）。
// 任一侧漏改都会让「手动断卦」与「线上断卦」口径分叉，故此处逐段比对契约标记。
const CONTRACT_MARKS = ['【盘面事实不可改写】', '【主次次序】', '【追问沿用原盘】', '【现实边界】',
  '【法理口径】', '【多选一问法】', '【结论对齐】',
  // M21（2026-10-27）：前提与应期四段——缺项分级、应期同域、应期撤回，加通用槽位段。
  '【前提元数据】', '【缺项分级】', '【应期同域】', '【应期撤回】'];
const appSrc = readFileSync(new URL('./public/app.js', import.meta.url), 'utf8');
CONTRACT_MARKS.forEach(function (m) {
  eq('app.js 含契约段 ' + m, appSrc.indexOf(m) >= 0, true);
  eq('interpret.js SYSTEM_PROMPT 含契约段 ' + m, SYSTEM_PROMPT.indexOf(m) >= 0, true);
});
eq('两份提示词同引经据典口径', appSrc.indexOf('引经据典') >= 0 && SYSTEM_PROMPT.indexOf('引经据典') >= 0, true);
// 反向对照：契约段一旦被删，本组断言必须变红（防止断言写成恒真）
eq('对照：契约段总数应为 11', CONTRACT_MARKS.length, 11);

// 全文一致：上面的断言只查 4 个标记「各自存在」，两份提示词正文分叉（一侧多/少一段
// 说明、改了措辞）仍会全绿。这里从 app.js 源码取出数组字面量求值（纯字符串元素，
// 无副作用），与 interpret.js 的 SYSTEM_PROMPT 逐字符比对。
// 相比跨文件 import（app.js 是浏览器 IIFE，import 会缺 DOM），求值只依赖源码文本。
(function () {
  const head = 'const SYSTEM_PROMPT = [';
  const start = appSrc.indexOf(head);
  const end = appSrc.indexOf("].join('\\n');", start);
  if (start < 0 || end < 0) { eq('能从 app.js 提取 SYSTEM_PROMPT 数组', false, true); return; }
  const literal = appSrc.slice(start + 'const SYSTEM_PROMPT = '.length, end + 1);
  let appPrompt = null;
  try { appPrompt = new Function('return ' + literal + ".join('\\n')")(); } catch (e) { appPrompt = null; }
  eq('app.js 的 SYSTEM_PROMPT 可求值', typeof appPrompt, 'string');
  eq('两份 SYSTEM_PROMPT 全文逐字符一致', appPrompt, SYSTEM_PROMPT);
})();

// ---------- 前提预检兜底（M21） ----------
// 前端会在排盘文本里注入「【前提预检（…）】」块（core/premise.js 的确定性命中）。
// 直接用 API 打 /api/interpret 的调用方没有这一段，若服务端不补，缺项分级与应期同域
// 就只剩系统提示里的原则，模型容易退回「默认一个时间跨度」——正是 2026-10-27 那次
// 「跨年之事给日级应期」的复发路径。
{
  const seen = [];
  const origF = globalThis.fetch;
  globalThis.fetch = function (url, opt) {
    seen.push(JSON.parse(opt.body));
    return Promise.resolve(new Response(JSON.stringify({ choices: [{ message: { content: '结论：平' } }] }),
      { status: 200, headers: { 'content-type': 'application/json' } }));
  };
  const callPan = function (panText) {
    return interpretPost({
      request: new Request('https://x/api/interpret', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ panText: panText, provider: 'gpt', model: 'gpt-6-luna' })
      }),
      env: { GPT_API_KEY: 'k', GPT_MODELS: 'gpt-6-luna' }
    });
  };
  await callPan('【六爻排盘】所测：这事能成吗');
  const noPre = seen[0].messages[1].content;
  eq('缺预检块 → 服务端补兜底', noPre.indexOf('【前提预检 · 缺失】') >= 0, true);
  eq('兜底要求声明假设', noPre.indexOf('写明所设假设') >= 0, true);
  eq('兜底禁止无跨度给干支日', noPre.indexOf('不得给具体干支日') >= 0, true);
  await callPan('【六爻排盘】所测：这事能成吗\n【前提预检（规则链 · 非推断）】\n- 时间范围：题面「今年」');
  const withPre = seen[1].messages[1].content;
  eq('已带预检块 → 不重复追加', withPre.indexOf('【前提预检 · 缺失】'), -1);
  eq('已带预检块 → 原文保留', withPre.indexOf('题面「今年」') >= 0, true);
  globalThis.fetch = origF;
}

// ---------- #21 SSE 透传剥离 reasoning_content（2026-10-13） ----------
// 事故复盘：百炼思考模型把 reasoning_content（思考草稿）与 content（最终答案）
// 分字段返回，旧版 pipeMergedSSE 把两者一并拼接下传。草稿内含模型自己都不
// 采信的临时错判（实测：草稿写「世在四爻妻财庚辰」，正式稿实为「世在三爻」），
// 断后 fact-audit 对全文字面匹配 → 误报 6 处「与卦盘不符」的假阳性。
// 修复：正文只透传 content；草稿仅缓冲，整条流无 content 时才兜底补发。
eq('delta 取正文：content 原样透传', deltaText({ content: '世在三爻' }), '世在三爻');
eq('delta 取正文：reasoning_content 不透传', deltaText({ reasoning_content: '世在四爻妻财辰土？' }), '');
eq('delta 取正文：两者并存只取 content', deltaText({ reasoning_content: '草稿', content: '正文' }), '正文');
eq('delta 取正文：content 非字符串按空处理', deltaText({ content: 42 }), '');
eq('delta 取正文：空对象按空处理', deltaText({}), '');
eq('delta 取正文：null/undefined 不抛', deltaText(null) + '|' + deltaText(undefined), '|');
eq('delta 取草稿：reasoning_content 可取（供兜底）', deltaReasoning({ reasoning_content: '草稿' }), '草稿');
eq('delta 取草稿：content 不进草稿缓冲', deltaReasoning({ content: '正文' }), '');
// 反向对照：事故旧行为必须能被本组断言识别（防回归成旧版合并逻辑）
eq('对照：旧版合并逻辑会污染正文', (function () {
  const d = { reasoning_content: '世在四爻妻财辰土？', content: '世在三爻' };
  return (d.reasoning_content || '') + (d.content || '');
})(), '世在四爻妻财辰土？世在三爻');

// 端到端：mock「思考模型」上游——reasoning_content 与 content 分字段交替返回，
// 走完整 interpretPost → SSE 透传链路，断言客户端收到的流里只有正文。
globalThis.fetch = function () {
  const enc = new TextEncoder();
  const rows = [
    { choices: [{ delta: { reasoning_content: '世在四爻妻财辰土？' } }] },
    { choices: [{ delta: { content: '世在三爻' } }] },
    { choices: [{ delta: { reasoning_content: 'Wait，应在上爻？' } }] },
    { choices: [{ delta: { content: '妻财庚辰' } }] }
  ];
  const body = new ReadableStream({
    start: function (c) {
      rows.forEach(function (r) { c.enqueue(enc.encode('data: ' + JSON.stringify(r) + '\n')); });
      c.enqueue(enc.encode('data: [DONE]\n'));
      c.close();
    }
  });
  return Promise.resolve(new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }));
};
const rReas = await interpretPost({
  request: new Request('https://x/api/interpret', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ panText: '占测试', provider: 'gpt', model: 'gpt-6-luna' })
  }),
  env: ENV_GPT
});
const evReas = await readSSEEvents(rReas);
eq('端到端：思考模型流只透传正文', sseText(evReas), '世在三爻妻财庚辰');
eq('端到端：草稿不进入流内任何事件', evReas.some(function (e) {
  return typeof e.t === 'string' && (e.t.indexOf('妻财辰土？') >= 0 || e.t.indexOf('Wait') >= 0);
}), false);
eq('端到端：无 error 事件（正常完篇）', evReas.some(function (e) { return e.error; }), false);

// 端到端兜底：整条流只有 reasoning_content（个别中转把正文放思考字段）→ 流末补发
globalThis.fetch = function () {
  const enc = new TextEncoder();
  const body = new ReadableStream({
    start: function (c) {
      c.enqueue(enc.encode('data: ' + JSON.stringify({ choices: [{ delta: { reasoning_content: '只有草稿的流' } }] }) + '\n'));
      c.enqueue(enc.encode('data: [DONE]\n'));
      c.close();
    }
  });
  return Promise.resolve(new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }));
};
const rReasOnly = await interpretPost({
  request: new Request('https://x/api/interpret', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ panText: '占测试', provider: 'gpt', model: 'gpt-6-luna' })
  }),
  env: ENV_GPT
});
const evReasOnly = await readSSEEvents(rReasOnly);
eq('端到端兜底：纯草稿流末补发，不至空响应', sseText(evReasOnly), '只有草稿的流');

// 长草稿（>30 字符且无「结论：」行）必须触发完整性告警。
// 旧版兜底补发后 outLen 仍为 0，完整性检查被 outLen > 30 直接跳过 ——
// 实测 2026-10-21 线上：补全请求回 745 字符纯草稿、无任何 warn，
// 用户看到的是半截思考过程当断语。
const longDraft = '我们需要回答用户关于考试文书的问题，先看用神父母巳火在二爻发动，世爻子孙酉金得月建生助，';
globalThis.fetch = function () {
  const enc = new TextEncoder();          // encG 在后面才声明，这里用局部 encoder
  const body = new ReadableStream({
    start: function (c) {
      c.enqueue(enc.encode('data: ' + JSON.stringify({ choices: [{ delta: { reasoning_content: longDraft } }] }) + '\n\n'));
      c.close();
    }
  });
  return Promise.resolve(new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }));
};
const rDraft = await interpretPost({
  request: new Request('https://x/api/interpret', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ panText: '占测试', provider: 'gpt', model: 'gpt-6-luna' })
  }),
  env: ENV_GPT
});
const evDraft = await readSSEEvents(rDraft);
eq('长草稿仍会补发（不为空响应）', sseText(evDraft).indexOf('我们需要回答用户') >= 0, true);
eq('长草稿无结论行 → 触发 INCOMPLETE_STRUCTURE',
  evDraft.some(function (e) { return e.warn === 'INCOMPLETE_STRUCTURE'; }), true);
globalThis.fetch = origFetch;
globalThis.fetch = origFetch;

// ---------- #25 fact-audit 端到端回归探针（2026-10-13 草稿污染焊死） ----------
// 事故复盘：思考模型把 reasoning_content（草稿）与 content（正式稿）分字段返回，
// 旧版 pipeMergedSSE 把两者一并拼接下传。草稿里的临时错判（「四爻为妻财」）与
// 正式稿（「三爻为妻财」）自相矛盾，fact-audit 对全文字面匹配 → 撞出「六亲」假阳性，
// app.js 收到未 accepted 结果后把冲突回灌模型整篇重写。修复后正文只透传 content。
// 本组把「草稿污染 → fact-audit 假阳性」这条完整因果链端到端锁死：
//   正链路：mock 思考模型分字段流 → interpret 透传 → 拼接正文 → fact-audit 零假阳性；
//   反链路：手工还原旧版「草稿+正式稿拼接」→ fact-audit 必撞六亲冲突（证探针有咬合力）。
const nodeRequire = createRequire(import.meta.url);
const CORE = nodeRequire('./core.js');
// 天地否：世在三爻、三爻妻财卯木、四爻官鬼午火——与事故「四爻妻财↔三爻妻财」同构
const faPan = CORE.paipan([0, 0, 0, 1, 1, 1], new Date(2024, 2, 5, 12, 0));
eq('探针前置：天地否世在三爻', faPan.shi, 2);
eq('探针前置：天地否三爻为妻财', faPan.lines[2].lq, '妻财');
eq('探针前置：天地否四爻为官鬼（草稿写妻财即错）', faPan.lines[3].lq, '官鬼');

// 正链路：草稿「四爻为妻财」+ 正式稿「三爻为妻财」分字段返回
globalThis.fetch = function () {
  const enc = new TextEncoder();
  const rows = [
    { choices: [{ delta: { reasoning_content: '先看世爻，四爻为妻财辰土，取妻财为用。' } }] },
    { choices: [{ delta: { content: '三爻为妻财卯木，' } }] },
    { choices: [{ delta: { reasoning_content: '不对，世在三爻。' } }] },
    { choices: [{ delta: { content: '用神妻财得月建生扶。' } }] }
  ];
  const body = new ReadableStream({
    start: function (c) {
      rows.forEach(function (r) { c.enqueue(enc.encode('data: ' + JSON.stringify(r) + '\n')); });
      c.enqueue(enc.encode('data: [DONE]\n'));
      c.close();
    }
  });
  return Promise.resolve(new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }));
};
const rFaProbe = await interpretPost({
  request: new Request('https://x/api/interpret', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ panText: '占测试', provider: 'gpt', model: 'gpt-6-luna' })
  }),
  env: ENV_GPT
});
const evFaProbe = await readSSEEvents(rFaProbe);
const faText = sseText(evFaProbe);
eq('正链路：草稿「四爻为妻财」不入正文', faText.indexOf('四爻为妻财') < 0, true);
eq('正链路：正式稿「三爻为妻财」保留', faText.indexOf('三爻为妻财') >= 0, true);
eq('正链路：正文经 fact-audit 零假阳性（核心）', CORE.auditFactClaims(faText, faPan).accepted, true);

// 反链路：手工还原旧版「草稿+正式稿拼接」→ fact-audit 必撞六亲冲突
const faPolluted = '四爻为妻财辰土，取妻财为用。三爻为妻财卯木，用神妻财得月建生扶。';
const faPollutedAudit = CORE.auditFactClaims(faPolluted, faPan);
eq('反链路：旧版污染正文被 fact-audit 识别为冲突', faPollutedAudit.accepted, false);
eq('反链路：冲突类型为六亲（四爻妻财≠官鬼）', faPollutedAudit.errors.some(function (e) { return e.type === '六亲' && e.at === '四爻'; }), true);
globalThis.fetch = origFetch;

// ---------- #22 Google 原生流式（alt=sse）与 SSE 心跳（2026-10-17） ----------
// 事故复盘一：心跳写的是 releaseLock() 之后的 writer，write() 返回 rejected promise
// 被 .catch 静默吞掉 —— 15s 心跳从未发出，思考期的 524 防护等于不存在。
// 判别方式：原始响应里 ': ping' 的出现次数。旧版只有开头那一次（1），新版应 ≥2。
const encG = new TextEncoder();
let gemSseCalls = [];
globalThis.fetch = function (url) {
  gemSseCalls.push(url);
  const body = new ReadableStream({
    start: function (c) {
      c.enqueue(encG.encode('data: ' + JSON.stringify({ candidates: [{ content: { parts: [{ text: '水雷' }] } }] }) + '\n\n'));
      c.enqueue(encG.encode('data: ' + JSON.stringify({ candidates: [{ content: { parts: [{ text: '屯' }] } }] }) + '\n\n'));
      c.close();
    }
  });
  return Promise.resolve(new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }));
};
const rGs = await postGem('gemini-3.6-flash');
const evGs = await readSSEEvents(rGs);
eq('Google 原生流式：正文逐段拼接', sseText(evGs), '水雷屯');
eq('Google 原生流式：走 streamGenerateContent?alt=sse',
  gemSseCalls[0].indexOf(':streamGenerateContent?alt=sse') >= 0, true);
eq('Google 原生流式：无 error 事件（正常完篇）', evGs.some(function (e) { return e.error; }), false);

// 心跳：上游首块后静默 1.4s，心跳间隔压到 1s（SSE_HEARTBEAT_MS 下限）。
globalThis.fetch = function () {
  const body = new ReadableStream({
    start: function (c) {
      c.enqueue(encG.encode(sseLine('甲')));
      setTimeout(function () { c.enqueue(encG.encode(sseLine('乙'))); c.close(); }, 1400);
    }
  });
  return Promise.resolve(new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }));
};
const rPing = await post(Object.assign({ SSE_HEARTBEAT_MS: '1000' }, ENV_GPT));
const rawPing = await rPing.text();
const pingCount = rawPing.split(': ping').length - 1;
eq('心跳真实写出：初始 ping + 周期 ping ≥ 2（旧版只有 1）', pingCount >= 2, true);
eq('心跳不影响正文完整性', rawPing.indexOf('甲') >= 0 && rawPing.indexOf('乙') >= 0, true);

/* 慢路径心跳（2026-10-28）。旧版 openSession 用 `new TransformStream()` + `await w.write()`：
   readable 侧 HWM=0，正文一次写入悬住，心跳与看门狗的错误帧就全排在同一个 writer 后面。
   线上指纹是「只收到开头那一帧 : ping，200~330s 里没有任何帧」，随后客户端 45s 判死 abort，
   服务端记 499。这里强制走「先建 SSE 再等上游」的慢路径（LLM_FAST_HEADER_MS=1），
   让上游 2.5s 才吐首块，断言等待期心跳仍在持续。 */
globalThis.fetch = function () {
  const body = new ReadableStream({
    start: function (c) {
      setTimeout(function () { c.enqueue(encG.encode(sseLine('甲'))); }, 2500);
      setTimeout(function () { c.enqueue(encG.encode(sseLine('乙'))); c.close(); }, 2900);
    }
  });
  return Promise.resolve(new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }));
};
const rPingSlow = await post(Object.assign({ SSE_HEARTBEAT_MS: '500', LLM_FAST_HEADER_MS: '1' }, ENV_GPT));
const rawSlow = await rPingSlow.text();
const slowPingCount = rawSlow.split(': ping').length - 1;
eq('慢路径：首字节等待期心跳持续（≥3 帧，旧版只 1 帧）', slowPingCount >= 3, true);
eq('慢路径：首字节到达后正文完整', rawSlow.indexOf('甲') >= 0 && rawSlow.indexOf('乙') >= 0, true);

// ---------- #23 排盘超限 413 与客户端断开（2026-10-17） ----------
// 旧版对 panText 静默 slice(0, 4000)，盘面尾巴被砍掉而模型照断、服务端无痕迹。
globalThis.fetch = origFetch;
const rLong = await interpretPost({
  request: new Request('https://x/api/interpret', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ panText: '甲'.repeat(4001), provider: 'gpt', model: 'gpt-6-luna' })
  }),
  env: ENV_GPT
});
eq('排盘文本超限 → 413（不再静默截断）', rLong.status, 413);
eq('排盘文本超限 → PAN_TOO_LONG', (await rLong.json()).error, 'PAN_TOO_LONG');

// 客户端断开：request.signal 必须传导到上游 fetch。
// 判别方式：断开后响应流应「立刻」收尾；旧版不监听 request.signal，流会挂到 300s 硬超时。
let upstreamCtl = null;
globalThis.fetch = function (url, opts) {
  const body = new ReadableStream({
    start: function (c) { upstreamCtl = c; c.enqueue(encG.encode(sseLine('甲'))); }
  });
  if (opts && opts.signal) {
    opts.signal.addEventListener('abort', function () {
      try { upstreamCtl.error(new Error('aborted by client')); } catch (e) { /* 已关闭 */ }
    });
  }
  return Promise.resolve(new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }));
};
const ac = new AbortController();
const rAbort = await interpretPost({
  request: new Request('https://x/api/interpret', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ panText: '占测试', provider: 'gpt', model: 'gpt-6-luna' }),
    signal: ac.signal
  }),
  env: ENV_GPT
});
const abortTextP = rAbort.text();
setTimeout(function () { ac.abort(); }, 60);
const raced = await Promise.race([
  abortTextP,
  new Promise(function (res) { setTimeout(function () { res('__HANG__'); }, 2000); })
]);
eq('客户端断开 → 流立即收尾（旧版会挂到 300s）', raced !== '__HANG__', true);
globalThis.fetch = origFetch;

// ---------- #24 网关缓存跳过 与 finishReason 截断告知（2026-10-21） ----------
// 实测 liuyao-gw 在网关 cache_ttl=0 下仍有 27/40 条 cached:true：缓存键是
// provider+endpoint+model+鉴权头+整个请求体的 SHA-256，故同一盘同一问重发必命中。
// 后果有二：① 评测拿不到独立样本；② 截断/失败响应会被一并固化。
// skipCache 只影响上游缓存头，不改任何生成参数。
let gwOpts = null, gwUrl = '';
globalThis.fetch = function (url, opts) {
  gwUrl = String(url);
  gwOpts = opts;
  const body = new ReadableStream({ start: function (c) { c.enqueue(encG.encode(sseLine('甲'))); c.close(); } });
  return Promise.resolve(new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }));
};
// 2026-10-29 起 DeepSeek 走官方直连、网关地址被忽略，故网关头用例改由 GPT 承载
// （GPT_BASE_URL 指网关仍会加 cf-aig-*）；DeepSeek 侧另有「直连」专项断言在后。
const GW_BASE = 'https://gateway.ai.cloudflare.com/v1/acc/gw';
const envGw = {
  GPT_API_KEY: 'k',
  GPT_MODELS: 'gpt-6-luna',
  GPT_BASE_URL: GW_BASE + '/openai'
};
const postDS = function (extra, envOverride) {
  return interpretPost({
    request: new Request('https://x/api/interpret', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(Object.assign({ panText: '占测试', model: 'gpt-6-luna' }, extra || {}))
    }),
    env: Object.assign({}, envGw, envOverride || {})
  });
};
await (await postDS({})).text();
eq('首轮断卦默认跳过缓存（防残篇被固化）', gwOpts.headers['cf-aig-skip-cache'], 'true');
eq('走网关仍带超时头（未破坏既有网关头）', String(gwOpts.headers['cf-aig-request-timeout']).length > 0, true);
// 追问：body 含 messages，与首轮不同键，本就不会命中缓存 → 不必跳过
await (await postDS({ messages: [{ role: 'user', content: '那应期呢' }] })).text();
eq('追问默认仍吃缓存', gwOpts.headers['cf-aig-skip-cache'], undefined);
// 回退开关：设了 LLM_CACHE_FIRST=1 就恢复「首轮也吃缓存」的旧行为
await (await postDS({}, { LLM_CACHE_FIRST: '1' })).text();
eq('LLM_CACHE_FIRST=1 恢复旧行为（首轮吃缓存）', gwOpts.headers['cf-aig-skip-cache'], undefined);
await (await postDS({ skipCache: true })).text();
eq('skipCache:true → 透传 cf-aig-skip-cache', gwOpts.headers['cf-aig-skip-cache'], 'true');
await (await postDS({ skip_cache: true })).text();
eq('skip_cache 别名同样生效', gwOpts.headers['cf-aig-skip-cache'], 'true');

// ---------- DeepSeek 官方直连（2026-10-29 用户要求不走 CF AI Gateway） ----------
// 关键点：线上 DEEPSEEK_BASE_URL 这个 secret 里躺的还是网关地址，只改代码默认值
// 不改 secret 就会静默继续走网关，故代码必须主动忽略 gateway.ai.cloudflare.com。
const postDeepseek = function (dsBase, model) {
  return interpretPost({
    request: new Request('https://x/api/interpret', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ panText: '占测试', model: model || 'deepseek-flash' })
    }),
    env: { DEEPSEEK_API_KEY: 'k', DEEPSEEK_BASE_URL: dsBase }
  });
};
await (await postDeepseek(GW_BASE + '/deepseek')).text();
eq('DeepSeek 忽略遗留网关地址，直连官方端点', gwUrl, 'https://api.deepseek.com/v1/chat/completions');
eq('DeepSeek 直连不带 cf-aig 超时头', gwOpts.headers['cf-aig-request-timeout'], undefined);
eq('DeepSeek 直连不带 cf-aig 缓存头', gwOpts.headers['cf-aig-skip-cache'], undefined);
await (await postDeepseek('')).text();
eq('DEEPSEEK_BASE_URL 未设 → 同样直连官方端点', gwUrl, 'https://api.deepseek.com/v1/chat/completions');
await (await postDeepseek('https://relay.example.com/v1/')).text();
eq('非网关的自定义地址（自建中转）仍生效', gwUrl, 'https://relay.example.com/v1/chat/completions');

// finishReason：上游以 MAX_TOKENS 收尾时必须显式告警，不得当完整断语交付。
// 实测 gemini-3.6-flash 稳定停在 405 tokens、正文断在句中且无「结论：」行，
// 旧版完全不读 finishReason，半个断语被当成完整答案（且会被网关缓存固化）。
globalThis.fetch = function () {
  const body = new ReadableStream({
    start: function (c) {
      c.enqueue(encG.encode('data: ' + JSON.stringify({ candidates: [{ content: { parts: [{ text: '半个断语' }] }, finishReason: 'MAX_TOKENS' }] }) + '\n\n'));
      c.close();
    }
  });
  return Promise.resolve(new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }));
};
const evTrunc = await readSSEEvents(await postGem('gemini-3.6-flash'));
eq('finishReason=MAX_TOKENS → 正文仍照常下发', sseText(evTrunc), '半个断语');
eq('finishReason=MAX_TOKENS → 发出 warn 事件', evTrunc.some(function (e) { return e.warn === 'MODEL_MAX_TOKENS'; }), true);
eq('截断不写成 error（不应触发重试）', evTrunc.some(function (e) { return e.error; }), false);

globalThis.fetch = function () {
  const body = new ReadableStream({
    start: function (c) {
      c.enqueue(encG.encode('data: ' + JSON.stringify({ candidates: [{ content: { parts: [{ text: '一、卦象要点：用神父母巳火二爻发动。\n二、断吉凶：旺衰相半。\n三、应期：甲戌日。\n四、白话总结：可为辅助。\n结论：平' }] }, finishReason: 'STOP' }] }) + '\n\n'));
      c.close();
    }
  });
  return Promise.resolve(new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }));
};
const evStop = await readSSEEvents(await postGem('gemini-3.6-flash'));
eq('finishReason=STOP 且结论行齐全 → 不告警（反向对照）', evStop.some(function (e) { return e.warn; }), false);

/* 2026-10-28：finish 缺失（流自然结束、上游什么都没说）必须告警。
   线上形状：DeepSeek 思考 10.2k 字后正文写到「用神」一行就没了，finish_reason 一路为
   null，旧版据此判「完美完篇」，一条告警都不发——用户拿半篇当断语。 */
globalThis.fetch = function () {
  const body = new ReadableStream({
    start: function (c) {
      c.enqueue(encG.encode('data: ' + JSON.stringify({ choices: [{ delta: { content: '一、卦象要点：世在三爻。\n结论：平\n应期：戌日\n验证标志：对方来电\n用神：妻财庚辰（三爻）\n' } }] }) + '\n\n'));
      c.close();
    }
  });
  return Promise.resolve(new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }));
};
const evNoFinish = await readSSEEvents(await postDS({ skip_cache: true }));
eq('finish 缺失 → 发出 MODEL_NO_FINISH（结论行齐全也要报）',
  evNoFinish.some(function (e) { return e.warn === 'MODEL_NO_FINISH'; }), true);
eq('finish 缺失不写成 error（不是网络问题，不该触发重试）',
  evNoFinish.some(function (e) { return e.error; }), false);

/* 2026-10-28：只有 reasoning_content、没有 content 时，兜底补发的那段是**草稿**，
   必须打 draft 标记 + DRAFT_ONLY 告警。旧版原样当正文下发，10.2k 字独白被渲染成断语，
   且客户端「只想不答」守卫（text 为空才算）因此永远不可达。 */
globalThis.fetch = function () {
  const body = new ReadableStream({
    start: function (c) {
      c.enqueue(encG.encode('data: ' + JSON.stringify({ choices: [{ delta: { reasoning_content: '我先核盘：世在三爻，用神取妻财……' } }] }) + '\n\n'));
      c.close();
    }
  });
  return Promise.resolve(new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }));
};
const evDraftOnly = await readSSEEvents(await postDS({ skip_cache: true }));
const draftFrame = evDraftOnly.filter(function (e) { return typeof e.t === 'string'; })[0] || {};
eq('纯草稿兜底 → 补发的正文帧带 draft:true', draftFrame.draft, true);
eq('纯草稿兜底 → 发出 DRAFT_ONLY 告警',
  evDraftOnly.some(function (e) { return e.warn === 'DRAFT_ONLY'; }), true);

// 上游静默挂死（2026-10-28）：流开了头、吐了思考，然后既不发字节也不 close。
// 实测 deepseek-flash 的形态：4KB 思考后整条流彻底静默，连 r.done 都收不到；
// 而服务端每 15s 的 `: ping` 心跳会让客户端那条「无输出超时」永远续命，
// 只能干等到 330s 硬顶。必须由服务端按「上游多少秒没有字节」独立判死。
globalThis.fetch = function () {
  const body = new ReadableStream({
    start: function (c) {
      c.enqueue(encG.encode('data: ' + JSON.stringify({ choices: [{ index: 0, delta: { reasoning_content: '先核盘' }, finish_reason: null }] }) + '\n\n'));
      // 故意不 close、不再 enqueue：模拟上游挂死
    }
  });
  return Promise.resolve(new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }));
};
const evStall = await readSSEEvents(await postDS({ skip_cache: true }, { UPSTREAM_IDLE_MS: '1000' }));
eq('上游静默超时 → 下发 UPSTREAM_STALL（不再等客户端硬顶）',
  evStall.some(function (e) { return e.error === 'UPSTREAM_STALL'; }), true);
eq('上游静默超时 → 不把半截草稿补发成正文',
  evStall.some(function (e) { return typeof e.t === 'string'; }), false);

// STOP 但缺「结论：」行 —— 上游自称停得正常，产物却没成形。
// 实测 gemini-3.6-flash：137 tokens / 3 秒 / success:true / finishReason=STOP，
// 正文断在句中。finishReason 守卫覆盖不到这类，必须靠结构化完整性判定。
globalThis.fetch = function () {
  const body = new ReadableStream({
    start: function (c) {
      c.enqueue(encG.encode('data: ' + JSON.stringify({ candidates: [{ content: { parts: [{ text: '一、卦象要点：用神父母巳火二爻发动，世爻子孙酉金得月建生扶。\n二、断吉凶：旺衰相半，未可遽断。\n三、应期：' }] }, finishReason: 'STOP' }] }) + '\n\n'));
      c.close();
    }
  });
  return Promise.resolve(new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }));
};
const evNoStruct = await readSSEEvents(await postGem('gemini-3.6-flash'));
eq('STOP 但缺结论行 → INCOMPLETE_STRUCTURE 告警',
  evNoStruct.some(function (e) { return e.warn === 'INCOMPLETE_STRUCTURE'; }), true);
globalThis.fetch = origFetch;

// generationConfig 变体对照（2026-10-21）：A=thinkingBudget:0，B=不传 thinkingConfig，
// C=不传 + maxOutputTokens 8192。仅在 LLM_DEBUG_VARIANTS=1 时接受 body.variant。
let gwBody = null;
globalThis.fetch = function (url, opts) {
  gwBody = opts && opts.body ? JSON.parse(opts.body) : null;
  const body = new ReadableStream({ start: function (c) { c.enqueue(encG.encode(sseLine('甲'))); c.close(); } });
  return Promise.resolve(new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }));
};
const postVar = function (variant, env) {
  return interpretPost({
    request: new Request('https://x/api/interpret', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ panText: '占测试', model: 'gemini-3.6-flash', variant: variant })
    }),
    env: Object.assign({ GEMINI_API_KEY: 'k' }, env || {})
  });
};
await (await postVar('A', { LLM_DEBUG_VARIANTS: '1' })).text();
eq('变体 A → thinkingBudget 为 0', gwBody.generationConfig.thinkingConfig.thinkingBudget, 0);
eq('变体 A → 不设 maxOutputTokens', gwBody.generationConfig.maxOutputTokens, undefined);
await (await postVar('B', { LLM_DEBUG_VARIANTS: '1' })).text();
eq('变体 B → 不传 thinkingConfig', gwBody.generationConfig.thinkingConfig, undefined);
eq('变体 B → 不设 maxOutputTokens', gwBody.generationConfig.maxOutputTokens, undefined);
await (await postVar('C', { LLM_DEBUG_VARIANTS: '1' })).text();
eq('变体 C → 不传 thinkingConfig', gwBody.generationConfig.thinkingConfig, undefined);
eq('变体 C → maxOutputTokens 给足 8192', gwBody.generationConfig.maxOutputTokens, 8192);
await (await postVar('B', {})).text();
// M24：生产口径走 policy.thinkBudget（gemini 默认 0 = 关思考，见 2026-10-28 线上 A/B 实测）。
eq('未开调试开关 → 变体参数被忽略，走生产口径（关思考）',
  gwBody.generationConfig.thinkingConfig.thinkingBudget, 0);
await (await postVar('A', { GEMINI_THINKING_BUDGET: '-1' })).text();
eq('显式 GEMINI_THINKING_BUDGET=-1 → 动态思考（不传 thinkingConfig）',
  gwBody.generationConfig.thinkingConfig, undefined);
const rVarEcho = await postVar('B', { LLM_DEBUG_VARIANTS: '1' });
const evVarEcho = await readSSEEvents(rVarEcho);
eq('变体回显事件（证明配置真生效）', evVarEcho.some(function (e) { return e.variant === 'B'; }), true);
globalThis.fetch = origFetch;

// ---------- #24 按盘 OG 预览（functions/index.js + functions/api/_share.js）----------
// 资产桩返回真实 public/index.html：锚点正则契约直接对着部署产物钉，index.html 结构
// 一变（锚点缺失）本组即转红，而不是对着一份测试专用假 head 自证。
const LYcore = (await import('./core.js')).default;
const ogHtml = readFileSync('public/index.html', 'utf8');
const OG_ETAG = 'W/"og-stub"';
function ogCtx(path, assetHtml) {
  return {
    request: new Request('https://x.test' + path),
    env: { ASSETS: { fetch: function () {
      return Promise.resolve(new Response(assetHtml || ogHtml, { status: 200, headers: {
        'content-type': 'text/html; charset=utf-8',
        'etag': OG_ETAG,
        'last-modified': 'Sat, 24 Oct 2026 00:00:00 GMT'
      } }));
    } } },
    next: function () { return Promise.resolve(new Response('__NEXT__')); }
  };
}
function ogMeta(html, prop) {
  const m = html.match(new RegExp('<meta property="' + prop + '" content="([^"]*)">'));
  return m ? m[1] : null;
}
function ogTitle(html) {
  const m = html.match(/<title>([^<]*)<\/title>/);
  return m ? m[1] : null;
}

// 测试向量（占时均为北京墙上 2026-10-24 8:30，期望值经 core.js 实算钉死）：
//   [1,0,9,6,1,1] 动爻 → 风火家人 之 天雷无妄；[1,0,1,1,0,1] 静卦 → 离为火（静卦）
const OG_DT = new Date(2026, 9, 24, 8, 30);
OG_DT.__wall = { y: 2026, m: 10, d: 24, h: 8, min: 30 };
const ogCode = LYcore.encodeCast({ time: OG_DT, vals: [1, 0, 9, 6, 1, 1], use: '妻财', question: '这个项目能不能成' });
const OG_TITLE1 = '风火家人 之 天雷无妄 · 丙午年 戊戌月 辛未日 壬辰时';
const OG_DESC1 = '所测：这个项目能不能成；用神：妻财；起卦于 2026-10-24 8:30（北京时间）';

// 合法码：四锚点（og:title / og:description / <title> 三处改写 + og:site_name 结构守卫）
const r1 = await ogGet(ogCtx('/?s=' + encodeURIComponent(ogCode)));
const h1 = await r1.text();
eq('合法码 → 200（不 500）', r1.status, 200);
eq('合法码 → og:title 按盘改写', ogMeta(h1, 'og:title'), OG_TITLE1);
eq('合法码 → <title> 同步改写', ogTitle(h1), OG_TITLE1);
eq('合法码 → og:description 按盘改写', ogMeta(h1, 'og:description'), OG_DESC1);
eq('合法码 → og:site_name 守卫锚保持默认', ogMeta(h1, 'og:site_name'), '莲斋 · 六爻');
eq('合法码 → og:type 不动', ogMeta(h1, 'og:type'), 'website');
eq('/twitter:card 保持 summary（无图文本卡）', /<meta name="twitter:card" content="summary">/.test(h1), true);
eq('合法码 → description ≤ 200 字符兜底', ogMeta(h1, 'og:description').length <= 200, true);
// 改写响应头：删 etag/last-modified（体已变，原 ETag 必失配），短缓存 + Content-Type 保留
eq('改写后 etag 已删', r1.headers.get('etag'), null);
eq('改写后 last-modified 已删', r1.headers.get('last-modified'), null);
eq('改写后 cache-control 为 300s', r1.headers.get('cache-control'), 'public, max-age=300');
eq('改写后 Content-Type 保留', (r1.headers.get('content-type') || '').indexOf('text/html') >= 0, true);

// 静卦标题口径：与 app.js 同构（benName + '（静卦）'），四柱尾巴照带
const ogStaticCode = LYcore.encodeCast({ time: OG_DT, vals: [1, 0, 1, 1, 0, 1], use: '', question: '' });
const rSt = await ogGet(ogCtx('/?s=' + ogStaticCode));
const hSt = await rSt.text();
eq('静卦 → og:title 为「本卦（静卦）· 四柱」', ogMeta(hSt, 'og:title'),
  '离为火（静卦） · 丙午年 戊戌月 辛未日 壬辰时');

// 旧格式码（三段最小形态 1.<占时>.<六爻>，无用神/所测字段）：decoder 按可选组放行，OG 照常改写
const ogOldCode = ogStaticCode.replace(/\.-$/, '');
eq('旧格式码构造自证（确为三段）', ogOldCode.split('.').length, 3);
eq('旧格式码 decode 放行', LYcore.decodeCast(ogOldCode).ok, true);
const rOld = await ogGet(ogCtx('/?s=' + ogOldCode));
const hOld = await rOld.text();
eq('旧格式码 → og:title 照常改写', ogMeta(hOld, 'og:title'),
  '离为火（静卦） · 丙午年 戊戌月 辛未日 壬辰时');
eq('旧格式码 → 无所测显示（未注明）', ogMeta(hOld, 'og:description'),
  '所测：（未注明）；用神：未取；起卦于 2026-10-24 8:30（北京时间）');

// 畸形码：原样回落站点默认 meta（200，流式透传，原 etag 保留，不加改写缓存头）
const rBad = await ogGet(ogCtx('/?s=' + encodeURIComponent('999.zzzz.!!!!')));
const hBad = await rBad.text();
eq('畸形码 → 200（不 500 / 不 404）', rBad.status, 200);
eq('畸形码 → og:title 为站点默认', ogMeta(hBad, 'og:title'), '六爻排盘 · 莲斋');
eq('畸形码 → <title> 为站点默认', ogTitle(hBad), '六爻排盘 · 莲斋');
eq('畸形码 → 资产原样透传（etag 保留）', rBad.headers.get('etag'), OG_ETAG);
eq('畸形码 → 不加改写缓存头', rBad.headers.get('cache-control'), null);

// 空参 / 无参：直达资产层（context.next()），零解码开销
eq('空参 ?s= → context.next() 直通', await (await ogGet(ogCtx('/?s='))).text(), '__NEXT__');
eq('无 s 参数 → context.next() 直通', await (await ogGet(ogCtx('/'))).text(), '__NEXT__');

// question 是用户输入：属性转义完整（无裸引号/尖括号），$& 等替换模式不被展开
const ogEscCode = LYcore.encodeCast({ time: OG_DT, vals: [1, 0, 9, 6, 1, 1], use: '__custom__',
  question: '"><script>alert(1)</script>靠谱吗' });
const rEsc = await ogGet(ogCtx('/?s=' + encodeURIComponent(ogEscCode)));
const hEsc = await rEsc.text();
const descEsc = ogMeta(hEsc, 'og:description');
eq('转义 → og:description 属性仍完整可解析', descEsc !== null, true);
eq('转义 → 无裸双引号/尖括号进入属性', /["<>]/.test(descEsc.replace(/&(quot|lt|gt);/g, '')), false);
eq('转义 → script 标签被实体化', descEsc.indexOf('&lt;script&gt;') >= 0, true);
eq('转义 → __custom__ 用神显示为「自定义」', descEsc.indexOf('用神：自定义') >= 0, true);
const ogDollarCode = LYcore.encodeCast({ time: OG_DT, vals: [1, 0, 9, 6, 1, 1], use: '',
  question: '花$&钱$1行吗' });
const rDollar = await ogGet(ogCtx('/?s=' + encodeURIComponent(ogDollarCode)));
// 期望串含 &amp;（esc 转义）且 $&/$1 保持字面（替换用函数形式，未被当作替换模式展开）
eq('替换用函数形式 → $& 字面保留', (await rDollar.text()).indexOf('所测：花$&amp;钱$1行吗') >= 0, true);

// 防漂移：门面不得私藏第二份解码实现——与 core.js 聚合入口取到的必须是同一函数引用
eq('_share 门面与 core.js 的 decodeCast 为同一引用', facadeDecode === LYcore.decodeCast, true);

// 断语零通道（物理性）：OG 侧两个文件的 import 白名单封闭为五个确定性模块 + 门面，
// analyze / yingqi-window / sensitive 等判读层不得出现在依赖里
function importSpecs(src) {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const stmts = code.match(/import\s[^;]*?from\s*['"][^'"]+['"]|import\s*['"][^'"]+['"]/g) || [];
  return stmts.map(function (st) {
    const m = st.match(/['"]([^'"]+)['"]/);
    return m ? m[1] : '';
  });
}
const ogSrcs = { 'functions/index.js': readFileSync('functions/index.js', 'utf8'),
  'functions/api/_share.js': readFileSync('functions/api/_share.js', 'utf8') };
const ALLOWED_BASE = { 'data.js': 1, 'data-jieqi.js': 1, 'calendar.js': 1, 'paipan.js': 1, 'share.js': 1, '_share.js': 1 };
const FORBIDDEN = /analyze|yingqi-window|sensitive|domain-methods|question-shape|fact-audit|interpret|records|models/;
let allSpecs = [];
Object.keys(ogSrcs).forEach(function (f) {
  const specs = importSpecs(ogSrcs[f]);
  eq(f + ' 含 import 语句', specs.length > 0, true);
  specs.forEach(function (sp) {
    const base = sp.split('/').pop();
    eq(f + ' ← ' + sp + ' 在白名单内', !!ALLOWED_BASE[base], true);
    eq(f + ' ← ' + sp + ' 不属断语/AI 层', FORBIDDEN.test(sp), false);
  });
  allSpecs = allSpecs.concat(specs);
});
eq('白名单只有五种确定性模块 + 门面', Object.keys(ogSrcs).length >= 1 && allSpecs.length >= 6, true);

// 全或无：任一锚点缺失 → 放弃改写、原样返回（不 500、etag 保留）
const brokenHtml = ogHtml.replace(/<meta property="og:site_name"[^>]*>\n/, '');
const rBroken = await ogGet(ogCtx('/?s=' + encodeURIComponent(ogCode), brokenHtml));
const hBroken = await rBroken.text();
eq('锚点缺失 → 200 回退原样（不 500）', rBroken.status, 200);
eq('锚点缺失 → og:title 保持默认', ogMeta(hBroken, 'og:title'), '六爻排盘 · 莲斋');
eq('锚点缺失 → 原样响应头（etag 保留）', rBroken.headers.get('etag'), OG_ETAG);

// ---------- #25 readings 回访闭环（M18·任务⑦，docs/proposal-readings-loop.md） ----------
const BL_OK = { yongshen: '妻财 妻财卯木', trend: '吉', confidence: '中', spread: 2,
  window: { status: 'ok', lo: 2, hi: 4, dayLo: '癸未', dayHi: '乙酉', text: '应期：出空之日' } };
const BL_BLOCKED = { yongshen: '', trend: '', confidence: '', spread: null,
  window: { status: 'blocked', blockedBy: ['no_yongshen'], text: '拒答' } };

// ① 派生：window ok + 合法 datetime → INSERT OR IGNORE，due_at = 日期 + (hi+1) 日
const dbRd = mkDb();
await postRaw('', { panText: '排盘', tosses: [], messages: [], datetime: '2026-10-01 10:00:00', baseline: BL_OK },
  { 'X-Access-Code': 'k' }, { LIUYAO_DB: dbRd, LIB_CODE: 'k' });
const rdSqlIdx = dbRd.state.sqls.findIndex(function (s) { return s.indexOf('INSERT OR IGNORE INTO readings') >= 0; });
eq('主 POST 后追加回访派生写入', rdSqlIdx >= 0, true);
eq('派生 SQL 为 INSERT OR IGNORE（幂等）', dbRd.state.sqls[rdSqlIdx].indexOf('OR IGNORE') >= 0, true);
eq('due_at = 占问日 + (hi+1) 日（10-01 + 5 = 10-06）', dbRd.state.bound[rdSqlIdx][1], '2026-10-06');
eq('note 带「当时判据预计」前缀（预判不预填）', dbRd.state.bound[rdSqlIdx][2].indexOf('当时判据预计') === 0, true);
eq('note 不含回填值口径（d3 字样不出现）', dbRd.state.bound[rdSqlIdx][2].indexOf('d3') < 0, true);

// ② blocked baseline / 缺 datetime / 无 baseline → 一律不派生（宁缺勿造）
const dbNo1 = mkDb();
await postRaw('', { panText: '排盘', tosses: [], messages: [], datetime: '2026-10-01 10:00:00', baseline: BL_BLOCKED },
  { 'X-Access-Code': 'k' }, { LIUYAO_DB: dbNo1, LIB_CODE: 'k' });
eq('blocked baseline 不派生', dbNo1.state.sqls.some(function (s) { return s.indexOf('readings') >= 0; }), false);
const dbNo2 = mkDb();
await postRaw('', { panText: '排盘', tosses: [], messages: [], baseline: BL_OK },
  { 'X-Access-Code': 'k' }, { LIUYAO_DB: dbNo2, LIB_CODE: 'k' });
eq('缺 datetime 不派生（日期不可信即不猜）', dbNo2.state.sqls.some(function (s) { return s.indexOf('readings') >= 0; }), false);
const dbNo3 = mkDb();
await postRaw('', { panText: '排盘', tosses: [], messages: [] }, { 'X-Access-Code': 'k' }, { LIUYAO_DB: dbNo3, LIB_CODE: 'k' });
eq('无 baseline 不派生（历史行为不变）', dbNo3.state.sqls.some(function (s) { return s.indexOf('readings') >= 0; }), false);

// ④ 入库回执（2026-10-29 修）：POST 返回体须回显判据与回访状态。
//    线上 20 卦 0 判据、readings 表 0 行长期不可见，根因之一就是旧版只回 {id}——
//    「存进去了」与「存进去但事后无法统计」在客户端完全同形，前端无从提示。
const dbEcho = mkDb();
const rEcho = await postRaw('', { panText: '排盘', tosses: [], messages: [], datetime: '2026-10-01 10:00:00', baseline: BL_OK },
  { 'X-Access-Code': 'k' }, { LIUYAO_DB: dbEcho, LIB_CODE: 'k' });
const jEcho = await rEcho.json();
eq('回执带 hasBaseline=true', jEcho.hasBaseline, true);
eq('回执带 reading=派生日（10-06）', jEcho.reading, '2026-10-06');
const rEcho2 = await postRaw('', { panText: '排盘', tosses: [], messages: [] },
  { 'X-Access-Code': 'k' }, { LIUYAO_DB: mkDb(), LIB_CODE: 'k' });
const jEcho2 = await rEcho2.json();
eq('无判据时回执 hasBaseline=false', jEcho2.hasBaseline, false);
eq('无判据时回执 reading=null', jEcho2.reading, null);
eq('回执仍保留 id（旧客户端不受影响）', typeof jEcho2.id, 'string');

// ③ 回填成功 → 任务置 acted；显式清除回执不触发
const dbAct = mkDb();
await postRaw('?outcome=1', { id: 'ok-1', outcome: { result: 'success', yingqi: 'on_time', window: 'd3' } },
  { 'X-Access-Code': 'k' }, { LIUYAO_DB: dbAct, LIB_CODE: 'k' });
const actSql = dbAct.state.sqls.filter(function (s) { return s.indexOf("UPDATE readings SET status = 'acted'") >= 0; });
eq('回填成功后派生任务置 acted', actSql.length, 1);
eq('acted 更新只针对 pending 且绑定 cast_id', actSql[0].indexOf("status = 'pending'") >= 0 && dbAct.state.bound[dbAct.state.bound.length - 1][1] === 'ok-1', true);
const dbClear = mkDb();
await postRaw('?outcome=1', { id: 'ok-1', outcome: null }, { 'X-Access-Code': 'k' }, { LIUYAO_DB: dbClear, LIB_CODE: 'k' });
eq('清除回执不关闭任务', dbClear.state.sqls.some(function (s) { return s.indexOf('UPDATE readings') >= 0; }), false);

// ④ /api/readings GET：口令同源、禁 SELECT *、due_at 过滤
const rdGet = function (headers, env) {
  return readingsGet({ request: new Request('https://x/api/readings', { headers: headers || {} }), env: env || { LIUYAO_DB: mkDb(), LIB_CODE: 'k' } });
};
eq('readings GET 无口令 → 401', (await rdGet()).status, 401);
const dbRg = mkDb();
dbRg.state.rows = [{ id: 'r1', cast_id: 'ok-1', due_at: '2026-10-06', note: 'n', question: '测事', hex: '乾为天' }];
const rRg = await rdGet({ 'X-Access-Code': 'k' }, { LIUYAO_DB: dbRg, LIB_CODE: 'k' });
eq('readings GET 带口令 → 200', rRg.status, 200);
eq('readings SQL 禁 SELECT *（正文不下发）', dbRg.state.sqls[0].indexOf('SELECT *') < 0 && dbRg.state.sqls[0].indexOf('pan_text') < 0, true);
eq('readings SQL 按到期日过滤（due_at <= 北京今天）', /r\.due_at <= \?/.test(dbRg.state.sqls[0]) && dbRg.state.bound[0][0] === beijingToday(), true);
const rRgBody = await rRg.json();
eq('到期任务下发 question/hex 供辨认', rRgBody.tasks[0].question === '测事' && rRgBody.tasks[0].hex === '乾为天', true);

// ⑤ /api/readings POST dismissed：口令、白名单、pending 限定
const rdPost = function (body, headers, env) {
  return readingsPost({
    request: new Request('https://x/api/readings', { method: 'POST', headers: Object.assign({ 'content-type': 'application/json' }, headers || {}), body: JSON.stringify(body) }),
    env: env || { LIUYAO_DB: mkDb(), LIB_CODE: 'k' }
  });
};
eq('readings POST 无口令 → 401', (await rdPost({ cast_id: 'ok-1', action: 'dismissed' })).status, 401);
eq('readings POST 非法 cast_id → 400', (await rdPost({ cast_id: 'bad id', action: 'dismissed' }, { 'X-Access-Code': 'k' })).status, 400);
eq('readings POST 非法 action → 400', (await rdPost({ cast_id: 'ok-1', action: 'acted' }, { 'X-Access-Code': 'k' })).status, 400);
const dbDis = mkDb();
const rDis = await rdPost({ cast_id: 'ok-1', action: 'dismissed' }, { 'X-Access-Code': 'k' }, { LIUYAO_DB: dbDis, LIB_CODE: 'k' });
eq('dismissed → 200 且只关 pending', rDis.status === 200 && dbDis.state.sqls[0].indexOf("status = 'pending'") >= 0, true);
dbDis.state.changes = 0;
eq('无待回访任务 → 404', (await rdPost({ cast_id: 'ok-1', action: 'dismissed' }, { 'X-Access-Code': 'k' }, { LIUYAO_DB: dbDis, LIB_CODE: 'k' })).status, 404);

// ---------- #25 「先发首字节」重构 + 思考进度通道 + 空流终止（2026-10-27） ----------
// 线上实症：DeepSeek 经网关首字节 60~90s，旧版把这段等待留在 Response 返回之前，
// 客户端全程零字节 → CF 边缘 ~100s 无数据即 reset（curl 实测 76s、0 字节）→
// 前端判失败、指数退避重试 18 次（AI Gateway 日志里那串 1s 请求），用户只看到「推卦中…」。
// 四条契约在此固化：慢上游立刻回 SSE 头、思考草稿走 r 通道、空流显式报错、首字节单独超时。
const postGpt = function (extra, envExtra) {
  return interpretPost({
    request: new Request('https://x/api/interpret', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(Object.assign({ panText: '占测试', provider: 'gpt', model: 'gpt-6-luna' }, extra || {}))
    }),
    env: Object.assign({}, ENV_GPT, envExtra || {})
  });
};

// ① 慢上游（2.2s 才响应）：响应头必须立即返回，且首帧可读
globalThis.fetch = function () {
  return new Promise(function (resolve) {
    setTimeout(function () {
      const body = new ReadableStream({
        start: function (c) { c.enqueue(encG.encode(sseLine('慢响应'))); c.close(); }
      });
      resolve(new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }));
    }, 2200);
  });
};
const tSlow = Date.now();
const rSlow = await postGpt();
const slowHeadMs = Date.now() - tSlow;
eq('慢上游 → 响应头不等上游（<1.8s 返回）', slowHeadMs < 1800, true);
eq('慢上游 → 直接给 SSE 200', rSlow.status, 200);
eq('慢上游 → Content-Type 仍是 event-stream', /text\/event-stream/.test(rSlow.headers.get('content-type')), true);
const rdSlow = rSlow.body.getReader();
const firstSlow = await rdSlow.read();
const slowFirstMs = Date.now() - tSlow;
eq('首字节在响应头之后立刻可读（<300ms，旧版此处要等满 2.2s）', slowFirstMs - slowHeadMs < 300, true);
const decSlow = new TextDecoder();
let slowAll = decSlow.decode(firstSlow.value);
while (true) { const rr = await rdSlow.read(); if (rr.done) break; slowAll += decSlow.decode(rr.value); }
eq('首帧是 SSE 注释（心跳），不是正文', /^: /.test(slowAll.trim()), true);
eq('上游落地后正文照常下发', /\{"t":"慢响应"\}/.test(slowAll), true);

// ② 慢上游 5xx：头已发出，回不了 JSON，必须改用流内 error（前端据此重试/换模型）
globalThis.fetch = function () {
  return new Promise(function (resolve) {
    setTimeout(function () { resolve(new Response('boom', { status: 500 })); }, 2000);
  });
};
const rSlowFail = await postGpt();
eq('慢上游 5xx → 状态码只能 200（头已发出）', rSlowFail.status, 200);
const evSlowFail = await readSSEEvents(rSlowFail);
eq('慢上游 5xx → 流内 error=LLM_ERROR', evSlowFail.some(function (e) { return e.error === 'LLM_ERROR'; }), true);

// ③ 思考草稿走独立 r 通道：实时下发、绝不混进正文（防 fact-audit 假阳性复发）
globalThis.fetch = function () {
  const body = new ReadableStream({
    start: function (c) {
      c.enqueue(encG.encode('data: ' + JSON.stringify({ choices: [{ delta: { reasoning_content: '思考甲' } }] }) + '\n'));
      c.enqueue(encG.encode('data: ' + JSON.stringify({ choices: [{ delta: { reasoning_content: '思考乙' } }] }) + '\n'));
      c.enqueue(encG.encode(sseLine('正文丙')));
      c.close();
    }
  });
  return Promise.resolve(new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }));
};
const evThink = await readSSEEvents(await postGpt());
const rPool = evThink.filter(function (e) { return typeof e.r === 'string'; }).map(function (e) { return e.r; }).join('');
eq('思考草稿实时下发（r 通道）', rPool, '思考甲思考乙');
eq('思考草稿不混进正文', sseText(evThink), '正文丙');
eq('有正文时不补发草稿、也不报空', evThink.some(function (e) { return e.error === 'EMPTY_UPSTREAM'; }), false);

// ④ 空流：上游正常关闭但一个字都没有 → 必须显式终止（旧版静默关流，前端空转 18 轮）
globalThis.fetch = function () {
  const body = new ReadableStream({ start: function (c) { c.enqueue(encG.encode('data: [DONE]\n')); c.close(); } });
  return Promise.resolve(new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }));
};
const evEmpty = await readSSEEvents(await postGpt());
eq('空流 → 显式 error=EMPTY_UPSTREAM', evEmpty.some(function (e) { return e.error === 'EMPTY_UPSTREAM'; }), true);
eq('空流 → 不再静默（至少有一个事件）', evEmpty.length > 0, true);

// ⑤ 只有草稿没有任何正文：沿用兜底补发，且不报 EMPTY（个别中转把答案塞在思考字段）
globalThis.fetch = function () {
  const body = new ReadableStream({
    start: function (c) {
      c.enqueue(encG.encode('data: ' + JSON.stringify({ choices: [{ delta: { reasoning_content: '只有草稿' } }] }) + '\n'));
      c.close();
    }
  });
  return Promise.resolve(new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }));
};
const evOnlyReas = await readSSEEvents(await postGpt());
eq('纯草稿流 → 流末兜底补发为正文', sseText(evOnlyReas), '只有草稿');
eq('纯草稿流 → 不误报 EMPTY_UPSTREAM', evOnlyReas.some(function (e) { return e.error === 'EMPTY_UPSTREAM'; }), false);

// ⑥ 首字节独立超时：LLM_FIRST_BYTE_MS 到点即 504，不再让边缘先 reset
globalThis.fetch = function (url, opts) {
  return new Promise(function (resolve, reject) {
    const sig = opts && opts.signal;
    if (sig) sig.addEventListener('abort', function () {
      const e = new Error('The operation was aborted'); e.name = 'AbortError'; reject(e);
    });
  });
};
const hdrT = Date.now();
const hdrR = await postGpt({}, { LLM_FIRST_BYTE_MS: '300' });
const hdrJ = await hdrR.json();
eq('首字节超时 → 504', hdrR.status, 504);
eq('首字节超时 → 错误码 UPSTREAM_FIRST_BYTE_TIMEOUT', hdrJ.error, 'UPSTREAM_FIRST_BYTE_TIMEOUT');
eq('首字节超时 → 不等满总超时（<1.5s 返回）', Date.now() - hdrT < 1500, true);
eq('首字节超时 → 文案提示换更快的模型', /更快/.test(hdrJ.message), true);

/* 2026-10-28 补：首字节计时必须覆盖「主模型秒挂 → 同族备选挂起」全程。
   旧版主模型 503 一到就清 firstByteTimer，备选若永不返回，只能等 300s 总超时；
   Cloudflare 边缘会先行断连，用户侧重新表现为长时间无回答。 */
const postGemEnv = function (model, envExtra) {
  return interpretPost({
    request: new Request('https://x/api/interpret', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ panText: '占测试', provider: 'gemini', model: model })
    }),
    env: Object.assign({ GEMINI_API_KEY: 'k' }, envExtra || {})
  });
};
let fbCalls = 0;
globalThis.fetch = function (url, opts) {
  fbCalls++;
  if (fbCalls === 1) return Promise.resolve(new Response('high demand', { status: 503 }));
  return new Promise(function (resolve, reject) {
    const sig = opts && opts.signal;
    if (sig) sig.addEventListener('abort', function () {
      const e = new Error('The operation was aborted'); e.name = 'AbortError'; reject(e);
    });
  });
};
const fbFastT = Date.now();
const fbFastR = await postGemEnv('gemini-3.8-flash', { LLM_FIRST_BYTE_MS: '300', LLM_TIMEOUT_MS: '2500' });
const fbFastJ = await fbFastR.json();
eq('主 503 + 备选挂起（快速路径）→ 仍按首字节预算 504', fbFastR.status, 504);
eq('主 503 + 备选挂起（快速路径）→ UPSTREAM_FIRST_BYTE_TIMEOUT', fbFastJ.error, 'UPSTREAM_FIRST_BYTE_TIMEOUT');
eq('主 503 + 备选挂起（快速路径）→ 不等总超时', Date.now() - fbFastT < 1500, true);
eq('主 503 + 备选挂起（快速路径）→ 同族降级确实发生', fbCalls, 2);

// 慢路径（头已先发）同样不得丢守卫：备选挂起按 firstByteMs 在流内终止。
fbCalls = 0;
globalThis.fetch = function (url, opts) {
  fbCalls++;
  if (fbCalls === 1) {
    return new Promise(function (resolve) {
      setTimeout(function () { resolve(new Response('high demand', { status: 503 })); }, 500);
    });
  }
  return new Promise(function (resolve, reject) {
    const sig = opts && opts.signal;
    if (sig) sig.addEventListener('abort', function () {
      const e = new Error('The operation was aborted'); e.name = 'AbortError'; reject(e);
    });
  });
};
const fbSlowT = Date.now();
const fbSlowR = await postGemEnv('gemini-3.8-flash', {
  LLM_FAST_HEADER_MS: '100', LLM_FIRST_BYTE_MS: '1200', LLM_TIMEOUT_MS: '4000'
});
eq('主慢 503 + 备选挂起（慢路径）→ 先发 SSE 头', fbSlowR.status, 200);
const fbSlowEv = await readSSEEvents(fbSlowR);
eq('主慢 503 + 备选挂起（慢路径）→ 流内 UPSTREAM_TIMEOUT',
  fbSlowEv.some(function (e) { return e.error === 'UPSTREAM_TIMEOUT'; }), true);
eq('主慢 503 + 备选挂起（慢路径）→ 按首字节预算截止', Date.now() - fbSlowT < 3000, true);
eq('主慢 503 + 备选挂起（慢路径）→ 同族降级确实发生', fbCalls, 2);

// ⑦ Google 原生流里的 thought 片段：与 reasoning_content 同待遇，只走 r 通道。
// 背景：thinkingConfig:thinkingBudget=0 并不总被 gemini 3.x 采纳，实测会真的吐
// parts[{text, thought:true}]；旧版按 p.text 一并拼进正文 → 2026-10-13 fact-audit
// 6 处「与卦盘不符」的假阳性。这条断言把「草稿不得进正文」在 gemini 侧也钉死。
globalThis.fetch = function () {
  const body = new ReadableStream({
    start: function (c) {
      c.enqueue(encG.encode('data: ' + JSON.stringify({
        candidates: [{ content: { parts: [{ text: ' Gemini 草稿', thought: true }, { text: ' Gemini 正文' }] } }]
      }) + '\n'));
      c.close();
    }
  });
  return Promise.resolve(new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }));
};
const evGemThink = await readSSEEvents(await postGem('gemini-3.6-flash'));
eq('gemini thought 片段走 r 通道', evGemThink.filter(function (e) { return e.r; }).map(function (e) { return e.r; }).join(''), ' Gemini 草稿');
eq('gemini thought 片段不进正文', sseText(evGemThink), ' Gemini 正文');

// ⑧ 慢路径必须登记 waitUntil（2026-10-27 二次修，线上 499 的真凶）。
// 慢路径是「先返回响应、再等上游落地」：handler 一返回，运行时就会取消挂在
// 游离 Promise 上的 fetch —— 网关侧表现为 499 + dur≈FAST_HEADER_MS，
// 客户端只拿到空流，按 6s 退避重试十几次。没有 waitUntil 就必然复现。
globalThis.fetch = function () {
  return new Promise(function (resolve) {
    setTimeout(function () {
      const body = new ReadableStream({
        start: function (c) { c.enqueue(encG.encode(sseLine('慢但活着'))); c.close(); }
      });
      resolve(new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }));
    }, 1900);
  });
};
let waitedTask = null;
const rWait = await interpretPost({
  request: new Request('https://x/api/interpret', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ panText: '占测试', provider: 'gpt', model: 'gpt-6-luna' })
  }),
  env: ENV_GPT,
  waitUntil: function (p) { waitedTask = p; }
});
eq('慢路径 → 登记了 waitUntil（否则 fetch 会被运行时取消）', typeof waitedTask === 'object' && waitedTask !== null, true);
const evWait = await readSSEEvents(rWait);   // 必须先消费，否则写入方被背压挂住
eq('慢路径 → waitUntil 落地后正文照常送达', sseText(evWait), '慢但活着');

// 反向对照：没有 waitUntil 时也不能抛错（老运行时/单测环境）
globalThis.fetch = function () {
  return new Promise(function (resolve) {
    setTimeout(function () {
      const body = new ReadableStream({ start: function (c) { c.enqueue(encG.encode(sseLine('无 waitUntil'))); c.close(); } });
      resolve(new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }));
    }, 1600);
  });
};
const rNoWait = await interpretPost({
  request: new Request('https://x/api/interpret', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ panText: '占测试', provider: 'gpt', model: 'gpt-6-luna' })
  }),
  env: ENV_GPT
});
const evNoWait = await readSSEEvents(rNoWait);
eq('缺 waitUntil 的运行时 → 仍 200 且不抛错', rNoWait.status, 200);
eq('缺 waitUntil 的运行时 → 正文仍能送达', sseText(evNoWait), '无 waitUntil');

// ---------- #26 按模型分策略（M24）----------
// 旧版对所有模型用同一套参数，方向恰好相反：gemini 3.x 被硬塞 thinkingBudget=0（而本仓库
// 自己的注释记着「关思考下 3.6-flash 只生成 137/405 tokens 就 STOP，断语断在句中」），
// deepseek 则既不限思考也不传 max_tokens（实测 10.2k 字草稿、正文零字）。
// 这一组守住「两个供应商拿到的请求体必须不同」。
const policyCalls = [];
globalThis.fetch = function (url, opt) {
  policyCalls.push({
    url: String(url),
    body: opt && opt.body ? JSON.parse(opt.body) : null
  });
  const parts = [sseLine('一、卦象要点\n结论：平\n'), 'data: [DONE]\n'];
  const body = new ReadableStream({
    start(c) { parts.forEach(function (s) { c.enqueue(new TextEncoder().encode(s)); }); c.close(); }
  });
  return Promise.resolve(new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }));
};
const ENV_BOTH = { GEMINI_API_KEY: 'gk', DEEPSEEK_API_KEY: 'dk' };
const postModel = function (provider, model, extraEnv) {
  return interpretPost({
    request: new Request('https://x/api/interpret', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ panText: '占测试', provider: provider, model: model })
    }),
    env: Object.assign({}, ENV_BOTH, extraEnv || {})
  });
};
const lastCall = function () { return policyCalls[policyCalls.length - 1]; };

policyCalls.length = 0;
await (await postModel('gemini', 'gemini-3.6-flash')).text();
const gemBody = lastCall().body;
eq('M24 gemini 默认关思考（实测：放开后 200s 断在应期中途、无结论行）',
  gemBody.generationConfig.thinkingConfig.thinkingBudget, 0);
eq('M24 gemini 仍保留 temperature=0.2', gemBody.generationConfig.temperature, 0.2);
eq('M24 gemini 不受 deepseek 的正文预算影响',
  gemBody.generationConfig.maxOutputTokens, undefined);

policyCalls.length = 0;
await (await postModel('deepseek', 'deepseek-flash')).text();
const dsBody = lastCall().body;
// 8192 实测反而更糟（思考打满即 length，正文 0 字），改为给足 32768。
eq('M24 deepseek 显式给足 max_tokens=32768（旧版完全不传、8192 实测更糟）', dsBody.max_tokens, 32768);
/* M25：提示词按模型分两版。默认 full —— A/B 实测（真实盘面 + 服务端 diag 帧）两版
   都能正常出正文（full 1862 字/37s，lean 1179 字/28s），精简版是「更快的可选项」，
   不是「必需品」。旧结论「deepseek 只想不答」实为本机带宽假象，已作废。 */
eq('M25 deepseek 默认走完整版（与 gemini 同一份契约）',
  dsBody.messages[0].content.indexOf('【判语优先】') >= 0, true);
eq('M25 默认不夹带精简版专属句（只输出断卦正文本身）',
  dsBody.messages[0].content.indexOf('只输出断卦正文本身') < 0, true);

policyCalls.length = 0;
await (await postModel('deepseek', 'deepseek-flash', { DEEPSEEK_PROMPT: 'lean' })).text();
const leanBody = lastCall().body;
eq('M25 DEEPSEEK_PROMPT=lean → 换整份提示词（含「只输出断卦正文本身」）',
  leanBody.messages[0].content.indexOf('只输出断卦正文本身') >= 0, true);
eq('M25 精简版不含完整版的审计条款（【判语优先】须逐条核验那类）',
  leanBody.messages[0].content.indexOf('【判语优先】') < 0, true);
eq('M25 精简版不含「须先引古法原文说明理由」这一论证入口',
  leanBody.messages[0].content.indexOf('说明理由') < 0, true);
eq('M25 精简版保留四段硬契约（盘面不可改写）',
  leanBody.messages[0].content.indexOf('【盘面事实不可改写】') >= 0, true);
eq('M25 精简版保留结构化五行（前端 parseConclusion 靠它）',
  leanBody.messages[0].content.indexOf('验证标志：') >= 0, true);
eq('M25 精简版比完整版短一半以上（1127 vs 3004 字）',
  leanBody.messages[0].content.length < SYSTEM_PROMPT.length * 0.5, true);
eq('M25 gemini 不受影响，仍走完整版',
  gemBody.systemInstruction.parts[0].text.indexOf('【判语优先】') >= 0, true);
eq('M25 导出的 SYSTEM_PROMPT 常量本身未被污染（app.js 副本契约不受影响）',
  SYSTEM_PROMPT.indexOf('只输出断卦正文本身') < 0, true);

policyCalls.length = 0;
await (await postModel('gemini', 'gemini-3.6-flash', { GEMINI_THINKING_BUDGET: '-1' })).text();
eq('M24 GEMINI_THINKING_BUDGET=-1 → 不传 thinkingConfig（动态思考，供再实验）',
  lastCall().body.generationConfig.thinkingConfig, undefined);

policyCalls.length = 0;
await (await postModel('gemini', 'gemini-3.6-flash', { GEMINI_THINKING_BUDGET: '2048' })).text();
eq('M24 GEMINI_THINKING_BUDGET=2048 → 显式上限',
  lastCall().body.generationConfig.thinkingConfig.thinkingBudget, 2048);

policyCalls.length = 0;
await (await postModel('deepseek', 'deepseek-flash', { DEEPSEEK_MAX_TOKENS: '4096' })).text();
eq('M24 DEEPSEEK_MAX_TOKENS 可覆盖默认 32768', lastCall().body.max_tokens, 4096);

policyCalls.length = 0;
await (await postModel('deepseek', 'deepseek-flash', { DEEPSEEK_PROMPT: 'full' })).text();
eq('M25 DEEPSEEK_PROMPT=full 可退回完整版（对照实验入口）',
  lastCall().body.messages[0].content.indexOf('只输出断卦正文本身') < 0, true);

policyCalls.length = 0;
await (await postModel('deepseek', 'deepseek-flash', { LLM_MAX_TOKENS: '2000' })).text();
eq('M24 全局 LLM_MAX_TOKENS 仍优先于按模型默认', lastCall().body.max_tokens, 2000);

// ---------- #26 三模型对账（/api/vote，Workers AI 免费额度）----------
// 三票形状必须完全一致（yong/wang/cheng/qi），前端分歧矩阵才一套渲染吃遍；
// chat 模型回散文，靠 extractJson + one-hot 归一；解析不出来一律判该票无效，绝不猜。
const CLEF_OK = {
  answers: {
    yong: { type: 'choice', probabilities: { cai: 0.8, guan: 0.1, fu: 0.04, xiong: 0.03, zi: 0.03 } },
    wang: { type: 'choice', probabilities: { ji_ruo: 0.02, ruo: 0.08, ping: 0.2, wang: 0.5, ji_wang: 0.2 } },
    cheng: { type: 'noul', noul: 0.7 },
    qi: { type: 'choice', probabilities: { ben_xun: 0.1, xia_xun: 0.3, yue_nei: 0.5, yue_wai: 0.1 } }
  },
  usage: { input_tokens: 520, output_tokens: 0 }
};
function mkAI(overrides) {
  const calls = [];
  const run = async function (model, body) {
    calls.push({ model: model, body: body });
    if (overrides && overrides[model]) {
      const o = overrides[model];
      return typeof o === 'function' ? o() : o;     // 函数即「抛错」用例，避免提前构造 rejected promise
    }
    if (model.indexOf('clef') >= 0) return CLEF_OK;
    if (model.indexOf('qwen') >= 0) {
      return { choices: [{ message: { content: '```json\n{"用神":"妻财","旺衰":"旺","可成":0.62,"应期":"月内"}\n```' } }],
        usage: { prompt_tokens: 210, completion_tokens: 38, neurons: 2.1 } };
    }
    return { choices: [{ message: { content: '{"用神":"妻财","旺衰":"平","可成":"75%","应期":"下旬"}' } }],
      usage: { prompt_tokens: 260, completion_tokens: 60, neurons: 14.6 } };
  };
  return { ai: { run: run }, calls: calls };
}
const voteCall = function (body, env, headers) {
  return votePost({
    request: new Request('https://x/api/vote', { method: 'POST', headers: Object.assign({ 'content-type': 'application/json' }, headers || {}), body: JSON.stringify(body) }),
    env: env
  });
};

const aiOk = mkAI();
const rVote = await voteCall({ state: '丙午年 戊戌月 丙子日 丙申时 雷泽归妹之泽雷随', ask: '求财' }, { AI: aiOk.ai });
eq('三票全绿 → 200', rVote.status, 200);
const jVote = await rVote.json();
eq('返回三票', jVote.votes.length, 3);
const vClef = jVote.votes.find(function (v) { return v.id === 'clef'; });
eq('clef 票有效', vClef.ok, true);
eq('clef 概率按中文选项归一（妻财=0.8）', Math.abs(vClef.probs.yong['妻财'] - 0.8) < 1e-9, true);
eq('clef 可成直接取 noul', vClef.probs.cheng.noul, 0.7);
eq('clef 旺衰五档齐全', Object.keys(vClef.probs.wang).length, 5);
const vQwen = jVote.votes.find(function (v) { return v.id === 'qwen'; });
eq('chat 票从代码围栏里抠出 JSON', vQwen.ok, true);
eq('chat 用神 one-hot 落在妻财', vQwen.probs.yong['妻财'], 1);
eq('chat 旺衰 one-hot 落在旺', vQwen.probs.wang['旺'], 1);
const vGpt = jVote.votes.find(function (v) { return v.id === 'gptoss'; });
eq('百分数写法 "75%" 归一为 0.75', Math.abs(vGpt.probs.cheng.noul - 0.75) < 1e-9, true);
eq('neurons 汇总为数字', typeof jVote.usage.neurons, 'number');
const clefCallBody = aiOk.calls.find(function (c) { return c.model.indexOf('clef') >= 0; }).body;
eq('clef questions 键全为 ASCII（中文键实测被 422 拒）',
  Object.keys(clefCallBody.questions).every(function (k) { return /^[A-Za-z0-9_.-]{1,100}$/.test(k); }), true);
eq('clef criteria 键也全为 ASCII',
  Object.keys(clefCallBody.questions.yong.criteria).every(function (k) { return /^[A-Za-z0-9_.-]{1,100}$/.test(k); }), true);

// Qwen3 默认开 thinking：实测 400 tokens 全烧在 reasoning 上、content 恒 null → UNPARSEABLE。
// 只有 `/no_think` 软开关能压住（chat_template_kwargs 在该条目上不生效，亦已实测）。
const qwenCallBody = aiOk.calls.find(function (c) { return c.model.indexOf('qwen') >= 0; }).body;
eq('qwen 请求末尾带 /no_think（否则整票作废）',
  /\/no_think\s*$/.test(qwenCallBody.messages[qwenCallBody.messages.length - 1].content), true);
eq('qwen 请求不开 thinking 时不传 reasoning_effort',
  Object.prototype.hasOwnProperty.call(qwenCallBody, 'reasoning_effort'), false);
const gptCallBody = aiOk.calls.find(function (c) { return c.model.indexOf('gpt-oss') >= 0; }).body;
eq('gpt-oss 不带 /no_think（它不认这个软开关）',
  /\/no_think/.test(gptCallBody.messages[gptCallBody.messages.length - 1].content), false);

// 依据层：模型自述的规则名必须剥掉书名号/引号，避免被当成可回溯的古籍引文。
// 背景：投票页早先「规则层」的三条带书名号「引文」是编造的，404 例语料里检索不到（已全撤）。
eq('未报「依据」时 basis 为 null（不猜）', vQwen.basis, null);
const aiBasis = mkAI({
  '@cf/qwen/qwen3-30b-a3b-fp8': {
    choices: [{ message: { content: '{"用神":"妻财","旺衰":"旺","可成":0.62,"应期":"月内","依据":"用神月破无救——《增删卜易·月破章》"}' } }],
    usage: { prompt_tokens: 10, completion_tokens: 5 }
  }
});
const jBasis = await (await voteCall({ state: '盘面' }, { AI: aiBasis.ai })).json();
const vBasis = jBasis.votes.find(function (v) { return v.id === 'qwen'; });
eq('依据层剥除书名号（不伪装成原文）', vBasis.basis, '用神月破无救——增删卜易·月破章');
eq('依据层剥除后仍保留规则名本体', /用神月破无救/.test(vBasis.basis), true);
eq('prompt 明确要求「依据」不得写书名',
  /不要写书名/.test(qwenCallBody.messages[qwenCallBody.messages.length - 1].content), true);
eq('cleanBasis 剥除各类引号装饰',
  _vCleanBasis('「官鬼旺而生世」——〈求名〉'), '官鬼旺而生世——求名');
eq('cleanBasis 空串 → null', _vCleanBasis('《》'), null);
eq('cleanBasis 截断到 32 字', _vCleanBasis('甲'.repeat(50)).length, 32);
eq('chat 票 max_tokens 留足 512（reasoning 也要占额度）', gptCallBody.max_tokens, 512);

const aiBad = mkAI({ '@cf/openai/gpt-oss-120b': { choices: [{ message: { content: '抱歉，我无法判断。' } }] } });
const jBad = await (await voteCall({ state: '盘面' }, { AI: aiBad.ai })).json();
const vBad = jBad.votes.find(function (v) { return v.id === 'gptoss'; });
eq('解析不出 JSON → 该票无效', vBad.ok, false);
eq('错误码标为 UNPARSEABLE', vBad.error, 'UNPARSEABLE');
eq('无效票不影响其余两票', jBad.votes.filter(function (v) { return v.ok; }).length, 2);

const aiField = mkAI({ '@cf/qwen/qwen3-30b-a3b-fp8': { choices: [{ message: { content: '{"用神":"妻财"}' } }] } });
const jField = await (await voteCall({ state: '盘面' }, { AI: aiField.ai })).json();
const vField = jField.votes.find(function (v) { return v.id === 'qwen'; });
eq('缺字段 → 无效票', vField.ok, false);
eq('错误码列出缺的字段', vField.error.indexOf('BAD_FIELDS') === 0, true);

const aiBoom = mkAI({ '@cf/qwen/qwen3-30b-a3b-fp8': function () { throw new Error('upstream 500'); } });
const jBoom = await (await voteCall({ state: '盘面' }, { AI: aiBoom.ai })).json();
eq('单票抛错不影响整体（其余两票照出）', jBoom.votes.filter(function (v) { return v.ok; }).length, 2);

eq('未绑定 AI → 503', (await voteCall({ state: '盘面' }, {})).status, 503);
eq('缺 state → 400', (await voteCall({ ask: '问点啥' }, { AI: mkAI().ai })).status, 400);
eq('非对象 body → 400', (await voteCall([], { AI: mkAI().ai })).status, 400);
eq('GET 不允许 → 405', voteGet().status, 405);

// 口令闸：与 interpret/records 同源，设 ACCESS_CODE 后无口令应被拦（独立 IP 避免计数干扰）
eq('vote 设 ACCESS_CODE 后无口令 → 401',
  (await voteCall({ state: '盘面' }, { AI: mkAI().ai, ACCESS_CODE: 'a' }, { 'CF-Connecting-IP': '198.51.100.20' })).status, 401);
eq('vote 带正确口令 → 200',
  (await voteCall({ state: '盘面' }, { AI: mkAI().ai, ACCESS_CODE: 'a' }, { 'CF-Connecting-IP': '198.51.100.20', 'X-Access-Code': 'a' })).status, 200);

globalThis.fetch = origFetch;
if (fail > 0) process.exit(1);

console.log('PASS:', pass, ' FAIL:', fail);
if (fail > 0) process.exit(1);
