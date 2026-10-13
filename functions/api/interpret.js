/* Cloudflare Pages Function: POST /api/interpret
 * 排盘文本 + 对话历史 → 大模型断卦（多供应商：Gemini / DeepSeek）
 *
 * 请求体：{ panText, messages, provider, model }
 *   provider: 'gemini' | 'deepseek'（可省略，按 model 名自动推断）
 *   model:    见下方 MODELS 白名单
 *
 * 环境变量（Pages 项目设置 / wrangler.toml [vars] 配置）：
 *   GEMINI_API_KEY    secret，Google AI Studio key（AIza 开头）
 *   GEMINI_BASE_URL   走 CF AI Gateway 的 google-ai-studio 原生路径（绕开 Google 对数据中心 IP 的拒绝）
 *   DEEPSEEK_API_KEY  secret，DeepSeek key（sk- 开头）
 *   DEEPSEEK_BASE_URL secret，生产走 CF AI Gateway 的 /deepseek 路径（网关重试 + 日志）；
 *                      未配置时回退 https://api.deepseek.com/v1 直连
 *   GPT_API_KEY       secret，OpenAI 兼容接口 key（官方或中转均可）；别名 OPENAI_API_KEY
 *   GPT_BASE_URL      OpenAI 兼容接口地址，默认 https://api.openai.com/v1（中转接口改这里）；别名 OPENAI_BASE_URL
 *   GPT_MODELS        GPT 可用模型清单（逗号分隔），默认 gpt-6-luna,gpt-6-sol,gpt-6-astra；别名 OPENAI_MODELS
 *   兼容回退：LLM_API_KEY / LLM_BASE_URL（旧单模型配置）
 *   ACCESS_CODE       选填，设置后页面需输入访问口令（生产曾于 2026-09-28 启用，同日撤销，当前未设置）
 *   RATE_LIMIT_PER_MIN 选填，按访客 IP 的每分钟请求上限（**未设置则不限流**）。
 *                      仅本 isolate 内计数，属「降低」而非「根治」。
 *                      **生产当前未设 → 实际不限流**（2026-09-28 曾设 =20，同日按用户要求撤销）。
 *   LLM_TIMEOUT_MS    选填，上游大模型请求的硬超时（毫秒），默认 90000。
 *                      覆盖「建立连接 + 读完整个流」，防止上游挂起（不返回也不断开）时请求悬置。
 */

// 供应商解析共享层（白名单 / 自定义供应商 / json 响应 / 常量时间口令比较），与 models.js 同一口径
import { customProviders, customKeyEnv, modelWhitelist, json, safeEqual } from './_lib.js';

// 入模规模上限：单请求最多 4,000（排盘）+ 8×2,000（历史）≈ 20,000 字符。
// 旧值 8,000 + 20×4,000 ≈ 88,000，在未设 ACCESS_CODE 时是可直接放大的费用敞口。
const LIMITS = { panText: 4000, historyTurns: 8, perMessage: 2000 };

// 上游流式响应的双重守卫。上游（用户自配的 OpenAI 兼容中转）属「信任边界外」，
// 恶意或异常时可打爆 isolate 内存（CF Workers 上限 128 MB）：
//   ① 持续发送不含 '\n' 的数据 → 行缓冲 buf 永不切分，无限增长；
//   ② 发送无限多条 data: 行   → 拼接正文 full 无限增长。
// 两者正常都不会发生：SSE 单行远小于 1 MB，正常断卦答复远小于 200 KB（约 6 万汉字）。
const SSE_MAX_LINE = 1000000;
const SSE_MAX_REPLY = 200000;

// 从 OpenAI 兼容 SSE 的 delta 中取「应透传给客户端的最终答案文本」。
// 导出供 test-functions.mjs 直接驱动（Pages Functions 只把 onRequest* 视作
// 路由处理函数，其余导出不影响路由）。
// reasoning_content 是模型的思考草稿：实测案例（2026-10-13，百炼思考模型）中，
// 草稿先错判「世在四爻妻财庚辰」、正式稿已自我纠正为「世在三爻妻财庚辰」，
// 旧版 pipeMergedSSE 把草稿一并拼接下传，导致断后 fact-audit 对全文字面
// 匹配出 6 处「与卦盘不符」的假阳性。故正文只认 content，草稿另走缓冲兜底。
export function deltaText(d) {
  if (!d || typeof d !== 'object') return '';
  return typeof d.content === 'string' ? d.content : '';
}

// 取思考草稿文本（仅用于「整条流无任何 content」时的兜底补发，见 pipeMergedSSE）。
export function deltaReasoning(d) {
  if (!d || typeof d !== 'object') return '';
  return typeof d.reasoning_content === 'string' ? d.reasoning_content : '';
}

// 按 IP 的滑动窗口限流（默认关闭，仅在配置了 RATE_LIMIT_PER_MIN 时生效）。
// 生产当前未设该变量 → 恒不触发；本函数保留为可随时启用的软开关。
// 模块级 Map 在 CF Workers 中随 isolate 存活，跨 isolate 不共享，故只是成本抑制的兜底。
const RL_HITS = new Map();
const RL_MAX_IPS = 5000;      // 单 isolate 内最多跟踪的 IP 数
const RL_WINDOW_MS = 60000;   // 窗口长度：1 分钟
// 导出供 test-functions.mjs 直接驱动（与 records.js 导出 jsonWithin/safeEqual 同一先例：
// Pages Functions 只把 onRequest* 视作路由处理函数，其余导出不影响路由）。
export function isRateLimited(request, env) {
  const limit = parseInt(env.RATE_LIMIT_PER_MIN || '0', 10);
  if (!limit || limit <= 0) return false;
  const now = Date.now();
  // IP 取用顺序：CF-Connecting-IP 由 Cloudflare 边缘写入，客户端伪造值会被边缘剥离，可信；
  // X-Forwarded-For 仅作非 CF 部署（本地 wrangler dev 等）的回退——该环境下它可被客户端伪造，
  // 故此时的限流只能算「降级可用」，不可作为安全边界。
  const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
  if (RL_HITS.size > RL_MAX_IPS) {
    // 只淘汰「窗口内已无有效计数」的 IP。旧版直接 clear() 会把正在被限流的访客一并放行。
    RL_HITS.forEach(function (arr, k) {
      if (!arr.length || now - arr[arr.length - 1] >= RL_WINDOW_MS) RL_HITS.delete(k);
    });
  }
  let hits = RL_HITS.get(ip);
  if (!hits) { hits = []; RL_HITS.set(ip, hits); }
  // 原地滑窗：把过期时间戳去掉（不新建数组，避免每次请求都分配）
  let keep = 0;
  for (let i = 0; i < hits.length; i++) { if (now - hits[i] < RL_WINDOW_MS) hits[keep++] = hits[i]; }
  hits.length = keep;
  // 达限即拒、且不再入队，使单个 IP 的数组长度被硬封顶在 limit。
  // 旧版无脑 push 后判 `length > limit`——判定结果与本写法等价，但数组会随请求数无界增长。
  if (hits.length >= limit) return true;
  hits.push(now);
  return false;
}

// ⚠ 与 public/app.js 的 SYSTEM_PROMPT 为同一份契约的两处副本：
//    改任一边都必须同步改另一边（app.js 那份还用于「复制请求内容手动断卦」的降级场景）。
//    test-functions.mjs 有断言守住「两份提示词的关键契约行一致」，见该文件 absorb 组。
export const SYSTEM_PROMPT = [
  '你是一位精通京房纳甲六爻的卦师，治学严谨，断卦有据。',
  '收到排盘后按以下次序通盘论断：',
  '一、列卦象要点：卦名卦宫、世应、用神（按所测之事取之，两现说明取舍）、动爻及其化出、月建日辰生克、旬空月破、冲合。',
  '二、断吉凶：以旺衰生克为纲，引经据典（《增删卜易》《卜筮正宗》等），术语用规范六爻术语，不得用现代心理学术语。',
  '三、断应期：据旬空、冲合、生扶之理推断应验之时。',
  '四、白话总结：用一段简明中文给出结论与建议。',
  '若信息不足，明确指出需补充何事，不得臆造。',
  // ↓ 上层契约四段：不可改盘 / 主次次序 / 追问沿用原盘 / 现实边界
  '【盘面事实不可改写】排盘里的六亲、纳甲、世应、动爻、旬空、月破、伏神均为程序确定性推算结果；' +
  '不得重新推算、不得改写，也不得写出与之矛盾的表述。吉凶、应期与取象可作传统推断，但须与盘面一致。',
  '【主次次序】以作用到世、应、用神的实际生克冲合为主证据；只出现在卦中却未作用到主线的结构，' +
  '列为辅助信息，不得升级为结论。不得用正负计分替代断卦。',
  '【追问沿用原盘】用户就同一事继续追问时，沿用本次排盘的起卦时刻、月日、爻值、世应与用神主线，' +
  '不重新起卦、不因当前日期变化而重算原盘、不事后改写首次结论；' +
  '只有当事项、对象、目标或时间范围发生实质变化时才说明需另起一卦。',
  '【现实边界】健康、生死、失踪、胎儿性别、重大财法决策不得由卦象替代现实判断；' +
  '涉及此类内容须明确提示就医、报警或咨询专业人士，不得写成医学诊断或法律意见。'
].join('\n');

function providerConfig(env, provider) {
  if (provider === 'gemini') {
    return {
      name: 'gemini',
      key: env.GEMINI_API_KEY || env.LLM_API_KEY || '',
      base: (env.GEMINI_BASE_URL || env.LLM_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, '')
    };
  }
  if (provider === 'deepseek') {
    return {
      name: 'deepseek',
      key: env.DEEPSEEK_API_KEY || env.LLM_API_KEY || '',
      base: (env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1').replace(/\/$/, '')
    };
  }
  if (provider === 'gpt') {
    // OpenAI 兼容接口（官方 api.openai.com 或任意中转/代理均可）
    return {
      name: 'gpt',
      key: env.GPT_API_KEY || env.OPENAI_API_KEY || '',
      base: (env.GPT_BASE_URL || env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '')
    };
  }
  // 自定义供应商（CUSTOM_PROVIDERS 声明的），密钥取 <ID>_API_KEY
  const cp = customProviders(env).filter(function (p) { return p.id === provider; })[0];
  if (cp) {
    return {
      name: provider,
      key: env[customKeyEnv(provider)] || '',
      base: (cp.base || 'https://api.openai.com/v1').replace(/\/$/, '')
    };
  }
  return null;
}

function inferProvider(model, wl) {
  const customs = Object.keys(wl).filter(function (k) { return k !== 'gemini' && k !== 'deepseek' && k !== 'gpt'; });
  for (let i = 0; i < customs.length; i++) {
    if (wl[customs[i]].indexOf(model) >= 0) return customs[i];
  }
  if (wl.gemini.indexOf(model) >= 0) return 'gemini';
  if (wl.deepseek.indexOf(model) >= 0) return 'deepseek';
  if (wl.gpt.indexOf(model) >= 0) return 'gpt';
  if (model.indexOf('gpt-') === 0 || model.indexOf('o1') === 0 || model.indexOf('o3') === 0) return 'gpt';
  return null;
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (isRateLimited(request, env)) {
    return json({ error: 'RATE_LIMITED', message: '请求过于频繁，请稍后重试' }, 429);
  }

  if (env.ACCESS_CODE) {
    const code = request.headers.get('X-Access-Code') || '';
    // 与 records.js 共用同一常量时间实现（旧版此处是明文 !==，属同类修复未收口）
    if (!(await safeEqual(code, env.ACCESS_CODE))) return json({ error: 'ACCESS_REQUIRED', message: '需要访问口令' }, 401);
  }

  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'BAD_JSON', message: '请求体解析失败' }, 400); }
  // JSON 文本 null 是合法 JSON，await request.json() 返回 null 而不抛错，
  // 下一行 body.panText 会解引用 null 抛未捕获 TypeError → 无 error code 的通用 500，
  // 前端 isRetriableError 也无法归类。
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return json({ error: 'BAD_JSON', message: '请求体应为 JSON 对象' }, 400);
  }

  const panText = (body.panText || '').toString().slice(0, LIMITS.panText);
  if (!panText) return json({ error: 'NO_PAN', message: '缺少排盘文本' }, 400);
  const history = Array.isArray(body.messages) ? body.messages.slice(-LIMITS.historyTurns) : [];

  const model = (body.model || '').toString();
  const wl = modelWhitelist(env);
  let provider = (body.provider || '').toString();
  if (!provider && model) provider = inferProvider(model, wl);
  // 必须用 owns 判定：wl 是普通对象字面量，`wl['constructor']` / `wl['__proto__']` 等
  // 会命中 Object.prototype 上的继承属性（truthy），使下一行 .indexOf 抛 TypeError → 边缘 500。
  if (!Object.prototype.hasOwnProperty.call(wl, provider)) {
    return json({ error: 'BAD_PROVIDER', message: '未知供应商：' + provider }, 400);
  }
  if (wl[provider].indexOf(model) < 0) {
    return json({ error: 'BAD_MODEL', message: '供应商 ' + provider + ' 不支持模型：' + model + '（可选：' + wl[provider].join(' / ') + '）' }, 400);
  }

  const cfg = providerConfig(env, provider);
  if (!cfg.key) return json({ error: 'NO_KEY', message: '服务端未配置 ' + provider.toUpperCase() + '_API_KEY 环境变量' }, 500);

  // Google 原生接口（generativelanguage.googleapis.com 或 AI Gateway 的 google-ai-studio 原生路径）
  // 走 generateContent + x-goog-api-key，并关闭 thinking（思考路径常因 high demand 503）；
  // 其余（含 Gateway 的 /openai 兼容路径、DeepSeek 等）按 OpenAI 兼容接口处理
  const isGoogle = cfg.base.indexOf('generativelanguage.googleapis.com') !== -1 ||
    (cfg.base.indexOf('google-ai-studio') !== -1 && cfg.base.slice(-7) !== '/openai');

  const messages = [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: panText }];
  history.forEach(function (m) {
    if (m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content) {
      messages.push({ role: m.role, content: m.content.slice(0, LIMITS.perMessage) });
    }
  });

  // CF AI Gateway 请求头：网关默认超时（实测 DeepSeek 约 91s）短于函数侧，
  // 显式声明与函数侧一致，避免网关先超时丢包。
  // 同时覆盖默认 3 次指数重试：DeepSeek 本身慢且大概率能成，网关重试会拖死 Worker；
  // Gemini/GPT 等快模型保留轻量重试，constant 1s 延迟足够覆盖偶发 503/429。
  // 注意：必须对**所有**走网关的分支生效——旧版只加在 OpenAI 兼容分支，
  // 而 GEMINI_BASE_URL 指向 gateway 的 google-ai-studio 路径时（README 记载的
  // 生产通道）不带头，函数侧等 300s、网关 ~91s 先 504，与注释意图相悖。
  function gatewayHeaders(base) {
    const h = {};
    if (base.indexOf('gateway.ai.cloudflare.com') === -1) return h;
    h['cf-aig-request-timeout'] = String(timeoutMs);
    h['cf-aig-max-attempts'] = provider === 'deepseek' ? '1' : '2';
    h['cf-aig-retry-delay'] = '1000';
    h['cf-aig-backoff'] = 'constant';
    return h;
  }

  // 按模型组装一次上游调用（Google 原生 generateContent；其余 OpenAI 兼容流式）。
  // 抽成函数是为了「跨模型降级」：备选模型要用同一套参数构造规则再发一次。
  function buildCall(modelId) {
    if (isGoogle) {
      const contents = messages.filter(function (m) { return m.role !== 'system'; }).map(function (m) {
        return { role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] };
      });
      return {
        url: cfg.base + '/models/' + encodeURIComponent(modelId) + ':generateContent',
        headers: Object.assign(
          { 'x-goog-api-key': cfg.key, 'Content-Type': 'application/json' },
          gatewayHeaders(cfg.base)
        ),
        payload: {
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents: contents,
          generationConfig: { temperature: 0.3, thinkingConfig: { thinkingBudget: 0 } }
        }
      };
    }
    // 统一走流式（服务端拼接完整文本后返回），避免中转站网关的 60s 整响应硬超时
    const payload = { model: modelId, messages: messages, stream: true };
    if (/^(gpt-5|o[134])/.test(modelId)) {
      // gpt-5 / o 系思考模型：不支持 temperature；推理强度可用环境变量 GPT_EFFORT 调（minimal/low/medium/high），默认 low 防超时
      const effort = (env.GPT_EFFORT || 'low').trim();
      if (effort && effort !== 'none') payload.reasoning_effort = effort;
    } else {
      payload.temperature = 0.3;
    }
    const headers = Object.assign(
      { 'Authorization': 'Bearer ' + cfg.key, 'Content-Type': 'application/json' },
      gatewayHeaders(cfg.base)
    );
    return {
      url: cfg.base + '/chat/completions',
      headers: headers,
      payload: payload
    };
  }

  // 【死代码，保留备查】流式透传上线后已无调用点（2026-10-13 审计确认）。
  // SSE_MAX_* 双守卫已迁入活路径 pipeMergedSSE；此函数仅留作「非流式降级」
  // 的参考实现，若中转站忽略 stream 参数回 JSON 需重新启用，勿直接删除——
  // 其中的守卫语义（LINE_OVERFLOW / REPLY_OVERFLOW）是活路径的对齐基准。
  async function readSSE(resp) {
    const reader = resp.body.getReader();
    const dec = new TextDecoder();
    let buf = '', full = '', cut = null;
    while (true) {
      const r = await reader.read();
      if (r.done) break;
      buf += dec.decode(r.value, { stream: true });
      // 守卫①：上游持续发送不含换行的数据，行缓冲永不切分。撞上即判定为异常流并断开。
      if (buf.length > SSE_MAX_LINE) { cut = 'LINE_OVERFLOW'; break; }
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (line.indexOf('data:') !== 0) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        try {
          const j = JSON.parse(data);
          const c = j.choices && j.choices[0];
          const d = c && c.delta;
          if (d && d.content) full += d.content;
          else if (c && c.message && c.message.content) full += c.message.content; // 部分中转站流里回完整段
        } catch (e) { /* 忽略无法解析的分片 */ }
      }
      // 守卫②：上游发送无限多条 data: 行，拼接正文无限增长。保留已收到的部分答复后断开。
      if (full.length > SSE_MAX_REPLY) { cut = 'REPLY_OVERFLOW'; break; }
    }
    if (cut) { try { await reader.cancel(); } catch (e) { /* 上游已断开则忽略 */ } }
    return { text: full.slice(0, SSE_MAX_REPLY), cut: cut };
  }

  // 上游硬超时。fetch 默认无超时，上游挂起（不返回也不断开）会让该请求一直悬置，
  // 流式只绕过了「整响应超时」，并不自带超时保护。计时覆盖「建连 + 读完整流」全程；
  // Gemini 断卦约 10–30 s；DeepSeek（含深推理模型）可超 90 s，默认 300 s 留足余量
  // （可用 LLM_TIMEOUT_MS 调）。
  // 计时器覆盖主调用与降级重试的总时长，超时任一环节都会被 abort 并落入下方 504 分支。
  const timeoutMs = Math.max(1000, parseInt(env.LLM_TIMEOUT_MS || '300000', 10) || 300000);
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(function () { timedOut = true; ctrl.abort(); }, timeoutMs);
  // 流式透传路径的超时保护必须延续到「读完整条流」全程。
  // return new Response(readable) 会同步触发下方 finally，若在 finally 里无条件
  // clearTimeout，计时器在流还没开始读时就已注销，上游挂起将导致请求无限悬挂。
  // 故流式分支把计时器「托管」给 pipeMergedSSE，由其在流结束时清除；
  // 心跳 setInterval 同理，随流生命周期启停。
  let timerHandedOff = false;
  let heartbeat = null;

  // 单次上游尝试。成功 → { reply, cut }；失败 → { fail: { status, detail, retryable } }。
  // retryable=false 表示 4xx 客户端错误（模型名非法/请求体错误等），换模型重试无意义；
  // 429/5xx 与网络错误视为可恢复，允许跨模型降级。
  async function attempt(modelId) {
    const call = buildCall(modelId);
    let resp;
    try {
      resp = await fetch(call.url, {
        method: 'POST',
        headers: call.headers,
        body: JSON.stringify(call.payload),
        signal: ctrl.signal
      });
    } catch (e) {
      if (timedOut) throw e;   // 硬超时交由外层统一返回 504
      return { fail: { status: 0, detail: e.message, retryable: true } };
    }
    if (!resp.ok) {
      const t = await resp.text();
      const st = resp.status;
      return { fail: { status: st, detail: t.slice(0, 500), retryable: st === 429 || st >= 500 } };
    }
    const ct = (resp.headers.get('content-type') || '').toLowerCase();
    if (!isGoogle && call.payload.stream && ct.indexOf('text/event-stream') !== -1) {
      // 上游返回 SSE 时，直接透传给客户端，避免服务端缓冲导致 CF 边缘 524 超时。
      // 服务端拼接完整文本的旧路径已弃用：DeepSeek v4-pro 整体响应可超 120s，
      // CF 边缘约 100s 无数据即断连；透传流式后首字节一到即开始向下发送。
      return { stream: resp };
    }
    const data = await resp.json();
    if (isGoogle) {
      const cand = data.candidates && data.candidates[0];
      const parts = cand && cand.content && cand.content.parts;
      return { reply: parts ? parts.map(function (p) { return p.text || ''; }).join('') : '', cut: null };
    }
    const choice = data.choices && data.choices[0];
    return { reply: choice && choice.message ? (choice.message.content || '') : '', cut: null };
  }

  try {
    let usedModel = model;
    let r = await attempt(usedModel);
    // gemini 跨模型降级（2026-10-12）：所选模型可恢复性失败（429/5xx/网络错误）时，
    // 自动落到同族备选模型重试一次。起因：gemini-3.8-flash 常因 Google 侧 high demand
    // 整段 503（AI Gateway 日志自 2026-10-01 起反复出现），网关 3 次重试盖不住持续拥塞；
    // 4xx 属配置/请求错误，换模型同样失败，不降级。
    // 备选也失败时保留**首次**错误返回——它更贴近用户所选模型的真实状态。
    let fellBackTo = null;
    if (r.fail && r.fail.retryable && provider === 'gemini') {
      const alt = wl.gemini.filter(function (m) { return m !== model; })[0];
      if (alt) {
        const r2 = await attempt(alt);
        if (!r2.fail) { fellBackTo = alt; usedModel = alt; r = r2; }
      }
    }
    if (r.fail) {
      // 上游原始错误体只进服务端日志，不回传客户端：本端点未配 ACCESS_CODE /
      // RATE_LIMIT_PER_MIN 时完全开放，而自配中转站的错误响应可能回显请求头或
      // key（部分中转确有此类行为），直接透出会造成 *_API_KEY 泄露。
      // 前端只需 data.error 即可完成重试分类，detail 对它没有价值。
      if (r.fail.status === 0) {
        console.error('[liuyao] 上游连接失败:', r.fail.detail);
        return json({ error: 'NET_ERROR', message: '无法连接大模型服务，请稍后重试' }, 502);
      }
      console.error('[liuyao] 上游返回 ' + r.fail.status + ':', r.fail.detail);
      return json({ error: 'LLM_ERROR', message: '大模型接口返回 ' + r.fail.status + '，请稍后重试' }, 502);
    }
    if (r.stream) {
      // 透传 SSE 流到客户端。三个关键点：
      // ① 计时器托管：return 会触发 finally，此处置位使 finally 不清除 timer，
      //    由 pipeMergedSSE 在流结束时清除——否则上游挂起时请求无限悬挂。
      // ② 周期心跳：开头那一次 : ping 只是「首字节」，不构成心跳；上游思考期
      //    （DeepSeek 可数十秒无输出）超过 CF 边缘 100s 无数据即遭 524 断连，
      //    故每 15s 主动写一次注释行，保持连接活跃。
      // ③ 守卫与终止语义：把 readSSE（已弃用死代码）的 SSE_MAX_* 双守卫迁到这里，
      //    撞限或上游中断时向下游写 data:{"error":...} 终止事件，客户端据此区分
      //    「正常完篇」与「中途断流」并走重试；旧版 .catch(()=>{}) 静默吞错后
      //    w.close() 正常关闭，客户端会把无声截断的半篇当作完整答案渲染。
      timerHandedOff = true;
      const { readable, writable } = new TransformStream();
      const enc = new TextEncoder();
      const writer = writable.getWriter();
      writer.write(enc.encode(': ping\n\n'));
      writer.releaseLock();

      async function pipeMergedSSE(upstream) {
        const reader = upstream.body.getReader();
        const dec = new TextDecoder();
        const w = writable.getWriter();
        let buf = '', outLen = 0, cut = null, reasBuf = '';
        // 向客户端写终止/错误事件（客户端 readStreamSSE 据此 throw 触发重试）
        const writeErr = async function (code, msg) {
          try {
            await w.write(enc.encode('data: ' + JSON.stringify({ error: code, message: msg }) + '\n\n'));
          } catch (e) { /* 客户端已断开则忽略 */ }
        };
        try {
          while (true) {
            const r = await reader.read();
            if (r.done) break;
            buf += dec.decode(r.value, { stream: true });
            // 守卫①：上游持续发送不含换行的数据，行缓冲永不切分。撞上即判定为异常流并断开。
            if (buf.length > SSE_MAX_LINE) {
              cut = 'LINE_OVERFLOW';
              await writeErr(cut, '上游单行数据异常，已中断');
              break;
            }
            let idx;
            while ((idx = buf.indexOf('\n')) >= 0) {
              const line = buf.slice(0, idx).trim();
              buf = buf.slice(idx + 1);
              if (!line || line.indexOf(':') === 0) continue;
              if (line.indexOf('data:') !== 0) continue;
              const data = line.slice(5).trim();
              if (!data || data === '[DONE]') continue;
              let chunk = '';
              try {
                const j = JSON.parse(data);
                const c = j.choices && j.choices[0];
                const d = c && c.delta;
                if (d) {
                  // 只透传最终答案（content）。reasoning_content 是模型的思考
                  // 草稿：内含未经纠正的临时判断（实测：草稿写「世在四爻妻财」，
                  // 正式稿实为「世在三爻」），旧版把草稿一并拼接下传，后果有三：
                  // ① 断语正文被独白污染，用户先读一大段「我们需要回答用户……」；
                  // ② 断后 fact-audit 对全文字面匹配，把草稿里的临时错判当真
                  //    断语校对，误报 6 处「与卦盘不符」；
                  // ③ 追问历史（records 落库）存进带草稿的版本，后续追问被污染。
                  // 草稿仅缓冲不发送；仅当整条流没有任何 content 时，流末兜底
                  // 补发（见下方 reasBuf 补发段）。
                  chunk += deltaText(d);
                  if (!chunk) {
                    const rc = deltaReasoning(d);
                    if (rc && reasBuf.length <= SSE_MAX_REPLY) reasBuf += rc;
                  }
                } else if (c && c.message && c.message.content) {
                  chunk = c.message.content;
                }
              } catch (e) { /* 忽略无法解析的分片 */ }
              if (chunk) {
                outLen += chunk.length;
                // 守卫②：正文总长上限，防上游不限流数据打爆 isolate 内存
                if (outLen > SSE_MAX_REPLY) {
                  cut = 'REPLY_OVERFLOW';
                  await writeErr(cut, '上游返回过长，已截断');
                  break;
                }
                await w.write(enc.encode('data: ' + JSON.stringify({ t: chunk }) + '\n\n'));
              }
            }
            if (cut) break;
          }
          // 兜底补发：全程只有 reasoning_content、没有任何 content（个别中转/模型
          // 把最终答案也放进思考字段）时，流末一次性补发，避免客户端按「空响应」
          // 重试或报 EMPTY。走到这里只可能是 r.done 正常收流（撞守卫已 break 且被
          // !cut 挡下），正常有 content 的流 outLen > 0 同样不触发。
          if (!cut && outLen === 0 && reasBuf) {
            try {
              await w.write(enc.encode('data: ' + JSON.stringify({ t: reasBuf }) + '\n\n'));
            } catch (e) { /* 客户端已断开则忽略 */ }
          }
        } catch (e) {
          // 上游断连 / abort（含超时）：告知客户端这是中断而非完篇
          await writeErr(timedOut ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_STREAM_ERROR',
            timedOut ? '上游响应超时' : ('上游连接中断：' + (e && e.message ? e.message : '未知原因')));
        } finally {
          if (heartbeat) { clearInterval(heartbeat); heartbeat = null; }
          clearTimeout(timer);
          try { reader.cancel(); } catch (e) { /* 上游已断开则忽略 */ }
          try { w.close(); } catch (e) { /* 已关闭则忽略 */ }
        }
      }

      // 周期心跳：每 15s 写一次注释行。SSE 注释行以 : 开头，客户端解析器跳过。
      heartbeat = setInterval(function () {
        writer.write(enc.encode(': ping\n\n')).catch(function () { /* 客户端断开则停 */ });
      }, 15000);
      pipeMergedSSE(r.stream).catch(function () { /* 错误已在 pipeMergedSSE 内处理并写终止事件 */ });
      return new Response(readable, {
        headers: {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive'
        }
      });
    }
    if (!r.reply) return json({ error: 'EMPTY', message: '大模型返回为空' }, 502);
    // 被守卫截断时仍返回已收到的部分答复，并带上原因（truncated 缺省时不出现在 JSON 里）；
    // 发生降级时 fallback 标出实际兜底模型（未降级则不出现该字段）
    return json({ reply: r.reply, provider: provider, model: usedModel, truncated: r.cut || undefined, fallback: fellBackTo || undefined });
  } catch (e) {
    if (timedOut) {
      return json({ error: 'LLM_TIMEOUT', message: '大模型 ' + Math.round(timeoutMs / 1000) + ' 秒内未返回完整响应，请重试或改用更快的模型' }, 504);
    }
    return json({ error: 'NET_ERROR', message: '无法连接大模型服务：' + e.message }, 502);
  } finally {
    // 流式路径的计时器已托管给 pipeMergedSSE（其 finally 负责 clearTimeout），
    // 此处跳过；否则 return Response 时会提前注销超时保护。
    if (!timerHandedOff) clearTimeout(timer);
    if (heartbeat) { clearInterval(heartbeat); heartbeat = null; }
  }
}

// 仅供测试的只读探针：暴露限流内部计数长度（不导出 RL_HITS 本体，避免测试耦合实现细节）。
// 用于断言「单 IP 的 hits 数组被封顶在 limit」——旧版无脑 push 时会随请求数无界增长。
export function __rlState() {
  const out = [];
  RL_HITS.forEach(function (arr, ip) { out.push({ ip: ip, len: arr.length }); });
  return out;
}
