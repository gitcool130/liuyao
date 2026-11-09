/* 供应商配置共享层（functions/api/_lib.js）
 * 以 _ 开头的文件不会被 Pages Functions 路由为端点，仅供相邻模块 import。
 * 供 interpret.js（白名单校验）与 models.js（清单渲染）共用，
 * 杜绝两处解析 GPT_MODELS / CUSTOM_PROVIDERS 口径漂移。
 */

export const DEFAULT_GPT_MODELS = 'gpt-6-luna,gpt-6-sol,gpt-6-astra';

// 内置供应商模型清单：models.js（页面芯片渲染）与 modelWhitelist（服务端校验）
// 共用这一份，杜绝两处硬编码漂移——旧版两份各写三条，后台改其一忘其二时
// 前端芯片可点而服务端 BAD_MODEL，且无任何提示（2026-10-21 审计修正）。
// key 为 configured 探测用的密钥环境变量名（见 models.js 的 env[key]）。
export const BUILTIN_MODELS = [
  { id: 'gemini-3.6-flash', pv: 'Google', key: 'GEMINI_API_KEY' },
  { id: 'gemini-3.8-flash', pv: 'Google', key: 'GEMINI_API_KEY' },
  { id: 'deepseek-flash', pv: 'DeepSeek', key: 'DEEPSEEK_API_KEY' }
];

// 已被判定为「签到送流量但请求不到模型」的问题模型/中转站，强制从清单与白名单剔除。
// 即使后台 GPT_MODELS / CUSTOM_PROVIDERS 里还留着，前端不会再展示，服务端也会拒绝请求。
const BANNED_MODEL_RE = /^gpt[-\s]?5[.-]2$/i;
const BANNED_MODEL_SET = new Set(['gpt-5-2', 'gpt5-2', 'gpt 5.2', 'gpt 5-2']);
export function isBannedModelId(id) {
  if (typeof id !== 'string') return false;
  const t = id.trim().toLowerCase();
  return BANNED_MODEL_SET.has(t) || BANNED_MODEL_RE.test(t);
}

// 所有端点共用的 JSON 响应出口。安全头在此**单点**加，不要在各端点各写一份
// （旧版 records.js / readings.js / _lib.js 三份物理拷贝，加头只改一处 → 另两处静默缺失）。
//   no-store：卦例正文/断语是逐用户内容，任何中间缓存都不该留存；
//   nosniff ：阻止浏览器把 JSON 当 HTML/脚本嗅探（配合 nosniff 才能让 415/403 的
//             回显文本不被当作可执行文档）。
export function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}

// 客户端 IP。CF-Connecting-IP 由边缘写入、客户端同名的头会被剥离，可信；
// X-Forwarded-For 仅在非 CF 部署（wrangler dev）下回退，该环境可伪造，只作降级。
// 两者都取不到时返回 ''——调用方据此跳过计数（fail-open），不要退化成共用 'unknown'
// 桶：那会把「所有无 IP 来源」绑成一个计数器，一次爆破就锁死全部。
export function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || '';
}

// 写路径守卫（CSRF + 内容协商）：所有 POST/PUT/PATCH/DELETE 先过这一关。
// 为什么需要：浏览器对 application/json 的跨站 POST 会先发预检，而 text/plain /
// form-urlencoded 属于「简单请求」不预检、且会把响应交给调用方——任意网页都能
// 借访客浏览器、以访客 IP 打本站付费接口（烧模型额度），甚至借口令 Cookie 写库。
// 两道闸互补：
//   ① Content-Type 必须是 JSON —— 把跨站「简单请求」直接挡在 415；
//   ② Origin 若存在则必须同源 —— 挡住同源外的表单/脚本发起，并容忍自定义域名。
// 缺 Origin 的请求放行（curl / 服务端调用不带该头，浏览器跨站一定带）。
const JSON_CT_RE = /^application\/(?:[a-z0-9.+-]+\+)?json\b/i;
const WRITE_METHODS = { POST: 1, PUT: 1, PATCH: 1 };

export function writeGuard(request, env) {
  const origin = request.headers.get('origin');
  if (origin) {
    let host = '';
    try { host = new URL(origin).host; } catch (e) { host = ''; }   // 'null'（沙箱 iframe）也会落到这里
    const selfHost = new URL(request.url).host;
    const allowed = String((env && env.ALLOWED_ORIGINS) || '').split(',')
      .map(function (s) { return s.trim(); }).filter(Boolean);
    const ok = !!host && (host === selfHost || allowed.some(function (a) {
      try { return new URL(a).host === host; } catch (e) { return a === origin; }
    }));
    if (!ok) {
      return json({ error: 'CROSS_ORIGIN_DENIED', message: '跨站请求已被拒绝' }, 403);
    }
  }
  if (WRITE_METHODS[request.method]) {
    const ct = request.headers.get('content-type') || '';
    if (!JSON_CT_RE.test(ct)) {
      return json({ error: 'UNSUPPORTED_MEDIA_TYPE', message: '请求体须为 application/json' }, 415);
    }
  }
  return null;
}

// 请求体读取：Content-Length 只是「早退」提示，真正的边界在流式累计。
// 旧实现只看头：不带 Content-Length 的分块请求（或伪造一个小的）会整段读进
// isolate 内存后才轮到字段限长——600 KB 的无头请求实测直接 200 进业务逻辑。
// 这里按实际字节数累计，超限立即 cancel 上游流，内存占用被硬封顶在 max + 一块。
// 返回 { value } / { error: 'TOO_LARGE' | 'BAD_JSON' }。
export async function readJsonLimited(request, max) {
  const cl = parseInt(request.headers.get('content-length') || '0', 10);
  if (!isFinite(cl) || cl > max) return { error: 'TOO_LARGE' };
  if (!request.body) return { error: 'BAD_JSON' };
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const r = await reader.read();
      if (r.done) break;
      size += r.value.byteLength;
      if (size > max) {
        try { await reader.cancel(); } catch (e) { /* 已释放 */ }
        return { error: 'TOO_LARGE' };
      }
      chunks.push(r.value);
    }
  } catch (e) {
    return { error: 'BAD_JSON' };
  } finally {
    try { reader.releaseLock(); } catch (e) { /* 已释放 */ }
  }
  const buf = new Uint8Array(size);
  let off = 0;
  for (let i = 0; i < chunks.length; i++) { buf.set(chunks[i], off); off += chunks[i].byteLength; }
  try {
    return { value: JSON.parse(new TextDecoder().decode(buf)) };
  } catch (e) {
    return { error: 'BAD_JSON' };
  }
}

// 按 IP 的滑动窗口限流（共享实现）。默认**开启**——「未配置即不限流」在
// 2026-11 复核时被判定为高危：/api/interpret 与 /api/vote 不设口令时是
// 零成本额度消耗口，一条 curl 循环就能打光当日 Workers AI 免费额度。
// 现行语义：
//   RATE_LIMIT_PER_MIN 未设 → 用调用方给的默认值（interpret 20、vote 6）；
//   显式设 0 或负数        → 关闭（本地压测/自建网关前置时用）；
//   取不到 IP              → 不计数（非 CF 环境下别假装有边界）。
//
// 存储：优先 D1（跨 isolate 全局一致），无 DB 绑定或表缺失时退化为 isolate 内存。
// 为什么必须落库：2026-11-09 线上实测本 zone 的 Pages Functions **几乎不复用 isolate**——
// 连续 5 次请求各自命中全新实例（自增计数停在 1）。纯内存计数在线上等于没有，
// 这也是旧版「同 IP 错 20 次锁 10 分钟」从未在线上生效的原因。
// 表结构见 schema.sql：
//   rate_hits(bucket TEXT, ip TEXT, w INTEGER, n INTEGER, PRIMARY KEY(bucket, ip, w))
// w = floor(now/60000)，一行代表「某端点 + 某 IP + 某一分钟」的计数。
// 代价：每个受保护请求多一次 D1 写（免费额度 10 万行/日，本站在此量级下可忽略）。
const RL_BUCKETS = new Map();   // 内存回退：name → Map(ip → number[])
const RL_MAX_IPS = 5000;
const RL_WINDOW_MS = 60000;

function limitOf(env, defLimit) {
  const raw = env && env.RATE_LIMIT_PER_MIN;
  const limit = (raw === undefined || raw === null || raw === '') ? (defLimit || 10) : parseInt(raw, 10);
  return (!isFinite(limit) || limit <= 0) ? 0 : limit;
}

// 内存回退实现（无 DB 时用；测试也走这条，便于断言滑窗边界）
function memoryHit(name, ip, limit) {
  let bucket = RL_BUCKETS.get(name);
  if (!bucket) { bucket = new Map(); RL_BUCKETS.set(name, bucket); }
  const now = Date.now();
  if (bucket.size > RL_MAX_IPS) {
    bucket.forEach(function (arr, k) {
      if (!arr.length || now - arr[arr.length - 1] >= RL_WINDOW_MS) bucket.delete(k);
    });
  }
  let hits = bucket.get(ip);
  if (!hits) { hits = []; bucket.set(ip, hits); }
  let keep = 0;
  for (let i = 0; i < hits.length; i++) { if (now - hits[i] < RL_WINDOW_MS) hits[keep++] = hits[i]; }
  hits.length = keep;
  if (hits.length >= limit) return true;   // 达限即拒且不入队，数组长度硬封顶
  hits.push(now);
  return false;
}

// D1 实现：UPSERT + RETURNING 一次往返拿到自增后的计数
async function dbHit(env, name, ip, limit) {
  const w = Math.floor(Date.now() / RL_WINDOW_MS);
  const row = await env.LIUYAO_DB.prepare(
    'INSERT INTO rate_hits (bucket, ip, w, n) VALUES (?, ?, ?, 1) ' +
    'ON CONFLICT(bucket, ip, w) DO UPDATE SET n = n + 1 RETURNING n'
  ).bind(name, ip, w).first();
  const n = row ? Number(row.n != null ? row.n : row['n']) : 0;
  // 概率清理（1%）：只删 3 小时前的行，避免表随时间无限增长
  if (Math.random() < 0.01) {
    try { await env.LIUYAO_DB.prepare('DELETE FROM rate_hits WHERE w < ?').bind(w - 180).run(); }
    catch (e) { /* 清理失败不影响本次判定 */ }
  }
  return n > limit;
}

export async function rateLimit(request, env, name, defLimit) {
  const limit = limitOf(env, defLimit);
  if (!limit) return false;
  const ip = clientIp(request);
  if (!ip) return false;
  if (!env || !env.LIUYAO_DB) return memoryHit(name, ip, limit);
  try {
    return await dbHit(env, name, ip, limit);
  } catch (e) {
    // 表缺失（尚未执行 schema.sql）/D1 抖动：退化为内存计数，绝不因限流设施故障而 5xx
    console.warn('[liuyao] 限流计数落库失败，退化为内存计数:', e && e.message);
    return memoryHit(name, ip, limit);
  }
}

export function rateLimited() {
  return json({ error: 'RATE_LIMITED', message: '请求过于频繁，请稍后重试' }, 429);
}

// 仅供测试读取内存回退桶的内部状态（不导出桶本体，避免测试耦合实现细节）
export function _rlState(name) {
  const out = [];
  const bucket = RL_BUCKETS.get(name);
  if (bucket) bucket.forEach(function (arr, ip) { out.push({ ip: ip, len: arr.length }); });
  return out;
}

// 请求体总大小闸门（L1）：await request.json() 会对任意大的 body 先全量读入内存，
// 之后才轮到字段级限长（panText 上限、jsonWithin 收缩）。CF 平台虽有请求体上限兜底，
// 但恶意大 JSON 仍会先吃掉 isolate 内存。这里按 Content-Length 提前拒绝。
// 局限：chunked 请求没有该头，只能靠字段限长与平台上限；故这是"早退"而非"边界"。
export const MAX_JSON_BODY = 512 * 1024;
export function bodyTooLarge(request) {
  // P2-API-11（2026-11-03）：畸形 content-length 头（如 'abc'）parseInt 得 NaN，
  // 旧版 NaN > MAX_JSON_BODY 为 false 直接放行——闸门可被一个畸形头绕过。
  // 非有限数一律按超限处理（拒绝），正常路径行为不变。
  const cl = parseInt(request.headers.get('content-length') || '0', 10);
  return !isFinite(cl) || cl > MAX_JSON_BODY;
}
export function payloadTooLarge() {
  return json({ error: 'BODY_TOO_LARGE', message: '请求体过大（上限 512 KB）' }, 413);
}

// 口令比较：先 SHA-256 再逐字节异或，长度不参与比较、耗时与口令内容无关
// （直接字符串 === 比较会因短路提前返回而泄露前缀信息）
// 放在共享层而非各端点各自实现：records.js 与 interpret.js 必须走同一实现，
// 否则会出现「一处已改常量时间、另一处仍是明文直比」的口径漂移。
export async function safeEqual(input, expected) {
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(String(input == null ? '' : input))),
    crypto.subtle.digest('SHA-256', enc.encode(String(expected == null ? '' : expected)))
  ]);
  const va = new Uint8Array(a), vb = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < va.length; i++) diff |= va[i] ^ vb[i];
  return diff === 0;
}

// 口令闸（读/写/断卦共用）：常量时间比较 + 同 IP 失败计数。
// 为什么要统一：records.js 有失败计数而 interpret.js 只有 safeEqual——两端点姿态不一致，
// 一旦单独启用 ACCESS_CODE（且未设 RATE_LIMIT_PER_MIN），断卦端点就成了无限速爆破口，
// 而 ACCESS_CODE 与 LIB_CODE 同源时可被用来换取卦例库读权限。
//
// safeEqual 只保证单次比较不泄露时序，不防高频试错。同 IP 10 分钟内错 20 次 → 429，
// 成功一次立即清零。计数在模块级 Map 中，跨 isolate 不共享，与 interpret 的限流同属
// 「成本抑制」而非安全边界。
const AUTH_FAILS = new Map();      // ip → { n, until }
const AUTH_MAX_FAILS = 20;
const AUTH_WINDOW_MS = 10 * 60 * 1000;
const AUTH_MAX_IPS = 5000;

function authKey(request) {
  // CF-Connecting-IP 由边缘写入、客户端伪造会被剥离；X-Forwarded-For 仅非 CF 部署回退。
  // P2-API-3(c)（2026-11-03）：非 CF 部署下 XFF 完全可伪造（客户端随手改头即可
  // 换一个干净桶），失败计数对其不构成约束；生产走 CF 边缘、(a) 的不可达依赖
  // 即建立在该前缀上，此处仅注释说明，不在代码里做不可靠的来源甄别。
  // P2-API-3(a)（2026-11-03）：两个头都取不到时返回 ''（而非旧版的 'unknown'）。
  // 旧版所有无 IP 客户端共用一个 'unknown' 桶——任意来源 20 次失败即把
  // 全部无 IP 客户端一并锁定 10 分钟（fail-close 被放大成全员拒绝服务）。
  // 现在取不到 IP 时跳过计数（fail-open，不锁定），由上层口令本身承担校验。
  return request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || '';
}

// 返回 null 表示放行；否则返回应直接下发的 Response（401 / 429）
export async function requireCode(request, expected, message) {
  if (!expected) return null;   // 未配置口令：保持开放（向后兼容本地/测试环境）
  const key = authKey(request);
  const now = Date.now();
  // P2-API-3(a)：无 IP 不计数（fail-open）——查表、锁定、累计三处都按 key 为空跳过
  let rec = key ? AUTH_FAILS.get(key) : undefined;
  if (rec && now >= rec.until) { AUTH_FAILS.delete(key); rec = undefined; }
  if (rec && rec.n >= AUTH_MAX_FAILS) {
    return json({ error: 'TOO_MANY_ATTEMPTS', message: '口令错误次数过多，请 10 分钟后再试' }, 429);
  }
  const given = request.headers.get('X-Access-Code') || '';
  if (await safeEqual(given, expected)) {
    if (rec) AUTH_FAILS.delete(key);
    return null;
  }
  if (key) {
    if (!rec) rec = { n: 0, until: now + AUTH_WINDOW_MS };
    rec.n++;
    AUTH_FAILS.set(key, rec);
    // P2-API-3(b)（2026-11-03）：超 AUTH_MAX_IPS 时旧版只删已过期条目——未过期
    // 条目不受影响，Map 仍可无界增长（注释声称的「成本抑制上限」实际不存在）。
    // 现在先删过期，仍超限则淘汰最旧条目：Map 迭代序即插入序，取第一个 key 删。
    // 代价是被淘汰 IP 的计数清零（多换一轮试错机会），换取计数表内存有界。
    if (AUTH_FAILS.size > AUTH_MAX_IPS) {
      AUTH_FAILS.forEach(function (v, k) { if (now >= v.until) AUTH_FAILS.delete(k); });
      while (AUTH_FAILS.size > AUTH_MAX_IPS) {
        const oldest = AUTH_FAILS.keys().next().value;
        if (oldest === undefined) break;
        AUTH_FAILS.delete(oldest);
      }
    }
  }
  return json({ error: 'ACCESS_REQUIRED', message: message }, 401);
}

// 卦例 id / 回访任务 cast_id 白名单（P2-API-7，2026-11-03）：写路径（客户端可自带 id）
// 与读路径（库里可能存有历史脏 id）都必须过这一关——早期版本（e8e86e1 ~ f5a0ca4，
// 2026-09-24 ~ 09-26）写入时无任何格式校验，那些行至今可能仍在线上 D1 中，
// 且会被前端拼进 data-id 属性。
// 旧版 records.js 与 readings.js 各存一份物理拷贝，违背本文件「单一事实源」纪律：
// 任一侧漏改即出现「一端放行、一端拦截」的漂移，故收敛到此统一导出、两处 import。
export const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

// 模型 id 字符集白名单：模型名会进入前端 DOM（芯片 data-m / 文本）与上游请求体，
// 只允许字母数字与 . _ - / : ，从源头杜绝引号/尖括号等注入字符
const MODEL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,63}$/;

export function isSafeModelId(id) {
  return typeof id === 'string' && MODEL_ID_RE.test(id);
}

// 供应商显示名白名单：label 会进入前端 DOM（models.js 渲染、app.js 芯片文本与 pv 属性位）。
// id 有白名单而 label 此前完全不校验 → 后台把 label 配成含引号的串即可逃逸属性值。
// 与 MODEL_ID_RE 同思路收敛：允许中英文、数字与常见分隔符，拒绝引号/尖括号/反引号/控制字符。
const LABEL_RE = /^[A-Za-z0-9\u4e00-\u9fff][A-Za-z0-9\u4e00-\u9fff ._:·()（）\/-]{0,31}$/;

export function isSafeProviderLabel(label) {
  return typeof label === 'string' && LABEL_RE.test(label);
}

// GPT 模型清单：GPT_MODELS（别名 OPENAI_MODELS），逗号分隔 → 去空白数组
// 非法字符的条目丢弃并告警（否则会被静默接受，一路进白名单与前端 DOM）
export function gptModelList(env) {
  const raw = env.GPT_MODELS || env.OPENAI_MODELS || DEFAULT_GPT_MODELS;
  const all = raw.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  const bad = all.filter(function (m) { return !isSafeModelId(m); });
  if (bad.length) console.warn('[liuyao] GPT_MODELS 中忽略非法模型名:', bad.join(','));
  const banned = all.filter(isBannedModelId);
  if (banned.length) console.warn('[liuyao] GPT_MODELS 中已禁用模型:', banned.join(','));
  return all.filter(function (m) { return isSafeModelId(m) && !isBannedModelId(m); });
}

// 内置供应商 id：自定义条目不得占用。
// 否则 modelWhitelist 的 wl[p.id] = p.models 会整体覆盖内置白名单，
// 而 providerConfig 仍取内置的 <ID>_API_KEY / <ID>_BASE_URL——
// 模型清单与上游配置错配，请求必然 404/401，且后台无任何提示。
const RESERVED_PROVIDER_IDS = { gemini: 1, deepseek: 1, gpt: 1 };

// 自定义供应商 base 白名单（配置层 SSRF，2026-11 复核）：base 会拼成
// `<base>/chat/completions` 由 Worker 侧发起 fetch。能改这个变量的人本就有
// 后台权限，但「后台变量」与「可发起任意内网请求」不该是同一件事——
// 一旦 CUSTOM_PROVIDERS 被误配/被第三方模板带入，就成了打内网和云元数据
// （169.254.169.254）的跳板，且请求源是 Cloudflare 边缘、不落你的日志。
// 只收 https + 公网主机名：拒绝 IP 字面量（无法可靠判断私网/重绑定）、
// localhost/.local/.internal、以及云元数据主机名。
const BLOCKED_HOST_RE = /^(?:localhost|.*\.localhost|.*\.local|.*\.internal|metadata(?:\.google\.internal)?|instance-data)$/i;

export function isSafeProviderBase(base) {
  if (typeof base !== 'string' || !base) return false;
  let u;
  try { u = new URL(base); } catch (e) { return false; }
  if (u.protocol !== 'https:') return false;
  if (u.username || u.password) return false;
  const h = u.hostname.toLowerCase();
  if (BLOCKED_HOST_RE.test(h)) return false;
  // 纯 IP（含 IPv6 字面量，URL 解析后带方括号）一律拒绝：私网段、CGNAT、
  // 链路本地与元数据地址都在其中，逐段判断不如整类拒绝来得可靠。
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(h) || h.charAt(0) === '[') return false;
  return true;
}

// 自定义供应商：CUSTOM_PROVIDERS（JSON 数组）
//   { "id": "kimi", "label": "Moonshot", "base": "https://api.moonshot.cn/v1", "models": ["kimi-k2"] }
// id 需为小写字母数字且非内置 id；对应密钥环境变量为 <ID大写>_API_KEY
// 解析失败/条目非法不再静默吞掉：console.warn 告警，并可由 customProviderWarnings 取回原因
export function customProvidersWithWarnings(env) {
  const warns = [];
  if (!env.CUSTOM_PROVIDERS) return { providers: [], warnings: warns };
  let arr;
  try {
    arr = JSON.parse(env.CUSTOM_PROVIDERS);
  } catch (e) {
    console.warn('[liuyao] CUSTOM_PROVIDERS 不是合法 JSON，已忽略:', e.message);
    return { providers: [], warnings: ['CUSTOM_PROVIDERS 不是合法 JSON：' + e.message] };
  }
  if (!Array.isArray(arr)) {
    console.warn('[liuyao] CUSTOM_PROVIDERS 应为 JSON 数组，实际为 ' + typeof arr + '，已忽略');
    return { providers: [], warnings: ['CUSTOM_PROVIDERS 应为 JSON 数组，实际为 ' + typeof arr] };
  }
  const out = [];
  arr.forEach(function (p, i) {
    if (!p || typeof p.id !== 'string' || !/^[a-z][a-z0-9]*$/.test(p.id)) {
      warns.push('第 ' + (i + 1) + ' 项 id 非法（应为小写字母数字）');
      return;
    }
    if (RESERVED_PROVIDER_IDS[p.id]) {
      warns.push(p.id + ' 是内置供应商 id，自定义条目不得占用，已忽略该条');
      return;
    }
    if (!Array.isArray(p.models) || !p.models.length) {
      warns.push(p.id + ' 未配置 models');
      return;
    }
    // base 缺失时保留旧行为（providerConfig 会回落到默认网关），但一旦填了就必须合规：
    // 宁可该供应商不上架，也不让一个 http/内网地址进到 fetch。
    if (p.base !== undefined && !isSafeProviderBase(p.base)) {
      warns.push(p.id + ' 的 base 非法（须为 https 公网地址，且不含账号密码），已忽略该条');
      return;
    }
    const safeModels = p.models.filter(isSafeModelId);
    const bannedModels = safeModels.filter(isBannedModelId);
    const models = safeModels.filter(function (m) { return !isBannedModelId(m); }).slice(0, 8);
    const dropped = p.models.length - safeModels.length;
    if (dropped > 0) warns.push(p.id + ' 有 ' + dropped + ' 个模型名含非法字符，已忽略');
    if (bannedModels.length) warns.push(p.id + ' 已禁用模型：' + bannedModels.join('、'));
    if (!models.length) { warns.push(p.id + ' 的模型名全部非法/被禁用，已忽略'); return; }
    const entry = Object.assign({}, p, { models: models });
    // label 非法时只删 label（models.js 的 `p.label || p.id` 会自然回退为 id），
    // 不整条丢弃供应商——否则后台一个引号就会让该供应商从清单里整体消失
    if (entry.label !== undefined && !isSafeProviderLabel(entry.label)) {
      warns.push(p.id + ' 的 label 非法（含引号/尖括号或超长），已回退为 id 显示');
      delete entry.label;
    }
    out.push(entry);
  });
  if (warns.length) console.warn('[liuyao] CUSTOM_PROVIDERS 部分条目被忽略：' + warns.join('；'));
  return { providers: out, warnings: warns };
}

export function customProviders(env) {
  return customProvidersWithWarnings(env).providers;
}

// 供应商配置告警（供 /api/models 一并向页面回传，用户可见「后台配错了」）。
// 旧版只覆盖 JSON 解析失败/非数组两种，条目级告警（id 非法、占用内置 id、
// 缺 models、模型名含非法字符、label 非法）只走 console.warn，页面无感知——
// 后台把 id 写成大写时，用户只看到供应商凭空消失而看不到原因。
export function customProviderWarnings(env) {
  return customProvidersWithWarnings(env).warnings;
}


export function customKeyEnv(id) { return id.toUpperCase().replace(/[^A-Z0-9]/g, '_') + '_API_KEY'; }

// 各供应商可用模型白名单（服务端校验，防任意模型名注入）
export function modelWhitelist(env) {
  const wl = {
    gemini: BUILTIN_MODELS.filter(function (m) { return m.key === 'GEMINI_API_KEY'; }).map(function (m) { return m.id; }),
    // deepseek-flash 现指向 V4.1-Flash-1017（官方原地替换快照，模型名不变）。
    // 旧版另挂的 DeepSeek 深推理型号自 2026-09-14 起已被官方重定向到 Flash 并按其费率计费，
    // 继续留在清单里会让用户误以为在跑该型号，故已从白名单移除。
    deepseek: BUILTIN_MODELS.filter(function (m) { return m.key === 'DEEPSEEK_API_KEY'; }).map(function (m) { return m.id; }),
    gpt: gptModelList(env)
  };
  customProviders(env).forEach(function (p) { wl[p.id] = p.models.slice(0, 8); });
  return wl;
}
