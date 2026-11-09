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
import { json, requireCode as requireCodeGate, writeGuard, readJsonLimited, rateLimit, rateLimited } from './_lib.js';

const MAX_STATE = 1500;
const MAX_ASK = 200;
const PER_MODEL_TIMEOUT = 28000;
// 一次请求烧三票 ≈ 17 neurons，10k/天 只够 500 轮。默认 6 次/分/IP：
// 正常用户对一张盘按不出 6 次对账，而脚本无法再以「一条循环」清空当日额度。
const VOTE_RATE_LIMIT = 6;

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

// 从可能带围栏、带前言、带尾注的回复里抠出第一个完整 JSON 对象。
// 括号配对扫描**全部**候选组：遇 { 记下起始位置（入栈，深度即栈深，全局计数、
// 不假设首个 { 是起点——前言里未配对的 { 只会挂在栈上，不影响后续配对），
// 遇 } 且栈非空则弹出一段完整配平的组作为候选；全部候选按起始位置从外到内
// 依次 try JSON.parse，第一个成功的返回；全部失败才返回 null。
// 旧实现两个缺陷：(a) 第一个花括号组 parse 失败即 return null，不找后续候选；
// (b) depth 从第一个 { 起算，前言有未配对 { 时永远回不到 0——中文技术散文
// （'分析{略}：{…}'）两种形态都整票判 UNPARSEABLE。
function extractJson(text) {
  if (!text) return null;
  let s = String(text).replace(/```json/gi, '```').replace(/```/g, '');
  const starts = [];   // 未配对 { 的起始位置栈（栈深 = 全局括号深度）
  const cands = [];    // 完整配平的组：[start, end]
  let inStr = false, esc = false;
  for (let k = 0; k < s.length; k++) {
    const c = s[k];
    if (esc) { esc = false; continue; }
    if (c === '\\') { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === '{') starts.push(k);
    else if (c === '}' && starts.length) cands.push([starts.pop(), k]);
  }
  // 从外到内：按起始位置升序，保证 '{"a":{"b":1}}' 取外层整组而非内层子对象
  cands.sort(function (x, y) { return x[0] - y[0]; });
  for (let i = 0; i < cands.length; i++) {
    try { return JSON.parse(s.slice(cands[i][0], cands[i][1] + 1)); } catch (e) { /* 非合法 JSON，试下一候选 */ }
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

// 中文概数词 → 概率（P2-API-4，2026-11-03）。chat 模型回「可成」时爱写
// 「七成」「八成」「大半」这类概数，旧实现把非数字字符一律剥掉后 Number('')
// === 0 且 isFinite 为真——「模型没说清」被静默变成「确定不成」（0），
// 比判废票更糟：伪造的 0 会混进前端分歧矩阵。概数词按语义映射到数值；
// 无法解析的一律返回 null，由调用方按缺失字段判废（BAD_FIELDS 口径）。
const CN_NUM = { '一': 0.1, '二': 0.2, '三': 0.3, '四': 0.4, '五': 0.5, '六': 0.6, '七': 0.7, '八': 0.8, '九': 0.9 };

function clamp01(v) {
  if (v == null) return null;
  if (typeof v !== 'number') {
    const s = String(v);
    if (s.indexOf('大半以上') >= 0) return 0.8;
    if (s.indexOf('大半') >= 0) return 0.7;
    const cm = /[一二三四五六七八九]成/.exec(s);
    if (cm) return CN_NUM[cm[0].charAt(0)];
  }
  if (typeof v === 'number') {
    const x = v > 1 && v <= 100 ? v / 100 : v;
    return x < 0 ? 0 : (x > 1 ? 1 : x);
  }
  // 容忍 "0.62" / "75%" 里的数字：先剥非数字字符，再按百分数拆
  const digits = String(v).replace(/[^\d.\-]/g, '');
  // P2-API-4（2026-11-03）：剥完一个不剩（'大概率'/'说不清'/''）说明模型没给数值，
  // 旧版 Number('')===0 且 isFinite 为真 → 静默按 0（确定不成）处理，比判废票更糟：
  // 伪造的 0 会混进前端分歧矩阵。无法解析一律 null，走缺失字段判废（BAD_FIELDS），
  // 与 normalizeClef 修复后的口径一致（该函数对 clamp01 返回 null 即记 missing）。
  if (!digits) return null;
  const n = Number(digits);
  if (!isFinite(n)) return null;
  const x = n > 1 && n <= 100 ? n / 100 : n;
  return x < 0 ? 0 : (x > 1 ? 1 : x);
}

/** 把 clef 的 answers 归一化成 { yong, wang, cheng, qi }；
 *  口径与 normalizeChat 对齐：必需字段（用神/旺衰/可成/应期）缺失或概率非法
 *  一律判废票（BAD_FIELDS），不再静默填 0.5/0——同一缺失两种判法会让伪造的
 *  概率混进前端分歧矩阵，对账就失去「同题差异才有比较价值」的诊断前提。 */
function normalizeClef(res) {
  const a = (res && res.answers) || {};
  const missing = [];
  // 选项概率逐档校验，与 chat 侧 clamp01 同口径（选 clamp 而非直接废票，理由同 chat）：
  // 越界（<0 或 >1）clamp 回 [0,1]；非有限数（缺选项档/NaN/非数值）→ null → 视为缺失字段走废票。
  const pick = function (dim, labels, name) {
    const node = a[dim];
    const src = (node && node.probabilities) || null;
    if (!src) { missing.push(name); return null; }
    const out = {};
    let covered = 0;
    for (const k in labels) {
      const c = clamp01(src[k]);
      if (c == null) { missing.push(name); return null; }
      out[labels[k]] = c;
      covered += c;
    }
    // 归一化到 1：模型偶尔只覆盖部分概率质量（总和不足 1），否则进度条会失真
    if (covered > 0 && Math.abs(covered - 1) > 1e-6) {
      for (const k in out) out[k] = out[k] / covered;
    }
    return out;
  };
  // 可成（noul）同口径：缺失/非有限 → 废票；越界 → clamp（与 chat 侧「可成」一致）
  const cnoul = a.cheng ? clamp01(a.cheng.noul) : null;
  const yong = pick('yong', YONG_LABEL, '用神');
  const wang = pick('wang', WANG_LABEL, '旺衰');
  if (cnoul == null) missing.push('可成');
  const qi = pick('qi', QI_LABEL, '应期');
  if (missing.length) return { error: 'BAD_FIELDS:' + missing.join('/'), answer: null };
  return {
    probs: { yong: yong, wang: wang, cheng: { noul: cnoul }, qi: qi },
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
  // 先限流再碰 AI 绑定：本端点是三个模型一次打满，是全站最贵的接口。
  // 限流放在最前，连未绑定 AI 的部署也不会被白刷。
  if (rateLimit(request, env, 'vote', VOTE_RATE_LIMIT)) return rateLimited();
  if (!env || !env.AI) {
    return json({ error: 'NO_AI_BINDING', message: '未绑定 Workers AI（wrangler.toml 加 [ai] binding = "AI"，或在 Pages 设置里添加 AI 绑定）' }, 503);
  }
  // 跨站/非 JSON 写入直接拒：没有这道闸，任意网页可用简单请求借访客 IP 烧额度。
  const badWrite = writeGuard(request, env);
  if (badWrite) return badWrite;
  // 口令闸：与 interpret/records 同源（_lib.js requireCode）。vote 虽走 Workers AI 免费额度，
  // 但 README 承诺「所有接口都需口令」，故设 ACCESS_CODE 后此处同样拦截（审计 P1-2）。
  const denied = await requireCodeGate(request, env.ACCESS_CODE, '需要访问口令');
  if (denied) return denied;
  // 请求体：Content-Length 只作早退，实际上限由流式累计兜底（32 KB 足够盘面 + 追问）
  const read = await readJsonLimited(request, 32 * 1024);
  if (read.error === 'TOO_LARGE') return json({ error: 'TOO_LARGE' }, 413);
  if (read.error) return json({ error: 'BAD_JSON' }, 400);
  const b = read.value;
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
