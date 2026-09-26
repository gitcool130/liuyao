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

// 模型 id 字符集白名单：模型名会进入前端 DOM（芯片 data-m / 文本）与上游请求体，
// 只允许字母数字与 . _ - / : ，从源头杜绝引号/尖括号等注入字符
const MODEL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,63}$/;

export function isSafeModelId(id) {
  return typeof id === 'string' && MODEL_ID_RE.test(id);
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
    out.push(Object.assign({}, p, { models: models }));
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
