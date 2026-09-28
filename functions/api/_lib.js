/* 供应商配置共享层（functions/api/_lib.js）
 * 以 _ 开头的文件不会被 Pages Functions 路由为端点，仅供相邻模块 import。
 * 供 interpret.js（白名单校验）与 models.js（清单渲染）共用，
 * 杜绝两处解析 GPT_MODELS / CUSTOM_PROVIDERS 口径漂移。
 */

export const DEFAULT_GPT_MODELS = 'gpt-6-luna,gpt-6-sol,gpt-6-astra';

export function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
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
  return all.filter(isSafeModelId);
}

// 自定义供应商：CUSTOM_PROVIDERS（JSON 数组）
//   { "id": "kimi", "label": "Moonshot", "base": "https://api.moonshot.cn/v1", "models": ["kimi-k2"] }
// id 需为小写字母数字；对应密钥环境变量为 <ID大写>_API_KEY
// 解析失败/条目非法不再静默吞掉：console.warn 告警，并可由 customProviderWarnings 取回原因
export function customProviders(env) {
  const warns = [];
  if (!env.CUSTOM_PROVIDERS) return [];
  let arr;
  try {
    arr = JSON.parse(env.CUSTOM_PROVIDERS);
  } catch (e) {
    console.warn('[liuyao] CUSTOM_PROVIDERS 不是合法 JSON，已忽略:', e.message);
    return [];
  }
  if (!Array.isArray(arr)) {
    console.warn('[liuyao] CUSTOM_PROVIDERS 应为 JSON 数组，实际为 ' + typeof arr + '，已忽略');
    return [];
  }
  const out = [];
  arr.forEach(function (p, i) {
    if (!p || typeof p.id !== 'string' || !/^[a-z][a-z0-9]*$/.test(p.id)) {
      warns.push('第 ' + (i + 1) + ' 项 id 非法（应为小写字母数字）');
      return;
    }
    if (!Array.isArray(p.models) || !p.models.length) {
      warns.push(p.id + ' 未配置 models');
      return;
    }
    const models = p.models.filter(isSafeModelId).slice(0, 8);
    const dropped = p.models.length - p.models.filter(isSafeModelId).length;
    if (dropped > 0) warns.push(p.id + ' 有 ' + dropped + ' 个模型名含非法字符，已忽略');
    if (!models.length) { warns.push(p.id + ' 的模型名全部非法，已忽略'); return; }
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
  return out;
}

// 供应商配置告警（供 /api/models 一并向页面回传，用户可见「后台配错了」）
export function customProviderWarnings(env) {
  if (!env.CUSTOM_PROVIDERS) return [];
  try {
    const arr = JSON.parse(env.CUSTOM_PROVIDERS);
    if (!Array.isArray(arr)) return ['CUSTOM_PROVIDERS 应为 JSON 数组'];
  } catch (e) {
    return ['CUSTOM_PROVIDERS 不是合法 JSON：' + e.message];
  }
  return [];
}


export function customKeyEnv(id) { return id.toUpperCase().replace(/[^A-Z0-9]/g, '_') + '_API_KEY'; }

// 各供应商可用模型白名单（服务端校验，防任意模型名注入）
export function modelWhitelist(env) {
  const wl = {
    gemini: ['gemini-3.6-flash', 'gemini-3.8-flash'],
    deepseek: ['deepseek-flash', 'deepseek-v4-pro'],
    gpt: gptModelList(env)
  };
  customProviders(env).forEach(function (p) { wl[p.id] = p.models.slice(0, 8); });
  return wl;
}
