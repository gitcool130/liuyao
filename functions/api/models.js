/* Cloudflare Pages Function: GET /api/models
 * 返回前端可用的模型清单，前端据此动态渲染模型芯片。
 * - GPT 模型清单由环境变量 GPT_MODELS（别名 OPENAI_MODELS，逗号分隔）驱动
 * - 自定义供应商由 CUSTOM_PROVIDERS（JSON 数组）驱动，密钥为 <ID大写>_API_KEY
 * 后台增删即可，无需改代码。configured=false 时前端会提示"后台未配 key"。
 */

// 解析逻辑统一在 _lib.js，与 interpret.js 白名单共享同一口径
import { gptModelList, customProviders, customKeyEnv, json } from './_lib.js';

export async function onRequestGet(context) {
  const { env } = context;

  const gptModels = gptModelList(env);
  const gptKeyed = !!(env.GPT_API_KEY || env.OPENAI_API_KEY);

  const all = [
    { id: 'gemini-3.6-flash', pv: 'Google', configured: !!env.GEMINI_API_KEY },
    { id: 'gemini-3.8-flash', pv: 'Google', configured: !!env.GEMINI_API_KEY },
    { id: 'deepseek-flash', pv: 'DeepSeek', configured: !!env.DEEPSEEK_API_KEY },
    { id: 'deepseek-v4-pro', pv: 'DeepSeek', configured: !!env.DEEPSEEK_API_KEY }
  ].concat(gptModels.map(function (id) {
    return { id: id, pv: 'OpenAI', configured: gptKeyed };
  }));

  customProviders(env).forEach(function (p) {
    const keyed = !!env[customKeyEnv(p.id)];
    p.models.slice(0, 8).forEach(function (m) {
      all.push({ id: m, pv: p.label || p.id, configured: keyed });
    });
  });

  // 去重（不同供应商配了同名模型时保留先出现的）
  const seen = {};
  const models = all.filter(function (m) {
    if (seen[m.id]) return false;
    seen[m.id] = true;
    return true;
  });

  return json({ models: models });
}
