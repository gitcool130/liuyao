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

export function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}

// 请求体总大小闸门（L1）：await request.json() 会对任意大的 body 先全量读入内存，
// 之后才轮到字段级限长（panText 上限、jsonWithin 收缩）。CF 平台虽有请求体上限兜底，
// 但恶意大 JSON 仍会先吃掉 isolate 内存。这里按 Content-Length 提前拒绝。
// 局限：chunked 请求没有该头，只能靠字段限长与平台上限；故这是"早退"而非"边界"。
export const MAX_JSON_BODY = 512 * 1024;
export function bodyTooLarge(request) {
  const cl = parseInt(request.headers.get('content-length') || '0', 10);
  return cl > MAX_JSON_BODY;
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
  // CF-Connecting-IP 由边缘写入、客户端伪造会被剥离；X-Forwarded-For 仅非 CF 部署回退
  return request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
}

// 返回 null 表示放行；否则返回应直接下发的 Response（401 / 429）
export async function requireCode(request, expected, message) {
  if (!expected) return null;   // 未配置口令：保持开放（向后兼容本地/测试环境）
  const key = authKey(request);
  const now = Date.now();
  let rec = AUTH_FAILS.get(key);
  if (rec && now >= rec.until) { AUTH_FAILS.delete(key); rec = undefined; }
  if (rec && rec.n >= AUTH_MAX_FAILS) {
    return json({ error: 'TOO_MANY_ATTEMPTS', message: '口令错误次数过多，请 10 分钟后再试' }, 429);
  }
  const given = request.headers.get('X-Access-Code') || '';
  if (await safeEqual(given, expected)) {
    if (rec) AUTH_FAILS.delete(key);
    return null;
  }
  if (!rec) rec = { n: 0, until: now + AUTH_WINDOW_MS };
  rec.n++;
  AUTH_FAILS.set(key, rec);
  if (AUTH_FAILS.size > AUTH_MAX_IPS) {
    AUTH_FAILS.forEach(function (v, k) { if (now >= v.until) AUTH_FAILS.delete(k); });
  }
  return json({ error: 'ACCESS_REQUIRED', message: message }, 401);
}

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
