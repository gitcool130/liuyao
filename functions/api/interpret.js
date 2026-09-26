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
 *   DEEPSEEK_BASE_URL 默认 https://api.deepseek.com/v1
 *   GPT_API_KEY       secret，OpenAI 兼容接口 key（官方或中转均可）；别名 OPENAI_API_KEY
 *   GPT_BASE_URL      OpenAI 兼容接口地址，默认 https://api.openai.com/v1（中转接口改这里）；别名 OPENAI_BASE_URL
 *   GPT_MODELS        GPT 可用模型清单（逗号分隔），默认 gpt-6-luna,gpt-6-sol,gpt-6-astra；别名 OPENAI_MODELS
 *   兼容回退：LLM_API_KEY / LLM_BASE_URL（旧单模型配置）
 *   ACCESS_CODE       选填，设置后页面需输入访问口令
 */

// 供应商解析共享层（白名单 / 自定义供应商 / json 响应），与 models.js 同一口径
import { customProviders, customKeyEnv, modelWhitelist, json } from './_lib.js';

const SYSTEM_PROMPT = [
  '你是一位精通京房纳甲六爻的卦师，治学严谨，断卦有据。',
  '收到排盘后按以下次序通盘论断：',
  '一、列卦象要点：卦名卦宫、世应、用神（按所测之事取之，两现说明取舍）、动爻及其化出、月建日辰生克、旬空月破、冲合。',
  '二、断吉凶：以旺衰生克为纲，引经据典（《增删卜易》《卜筮正宗》等），术语用规范六爻术语，不得用现代心理学术语。',
  '三、断应期：据旬空、冲合、生扶之理推断应验之时。',
  '四、白话总结：用一段简明中文给出结论与建议。',
  '若信息不足，明确指出需补充何事，不得臆造。',
  '用户后续追问时，保持卦理一致，延续断卦思路作答。'
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

  if (env.ACCESS_CODE) {
    const code = request.headers.get('X-Access-Code') || '';
    if (code !== env.ACCESS_CODE) return json({ error: 'ACCESS_REQUIRED', message: '需要访问口令' }, 401);
  }

  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'BAD_JSON', message: '请求体解析失败' }, 400); }

  const panText = (body.panText || '').toString().slice(0, 8000);
  if (!panText) return json({ error: 'NO_PAN', message: '缺少排盘文本' }, 400);
  const history = Array.isArray(body.messages) ? body.messages.slice(-20) : [];

  const model = (body.model || '').toString();
  const wl = modelWhitelist(env);
  let provider = (body.provider || '').toString();
  if (!provider && model) provider = inferProvider(model, wl);
  if (!wl[provider]) return json({ error: 'BAD_PROVIDER', message: '未知供应商：' + provider }, 400);
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
      messages.push({ role: m.role, content: m.content.slice(0, 4000) });
    }
  });

  let url, headers, payload;
  if (isGoogle) {
    url = cfg.base + '/models/' + encodeURIComponent(model) + ':generateContent';
    headers = { 'x-goog-api-key': cfg.key, 'Content-Type': 'application/json' };
    const contents = messages.filter(function (m) { return m.role !== 'system'; }).map(function (m) {
      return { role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] };
    });
    payload = {
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: contents,
      generationConfig: { temperature: 0.3, thinkingConfig: { thinkingBudget: 0 } }
    };
  } else {
    url = cfg.base + '/chat/completions';
    headers = { 'Authorization': 'Bearer ' + cfg.key, 'Content-Type': 'application/json' };
    // 统一走流式（服务端拼接完整文本后返回），避免中转站网关的 60s 整响应硬超时
    payload = { model: model, messages: messages, stream: true };
    if (/^(gpt-5|o[134])/.test(model)) {
      // gpt-5 / o 系思考模型：不支持 temperature；推理强度可用环境变量 GPT_EFFORT 调（minimal/low/medium/high），默认 low 防超时
      const effort = (env.GPT_EFFORT || 'low').trim();
      if (effort && effort !== 'none') payload.reasoning_effort = effort;
    } else {
      payload.temperature = 0.3;
    }
  }

  // 流式 SSE 读取：拼接 delta.content（跳过 reasoning 思考链片段），突破网关整响应超时
  async function readSSE(resp) {
    const reader = resp.body.getReader();
    const dec = new TextDecoder();
    let buf = '', full = '';
    while (true) {
      const r = await reader.read();
      if (r.done) break;
      buf += dec.decode(r.value, { stream: true });
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
    }
    return full;
  }

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(payload)
    });
    if (!resp.ok) {
      const t = await resp.text();
      return json({ error: 'LLM_ERROR', message: '大模型接口返回 ' + resp.status, detail: t.slice(0, 500) }, 502);
    }
    const ct = (resp.headers.get('content-type') || '').toLowerCase();
    let reply = '';
    if (!isGoogle && payload.stream && ct.indexOf('text/event-stream') !== -1) {
      // 流式 SSE：拼接完整文本（个别中转站忽略 stream 参数回 JSON 时走下方兜底）
      reply = await readSSE(resp);
    } else {
      const data = await resp.json();
      if (isGoogle) {
        const cand = data.candidates && data.candidates[0];
        const parts = cand && cand.content && cand.content.parts;
        if (parts) reply = parts.map(function (p) { return p.text || ''; }).join('');
      } else {
        const choice = data.choices && data.choices[0];
        reply = choice && choice.message ? (choice.message.content || '') : '';
      }
    }
    if (!reply) return json({ error: 'EMPTY', message: '大模型返回为空' }, 502);
    return json({ reply: reply, provider: provider, model: model });
  } catch (e) {
    return json({ error: 'NET_ERROR', message: '无法连接大模型服务：' + e.message }, 502);
  }
}
