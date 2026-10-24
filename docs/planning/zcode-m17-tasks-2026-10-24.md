# M17 遗留任务（ZCode 用，2026-10-24 晚）

> 来源：docs/optimization-2026-10-24.md 的遗留清单（P1 两件）。  
> 用法同前一 night 清单：先贴阶段一（方案），审完再贴阶段二（实施）。  
> 顺序建议：任务 A（baseline 列）先行，任务 B（OG 预览）有打包边界待确认，放第二。

---

## 任务 A：判据快照结构化（baseline 列）· 阶段一（方案）

```
为 liuyao 项目实现「判据快照结构化」出实施方案（docs/optimization-2026-10-24.md 的 P1-1）。

【先读并逐条复述要点】
1. docs/optimization-2026-10-24.md 全文，特别是 §二.2 应期窗口（yingqi-window.js）与
   「baseline 列」相关段落
2. schema.sql 中 casts 表现有结构
3. functions/ 中 recordPayload() 的完整实现（定位写入点，确认与 panText 同批写入的调用链）
4. 前端回填表单相关代码（回填/复盘入口，outcome 统计的现有读取路径）

【方案必须回答】
1. ALTER TABLE casts ADD COLUMN baseline TEXT 的迁移策略：D1 上如何执行、
   如何做到向后兼容（旧行 baseline 为 NULL 时所有读取路径如何降级）
2. baseline JSON 结构 {yongshen, trend, window, confidence, spread}：
   每个字段从盘面哪个计算结果取值（指出 yingqi-window.js 中的具体来源变量），
   取不到时填什么（null？空串？）——必须显式定义
3. recordPayload() 写入点改动：与 panText 同批写入的具体 diff 位置
4. 回填表单「当时判据 vs 事后事实」并排显示的 UI 方案：
   明确设计原则是决策留痕（展示判据），不是打分（准/不准评分），界面文案不得出现
   「准确率」类表述——置信度是盘面要素自洽度，不是命中概率，口径与现状完全一致
5. 验证步骤：本地 wrangler dev 下如何验证写入与读取

【硬约束】
- 只输出方案文档 docs/proposal-baseline-column.md，不改任何代码
- schema.sql 现有内容只读；方案中的 DDL 只允许 ADD COLUMN（禁删列/改名/改类型）
- 置信度与窗口宽度的既有口径（工程约定、非古法、非概率）原样保留，禁止重新解释
```

## 任务 A · 阶段二（审完方案后再贴）

```
按 docs/proposal-baseline-column.md 分阶段实施。

【硬约束】
1. 每阶段结束停下汇报，不要一次做完
2. schema.sql 只允许追加 ADD COLUMN 迁移段；迁移必须幂等（重复执行不报错不重复加列）
3. recordPayload() 只允许在现有写入批次中追加 baseline 字段，
   禁止重写函数、禁止改动 panText 及其他字段的现有行为
4. 前端只允许在回填表单处新增「当时判据」展示区，禁止改动排盘与断语输出
5. tests/guji/ 现有 404 例断言值禁止修改；若 node test-rules.js、
   node tests/guji/run.mjs、npm test、npm run test:fn 任一非绿，
   停下解释原因等确认，禁止改测试迁就代码
6. 收尾必须贴四项测试的运行结果尾部 20 行：
   npm test（751）、npm run test:fn（180）、node tests/guji/run.mjs（12144 断言）、npm run test:ui（62）
```

---

## 任务 B：按盘 OG 预览 · 阶段一（方案 + 边界确认）

```
为分享链接实现按盘 OG 预览（optimization-2026-10-24.md 的 P1-2）。
第一步不是写方案，是先做一个边界确认实验。

【第一步：打包边界确认（只做实验，不改代码）】
确认 CF Pages 打包 Functions 时是否会带入 public/core/share.js：
1. 读 wrangler.toml 与 functions/ 目录结构，确认 Pages Functions 的打包范围
2. 给出结论：functions/ 内 import '../public/core/share.js' 是否可行/会被打包
   （如不确定，标注「待核实」并给出本地验证命令，禁止臆断）

【第二步：方案】
按遗留清单的既定方向设计——把 share 码解析抽成单一实现（functions/api/_share.js），
浏览器端与 Worker 端复用，禁止两份同格式解码器并存（会静默漂移）。

方案必须回答：
1. _share.js 的归属与导入方式：Functions 侧与 public/ 打包侧各如何引用同一份实现
2. OG 预览的实现位置：Worker 端渲染（读 User-Agent 返回带 og:title/og:description 的
   HTML）还是静态 meta？抓取器（微信/Telegram/Twitter 等）对 SPA 的支持差异要不要处理，
   本期范围切到哪里
3. og:title/og:description 的内容：只含盘面公共事实（年月日时柱、用神、所测事项），
   不含任何断语——分享码不存断语是刻意设计，预览也不得引入断语
4. 对畸形分享码：预览必须优雅降级（返回站点默认 meta），不产出「半个盘」

【硬约束】
- 第一步实验只读；第二步只输出 docs/proposal-og-preview.md
- functions/ 与 public/ 现有文件一律只读
- 禁止在方案中引入第二份解码实现（这是本任务的存在理由）
```

## 任务 B · 阶段二（审完方案后再贴）

```
按 docs/proposal-og-preview.md 实施。

【硬约束】
1. share 码解析逻辑必须收敛到单一实现；若方案判定需把 public/core/share.js 中
   的解析段抽出共享，移动而非复制——迁移后原路径必须 import 新位置，
   grep 全仓不得存在两份解析实现
2. OG 预览只输出盘面公共事实 meta，禁止读取或展示断语/调用 AI
3. 畸形输入一律降级到站点默认 meta，禁止 500
4. tests/guji/ 断言值禁改；收尾贴四项测试全绿结果（同任务 A 阶段二第 6 条）
5. 新增的 Functions 路由行为写进 npm run test:fn 或新增测试文件覆盖
   （正常码、畸形码、旧格式码三类至少各 1 例）
```

---

## 附：上下文注记（贴任务前先贴这段，防止它把边界当 bug 重报）

```
已知边界（是设计约定，不是缺陷，审计/实施中不得作为问题上报或"修复"）：
1. 应期窗口 spread 2–3 日是工程约定；古书只给出空/逢冲/值日节点
2. 置信度 = 盘面要素自洽度，不是命中概率；样本足够前不得改口径
3. 分享码刻意不存断语；分享已有 AI 断卦的盘不带断语是设计而非缺功能

P2 事项本轮明确不做，禁止顺手实施：分桶样本积累、取用神两派并置、规则库外化。
禁止 git push、禁止 wrangler deploy，只改本地文件。
```
