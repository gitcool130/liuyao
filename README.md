# 莲斋六爻 · 在线排盘与 AI 断卦

基于京房纳甲的六爻排盘工具，集成多模型 AI 断卦。前端纯静态（HTML/CSS/JS，零依赖），后端为 Cloudflare Pages Functions + D1 数据库。


## 功能

- **手动摇卦**：六次掷币（字/背）输入，如实记录每次摇卦结果
- **完整排盘**：卦名卦宫、纳甲六亲、世应、六神、伏神、动爻变卦、旬空、月破、干支四柱（双锚点历法校准，37 项自检全过）
- **AI 断卦**：排盘文本交给大模型按京房纳甲体系论断（用神 → 旺衰生克 → 吉凶 → 应期 → 白话总结），术语规范引自《增删卜易》《卜筮正宗》
- **多模型对比**：可同时勾选多个模型并列输出断卦结果，互为参照
- **进阶探讨**：断卦后可继续追问，各模型独立上下文，保持卦理一致
- **卦例库**：D1 数据库存储历史卦例（含各模型对话记录），可回看、管理
- **失败降级**：断卦失败时不输出报错，而是展示可复制的完整大模型请求内容，可粘贴到任意对话窗口手动断卦

## 架构

```
页面（静态）→ Pages Functions
  /api/interpret  断卦（多供应商路由，模型白名单校验）
  /api/models     动态模型清单下发
  /api/records    卦例库 CRUD（D1）
供应商通道：
  Gemini   → CF AI Gateway（绕开 Google 对数据中心 IP 的拒绝）→ Google 原生 generateContent
  DeepSeek → api.deepseek.com（OpenAI 兼容）
  GPT      → 任意 OpenAI 兼容接口（官方或中转站）
  Custom   → CUSTOM_PROVIDERS 声明任意多家（Kimi/Qwen/GLM/硅基流动等）
```

安全设计：API Key 仅存服务端 secret，模型名服务端白名单校验防注入，可选 ACCESS_CODE 访问口令。

## 文件说明

| 文件 | 说明 |
|------|------|
| `index.html` | 页面结构（摇卦、排盘、AI 卡片、模型芯片、卦例库） |
| `app.js` | 前端逻辑（排盘渲染、多模型对比、进阶探讨、失败降级） |
| `core.js` | 排盘核心引擎（纳甲/六神/伏神/世应/旬空/月破/干支历），浏览器挂 `window.LY` |
| `test-core.js` | 排盘引擎 37 项自检 |
| `functions/api/interpret.js` | 断卦接口（多供应商路由 + 流式 SSE 拼接） |
| `functions/api/models.js` | 模型清单接口 |
| `functions/api/records.js` | 卦例库接口 |
| `schema.sql` | D1 建表语句 |
| `wrangler.toml` | 部署配置（D1 绑定 + 环境变量说明） |

## 环境变量（Pages 后台 → Settings → Environment variables）

**Gemini 通道**

| 变量 | 说明 |
|------|------|
| `GEMINI_API_KEY` | secret，Google AI Studio key（AIza 开头） |
| `GEMINI_BASE_URL` | 默认走 CF AI Gateway 原生路径（见 wrangler.toml） |

**DeepSeek 通道**

| 变量 | 说明 |
|------|------|
| `DEEPSEEK_API_KEY` | secret，DeepSeek key |
| `DEEPSEEK_BASE_URL` | 默认 `https://api.deepseek.com/v1` |

**GPT / OpenAI 兼容通道（中转站等）**

| 变量 | 说明 |
|------|------|
| `GPT_API_KEY` | secret，接口 key（别名 `OPENAI_API_KEY`） |
| `GPT_BASE_URL` | 接口地址，默认官方（中转站改这里） |
| `GPT_MODELS` | 逗号分隔模型清单，如 `gpt-5.2` |
| `GPT_EFFORT` | 选填，gpt-5/o 系推理强度（minimal/low/medium/high），默认 low |

**自定义供应商（任意 OpenAI 兼容接口，无需改代码）**

1. 文本变量 `CUSTOM_PROVIDERS`，JSON 数组：

```json
[{"id":"kimi","label":"Moonshot","base":"https://api.moonshot.cn/v1","models":["kimi-k2"]}]
```

2. 密钥变量 `<ID大写>_API_KEY`（如 `KIMI_API_KEY`），设为 secret。

**其他**

- `ACCESS_CODE`：选填，设置后页面调用需输入口令。

> ⚠️ 注意：wrangler CLI 部署时 `wrangler.toml [vars]` 会覆盖后台同名**文本**变量（secret 不受影响）。后台改完变量需 Retry deployment 生效。

## 本地开发

```bash
npx wrangler pages dev .        # 本地起 Pages（需先在 wrangler.toml 绑定 D1）
node test-core.js               # 排盘引擎自检
```

## 部署

```bash
npx wrangler pages deploy . --project-name=liuyao --branch=main
```

D1 建库：控制台创建后将 `database_id` 填入 wrangler.toml，并执行 `schema.sql`。

## 许可

仅供学习研究，断卦结果仅供参考。
