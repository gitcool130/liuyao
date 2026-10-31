/**
 * /api/vote —— 三模型对账（Workers AI 免费额度内）
 *
 * 定位：**诊断信号，不是决策信号**。三票不决定吉凶，只回答一个问题——
 *   「同一张盘、同一套前提，不同模型会不会给出不同的取用神/旺衰/可成概率」。
 *   三票同错 = 规则链的问题；单票错 = 该模型没遵守前提。见 README §对账。
 *
 * 为什么用 Workers AI：无需新凭据，绑定即用；`clef` 家族直接给概率、不收输出费。
 * 实测一轮三票约 17 neurons，免费额度 10000/天 ≈ 500 轮（2026-10-29 实测）。
 *
 * 请求：POST { state: string(≤1500), ask?: string(≤200) }
 * 响应：{ votes: [{ id, label, org, ok, ms, probs, answer, basis, error }], usage: {...} }
 *        probs 形状固定为 { yong, wang, cheng, qi }，与前端分歧矩阵一一对应。
 *        basis 是**模型自述的规则名**（已剥书名号），一律未经原典核验 —— 前端据此渲染「依据层」，
 *        不得当作可回溯的古籍引文；可回溯的引文只在 core/analyze.js 的 basis 字段里。
 */
import { json, requireCode as requireCodeGate } from './_lib.js';

const MAX_STATE = 1500;
const MAX_ASK = 200;
const PER_MODEL_TIMEOUT = 28000;

const YONG_LABEL = { cai: '妻财', guan: '官鬼', fu: '父母', xiong: '兄弟', zi: '子孙' };
const WANG_LABEL = { ji_ruo: '极弱', ruo: '弱', ping: '平', wang: '旺', ji_wang: '极旺' };
const QI_LABEL = { ben_xun: '本旬', xia_xun: '下旬', yue_nei: '月内', yue_wai: '月外' };

// chat 模型回的是单个词，归一化成 one-hot 分布，好让前端一套渲染通吃。
const YONG_ALIAS = { 妻财: 'cai', 财: 'cai', 官鬼: 'guan', 鬼: 'guan', 父母: 'fu', 父: 'fu', 兄弟: 'xiong', 兄: 'xiong', 子孙: 'zi', 子: 'zi' };
const WANG_ALIAS = { 极弱: 'ji_ruo', 弱: 'ruo', 平: 'ping', 旺: 'wang', 极旺: 'ji_wang' };
const QI_ALIAS = { 本旬: 'ben_xun', 下旬: 'xia_xun', 月内: 'yue_nei', 月外: 'yue_wai' };

const CRITERIA = {
  yong: {
    cai: '求财、货物、妻妾，以妻财为用',
    guan: '功名、官讼、疾病之病神，以官鬼为用',
    fu: '文书、房屋、长辈、信息，以父母为用',
    xiong: '兄弟、同辈、劫财之神，以兄弟为用',
    zi: '子孙、晚辈、医药、解忧，以子孙为用'
  },
  wang: { ji_ruo: '休囚无生且受重克', ruo: '受克或休囚，救应不足', ping: '生克相抵', wang: '得月建或日辰生扶，克力不足', ji_wang: '月建日辰双重生扶或临旺地' },
  qi: { ben_xun: '应在当前旬内', xia_xun: '应在下一旬', yue_nei: '应在本月内', yue_wai: '应在本月之外' }
};

const MODELS = [
  { id: 'clef', label: 'clef 27B', org: 'Cloudflare', model: '@cf/cloudflare/clef', kind: 'clef' },
  { id: 'qwen', label: 'Qwen3-30B', org: '阿里', model: '@cf/qwen/qwen3-30b-a3b-fp8', kind: 'chat' },
  { id: 'gptoss', label: 'gpt-oss-120b', org: 'OpenAI 开源', model: '@cf/openai/gpt-oss-120b', kind: 'chat' }
];

function chatPrompt(state, ask) {
  return state + '\n\n' + (ask ? '占问：' + ask + '\n\n' : '') +
    '请按盘面判读，只输出一行 JSON，不要解释、不要代码块：\n' +
    '{"用神":"妻财|官鬼|父母|兄弟|子孙","旺衰":"极弱|弱|平|旺|极旺","可成":0到1之间的小数,"应期":"本旬|下旬|月内|月外","依据":"所据规则名，16字内"}\n' +
    '「依据」只写规则名称（如「用神月破无救」），不要写书名、不要加引号——本接口不核验古籍原文。';
}

// 从可能带围栏、带前言、带尾注的回复里抠出第一个完整 JSON 对象
function extractJson(text) {
  if (!text) return null;
  let s = String(text).replace(/```json/gi, '```').replace(/```/g, '');
  const i = s.indexOf('{');
  if (i < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let k = i; k < s.length; k++) {
    const c = s[k];
    if (esc) { esc = false; continue; }
    if (c === '\\') { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(s.slice(i, k + 1)); } catch (e) { return null; }
      }
    }
  }
  return null;
}

function oneHot(labels, alias, raw) {
  const key = String(raw || '').trim();
  let hit = null;
  for (const name in alias) { if (key.indexOf(name) >= 0) { hit = alias[name]; break; } }
  const out = {};
  for (const k in labels) out[labels[k]] = k === hit ? 1 : 0;
  return { probs: out, hit: hit };
}

function clamp01(v) {
  if (v == null) return null;
  // 容忍 "0.62" / "75%" / "七成" 里的数字：先剥非数字字符，再按百分数拆
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[^\d.\-]/g, ''));
  if (!isFinite(n)) return null;
  const x = n > 1 && n <= 100 ? n / 100 : n;
  return x < 0 ? 0 : (x > 1 ? 1 : x);
}

/** 把 clef 的 answers 归一化成 { yong, wang, cheng, qi } */
function normalizeClef(res) {
  const a = (res && res.answers) || {};
  const pick = function (dim, labels) {
    const node = a[dim] || {};
    const src = node.probabilities || {};
    const out = {};
    let covered = 0;
    for (const k in labels) { out[labels[k]] = typeof src[k] === 'number' ? src[k] : 0; covered += out[labels[k]]; }
    // 归一化到 1：模型偶尔只覆盖部分选项，缺的按 0 处理但总和须为 1，否则进度条会失真
    if (covered > 0 && Math.abs(covered - 1) > 1e-6) {
      for (const k in out) out[k] = out[k] / covered;
    }
    return out;
  };
  const noul = a.cheng && typeof a.cheng.noul === 'number' ? a.cheng.noul : null;
  return {
    probs: { yong: pick('yong', YONG_LABEL), wang: pick('wang', WANG_LABEL), cheng: { noul: noul == null ? 0.5 : noul }, qi: pick('qi', QI_LABEL) },
    answer: null
  };
}

/** 把 chat 模型的 JSON 文本归一化成同一形状；解析失败即判该票无效（不猜） */
function normalizeChat(text) {
  const o = extractJson(text);
  if (!o) return { error: 'UNPARSEABLE', answer: text ? String(text).slice(0, 200) : '' };
  const y = oneHot(YONG_LABEL, YONG_ALIAS, o['用神'] || o.yongshen);
  const w = oneHot(WANG_LABEL, WANG_ALIAS, o['旺衰'] || o.wangshuai);
  const q = oneHot(QI_LABEL, QI_ALIAS, o['应期'] || o.yingqi);
  const c = clamp01(o['可成'] != null ? o['可成'] : o.cheng);
  const missing = [];
  if (!y.hit) missing.push('用神');
  if (!w.hit) missing.push('旺衰');
  if (c == null) missing.push('可成');
  if (!q.hit) missing.push('应期');
  if (missing.length) return { error: 'BAD_FIELDS:' + missing.join('/'), answer: String(text).slice(0, 200) };
  return { probs: { yong: y.probs, wang: w.probs, cheng: { noul: c }, qi: q.probs }, answer: String(text).slice(0, 400), basis: cleanBasis(o['依据'] || o.basis) };
}

/**
 * 模型自述的规则名 —— 只留规则名，剥掉一切「看起来像古籍引文」的装饰。
 *
 * 前端「依据层」早先展示的是带书名号的引文，实测全部是编造的（语料 404 例中检索不到）。
 * 模型仍爱在 JSON 里顺手写「……——《增删卜易》」，故此处主动剥除书名号与引号，
 * 并在前端一律标「模型自述 · 未核验」：宁可信息少一点，也不让编造的引文看起来像可回溯的原文。
 */
function cleanBasis(v) {
  const s = String(v == null ? '' : v).replace(/[《》〈〉「」『』“”"']/g, '').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  return s.slice(0, 32);
}

function withTimeout(promise, ms) {
  let timer;
  const guard = new Promise(function (resolve) {
    timer = setTimeout(function () { resolve({ ok: false, error: 'TIMEOUT' }); }, ms);
  });
  const task = promise.then(function (v) { return { ok: true, value: v }; })
    .catch(function (e) { return { ok: false, error: String((e && e.message) || e) }; });
  return Promise.race([task, guard]).then(function (r) { clearTimeout(timer); return r; });
}

function runOne(env, m, state, ask) {
  const t0 = Date.now();
  const call = m.kind === 'clef'
    ? env.AI.run(m.model, {
      state: state,
      questions: {
        yong: { type: 'choice', instructions: '此卦问事，用神应取哪一六亲？', criteria: CRITERIA.yong },
        wang: { type: 'choice', instructions: '用神当前旺衰程度', criteria: CRITERIA.wang },
        cheng: { type: 'noul', instructions: '所问之事最终能否成？给出成的概率' },
        qi: { type: 'choice', instructions: '应期落在哪一档', criteria: CRITERIA.qi }
      }
    })
    : env.AI.run(m.model, {
      messages: [
        { role: 'system', content: '你是六爻排盘判读器。严格按给定盘面，只输出一行 JSON。' },
        // Qwen3 默认开 thinking，400 tokens 全烧在 reasoning 上、content 恒为 null（实测 UNPARSEABLE）。
        // `/no_think` 是官方软开关；改用 chat_template_kwargs 在 Workers AI 的该条目上不生效（已实测）。
        { role: 'user', content: chatPrompt(state, ask) + (m.id === 'qwen' ? ' /no_think' : '') }
      ],
      max_tokens: 512,
      temperature: 0.1,
      ...(m.id === 'qwen' ? {} : { reasoning_effort: 'low' })
    });

  return withTimeout(call, PER_MODEL_TIMEOUT).then(function (r) {
    const base = { id: m.id, label: m.label, org: m.org, ms: Date.now() - t0 };
    if (!r.ok) return Object.assign(base, { ok: false, error: r.error, probs: null, answer: null });
    const res = r.value && (r.value.result || r.value);
    if (!res) return Object.assign(base, { ok: false, error: 'EMPTY_RESULT', probs: null, answer: null });
    const u = res.usage || {};
    const usage = { input: u.input_tokens || u.prompt_tokens || 0, output: u.output_tokens || u.completion_tokens || 0, neurons: u.neurons || 0 };
    const norm = m.kind === 'clef' ? normalizeClef(res) : normalizeChat(res.choices && res.choices[0] && res.choices[0].message && res.choices[0].message.content);
    if (norm.error) return Object.assign(base, { ok: false, error: norm.error, probs: null, answer: norm.answer, usage: usage });
    return Object.assign(base, { ok: true, error: null, probs: norm.probs, answer: norm.answer, basis: norm.basis || null, usage: usage });
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env || !env.AI) {
    return json({ error: 'NO_AI_BINDING', message: '未绑定 Workers AI（wrangler.toml 加 [ai] binding = "AI"，或在 Pages 设置里添加 AI 绑定）' }, 503);
  }
  // 口令闸：与 interpret/records 同源（_lib.js requireCode）。vote 虽走 Workers AI 免费额度，
  // 但 README 承诺「所有接口都需口令」，故设 ACCESS_CODE 后此处同样拦截（审计 P1-2）。
  const denied = await requireCodeGate(request, env.ACCESS_CODE, '需要访问口令');
  if (denied) return denied;
  const len = Number(request.headers.get('content-length') || 0);
  if (len > 32 * 1024) return json({ error: 'TOO_LARGE' }, 413);

  let b;
  try { b = await request.json(); } catch (e) { return json({ error: 'BAD_JSON' }, 400); }
  if (!b || typeof b !== 'object' || Array.isArray(b)) return json({ error: 'BAD_JSON' }, 400);

  const state = typeof b.state === 'string' ? b.state.slice(0, MAX_STATE) : '';
  if (!state) return json({ error: 'NO_STATE', message: '缺少盘面文本' }, 400);
  const ask = typeof b.ask === 'string' ? b.ask.slice(0, MAX_ASK) : '';

  const votes = await Promise.all(MODELS.map(function (m) { return runOne(env, m, state, ask); }));
  const total = votes.reduce(function (n, v) { return n + ((v.usage && v.usage.neurons) || 0); }, 0);
  return json({ votes: votes, usage: { neurons: Number(total.toFixed(3)), models: MODELS.length } });
}

export function onRequestGet() {
  return json({ error: 'METHOD_NOT_ALLOWED', message: '请用 POST' }, 405);
}

// 导出给测试用（不参与运行时分发）
export const _internals = { extractJson, normalizeClef, normalizeChat, oneHot, clamp01, cleanBasis, MODELS, CRITERIA };
