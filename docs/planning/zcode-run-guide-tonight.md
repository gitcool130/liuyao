# 今晚 ZCode 开跑指南（2026-10-24 · 直接照此执行）

> 项目目录：`C:\Users\Administrator\WorkBuddy\liuyao`（如未克隆：`git clone https://github.com/idavailable/liuyao`）
> 规则只有一条：**方案阶段可并行，实施阶段一次只跑一个。**
> 每个任务独立会话（/new 开新会话），下面每段 prompt 自带上下文，直接整段复制粘贴。

---

## 第 0 步：开工前 30 秒

1. 打开 ZCode，工作区选 liuyao 目录
2. 确认模型：GLM-5.3-Flash 跑①③（量大、简单），GLM-5.3 跑②（要啃代码）
3. 全仓测试基线（后面验收对数用）：**npm test 751 / test:fn 180 / guji 12144 / test:ui 62**

---

## 第一波（三个并行，互不冲突）

### ① M17-A 阶段一：baseline 列方案（模型：GLM-5.3）

```
为 liuyao 项目实现「判据快照结构化」出实施方案（docs/optimization-2026-10-24.md 的 P1-1）。

【先读并逐条复述要点，复述错误视为未完成】
1. docs/optimization-2026-10-24.md 全文，特别是 §二.2 应期窗口（yingqi-window.js）与「baseline 列」段落
2. schema.sql 中 casts 表现有结构
3. functions/ 中 recordPayload() 的完整实现（定位写入点，确认与 panText 同批写入的调用链）
4. 前端回填表单相关代码（回填/复盘入口，outcome 统计的现有读取路径）

【方案必须回答】
1. ALTER TABLE casts ADD COLUMN baseline TEXT 的迁移策略：D1 上如何执行、
   如何向后兼容（旧行 baseline 为 NULL 时读取路径如何降级）
2. baseline JSON 结构 {yongshen, trend, window, confidence, spread}：
   每个字段从盘面哪个计算结果取值（指出 yingqi-window.js 中的具体来源变量），
   取不到时填什么（null？空串？）——必须显式定义
3. recordPayload() 写入点改动：与 panText 同批写入的具体 diff 位置
4. 回填表单「当时判据 vs 事后事实」并排显示的 UI 方案：
   设计原则是决策留痕（展示判据），不是打分；界面文案不得出现「准确率」类表述；
   置信度是盘面要素自洽度、不是命中概率，口径与现状完全一致
5. 本地 wrangler dev 下如何验证写入与读取

【硬约束】
- 只输出方案文档 docs/proposal-baseline-column.md，不改任何代码
- schema.sql 现有内容只读；方案中的 DDL 只允许 ADD COLUMN
- 置信度与窗口宽度的既有口径原样保留，禁止重新解释
```

### ② M17-B 阶段一：OG 预览方案 + 打包边界实验（模型：GLM-5.3）

```
为分享链接实现按盘 OG 预览（optimization-2026-10-24.md 的 P1-2）。
第一步不是写方案，是先做边界确认实验。

【第一步：打包边界确认（只做实验，不改代码）】
确认 CF Pages 打包 Functions 时是否会带入 public/core/share.js：
1. 读 wrangler.toml 与 functions/ 目录结构，确认 Pages Functions 的打包范围
2. 给出结论：functions/ 内 import '../public/core/share.js' 是否可行/会被打包
   （不确定就标注「待核实」并给出本地验证命令，禁止臆断）

【第二步：方案】
按既定方向设计——把 share 码解析抽成单一实现（functions/api/_share.js），
浏览器端与 Worker 端复用，禁止两份同格式解码器并存（会静默漂移）。

方案必须回答：
1. _share.js 的归属与导入方式：Functions 侧与 public/ 打包侧各如何引用同一份实现
2. OG 预览的实现位置：Worker 端按 User-Agent 返回带 og:title/og:description 的 HTML，
   还是静态 meta？各抓取器（微信/Telegram/Twitter）差异要不要处理，本期范围切到哪里
3. og:title/og:description 只含盘面公共事实（年月日时柱、用神、所测事项），
   不含任何断语——分享码不存断语是刻意设计，预览也不得引入断语
4. 畸形分享码：预览必须优雅降级（返回站点默认 meta），不产出「半个盘」

【硬约束】
- 第一步实验只读；第二步只输出 docs/proposal-og-preview.md
- functions/ 与 public/ 现有文件一律只读
- 禁止在方案中引入第二份解码实现
```

### ③ 规则库外化（模型：GLM-5.3-Flash，一口气跑完）

```
把本仓的断语规则库包装成对外可引用的文档页。约束：

【先读】docs/optimization-2026-10-24.md §一「四·C 规则库外化」行、
tests/guji/coverage.mjs 的输出、README 规则相关章节。

【产出】docs/rules-public.md：
1. 覆盖哪些断语类别、各类别依据的古籍与门派、口径分歧如何标注、
   已知局限（含 §一 登记的 5 处口径分歧）
2. 所有统计数字从 tests/guji/cases 与 coverage.mjs 实际输出提取，
   禁止凭空写数字——每个数字注明来源文件
3. 语气遵守仓库既有原则：不宣称预测效力、不做单点打分（§七「四件不做」）

【硬约束】
- 只允许新建 docs/rules-public.md，其余文件一律不动
- 允许运行 coverage.mjs 获取数据，禁止修改它
```

---

## 审查清单（第一波回来后，人工 5 分钟）

方案过不过，看这四点，任何一点不对就打回重做（贴回原任务 + 指出哪里错）：

- [ ] ① 它复述的 recordPayload() 位置和 casts 结构，跟代码对得上吗（自己 grep 一下验证）
- [ ] ① baseline 五字段是否都给了明确取值来源和 null 约定；是否出现「准确率」「命中率」字样（有 = 打回）
- [ ] ② 打包边界结论是「实验/证据」还是「我猜」；方案里是否只有一份解码器
- [ ] ③ rules-public.md 里的数字抽查两个，能对上 tests/guji 的实际文件吗

---

## 第二波（串行，审完一个跑一个；每次 /new 开新会话）

### ④ M17-A 阶段二：baseline 实施（先贴注记，再贴任务）

先贴这段（每个实施任务前都要贴）：

```
已知边界（是设计约定，不是缺陷，不得作为问题上报或"修复"）：
1. 应期窗口 spread 2–3 日是工程约定；古书只给出空/逢冲/值日节点
2. 置信度 = 盘面要素自洽度，不是命中概率；样本足够前不得改口径
3. 分享码刻意不存断语；分享已有 AI 断卦的盘不带断语是设计而非缺功能
P2 事项本轮明确不做，禁止顺手实施：分桶样本、取用神两派并置、规则库外化。
禁止 git push、禁止 wrangler deploy，只改本地文件。
```

然后贴：

```
按 docs/proposal-baseline-column.md 分阶段实施。

【硬约束】
1. 每阶段结束停下汇报，不要一次做完
2. schema.sql 只允许追加 ADD COLUMN 迁移段；迁移必须幂等
3. recordPayload() 只允许在现有写入批次中追加 baseline 字段，
   禁止重写函数、禁止改动 panText 及其他字段的现有行为
4. 前端只允许在回填表单处新增「当时判据」展示区，禁止改动排盘与断语输出
5. tests/guji/ 现有 404 例断言值禁止修改；若任一测试非绿，
   停下解释原因等确认，禁止改测试迁就代码
6. 收尾必须贴四项测试结果尾部 20 行：
   npm test（基线 751）、npm run test:fn（180）、
   node tests/guji/run.mjs（12144 断言）、npm run test:ui（62）
   数字对不上基线 = 改坏了，自己先查
```

### ⑤ M17-B 阶段二：OG 实施（④ 全绿后再跑）

先贴同一段「已知边界」注记，再贴：

```
按 docs/proposal-og-preview.md 实施。

【硬约束】
1. share 码解析逻辑必须收敛到单一实现；若需把 public/core/share.js 的解析段抽出共享，
   移动而非复制——迁移后原路径必须 import 新位置，
   grep 全仓不得存在两份解析实现
2. OG 预览只输出盘面公共事实 meta，禁止读取或展示断语、禁止调用 AI
3. 畸形输入一律降级到站点默认 meta，禁止 500
4. tests/guji/ 断言值禁改；收尾贴四项测试全绿结果（同任务④第 6 条）
5. 新增 Functions 路由要有测试覆盖：正常码、畸形码、旧格式码至少各 1 例
```

---

## 第三波（不急，明晚错峰再说）

- ⑥ 取用神参数化 —— **依赖 ④ 落地**（baseline.yongshen 口径先锁定）
- ⑦ readings 复盘闭环 —— **依赖 ④ 的 schema 稳定**

两个都跑两阶段流程，prompt 在 `zcode-tasks-2026-10-24.md` 里现成的。

---

## 收工检查（全部跑完后 1 分钟）

- [ ] git status 看改动面：只有方案文档 + ④⑤ 的预期文件，没有多余改动
- [ ] 四项测试全绿且数字对基线
- [ ] grep 全仓确认 share 解码器只有一份
- [ ] 手动 commit + push 由你自己来（ZCode 全程禁 push）
