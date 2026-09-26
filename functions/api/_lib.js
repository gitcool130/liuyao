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

// GPT 模型清单：GPT_MODELS（别名 OPENAI_MODELS），逗号分隔 → 去空白数组
export function gptModelList(env) {
  const raw = env.GPT_MODELS || env.OPENAI_MODELS || DEFAULT_GPT_MODELS;
  return raw.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
}

// 自定义供应商：CUSTOM_PROVIDERS（JSON 数组）
//   { "id": "kimi", "label": "Moonshot", "base": "https://api.moonshot.cn/v1", "models": ["kimi-k2"] }
// id 需为小写字母数字；对应密钥环境变量为 <ID大写>_API_KEY
export function customProviders(env) {
  try {
    const arr = JSON.parse(env.CUSTOM_PROVIDERS || '[]');
    if (!Array.isArray(arr)) return [];
    return arr.filter(function (p) {
      return p && typeof p.id === 'string' && /^[a-z][a-z0-9]*$/.test(p.id) &&
        Array.isArray(p.models) && p.models.length;
    });
  } catch (e) { return []; }
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
