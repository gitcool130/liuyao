# 增删六爻 · 在线排盘与 AI 断卦

基于京房纳甲的六爻排盘工具，集成多模型 AI 断卦。前端纯静态（HTML/CSS/JS，零运行时依赖），后端为 Cloudflare Pages Functions + D1 数据库。

## 技术要点

### 排盘引擎（core/ 四层，纯浏览器端零运行时依赖）

引擎按「易学数据 → 历法底座 → 排盘事实 → 断卦符号」四层拆分，保持 `window.LY` 对外 API 兼容，`<script>` 全局挂载（file:// 直开可用，零构建）：

| 文件 | 职责 |
|------|------|
| `core/data.js` | 八卦纳甲表、64 卦名、冲合刑害、进退神、三合局等易学常量 |
| `core/data-jieqi.js` | 十二节交节时刻表（1900–2100，分钟级，约 15KB 差分压缩） |
| `core/calendar.js` | JDN 双锚点四柱、五虎遁/五鼠遁、旬空、节气查表、夜子时流派开关 |
| `core/paipan.js` | 京房八宫变爻法、纳甲装配、六亲、世应、六神、伏神（纯函数，零 I/O） |
| `core/analyze.js` | 断卦符号层：规则判定链，输出结构化 `judgments[]` |

- **京房纳甲**：八宫卦序变爻法生成全部 64 卦（本宫 → 一世至五世 → 游魂 → 归魂）
- **节气精确到分钟**：十二节交节时刻查表（1900–2100 共 2412 项，由 lunar-javascript 离线生成差分压缩表，运行时零计算只查表）——替换旧版通用公式（临界日 ±1 日误差，月建一错全盘错）
- **夜子时流派显式声明**：`LY.nightZiMode`（默认 `'day'`：日柱归当日、时干按**次日**日干五鼠遁起子时——夜子时正法，najia/lunar-javascript 两库实证一致；`'next'`：日柱时柱整体归次日，换日说，iching-shifa 从之）
- **断卦符号化（无评分制）**：废弃旧版 +2.5/-2 算术评分，改为规则判定链——每条规则独立函数、可单测，输出 `judgments[]`（tag/rule/text/basis 典据）+ `trend`（吉/凶/平/待审，规则汇聚表驱动）+ `yingqiClues`（应期线索，只出线索不下结论）
- **暗动闭环**：静爻被日冲，先查月令旺衰（旺相=暗动，休囚=日破）——修复旧版「文字说了一套、代码没做」
- **规则覆盖**：月建档（旺相休囚死）、真假月破、日辰生克拱扶、冲散/暗动/日破、合起合绊、静空/动空/真空（旬空+月破）、回头生克冲合、进神退神、三合局、相刑相害、飞伏生克、用神两现取舍、伏神引拔、伏神伏世下（不误报用神持世）
- **质量保障**：`test-core.js` 37 项基础自检 + `test-rules.js` 56 项规则链单测 + `test-diff.mjs` 三库交叉差分（见下）

### 三库交叉差分（test-diff.mjs，devDependencies 不进生产）

以三个独立实现的现成库当裁判，对 4096 种爻组合与历法时点全量互证：

- **@taoracle/najia**（MIT，tyme4ts 历法）——排盘主裁判
- **iching-shifa**（GPL v3，仅测试层引用不触发分发传染）——交叉裁判
- **lunar-javascript**（MIT）——历法/节气基准（也是节气表生成源）

已达成：**104,780 个字段三方零差异、零流派分歧**；节气表 1900–2100 全量 2412 项与 lunar-javascript 对齐（误差 = 0）。差分两度抓出真实存量 bug：① 64 卦名表中「山火贲」曾被误标（旅卦覆卦混淆）；② 夜子时时干曾被错按当日日干五鼠遁（辛丑日 23:30 误得戊子时，正法为次日壬寅遁得庚子时）——均在补入 23 时段差分样本后暴露，已修复并回归。

> 待办：经典卦例回归（golden test）——《增删卜易》《卜筮正宗》带完整装卦的卦例（≥10 例）需人工从定本提取（含原文时间、爻值、期望断语），数据就绪后补入测试层。

## 验收标准（M1–M12）

重构分期（M1–M12）的验收口径，供外部审查与后续贡献者对照。源码注释中的「M3 验收」即指本表：

| 里程碑 | 验收标准 | 落点 |
|---|---|---|
| M1 节气精确化 | 1900–2100 十二节交节时刻与 lunar-javascript 全量一致（误差 = 0），表外年份显式返回 null | `test-diff.mjs` diffJieqi（2412 项）、`test-core.js` 表范围项 |
| M2 子时流派 | 默认 `day` 时 23:00–24:00 日柱归当日、时干按**次日**日干五鼠遁；`next` 时整体进次日。两流派分别与 najia/lunar-javascript、iching-shifa 对齐 | `test-rules.js` 夜子时组、`test-diff.mjs` diffNightZi |
| M3 断卦符号化 | ① 源码中无 `score` 字样（扫描时剔除注释）；② 输出必为 `judgments[]`（每条含 tag/rule/text/basis）；③ `trend` 仅由规则汇聚表求得，不由算术分值决定；④ 应为期线索只给线索不下结论 | `test-rules.js` 第 9/10 组（源码扫描 + 汇聚表驱动）、`analyze.js` aggregateTrend |
| M4 规则补全 | 三合局、进神退神、相刑相害、飞伏生克各有命中/不命中两用例外 | `test-rules.js` 第 4–8 组 |
| M5 盲摆防刷卦 | 摇出即定不可反悔；确认前不泄露爻象（铜钱显示「？」、爻位显示「已摇出」即已摇出）；熵源为 `crypto.getRandomValues` | `app.js` pendingToss 状态机、`index.html` `.is-hidden` 样式 |
| M6 撤销正确性 | 撤销后 `curCoins`/`pendingToss` 彻底重置，不得复制上一爻结果 | `app.js` resetTossState() |
| M7 时间锁 | 现场模式首摇瞬间锁定占时且不可编辑；补录模式可改；模式往返不得污染锁定值 | `app.js` timeLocked/lockedDate、`dtInput.disabled` 双保险 |
| M8 随机源 | 生产代码无 `Math.random` 用于爻值生成 | `app.js` secureCoin/cryptoToss |
| M9 三库差分 | 4096 爻组合 + 历法时点 + 夜子时双流派 + 节气全量，三方比对零 BUG、零未裁决流派分歧 | `test-diff.mjs`（10 万+字段） |
| M12 CI 门禁 | push/PR 触发：单测 + 差分 + 语法检查 + 脚本加载顺序，只验证不部署 | `.github/workflows/ci.yml`、`npm run test:all` |

> 暗动闭环（M3 核心）的验收方式是「翻转证明」：同一静爻、同一日辰，仅改月令旺衰即令结论在暗动/日破之间翻转——见 `test-rules.js` 第 2 组。

### 多模型 AI 断卦（functions/api/interpret.js）

- **供应商路由 + 模型白名单**：按模型名自动推断供应商，服务端白名单校验防任意模型名注入
- **Google 协议自适应**：base 指向 Google 原生路径时走 `generateContent + x-goog-api-key`，并强制 `thinkingBudget: 0`（gemini-3.x 思考路径高峰期 503 的根因规避）；其余一律 OpenAI 兼容协议
- **流式 SSE 服务端拼接**：所有 OpenAI 兼容通道统一 `stream: true`，服务端逐 chunk 拼接后返回完整 JSON——突破部分中转站 60 秒整响应硬超时，同时前端无需处理流
- **gpt-5/o 系参数适配**：自动识别思考型模型，剥离其不支持的 `temperature`，改用 `reasoning_effort`（默认 low，环境变量 `GPT_EFFORT` 可调）
- **动态模型清单**：`/api/models` 由环境变量实时驱动（`GPT_MODELS` + `CUSTOM_PROVIDERS`），前端启动时拉取渲染芯片，后台增删模型/供应商零代码改动
- **失败降级**：断卦失败时不输出报错，而是展示可复制的完整 prompt，可粘贴到任意对话窗口手动断卦

### 摇卦严肃性（防刷卦设计）

- **盲摆模式**：点[摇卦]由 `crypto.getRandomValues` 密码学熵源内定爻值，UI 只显示「已摇出」，点[落爻]才揭晓——摇与落之间不可反悔、确认前 DOM 中无爻象信息
- **手动录入**：保留自行翻铜钱录入（标注「后果自负」），用户自主定结果，责任归属明确
- **时间锁**：现场摇卦模式下，首摇瞬间锁定占时（不可事后改时间）；补录模式可为既往时刻补卦
- **撤销修复**：撤销/重置彻底清空当前爻状态（含 `curCoins` 与已摇未落的内定值），杜绝「复制上一爻」状态残留 bug

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

- **摇卦**：一键盲摆（crypto 熵源、摇出即定、确认前不泄露爻象）或手动录入（后果自负）
- **完整排盘**：卦名卦宫、纳甲六亲、世应、六神、伏神、动爻变卦、旬空、月破、干支四柱（节气精确到分钟）
- **旺衰粗判（规则链）**：取用神（含两现取舍/伏神）→ 月建档 → 真假月破 → 日辰 → 暗动/日破 → 合起合绊 → 旬空/真空 → 动变（回头生克/进退神）→ 世爻关系 → 飞伏生克 → 三合刑害，趋势由规则汇聚（非算术评分），附应期线索
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
| `app.js` | 前端逻辑（盲摆状态机、时间锁、排盘渲染、多模型对比、进阶探讨、失败降级） |
| `core/data.js` | 易学常量（八卦纳甲、64 卦名、冲合刑害、进退神、三合局） |
| `core/data-jieqi.js` | 十二节交节时刻表（生成产物，勿手改；由 `tools/gen-jieqi.js` 重新生成） |
| `core/calendar.js` | 历法底座（JDN 四柱、五虎遁/五鼠遁、旬空、节气查表、夜子时开关） |
| `core/paipan.js` | 排盘事实引擎（纳甲/六亲/世应/六神/伏神，纯函数） |
| `core/analyze.js` | 断卦符号层（规则判定链，judgments/trend/yingqiClues） |
| `core.js` | Node 聚合入口（浏览器请按序加载 core/ 五文件，见 index.html） |
| `test-core.js` | 排盘引擎 56 项基础自检（历法锚点、节气边界、夜子时、纳甲六亲、卦序） |
| `test-rules.js` | 断卦规则链 62 项单测（暗动闭环、进退神、三合、夜子时正法、伏神伏世下、两现取舍、交节边界等） |
| `test-diff.mjs` | 三库交叉差分（4096 组合 + 历法时点 + 夜子时双流派 + 节气全量，10 万+字段） |
| `tools/gen-jieqi.js` | 节气表离线生成器（lunar-javascript → 差分压缩表） |
| `functions/api/interpret.js` | 断卦接口（多供应商路由 + 流式 SSE 拼接） |
| `functions/api/models.js` | 模型清单接口 |
| `functions/api/records.js` | 卦例库接口（id 服务端校验/生成，防伪造覆盖） |
| `functions/api/_lib.js` | 供应商解析共享层（`_` 前缀不路由，白名单与清单共用一口径） |
| `.github/workflows/ci.yml` | CI 质量门禁（单测 + 差分 + 语法检查，只验证不部署） |
| `schema.sql` | D1 建表语句（id 双层兜底：应用层 UUID + DDL DEFAULT 表达式） |
| `wrangler.toml` | 部署配置（D1 绑定 + 环境变量说明） |
| `package.json` | 仅 devDependencies（测试裁判库），生产构建零 npm 依赖 |

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
npm install                       # 安装测试裁判库（devDependencies）
npx wrangler pages dev .          # 本地起 Pages（需先在 wrangler.toml 绑定 D1）
npm test                          # 快速环：基础自检 56 项 + 规则链单测 62 项（无需裁判库）
npm run test:all                  # 完整环：上者 + 三库交叉差分（CI 即用此命令）
npm run test:diff                 # 仅差分（须在 UTC+8 时区运行，建议 TZ=Asia/Shanghai）
npm run gen:jieqi                 # 重新生成节气表（改覆盖范围时用）
```

> 审查提示：若 `raw.githubusercontent.com` 不可达（部分网络环境会静默超时，导致误判"文件不存在"），可用 CDN 镜像取源：
> `https://cdn.jsdelivr.net/gh/idavailable/liuyao@main/core/calendar.js`；或直接读 Git 对象树 `git ls-tree -r --name-only origin/main`。

## 部署

```bash
npx wrangler pages deploy . --project-name=liuyao --branch=main
```

D1 建库：控制台创建后将 `database_id` 填入 wrangler.toml，并执行 `schema.sql`。

## 许可

仅供学习研究，断卦结果仅供参考。
