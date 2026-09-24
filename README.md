# 莲斋六爻 · 在线排盘与 AI 断卦

基于京房纳甲的六爻排盘工具，集成多模型 AI 断卦。前端纯静态（HTML/CSS/JS，零依赖），后端为 Cloudflare Pages Functions + D1 数据库。

## 技术要点

### 排盘引擎（core.js，纯浏览器端零依赖）

- **京房纳甲**：八宫卦序变爻法生成全部 64 卦（本宫 → 一世至五世 → 游魂 → 归魂），纳甲装配取上卦第 3~5 位、下卦第 0~2 位
- **干支历法**：儒略日数（JDN）双锚点校准推算年月日时四柱，不依赖任何外部历法库
- **旺衰分析**：旬空、月破、伏神、世应、六神、动爻化出（回头生克）全量解析
- **质量保障**：`test-core.js` 内置 37 项自检（卦序、纳甲、干支、世应、旬空等），CI 级守护排盘正确性

### 多模型 AI 断卦（functions/api/interpret.js）

- **供应商路由 + 模型白名单**：按模型名自动推断供应商，服务端白名单校验防任意模型名注入
- **Google 协议自适应**：base 指向 Google 原生路径时走 `generateContent + x-goog-api-key`，并强制 `thinkingBudget: 0`（gemini-3.x 思考路径高峰期 503 的根因规避）；其余一律 OpenAI 兼容协议
- **流式 SSE 服务端拼接**：所有 OpenAI 兼容通道统一 `stream: true`，服务端逐 chunk 拼接后返回完整 JSON——突破部分中转站 60 秒整响应硬超时，同时前端无需处理流
- **gpt-5/o 系参数适配**：自动识别思考型模型，剥离其不支持的 `temperature`，改用 `reasoning_effort`（默认 low，环境变量 `GPT_EFFORT` 可调）
- **动态模型清单**：`/api/models` 由环境变量实时驱动（`GPT_MODELS` + `CUSTOM_PROVIDERS`），前端启动时拉取渲染芯片，后台增删模型/供应商零代码改动
- **失败降级**：断卦失败时不输出报错，而是展示可复制的完整 prompt，可粘贴到任意对话窗口手动断卦

### 存储与安全

- **D1 卦例库**：卦例含各模型独立对话历史（`{modelId: history[]}`），支持进阶探讨时延续上下文
- **卦例库口令**：`LIB_CODE` 专管卦例库**写入**（装入/更新），与全站闸 `ACCESS_CODE` 解耦——浏览开放、装入登录、断卦不受限；页面「口令登录」按钮经 `POST /api/records?verify=1` 探针验证，自动保存静默跳过未登录状态
- **密钥不出服务端**：API Key 全部存 CF secret（加密变量，wrangler 部署不覆盖），模型名白名单 + 输入长度截断防注入
- **部署防回归**：已禁用 GitHub 集成的自动生产部署（其 Functions 构建缓存会回滚代码并抢占生产），统一由 wrangler direct upload 部署

### 生成式琴音（bgm.js）

- Karplus-Strong 拨弦物理建模：激励噪声三轮平滑去起音毛刺，衰减系数随频率变化（低绵长、高收敛）
- 总线 1500Hz 低通滤波，D 宫五声音阶中低音域随机漫步成句，泛音/双音轻点缀，句间留白 5~10 秒，卷积混响
- 零音频文件、零外部请求；默认开启，首次手势启动，切后台自动暂停

## 功能

- **手动摇卦**：六次掷币（字/背）输入，如实记录每次摇卦结果
- **完整排盘**：卦名卦宫、纳甲六亲、世应、六神、伏神、动爻变卦、旬空、月破、干支四柱（双锚点历法校准，37 项自检全过）
- **AI 断卦**：排盘文本交给大模型按京房纳甲体系论断（用神 → 旺衰生克 → 吉凶 → 应期 → 白话总结），术语规范引自《增删卜易》《卜筮正宗》
- **多模型对比**：可同时勾选多个模型并列输出断卦结果，互为参照
- **进阶探讨**：断卦后可继续追问，各模型独立上下文，保持卦理一致
- **自定义所测**：固定六类用神之外，可自由输入所测之事，写入排盘文本交由 AI 细断
- **卦例库**：D1 数据库存储历史卦例（含各模型对话记录），可回看、删除；浏览开放，**装入与删除需口令登录**（LIB_CODE）
- **生成式琴音**：右下角「琴」按钮，纯 Web Audio 合成古琴背景音（零音频文件，柔和丝弦音色）
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

- `LIB_CODE`：卦例库写入口令（secret）。设置后装入卦例库需先在页面「口令登录」；未设置则写入开放。读取（GET）始终开放。
- `ACCESS_CODE`：全站访问口令（secret），设置后**所有接口**（含断卦）都需口令。一般只需 LIB_CODE，不要两个都设。
- 文件清单新增 `bgm.js`（琴音引擎）。

> ⚠️ 注意：wrangler CLI 部署时 `wrangler.toml [vars]` 会覆盖后台同名**文本**变量（secret 不受影响）。后台改完变量后用 wrangler 重新部署一次生效。
> ⚠️ 本项目已**禁用 GitHub 集成的自动生产部署**——git 构建会复用旧 Functions 编译缓存并抢占生产位置，导致"部署了又变回旧版"。统一用下方 wrangler 命令部署；GitHub 仓库仅作代码备份（经 Contents API 同步）。

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
