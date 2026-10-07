# 增删六爻 · 在线排盘与 AI 断卦

基于京房纳甲的六爻排盘工具，集成多模型 AI 断卦。前端纯静态（HTML/CSS/JS，零运行时依赖），后端为 Cloudflare Pages Functions + D1 数据库。

## 技术要点

### 排盘引擎（public/core/ 四层，纯浏览器端零运行时依赖）

引擎按「易学数据 → 历法底座 → 排盘事实 → 断卦符号」四层拆分，保持 `window.LY` 对外 API 兼容，`<script>` 全局挂载（file:// 直开可用，零构建）：

| 文件 | 职责 |
|------|------|
| `public/core/data.js` | 八卦纳甲表、64 卦名、冲合刑害、进退神、三合局等易学常量 |
| `public/core/data-jieqi.js` | 十二节交节时刻表（1900–2100，分钟级，约 15KB 差分压缩） |
| `public/core/calendar.js` | JDN 双锚点四柱、五虎遁/五鼠遁、旬空、节气查表、夜子时流派开关 |
| `public/core/paipan.js` | 京房八宫变爻法、纳甲装配、六亲、世应、六神、伏神、**卦型判定**（六冲卦/六合卦/游魂归魂）（纯函数，零 I/O） |
| `public/core/analyze.js` | 断卦符号层：规则判定链，输出结构化 `judgments[]` + `yingqiLayers`（应期三层） |
| `public/core/sensitive.js` | 上层契约：敏感问题确定性分流（block / advisory / pass 三档，纯字符串判定） |
| `public/core/domain-methods.js` | 上层契约：所测之事的分析方法注入（看盘次序 + 常见误判，**明示非古籍引文**） |
| `public/core/fact-audit.js` | 上层契约：断语事实一致性审计（只审显式盘面断言，不评吉凶应期） |
| `public/core/coverage-audit.js` | 上层契约：断语**推理**一致性审查（成对概念误置 / 结构遗漏 / 用神是否取错） |

- **京房纳甲**：八宫卦序变爻法生成全部 64 卦（本宫 → 一世至五世 → 游魂 → 归魂）
- **卦型判定**：六冲卦 10（八纯卦 + 天雷无妄 + 雷天大壮）、六合卦 8（泰否复豫节困贲旅）、游魂/归魂各 8——六冲/六合由六爻**纳甲地支**直推（不查卦名表），游魂/归魂由八宫变爻次序定；`paipan()` 直接给出 `isLiuChong / isLiuHe / soul`
- **节气精确到分钟**：十二节交节时刻查表（1900–2100 共 2412 项，由 lunar-javascript 离线生成差分压缩表，运行时零计算只查表）——替换旧版通用公式（临界日 ±1 日误差，月建一错全盘错）
- **夜子时流派显式声明**：`LY.nightZiMode`（默认 `'day'`：日柱归当日、时干按**次日**日干五鼠遁起子时——夜子时正法，najia/lunar-javascript 两库实证一致；`'next'`：日柱时柱整体归次日，换日说，iching-shifa 从之）
- **断卦符号化（无评分制）**：废弃旧版 +2.5/-2 算术评分，改为规则判定链——每条规则独立函数、可单测，输出 `judgments[]`（tag/rule/text/basis 典据）+ `trend`（吉/凶/平/待审，规则汇聚表驱动）+ `yingqiClues`（应期线索，只出线索不下结论）
- **暗动闭环**：静爻被日冲，先查月令旺衰（旺相=暗动，休囚=日破）——修复旧版「文字说了一套、代码没做」
- **规则覆盖**：月建档（旺相休囚死）、真假月破、日辰生克拱扶、冲散/暗动/日破、合起合绊、静空/动空/真空（**真空以「安静」为前提，动爻永不真空**）、回头生克冲合、进神退神、三合局、相刑相害、飞伏生克、用神两现取舍、伏神引拔、伏神伏世下（不误报用神持世）
- **上层契约层（M15）**：`sensitive.js` / `domain-methods.js` / `fact-audit.js` / `coverage-audit.js` 四个**不参与排盘**的模块——分别负责「敏感问题确定性分流」「所测之事的分析方法与误判清单注入」「断语与卦盘的事实一致性审计」「断语推理一致性审查」。详见下节；自检见 `test-absorb.js`（128 项）
- **质量保障**：`test-core.js` 89 项基础自检（含入参校验、非法日期文案、`bian` 语义契约锁定） + `test-rules.js` 185 项规则链单测（含直测 `ruleXingHai` 的三刑全覆盖） + `test-gua-types.js` 卦型判定回归（64 卦全枚举 + 京房八宫卦次整表 + 10 类变异自检） + `test-functions.mjs` 57 项 Functions 层（含上游超时、流式缓冲守卫、限流窗口有界） + `test-shake.js` 49 断言 UI 冒烟 + `test-diff.mjs` 三库交叉差分（10 万+字段）+ `tests/guji` 古籍卦例回归（《增删卜易》《卜筮正宗》404 条卦例 + 40 条断语用例 / 12102 断言，断卦规则覆盖 37/51，另附 41 类变异自检）+ `tests/verify` 外部验证集三方对账与零依赖金标准回归；CI 另有「部署隔离断言」守住 `public/` 边界

### 三库交叉差分（test-diff.mjs，devDependencies 不进生产）

以三个独立实现的现成库当裁判，对 4096 种爻组合与历法时点全量互证：

- **@taoracle/najia**（MIT，tyme4ts 历法）——排盘主裁判
- **iching-shifa**（GPL v3，仅测试层引用不触发分发传染）——交叉裁判
- **lunar-javascript**（MIT）——历法/节气基准（也是节气表生成源）

已达成：**104,780 个字段三方零差异、零流派分歧**；节气表 1900–2100 全量 2412 项与 lunar-javascript 对齐（误差 = 0）。差分两度抓出真实存量 bug：① 64 卦名表中「山火贲」曾被误标（旅卦覆卦混淆）；② 夜子时时干曾被错按当日日干五鼠遁（辛丑日 23:30 误得戊子时，正法为次日壬寅遁得庚子时）——均在补入 23 时段差分样本后暴露，已修复并回归。

### 古籍卦例回归（tests/guji，M13）

以两部传世定本（皆公有领域）的实占卦例做 golden test，合计 **404 条卦例 + 40 条断语用例、12102 项断言**；断卦规则覆盖 **37 / 51 = 72.5%**（`npm run guji:coverage`）：

- **《增删卜易》**（清·野鹤老人传，李文辉增删，康熙三十年刊本）207 条六行卦体 → 对账纳甲地支 / 六亲 / 世应 / 变卦；
- **《卜筮正宗》**（清·王洪绪）197 条表格卦例 → 对账纳甲地支 / 六亲 / **六神** / **伏神**（六神依日干起、伏神取本宫首卦同位，正是表格版式独有的两个维度）。

书里对每一卦印有两组互相独立的信息——**卦画**（六爻阴阳与动爻）与**装卦**（六爻六亲、纳甲地支、世应、变卦、六神、伏神）——本回归以前者作引擎输入、后者作断言期望，故不存在「拿引擎输出当期望」的自证问题（本仓库历史上出现过恒真空断言，此处刻意规避，并有变异自检兜底）。

> 语料转换缺陷（td 错位/串栏/讹字）不作静默跳过，而是逐条回溯定本原文定性后登记于 `tests/guji/known-text-issues.json`（当前 31 处），`run.mjs` 单独列出条数。结论：12102 项断言全部通过，31 处差异均属第三方转换文本缺陷，**引擎侧零分歧**；另有 5 处**口径分歧**锁定在案（见 `tests/guji/README.md` §七）。

> **断语断言**取自《增删卜易》明文断语（如「飞来生伏」「鬼化退神」「世临月建之官」），逐条回溯到 `cases[].quote`。它把「实现口径 vs 原书口径」的差异变成可见、可追踪的条目——上一轮由用例暴露出一处 `ruleXunKong` 的判定优先级缺陷，**本轮已依《卜筮正宗·旬空论第十》原文修正**（详见 `tests/guji/README.md` §七）。

> **不必把节气表前推到康熙年间**：古籍只记「月建 + 日辰干支」，不记公历年份；而 `analyze.js` 的规则链零引用年柱与时柱（仅用 `monthZhi` / `dayZhi` / `dayGan` / `kong`，可用 grep 复核），
> 故可由 `tests/guji/lib/ganzhi.mjs` 在 1900–2100 内搜索等价日期驱动引擎。等价性论证与「前提被破坏时该怎么办」见 `tests/guji/README.md` §二。
> 附带产物是**变异自检**（`npm run test:guji:self`）：向期望值逐类注入 41 类已知错误，验证 41/41 均能变红——用于证明「全绿」不是空转；它已抓出数处真实设计边界，记录在该 README §十一。
> 已登记分歧 1 条：辰月戊申日占父近病「申日冲寅木而暗动」，原书作**暗动**，本实现按旺相休囚死口径（寅木在辰月属「囚」）判**日破**；而同书〈增删黄金策千金赋〉「休囚为日破，不为暗动」反与本实现一致——同一书内两处口径不一。处理方式为**保留实现口径、登记分歧、锁定现状**，见 `tests/guji/README.md` §七。
> 原第 2 条分歧（子月癸酉日自占婚「戌土虽值旬空，**动不为空**」，本实现旧版误判「真空」）已于本轮**修正引擎**：依《卜筮正宗·旬空论第十》原文，真空两分支（「休囚**安静**」「**静**逢月破」）皆以安静为前提，故 `moving` 是真空的**前置守卫**。该用例已由「登记分歧」转为正常断言，并补 9 条单测 + 2 类变异（动↔静两个方向）锁定，另补一条正面对偶用例 `zsby-1547-zhenkong`（原书断「财伏而空，全无影响」）保住「真空」的正当覆盖。

### 外部验证集三方对账（tests/verify，M14）

收到一份**外部给的排盘验证集**（4 条、非古籍卦例）后，本仓库的处理方式是**先判责、不照收**：结论 **4 条全错，引擎侧 0 项错**。

- **判责不靠引擎自证**：三家独立裁判库复核（najia 排盘主裁判 / iching-shifa 交叉裁判 / lunar-javascript 历法）；**另有**一条完全绕开引擎的检测——只用裁判库由 `coins` 推卦画，去比用例**自称**的卦名；再加一条手算复算（以 2000-01-01=戊午 为锚点纯数天数，不等价于引擎自己的 JDN 公式）。
- **三个病因**解释全部 52 项错项：① **日柱靠猜**（27 项）——日柱 4/4 错，偏移 −11/+10/−15/−15 天各不相同，属拼凑而非系统性口径差；旬空 4、六神 18、时柱 1 全是随日柱连带出错（**线索**：用例的旬空与六神在它自己那个错日柱下完全自洽，故只需修输入）。② **`coins` 与自称卦名对不上**（24 项）——TC_003 的 `coins` 推得变卦「坤为地」却自称「雷天大壮」，TC_004 推得本卦「地山谦」却自称「水地比」。③ **六合卦概念错**（1 项）——水地比不在六合卦之列（且它是归魂卦）。
- **收益不只是判责**：用例数值虽不可信，但它的**字段清单**指出引擎缺三项判定（六冲卦 / 六合卦 / 游魂归魂）——尤其第三项 `PALACE[..].variant` 数据早已存在却全仓库无人消费。本轮已把三项**落地为引擎原生能力**。
- **两层门禁**：`run.mjs` 判责（需裁判库；`--fix` 才重写金标准，且**拒绝写入无任一裁判库背书的字段**）；`regress.mjs` 断言（**零依赖**，只加载 `core.js`，173 项逐字段比对已裁决基线）——金标准只在重新裁决时变动，日常回归不需要裁判库在场。
- 裁决件 `external-suite-v1.1-adjudicated.json` 可直接作为**修正建议**回给对方；原始件 `external-suite-v1.json` 逐字节原样保留，未改动。

### 上层契约层（M15）

排盘与断语是「确定性事实」，但**大模型断卦这一段原先完全没有约束**：提示词自由发挥、输出无人回检、敏感问题无边界。M15 补的是这三个缺口，参照两个外部六爻 Agent Skill 的做法吸收而来（吸收取舍见本节末）。三层都**不参与排盘**，故不影响 M1–M14 的任何断言。

| 模块 | 做什么 | 不做什么 |
|---|---|---|
| `core/sensitive.js` | 对用户**自己写下**的事由做确定性分流：`block`（不进入 AI 断卦）/ `advisory`（可断卦但须附现实提示）/ `pass` | 不介入排盘；不对固定事类的下拉标签分流（「功名·官司·疾病」里的「疾病」只是分类说明，拿它分流会让每个选官鬼的人都吃到就医提示） |
| `core/domain-methods.js` | 按所测之事注入「看盘次序 + 常见误判」，把「先审用神—再察世应月日—后追动变伏神」这条主线固化进提示词 | 不预设吉凶、不给结论；**明示「项目综合，非古籍引文」**，不得在报告里包装成「某某书曰」 |
| `core/fact-audit.js` | 断语回来后，把其中**显式写出的盘面断言**（「三爻为妻财」「世爻在三爻」「本卦为…」「五爻发动」）与卦盘逐条对撞，只提示冲突 | 不审吉凶倾向、应期早晚、取象类象、作用链主次——这些属传统推断，程序无权判对错，已在 `unrestricted` 中明示 |
| `core/coverage-audit.js` | 补 `fact-audit` 查不到的另一半：盘面没写反、文字也通顺，但**推理走样**了——真空写成动不为空、暗动写成日破、真破说成假破、用神取错、盘里有月破/伏神却只字未提 | 不评吉凶对错、不判应期准否；「漏审」只作普通提示（不染红），只有概念误置才告警——否则用户会把提醒当错误，真告警反被无视。三条误报豁免：否定表述（「非真空也」「幸无月破」）、全盘结构（`analyze` 只判用神一线，断语谈非用神爻的旬空/月破/日冲属正常，第三参 `pan` 给了才查得出）、用神角色词（「以X为忌神/原神」不是取用） |

**为什么 `block` 只拦五类而不是「含疾病就拦」**：外部实现把「疾病」整词列入拦截，而本仓 `useSelect` 的「官鬼」本就对应疾病（六爻传统占问之一），全拦会让正常功能失效。故只拦**确诊 / 手术方案 / 能活多久 / 生死预后**这类现实决策，一般「疾病何时痊愈」走 `advisory`——可断卦，但断语不得写成医学诊断。同理「生产项目」这类含敏感子串的正常求财问句不得误伤（外部实现曾误收「生产」一词，本仓未收，并有断言锁定）。

**应期三层**：`analyze()` 原有 `yingqiClues` 是扁平线索，现另出 `yingqiLayers = { main, auxiliary, risk }`——主应期（用神解除受制的直接窗口：出空、出月）／辅助节点（触发性的冲合节点：暗动、合绊）／风险窗口（使结论转向的条件：伏藏待引拔、忌神回克）。**分层只是另归档，不新增也不丢失线索**：`test-absorb.js` 对 6 组卦 × 6 类用神共 36 案断言「三层并集 === 扁平线索（含顺序）」，防止将来改规则时只改一边。

**按卦名起卦**：起卦区新增「卦名 + 动爻」录入（卦名下拉由 `HEXNAMES` 反查，非手抄清单）。卦名 → 六爻卦画 → 叠加动爻 → 爻值，全链路确定性换算，不经大模型也不掷币——古籍卦例本就只记卦画与动爻，没有爻值。复现古籍卦例时请配合「补录模式」改占问时刻。

> **吸收取舍（诚实记录）**：参照了两个外部六爻 Skill（`fortune-liuyao-skill`、`liuyao-frv`）。**吸收**的是它们上层方法论中可确定性验证、且不触碰本仓断法口径的部分（敏感分流、领域方法注入、断后事实审计、应期分层、按卦名换算起卦、旺相休囚死展示）。**未吸收**的有三类：① 它们的**排盘引擎本体**——深度不及本仓（无旺相休囚死、无暗动/日破、无真空/动不为空，金标盘仅 3 张）；② **神煞**（天德、天厨、三合神煞等）——本仓 `analyze.js` 开篇即定「专凭五行生克，不用神煞」，口径冲突；③ **反吟 / 伏吟、卦身**——定义在各家实现间不一致（如「卦之伏吟」按「本卦与变卦逐位纳支全同」口径推演，在本仓纳甲体系下恒不成立），无法在未经 `tests/guji` 古籍回归背书的情况下落地，故**暂不实现**，留待逐条回溯定本后再定。

## 验收标准（M1–M15）

重构分期（M1–M12）的验收口径，供外部审查与后续贡献者对照。源码注释中的「M3 验收」即指本表：

| 里程碑 | 验收标准 | 落点 |
|---|---|---|
| M1 节气精确化 | 1900–2100 十二节交节时刻与 lunar-javascript 全量一致（误差 = 0）；**表外年份降级不中断**：月柱/年柱按典型交节日近似（±2 日）并由 `fourPillars().outOfTable` 标记，UI 与排盘文本同步提示——绝不抛异常、绝不静默给错值 | `test-diff.mjs` diffJieqi（2412 项）、`test-core.js` 表范围与表外降级项 |
| M2 子时流派 | 默认 `day` 时 23:00–24:00 日柱归当日、时干按**次日**日干五鼠遁；`next` 时整体进次日。两流派分别与 najia/lunar-javascript、iching-shifa 对齐 | `test-rules.js` 夜子时组、`test-diff.mjs` diffNightZi |
| M3 断卦符号化 | ① 源码中无 `score` 字样（扫描时剔除注释）；② 输出必为 `judgments[]`（每条含 tag/rule/text/basis）；③ `trend` 仅由规则汇聚表求得，不由算术分值决定；④ 应为期线索只给线索不下结论 | `test-rules.js` 第 9/10 组（源码扫描 + 汇聚表驱动）、`analyze.js` aggregateTrend |
| M4 规则补全 | 三合局、进神退神、相刑相害、飞伏生克各有命中/不命中两用例外 | `test-rules.js` 第 4–8 组 |
| M5 盲摆防刷卦 | 摇出即定不可反悔；确认前不泄露爻象（铜钱显示「？」、爻位显示「已摇出」即已摇出）；熵源为 `crypto.getRandomValues` | `app.js` pendingToss 状态机、`index.html` `.is-hidden` 样式 |
| M6 撤销正确性 | 撤销后 `curCoins`/`pendingToss` 彻底重置，不得复制上一爻结果 | `app.js` resetTossState() |
| M7 时间锁 | 现场模式首摇瞬间锁定占时且不可编辑；补录模式可改；模式往返不得污染锁定值 | `app.js` timeLocked/lockedDate、`dtInput.disabled` 双保险 |
| M8 随机源 | 生产代码无 `Math.random` 用于爻值生成 | `app.js` secureCoin/cryptoToss |
| M9 三库差分 | 4096 爻组合 + 历法时点 + 夜子时双流派 + 节气全量，三方比对零 BUG、零未裁决流派分歧 | `test-diff.mjs`（10 万+字段） |
| M12 CI 门禁 | push/PR 触发：单测 + 差分 + 语法检查 + 脚本加载顺序，只验证不部署 | `.github/workflows/ci.yml`、`npm run test:all` |
| M13 卦例回归 | 古籍 golden test：《增删卜易》207 条六行卦体（纳甲/六亲/世应/变卦）+《卜筮正宗》197 条表格卦例（另覆盖**六神/伏神**）+ 40 条**断语用例**（覆盖 37/51 条断卦规则），合计断言 12102 项；期望取自定本印刷内容（卦画作输入、装卦作期望），另有 41 类变异自检保证非空转；31 处文本缺陷逐条回溯原文登记（非静默跳过），5 处口径分歧锁定在案；**并已由用例反向修正引擎 1 处**（`ruleXunKong` 真空守卫） | `tests/guji/`（run.mjs / selftest.mjs / coverage.mjs / README.md / known-text-issues.json）、`tools/guji-import.mjs`、`tools/guji-import-bszz.mjs` |
| M14 卦型判定与外部验证集对账 | ① 三项卦型判定落地引擎（六冲卦 10 / 六合卦 8 / 游魂归魂各 8），期望取自**京房八宫卦次整表**（64 卦全枚举）而非实现自身输出，另附 10 类变异自检，断言 88 项；② 外部验证集三方对账：引擎侧被裁判库判负 **0 项**，52 项分歧逐条归责于用例（三病因全解释）；③ 裁决基线由**零依赖**回归（173 断言）在日常守护，不需要裁判库在场 | `public/core/paipan.js`、`test-gua-types.js`、`tests/verify/`（run.mjs 判责 / regress.mjs 断言 / README.md / 原始件 v1 / 裁决件 v1.1） |
| M15 上层契约（分流 / 方法注入 / 断后审计） | ① 敏感分流三档：`block` 五类（自伤暴力、孕产胎儿、确诊类医疗、失踪刑案、重大财法）各有用例，`advisory` 一档（一般健康），且有**反向对照**断言「生产项目」「新的生产项目能不能上马」不得误伤；② 领域方法：`DOMAIN_METHODS` 覆盖 `useSelect` 全部 7 个取值，生成的文本块**必须含「非古籍引文」声明**（防被包装成古籍原文）；③ 断后审计：逐爻六亲 / 世应位置 / 本卦变卦名 / 动爻四类断言各配「写对 → 不报」与「写错 → 报」双向用例，静卦不比对变卦名（防漏判误报），缺参不抛；④ 应期三层：6 组卦 × 6 类用神共 36 案断言「三层并集 === `yingqiClues`（含顺序）」，待审分支同形返回；⑤ 两份 `SYSTEM_PROMPT`（`app.js` 与 `interpret.js`）的四段契约标记逐段比对一致；⑥ 推理审查：真空/动空/待时、真破/假破、暗动/日破/冲散三组成对概念各配「说对 → 放行」「说反 → 告警」双向用例，另有无此结构而断言、用神取错、漏审只作软提示不染红、空输入不炸 | `test-absorb.js`（128 项）、`test-functions.mjs` absorb 组（10 项）、`public/core/sensitive.js`、`public/core/domain-methods.js`、`public/core/fact-audit.js`、`public/core/coverage-audit.js` |

> 暗动闭环（M3 核心）的验收方式是「翻转证明」：同一静爻、同一日辰，仅改月令旺衰即令结论在暗动/日破之间翻转——见 `test-rules.js` 第 2 组。

## 审计基线与已修项台账

### 审计前必先对齐基线

审计输入**一律以 commit 为准**，不要用线上页面、旧下载快照或第三方缓存的源码当输入——否则会把已修项当新缺陷重报，白跑一轮。先跑：

```bash
git log -1 --format='%h %cs %s'   # 确认审计对象就是 HEAD
git status -sb                    # 若显示 ahead，先推送再审计
```

| commit | 说明 |
|---|---|
| `f5a0ca4` | 第二轮审计的**输入**版本：`core/`、`app.js` 尚在仓库根，`ruleMonth` 仍以 `else` 兜底猜五行关系，`app.js` 仍为 `history.slice(0, -1)` |
| `3e473e2` | 第二轮 P0/P1/P2 **20 项全量修复**（台账见下） |
| `123425f` | 部署根收敛至 `public/`，源码/配置/测试与公网物理隔离 |
| `9749c36` | 盲摇落爻后揭晓真实铜钱结果 |
| `d858b63` | README 与测试同步 |
| `3f33dab` | README 补「审计基线与已修项台账」 |
| `08bcc21` | 第三轮 **15 项**（测试有效性 / 恒真断言 / 死代码 / 计数漂移）修复；**第四轮审计的输入**版本 |
| `779b4526` | 第二十轮：B1（三刑单向漏判 33.3%）/ B2（原型链污染）/ B3（DELETE 缺 `ID_RE`）修复 + A1 读路径口令收口（`requireCode` 认 `LIB_CODE \|\| ACCESS_CODE`） |
| `779b4526` 之后 | 第二十一轮：B4/B5/C1/C4/C5/C6/C7/N1 收口，C2/C3 定性订正（详见下方台账） |

> ⚠️ **历史教训**：第二轮 20 项报告在修复后仍被反复重报，原因是外部审计取的源码是 GitHub main（`f5a0ca4`），而修复提交全部停留在本地未推送。**提交推送之前不要发起外部审计**，否则拿到的必然是旧版的结论。
>
> 该教训在第三、四轮各复现一次（第四轮 21 项中 12 项为第三轮已修项）。另注意：GitHub 压缩包内文件的**内嵌日期 = 提交作者时间**，昨天提交的今天就显示「yesterday」，**不能用来判断内容新旧**。判版本看结构：顶层有无 `public/`、`app.js` 里 `history.slice()` 是否带参数、`analyze.js` 能否搜到 `relation5`。

### 20 项台账（第二轮）

| # | 报告项 | 现状 | 落点 |
|---|---|---|---|
| 1 | `ruleMonth` 同五行不同支误报「克月建」 | ✅ 已修：抽 `relation5` 五值完备函数，补「月建同气」分支，删 `else` 兜底 | `public/core/analyze.js` ruleMonth；`test-rules.js` #1（月建子水/用神亥水） |
| 2 | `ruleDay` 用神克日辰误判「日辰比和」且 `supports=true` | ✅ 已修：补「耗于日辰」分支且 `supports=false` | ruleDay；`test-rules.js` #2 + 交叉项（耗不得救月破→真破） |
| 3 | 判定链未遍历其余动爻对用神的作用 | ✅ 已修：新增 `ruleMovingOthers`（含动爻变爻），并登记进 `aggregateTrend` 名单 | analyze.js；`test-rules.js` 第 14 组 |
| 4 | `sendChat` 用 `slice(0, -1)` 切掉追问 | ✅ 已修：整段 `history` 送出（失败降级提示词同样含追问） | `public/app.js` sendChat；`test-shake.js` B 组 3 断言 |
| 5 | `btnTimeMode` 切回现场后不重排盘 | ✅ 已修：恢复锁定时刻后 `if (records.length === 6) computePan()` | app.js；`test-shake.js` C 组 |
| 6 | `ruleSanHe` 忽略变爻 | ✅ 已修：本卦动爻 + 变爻同建元素池，同一爻本变不双算 | analyze.js ruleSanHe；`test-rules.js` 第 15 组 |
| 7 | `ruleFu` 飞伏同五行归入「飞伏无关」 | ✅ 已修：补「飞伏同气」（另含伏克飞/伏生飞） | analyze.js ruleFu；`test-rules.js` 第 16 组 |
| 8 | `pickYongshen` 伏神取首现 | ✅ 已修：临世应 → 月令旺相者 → 前爻 | analyze.js pickYongshen；`test-rules.js` 第 16 组 |
| 9 | `ruleYuePo` 真假月破条件简化 | ✅ 已按报告口径：`zhen` 仅在 `WEAK` 成立，旺相即假破（无需额外分支） | analyze.js ruleYuePo；`test-rules.js` 第 3 组 |
| 10 | `records.js` 对 JSON 字符串 `slice` 产出非法 JSON | ✅ 已修：`jsonWithin` 按结构收缩，落库永远是合法 JSON | `functions/api/records.js`；`test-functions.mjs` |
| 11 | `ruleDayHe` 动爻被日合一律判「合绊」 | ⚖️ 维持现状（口径分歧，见下） | — |
| 12 | `ruleXunKong` 真空条件宽窄 | ⚖️ 维持现状（口径分歧，见下） | — |
| 13 | `checkAccess` 口令字符串直比 | ✅ 已修：`safeEqual`（SHA-256 + 逐字节异或，常量时间，长度不进比较） | records.js；`test-functions.mjs` |
| 14 | `customProviders` 静默吞错 | ✅ 已修：`console.warn` + `customProviderWarnings` 回传页面告警 | `functions/api/_lib.js`、`models.js`；`test-functions.mjs` |
| 15 | `renderModelChips` 的 id/pv/label 未转义 | ✅ 已修：全量 `esc()`，上游另有模型名字符集白名单 | app.js + `_lib.js`；`test-shake.js` E 组 |
| 16 | `loadModels` 失败静默 | ✅ 已修：`#modelWarn` 明示「当前为内置兜底清单」及后台配置告警 | app.js；`test-shake.js` |
| 17 | `apiFetch` 的 `Object.assign` 整体覆盖 headers | ✅ 已修：`withHeaders` 浅合并，调用方 headers 不吞 Content-Type/口令头 | app.js |
| 18 | `window.LY` 无回退 | ✅ 已修：加载守卫 + 可读提示并终止初始化 | app.js 顶部；`test-shake.js` D 组 |
| 19 | `applyModels` 异步返回后无条件重建选择集 | ✅ 已修：合并 + localStorage 恢复，不静默丢弃已选模型 | app.js |
| 20 | `wrangler.toml` 硬编码 `GEMINI_BASE_URL`（含账号 ID） | ✅ 已修：移出仓库，改 Pages secret（`wrangler pages secret put`） | wrangler.toml 注释 |

### 测试质量台账（第三轮，15 项）

第三轮审计针对**测试自身的有效性**（自我实现、恒真断言、死代码、计数漂移），与本轮代码改动同批落地：

| # | 报告项 | 核实 | 处理 |
|---|---|---|---|
| 1 | `test-core.js` 第 5 项重算五虎遁、留 `mGan` 死变量，未调用 `fourPillars` | ✅ 成立 | 改为 `fourPillars(...).monthGZ === '丁酉'` 端到端断言（+1 项） |
| 2 | 第 10 项 `eq('甲日六神起', C.BEASTS ? '' : '', '')` 恒真 | ✅ 成立 | 换为「盘面六神序列 === BEASTS 自 `beastStart(日干)` 起」交叉断言（+1 项） |
| 3 | `test-diff.mjs` 的 `cmp()` 是死函数 | ✅ 成立 | 删除（实际比对逻辑内联在 `fields.forEach`） |
| 4 | `test-functions.mjs`「无告警」只断言返回值 | ✅ 成立 | 补 `warns.length` 前后对照断言（+1 项） |
| 5 | `test-rules.js`「无用神路径」实为重复测试 | ✅ 成立，但**建议的修法不可行** | 实测 64 卦 × 5 用神 = 320 组合**无一例**取不到用神（八宫首卦六亲必全 → 伏神恒存在），故改**构造**「去掉伏神」的盘验证该分支，并加 320 组合不可达断言（+6 项） |
| 6 | `package.json` 声明 `>=18`，但 `playwright-core@1.63.0` 要求 `>=20` | ✅ 成立 | `engines` 提到 `>=20`（package.json + lock 根），CI 本就用 Node 22 |
| 7 | UI 测试 B/C 组循环内无等待，时序脆弱 | ✅ 成立 | 对齐 A 组补 60ms 间隔 + 循环后 200ms 收敛等待 |
| 8 | 测试计数三处不一致 | ⚠️ **部分成立** | 真实不一致在 **README 自身**（L25「102 项」vs 文件表「62 项」）；报告所指「test-rules.js 头部注释写 62」不存在，且实测运行时 **102 项**（静态调用点 102，`grep eq(` 数不出循环展开）。已把表内 62 改为 102 |
| 9 | `test-core.js` 注释「惊恐节」笔误 | ✅ 成立（但只出现 1 次，报告称 2 次不确） | 改为「白露边界」（该段测的确实是白露） |
| 10 | README「待办：经典卦例回归」未进 M 表 | ✅ 成立 | M 表补 `M13 卦例回归（待数据，尚未覆盖）` |
| 11 | 源码扫描正则可能误伤字符串常量 | ✅ 成立（当前无 URL 故未爆） | 改为**先剥字符串再剥注释**，并加「剥离后仍含 `function`」守卫 |
| 12 | `relation5` 与 `relationText` 视角相反且无说明 | ⚠️ **部分成立** | `relation5` 本有五值注释；补 `relationText` 的视角说明与 `REL_TEXT['耗']='受制'` 的反直觉示例，并在 `relation5` 处互相交叉引用 |
| 13 | `diffJieqi` 迭代上界 15 是魔数 | ✅ 成立 | 提为 `JIE_MAX_ITER` 并注明「12 节 + 起点余量 3」 |
| 14 | `compatibility_date = "2026-09-24"` 若非当天会被拒 | ❌ **不成立** | 该日期早于当前日期，合法；仅在注释里补「必须是已过去日期、勿改成当天」的提醒 |
| 15 | UI 测试用 `networkidle` 等待，遇轮询/SSE 会超时 | ✅ 成立 | 改为 `domcontentloaded` + 显式 `waitForSelector`（E 组用 `state:'attached'`，芯片可能处于折叠态） |

> 报告亮点一节（`diffNightZi` 双流派显式映射、`jsonWithin` 反向对照、`safeEqual` 常量时间、暗动「翻转证明」、`public/` 物理隔离）与实际实现一致，无需改动。

### 第四轮台账（化耗真缺口 + 重报核销，21 项）

第四轮报告的输入是 `08bcc21`（第三轮修复后），其中 **12 项为第三轮已修项重发**，**1 项是真功能缺口**，其余为工程项与注释补强：

| # | 报告项 | 核实 | 处理 |
|---|---|---|---|
| P0-1 | `ruleDongBian` 漏判「用神克变爻（化耗）」 | ✅ **成立——真功能缺口** | 补 `ke(L.wx, b.wx)` → `kind='化耗'`、`rule='化耗气'`。旧版五值独缺「耗」，用神木化土一类动变整条无输出（analyze 失声）；顺带统一 `kind`（`化比和` 原先漏赋、为 `null`）。+11 项断言（含五值完备表） |
| P1-4 | `aggregateTrend` 对「休囚用神得日生」判吉 | ⚠️ **成立**（但报告所引代码非当前版） | 报告引的是缺 `STRONG` 门的旧片段。真实问题是「`STRONG→吉`」与「有生扶→吉」两条**等价分支**并存，后者把前者的 STRONG 门彻底架空。已合并为 `STRONG.includes(grade) ? '吉' : '平'`——失令者虽得日生亦须待时。+4 项断言 |
| P0-2 | `test-core` 月干项重算五虎遁、留 `mGan` 死变量 | ❌ **重报** | 第三轮已改为 `fourPillars(...).monthGZ === '丁酉'` |
| P0-3 | `test-core` 六神项 `C.BEASTS ? '' : ''` 恒真 | ❌ **重报** | 第三轮已换「六神序列 === BEASTS 自 `beastStart(日干)` 起」交叉断言 |
| P0-4 | `test-rules`「无用神路径」实为重复测试 | ❌ **重报** | 第三轮已改构造盘 + 320 组合不可达断言 |
| P1-1 | `test-diff.mjs` 的 `cmp()` 是死函数 | ❌ **重报** | 第三轮已删 |
| P1-2 | `test-functions.mjs`「无告警」只断言返回值 | ❌ **重报** | 第三轮已补 `warns.length` 前后对照 |
| P1-3 | `engines >=18` 与 `playwright-core@1.63.0` 要求 `>=20` 冲突 | ❌ **重报** | 第三轮已提至 `>=20` |
| P2-1 | 测试数量三处不一致（README 102 / 注释 62 / 实测 86） | ❌ **重报** | 第三轮已对齐为 README 与实跑一致；`test-rules.js` 头部本无项数，实测 108（本轮 127） |
| P2-2 | `test-core.js` 注释「惊恐节」笔误 | ❌ **重报** | 第三轮已改「白露边界」 |
| P2-3 | `calendar.js` 硬编码 `2100`，与已定义的 `YEAR_END` 重复 | ✅ 成立 | 改用 `YEAR_END`（改覆盖范围时只改一处） |
| P2-4 | `gen-jieqi.js` 死变量 `let d = new Date(y, 0, 1)` | ✅ 成立 | 删除（循环内实际使用 `cursor`） |
| P2-5 | `.kong` 类名语义错位（用于月建/日辰高亮，字面是「旬空」） | ✅ 成立 | 月建/日辰改用新类 `.gz-hi`；`.kong` 保留给旬空标记 |
| D-1 | 源码扫描正则可能误伤 URL 字符串 | ❌ **重报** | 第三轮已改「先剥字符串再剥注释」并加守卫断言 |
| D-2 | `relation5`/`relationText` 视角相反且无说明 | ❌ **重报** | 第三轮已补双向交叉说明 |
| D-3 | `ruleXunKong` 真空口径未在函数头注写明 | ✅ 成立 | 补头注：写明宽口径（`WEAK` 全集）的依据，及野鹤季节口径之别，避免外部审计反复重报 |
| D-4 | `ruleMovingOthers` 未写清飞神边界 | ✅ 成立 | 补注：用神为伏神时 `pos` 承自飞神，故 `M.pos === L.pos` 即飞神自身发动，飞伏关系统归 `ruleFu` |
| D-5 | `ruleShi`「伏世下」隐式依赖 `pos` 传递 | ✅ 成立（注释已在，断言缺） | 补结构断言：64 卦 × 5 用神全枚举，凡 `source === '伏神'` 者 `pos` 必为飞神位（实测 56 例、0 违例） |
| D-6 | `renderFailBox` 若「先 esc 再 slice」会在实体中间截断 | ✅ 代码本已正确 | 仅补注释钉住顺序（slice → esc） |
| D-7 | UI 测试 B 组循环内无等待 | ❌ **重报** | 第三轮已补 60ms 间隔 + 循环后收敛等待 |
| D-8 | `compatibility_date = "2026-09-24"` 若是未来日期会被拒 | ❌ **不成立** | 同第三轮 #14：该日期早于当前日期，合法 |

> 报告「亮点」一节（`diffNightZi` 双流派显式映射、`jsonWithin` 反向对照、`safeEqual` 常量时间、暗动「翻转证明」、10 万+ 字段差分、`public/` 物理隔离）与实际实现一致，无需改动。

### 第五轮台账（安全修复，9 项）

第五轮审计基线为 `e8ad863`（第四轮修复后），台账（20+15+21 项）对 HEAD 全部成立、无重报。本轮 9 项为**新增发现**，均已修复：

| # | 级别 | 报告项 | 处理 |
|---|---|---|---|
| 1 | 🔴 P0 | `app.js` 中 `r.id` 未转义（16 处插值中唯一漏 `esc()` 者），且 `esc()` 不转义引号 → 存储型 XSS | 新增 `escAttr()`（`esc` 之上补 `"`→`&quot;`、`'`→`&#39;`），`data-id`/`data-del`/`data-m`/`title` 四处属性位一律改用 |
| 2 | 🔴 P0 | 同上，服务端读路径信任库内历史脏 id | `ID_RE` 上提至模块级；GET 列表按 `ID_RE` 过滤非法行，GET `?id=` 非法 id 直接 400 |
| 3 | 🟠 P1 | `interpret.js` 的 `wl[provider]` 走原型链 → `provider='constructor'` 抛未捕获 TypeError → 边缘 500（前端误显示为「新部署传播中」） | 改 `Object.prototype.hasOwnProperty.call(wl, provider)` |
| 4 | 🟠 P1 | `interpret.js` 口令仍是明文 `!==`，未复用 `safeEqual`（台账 13 条只修了 `records.js`，属同类修复未收口） | `safeEqual` 上移至 `_lib.js` 共用，`records.js` 改为 import 并 re-export（保持既有 import 路径），`interpret.js` 改用它 |
| 5 | 🟠 P1 | `/api/interpret` 无限流/无来源校验，单请求可达 88,000 字符入模（费用敞口） | 入模上限收敛为 `4,000 + 8×2,000 ≈ 20,000`；新增可选 `RATE_LIMIT_PER_MIN` 软开关（按 IP 滑窗）。**2026-09-28 曾启用 `=20`，同日按用户要求「不限流」撤销**（`wrangler.toml` 中该行已注释保留）。全站口令 `ACCESS_CODE` 亦于同日启用后撤销。**当前 `/api/interpret` 无口令、无限流**，费用敞口仅由入模上限单独约束 |
| 6 | 🟡 P2 | `loadCast()` 无 `try/catch` → 接口异常时点击「什么都不会发生」 | 全函数包 `try/catch` + `libDetailError()` 写入 `#libDetail` 并提示；补 `data.record` 空值守卫 |
| 7 | 🟡 P2 | 三合／刑害／世爻 tag 不在 `aggregateTrend` 汇聚表内（永不影响 `trend`）；`ruleSanHe` 有死形参 | 死形参 `target` 已删（定义与调用点同步）；**汇聚表覆盖属口径问题，未擅改**——已登记进「已知口径分歧」并附可直接套用的改动清单 |
| 8 | 🟡 P2 | `gen-jieqi.js` 去尾逗号用值比较（`lines[末项] === l`）而非下标 | 改 `i === lines.length - 1`；`:68` 的 Uint32 断言文案改为与实际实现一致（`JIEQI_DELTAS` 为普通数字数组） |
| 9 | 🟡 P2 | `CUSTOM_PROVIDERS.label` 无字符集校验（`id` 有白名单，`label` 直入 DOM 属性位）；GET `?id=` 返回 `messages` 全文未在文档说明 | `_lib.js` 新增 `isSafeProviderLabel()`（非法则删 `label` 降级为 `id` 并告警，不整条丢弃供应商）；README「存储与安全」「已知口径分歧」各补一条 |

> 另：CI 已补 `test:ui` 步骤（`npm run test:all` 原不含 `test-shake.js`，而它覆盖的盲摆状态机／时间锁／追问历史最易回归）。

### 第六轮：三合局纳入 trend（口径定论，1 项）

第五轮台账 #7 遗留的「`aggregateTrend` 是否覆盖三合／刑害／世爻」已于本轮**依经典定论**（非取舍偏好）：

| # | 项 | 结论 | 经典依据 |
|---|---|---|---|
| 1 | 三合局 | **纳入** `supports`／`harms` | 《增删卜易·六合章第十九》「三合其局者，用神旺则无不为吉」，且吉凶由局与用神的生克定，直接作用于用神旺衰 |
| 2 | 刑害（相刑／相害） | **不纳入**（其「附和为凶」的语义已由 `WEAK + harms>0` 分支天然表达） | 《增删卜易·三刑章第二十一》：野鹤自述数十年「只以三刑为证而应验」仅得一卦，且多「附和为凶」 |
| 3 | 世爻关系 | **不纳入**（仅作 bullet 陈述） | 《黄金策》《增删卜易》「用克世勿作凶看」：吉凶随占类翻转（求财得、功名灾），无法单一映射；作用对象是世爻而非用神 |

实现：`ruleSanHe(pan, target)` 恢复 `target` 形参（第五轮误判为死形参而删除——`test-rules.js` 一直在传 `'官鬼'`，可见它是「预留未实现」而非死代码），产出 `relation` 字段（同气／生用／克用／泄用／耗用），`aggregateTrend` 据此归类。`test-rules.js` 新增 24 条断言（`127 → 151`）。

### 第二十一轮台账（健壮性与一致性收口，9 项 + 2 项定性订正）

第十九轮全量代码审计报出的剩余项，本轮全清。⚠️ **其中 2 项的定性被本轮撤销**（C2 报为「数据冗余」实为刻意契约；C3 报为「无经典依据」实为两条都有明文），1 项依原文定下口径。

| # | 报告项 | 结论 | 落点 |
|---|---|---|---|
| B4 | `readSSE` 的 `buf`/`full` 无上限 | ✅ 已修：双守卫（单行 1 MB / 正文 200 KB），撞限即 `reader.cancel()`，截断时仍返回已收部分并带 `truncated` | `functions/api/interpret.js`；`test-functions.mjs` #17 |
| B5 | 上游 `fetch` 无超时控制 | ✅ 已修：`AbortController` + `setTimeout` 覆盖「建连 + 读流」全程，默认 90 s（`LLM_TIMEOUT_MS`），超时 `504 LLM_TIMEOUT` | 同上 |
| C1 | `paipan` 对 `tossVals` 无入参校验 → **静默错排** | ✅ 已修：长度非 6、非 `number`、不在 `{0,1,6,9}` 一律抛错（旧版 7/8 被静默当阴爻，排出错卦却不报错） | `public/core/paipan.js`；`test-core.js` #18 |
| C2 | 非动爻也计算 `bian`（报为「数据冗余、语义误导」） | ❌ **判断撤销**：`bian` 是「变卦**同位爻**的纳甲」，古籍回归依赖它对静爻位逐位比对；**行为不改**，就地补注释 + 补契约锁定断言 | `public/core/paipan.js`；`test-core.js` #20 |
| C3 | `化回头冲`/`化回头合` 有判定、无依据、不入表 | ⚖️ **依原文定口径**：两条都有明文，补 `basis`；`化回头合` 判词「羁绊之象」→「化扶」（原文与「合绊」是两回事）；维持不入表，理由入「已知口径分歧」 | `public/core/analyze.js`；`test-rules.js` #20 |
| C4 | 非法日期抛误导性错误（指向「节气表损坏」） | ✅ 已修：`fourPillars` 入口判 `isNaN(getTime())`，给准确文案；`termMoment` 的边界断言保持原样（它防的是差分链损坏） | `public/core/calendar.js`；`test-core.js` #19 |
| C5 | 限流 `hits` 数组无界 + `clear()` 误放行 | ✅ 已修：达限即拒且不再入队（长度硬封顶在 `limit`）+ 只淘汰窗口内已无有效计数的 IP | `functions/api/interpret.js`；`test-functions.mjs` #18 |
| C6 | `app.js` 两处缺 `try/catch` → 状态锁死 | ✅ 已修：`#btnAI.onclick` 与 `sendChat` 补 `try/finally`（异常时按钮不再停在「卦师推敲中…」、`chatBusy` 不再永久为真） | `public/app.js` |
| C7 | 无 CSP | ✅ 已修：新增 `public/_headers`（CSP + nosniff + Referrer-Policy + X-Frame-Options + Permissions-Policy） | `public/_headers` |
| N1 | 辰月辰日遇用神辰 → 输出两条相同「自刑」（本轮实测新发现） | ✅ 已修：日支与月支**同支**时合并为一条；非同支路径判词**逐字不变** | `public/core/analyze.js`；`test-rules.js` #20 |

**验证方式**：10 项变异逐项回退重跑，**全部转红且每条 FAIL 精准指向被回退的行为**（例：C5 回退 →「单 IP 计数封顶」`got=20 want=3`；C4 回退 →「不再误指节气表」`got=true want=false`；B5 回退 → `got=502 want=504`）。`npm run test:all` EXIT=0（core 89 / rules 185 / functions 57 / gua-types 88 / guji 12102 断言 / selftest 41 / diff 零 BUG / verify 裁决件 162）。

### 已知口径分歧（**非** Bug，勿再重报）

以下各项均**非**缺陷，口径均已定，后续审计请勿重报。前两项属**流派门户之别**，本实现已选定其一；涉三合／刑害／世爻覆盖者曾为待定项，已于第六轮依经典定论。改动其一，须同步改 `aggregateTrend` 的 supports/harms 名单或判定门并补断言。列表中的删除线项为**已修项**，保留记录备查（旧版行为与修法一并留档，便于回溯）：

- **`ruleDayHe` 动爻逢日合**：本实现动爻一律判「合绊」（依《增删卜易》「动逢合而绊住」），静爻才分旺相「合起」/休囚「合绊」。另有流派主张旺相动爻亦可作「合起」。
- **`ruleXunKong` 真空条件**：本实现依《卜筮正宗·旬空论第十》——「真空到底空」为「**休囚安静**」「**静逢月破**值此旬空者」（即 `WEAK` = 休/囚/死，且**安静**）。另有两处季节口径更窄：野鹤〈旬空章第二十六〉与《卜筮正宗·用神空亡诀》皆称「春土夏金秋树木，三冬逢火是真空」，即仅「**死**」地成真空。收紧只需把条件改为 `grade === '死'`，但会改变大量存量卦的断语；本实现维持「休/囚/死」宽口径（流派选择）。
- ~~**`ruleXunKong` 的「动不为空」优先级**~~ → ✅ **已修（本轮）**：旧版先算 `zhen = 月破 || (休囚 && 无日辰生扶)`，为真即 `return`，未给「动不为空」留位置，故动爻遇空且休囚被误判真空。本轮依《卜筮正宗·旬空论第十》两侧清单定案：**「到底有用」一侧明列「旺相旬空，或休囚发动……」；「真空到底空」一侧两条皆带「安静」**（「休囚**安静**」「**静**逢月破」）—— 可见这不是优先级之争，而是 **`moving` 本就是真空的前置守卫**。修法：`const zhen = !L.moving && (zhenYuePo || (WEAK.indexOf(grade) >= 0 && !daySupports))`，**不触碰**真空定义的宽窄（那属上条的流派选择）。实测影响面 **33 / 2444** 条判定（全部为「真空 → 动不为空」，`trend` 迁移 22 条凶→平），逐条核对后仍判「凶」的 11 条各有独立伤克来源（月建克伤／化回头克／日辰克伤／动爻克用／化退神），无一依赖已改分支。`test-rules.js` 补 9 条边界断言（含「动+空+月破」亦不真空），`selftest.mjs` 的对应变异改为**改卦画令用神由动转静**（行为变异，比改期望值更强）。
  > 附注：真空不再成立时，若该爻**同时真月破且无日辰生扶**，`aggregateTrend` 仍会经 `zhenYuePo && !daySupports` 判「凶」——那是「真月破无救自成凶」的独立口径，与旬空无关（实测 33 条中无一落入此路）。
- **`aggregateTrend` 的「失令 vs 日生」权重**：本实现取「月建为提纲」——《增删卜易》「失令者纵得日生亦难成」。故用神休囚（泄气于月／克月建）即使得日辰生扶，`trend` 判「平」（待时）而非「吉」；只有旺相（`STRONG`）得生扶且无伤克才直判「吉」。另有流派以日辰为「主宰」，得日生即论可用。放宽只需把 `aggregateTrend` 末段写回 `trend = '吉'`（但会重新架空 `STRONG` 门）。
- **`aggregateTrend` 对三合局／刑害／世爻关系的覆盖（第五轮提出，第六轮依经典定论）**：结论为**三合局纳入、刑害与世爻关系不纳入**，三者理由皆出经典，非取舍偏好。
  - **三合局 → 纳入**：依《增删卜易·六合章第十九》「三合其局者，**用神旺则无不为吉**」，原文并以「如占功名，合成官局谓之官旺；合成财局，财旺生官；**倘合成子孙局者，乃伤用之神也**」为例——「合成子孙局」即「局泄用神」的五行表述，可见三合吉凶由**局五行对用神五行**的生克定，直接作用于用神力量。实现：`ruleSanHe(pan, target)` 产出 `relation`（同气／生用／克用／泄用／耗用），汇聚表据此归类——同气、生用 → `supports`；克用 → `harms`；泄用、耗用不入表（与既定的「泄气于月不入 harms」同口径）。
    > 第五轮曾把 `ruleSanHe` 的 `target` 当死形参删除，实为误判：`test-rules.js` 一直在传 `'官鬼'`，它是「预留未实现」而非死代码，第六轮已恢复启用。
  - **刑害（`相刑:*`／`相害:*`）→ 不纳入，但其「附和为凶」的语义已由现有分支实现**：依《增删卜易·三刑章第二十一》，野鹤老人自述「只以三刑为证而应验，这数十年，**我只得到这一卦**」，并谓子卯、丑未之刑「多是**附和为凶**」——刑非凶之主因，只在用神本已虚弱时跟着损伤。该语义恰由 `harms.length > 0 && supports.length === 0 && WEAK` 分支天然实现。若强行列入 `harms`，反使「旺相用神遇单刑」由吉降平，与「旺者不畏刑」相悖。
  - **世爻关系（`世爻:*`）→ 不纳入**：依《黄金策》《增删卜易》「**用克世勿作凶看**……如占求财，财爻克世者**必得**；占行人，用神克世者**即归**；占医药，子孙克世者**即愈**……**若占功名，官鬼克世，非祸即灾**」——同一「用神克世」的吉凶随占类翻转，**无法映射为单一方向**；且其作用对象是世爻（事与己），不属用神旺衰。故只作 bullet 陈述。
- **`化回头冲` / `化回头合` 不入汇聚表，且判词已依原文订正（第二十一轮：两句都找到了原文，口径就此定下）**：二者原先 `basis` 为空、被判为「有判定无依据」。回溯定本后确认**两条都有明文**，故补依据、定口径、并订正一处判词错误：
  - **`化回头冲`** ← 《增删卜易·**反伏章第二十八**》：「以上用神旺相，不变冲克者，虽则反伏，事亦必成，**只恐用神化回头之冲克者，即如卦变，大凶之象**」；实例「比之井」世爻乙卯动化辛酉，卯酉**既冲且克**。原文所论是「冲**克**」，其**克**向量已由 `动变:化回头克` 计入 `harms`；**只冲不克**者（丑未、辰戌同为土）原文未论。故本项自身不入表——否则会对已计入的伤害**重复计权**。
  - **`化回头合`** ← 《增删卜易·**六合章第十九**》：「爻之合者，靜而逢合，謂之**合起**；動而逢合，合謂之**合絆**。爻與爻合謂之合好，**爻動化合謂之化扶**」，同章又明言「**爻動化出之爻回頭相合者，謂之化扶，得他扶助之意**」。六合须分四种，本实现的 `动变:化回头合` 判的正是最后一种（变爻回头合本爻），故**判词应为「化扶」**——旧版写作「羁绊之象」是把「化扶」与「合絆」混为一谈，第二十一轮已订正（`合絆` 对应的是本仓 `ruleDayHe` 的 `日合:合绊`，即与**日月动爻**合）。
    不入表理由：同章谓「凡得諸合，諸占皆以為吉，**然必用神有氣相宜，用若失陷無益**」——吉凶随用神旺衰翻转，不满足 `aggregateTrend` 的纳入准则（须**直接、单向**作用于用神力量，且吉凶不依赖占类/旺衰），与「相刑相害」「世爻关系」同一处理。
  - **影响面**：`aggregateTrend` 的 supports/harms 名单**未改动**，`trend` 判定与旧版完全一致；本轮只改 `basis`（空 → 引原文）与 `text`（「羁绊之象」→「化扶，得他扶助之意」）。
- **反吟 / 伏吟、卦身：本仓**暂不实现**（M15 决策，非遗漏）**：两个外部六爻 Skill 都列了这两项，但彼此口径并不一致——按「本卦与变卦**逐位纳支全同／全冲**」这一常见叙述推演，在本仓纳甲体系下**恒不成立**（纳支全同意味着内外卦皆未变，即无动爻；纳支全冲要求变卦纳支恰为本卦六支的冲支，而八纯卦之外的纳支组合推不出该序列）；另一说取「动爻变出之支与本爻冲／同」，则与 `动变:化回头克/化回头生` 等既有判定重叠。卦身（月卦身）同理，世爻支→卦身支的配法各家不一。本仓的规矩是「断法须经 `tests/guji` 回溯定本背书方可落地」，故两项**留白**，不写死任何一家口径；将来若补，须先找到定本原文并登记于此表。
- **`paipan().lines[i].bian` 的语义＝「变卦同位爻的纳甲」——勿改为「静爻无 bian」（第十九轮曾误判，第二十一轮复核后撤销）**：只要本卦有动爻（`hasBian`），**六爻全部**带 `bian`，且取的是变卦**同位爻**的纳甲，**不是**「该爻发动后的值」。此为刻意设计——古籍排盘表的右半（变卦）对**静爻位同样印出纳甲**，`tests/guji/lib/check.mjs` 要逐位比对，`tests/verify/regress.mjs` 更明确写着「**不能用『静爻应无 bian』来断言**，只能断言『有无变卦』这一层」。改为 `null` 会直接废掉古籍回归的比对能力。现已在 `paipan.js` 就地注释，并由 `test-core.js` 第 20 节锁定（含「静爻位的 bian 取姤二爻辛亥」这类实义断言，非恒真）。

### 多模型 AI 断卦（functions/api/interpret.js）

- **供应商路由 + 模型白名单**：按模型名自动推断供应商，服务端白名单校验防任意模型名注入
- **Google 协议自适应**：base 指向 Google 原生路径时走 `generateContent + x-goog-api-key`，并强制 `thinkingBudget: 0`（gemini-3.x 思考路径高峰期 503 的根因规避）；其余一律 OpenAI 兼容协议
- **流式 SSE 服务端拼接**：所有 OpenAI 兼容通道统一 `stream: true`，服务端逐 chunk 拼接后返回完整 JSON——突破部分中转站 60 秒整响应硬超时，同时前端无需处理流
- **流式缓冲双守卫**：上游属信任边界外（用户自配中转），故两条无界路径均设硬上限——① 持续发送**不含换行**的数据会使行缓冲永不切分；② 发送**无限多条** `data:` 行会使拼接正文无限增长（CF Workers isolate 内存上限 128 MB）。阈值 `SSE_MAX_LINE` 1 MB / `SSE_MAX_REPLY` 200 KB（约 6 万汉字），撞限即 `reader.cancel()` 断开；被截断时仍返回已收到的部分答复并带 `truncated` 字段
- **上游硬超时**：`fetch` 默认无超时，上游挂起（不返回也不断开）会让请求一直悬置；流式只绕过了「整响应超时」，并不自带超时保护。现用 `AbortController` + `setTimeout` 覆盖「建连 + 读完整流」全程，默认 90 s（`LLM_TIMEOUT_MS` 可调），超时返回 `504 LLM_TIMEOUT`
- **gpt-5/o 系参数适配**：自动识别思考型模型，剥离其不支持的 `temperature`，改用 `reasoning_effort`（默认 low，环境变量 `GPT_EFFORT` 可调）
- **动态模型清单**：`/api/models` 由环境变量实时驱动（`GPT_MODELS` + `CUSTOM_PROVIDERS`），前端启动时拉取渲染芯片，后台增删模型/供应商零代码改动
- **失败降级**：断卦失败时不输出报错，而是展示可复制的完整 prompt，可粘贴到任意对话窗口手动断卦
- **上层契约四段（M15）**：`SYSTEM_PROMPT` 除原有断卦次序外，另加【盘面事实不可改写】【主次次序】【追问沿用原盘】【现实边界】四段。两份提示词是同一契约的两个副本（`app.js` 那份还用于「复制请求内容手动断卦」的降级路径），改一边必须改另一边——`test-functions.mjs` absorb 组逐段比对契约标记守住同源
- **断后事实审计（M15）**：断语回来后由 `core/fact-audit.js` 把显式盘面断言与卦盘对撞，冲突以告警条附在该模型答案下方；审计自身抛错不影响断语展示
- **断后推理审查（M15）**：再由 `core/coverage-audit.js` 审「推理有没有走样」——真空/动不为空/旬空待时、真破/假破、暗动/日破/冲散这三组成对概念一字之差而吉凶相反，误置即告警；盘里判定出的月破、旬空、伏神、三合、刑害若断语未提及，只作「请回看是否漏审」的普通提示；断语明说取用而与卦盘不符时告警（用神一错，全篇生克皆落空处）
- **敏感分流（M15）**：命中 `block` 时禁用「开始断卦」并在断卦区展示现实帮助渠道；排盘与旺衰粗判仍可查看（本仓首先是排盘工具，不宜因分流把工具本身锁死）

### 摇卦严肃性（防刷卦设计）

- **盲摆模式**：点[摇卦]由 `crypto.getRandomValues` 密码学熵源内定爻值，UI 只显示「已摇出」，点[落爻]才揭晓——摇与落之间不可反悔、确认前 DOM 中无爻象信息；落爻后铜钱展示本爻真实字/背（只读高亮，不可翻动），供核对结果，下一次[摇卦]/[撤销]/[重置]时清除
- **手动录入**：保留自行翻铜钱录入（标注「后果自负」），用户自主定结果，责任归属明确
- **时间锁**：现场摇卦模式下，首摇瞬间锁定占时（不可事后改时间）；补录模式可为既往时刻补卦
- **撤销修复**：撤销/重置彻底清空当前爻状态（含 `curCoins` 与已摇未落的内定值），杜绝「复制上一爻」状态残留 bug

### 存储与安全

- **D1 卦例库**：卦例含各模型独立对话历史（`{modelId: history[]}`），支持进阶探讨时延续上下文
- **卦例库口令**：`LIB_CODE` 管卦例库的**读与写**（浏览/装入/删除），与全站闸 `ACCESS_CODE` 解耦（闸门取 `LIB_CODE || ACCESS_CODE`）——**卦例库需登录，断卦不受限**；页面「口令登录」按钮经 `POST /api/records?verify=1` 探针验证，自动保存静默跳过未登录状态；未登录时点「卦例」会提示补输口令（`apiFetch` 遇 401 自动重试）
- **密钥不出服务端**：API Key 全部存 CF secret（加密变量，wrangler 部署不覆盖），模型名白名单 + 输入长度截断防注入
- **读接口开放的影响范围（第五轮提出 → 第二十轮彻底闭合）**：`GET /api/records` 列表与 `?id=` 详情原先**始终开放**，在只设 `LIB_CODE` 的配置下任何访客可读到全部卦例的 `question`（占问之事）与 `pillars`；猜中/拿到 id 后 `?id=` 还会返回 **`pan_text` 全文与 `messages`（各模型完整 AI 对话历史）**。问病、问讼、问感情类占问内容属隐私。
  2026-09-28 曾随全站 `ACCESS_CODE` 收口，同日按需求撤销 `ACCESS_CODE` 时**未单独评估这条连带影响**，读路径遂退化为「未设即放行」（实测 `GET /api/records` → `200`）。**第二十轮把读路径与写路径收口到同一口令闸**（`records.js` 的 `requireCode`，认 `LIB_CODE || ACCESS_CODE`）：无口令读列表/详情 → `401 ACCESS_REQUIRED`。当前口径为「卦例库**读与写均需口令**，`/api/models` 免口令」。
- **静态资源安全响应头（第二十一轮 C7）**：新增 `public/_headers`，对静态资源下发 CSP + `X-Content-Type-Options: nosniff` + `Referrer-Policy` + `X-Frame-Options: DENY` + `Permissions-Policy`。CSP 的价值在于兜住**外联与回传**（`script-src 'self'` 挡外部脚本、`connect-src 'self'` 挡把卦例/提示词 exfil 到外域）；`'unsafe-inline'` 为必需项——页面含内联 `<style>`，且 **Cloudflare 会向 HTML 注入内联的 `__CF$cv$params`**（Bot Management），不带它会被本页自己的 CSP 拦掉。前端已逐处 `esc()`/`escAttr()`/`mdLite()` 转义，CSP 在此是**第二道防线**而非唯一防线。注意 `_headers` **不作用于 Pages Functions 响应**，`/api/*` 的头由函数自身控制。
- **限流窗口的单 IP 计数有界（第二十一轮 C5）**：旧版每次请求都 `hits.push()`，单个 IP 的数组随请求数**无界增长**，且 `RL_HITS.size` 超限时 `clear()` 会**把正在被限流的访客一并放行**。现改为「达限即拒且不再入队」（数组长度硬封顶在 `limit`）＋「只淘汰窗口内已无有效计数的 IP」。IP 取用顺序为 `CF-Connecting-IP`（边缘写入、客户端伪造值被剥离）→ `X-Forwarded-For`（非 CF 部署的回退，该环境下可伪造，故此时限流只算降级可用）。
- **请求规模与限流**：`/api/interpret` 单请求上限为 4,000（排盘）+ 8×2,000（历史）≈ 20,000 字符；`RATE_LIMIT_PER_MIN` 为可选软开关（按访客 IP 滑窗，仅 isolate 内计数），**生产当前未设 → 不限流**（2026-09-28 曾设 20，同日按用户要求撤销）。全站口令 `ACCESS_CODE` 于同日启用后撤销，`/api/interpret` **回归无口令开放**（实测无口令 → 越过守卫，直接进入参数校验）。费用敞口现**仅由「入模上限 ≈ 20,000 字符」单独约束**
- **部署防回归**：已禁用 GitHub 集成的自动生产部署（其 Functions 构建缓存会回滚代码并抢占生产），统一由 wrangler direct upload 部署

### 生成式琴音（bgm.js）

- Karplus-Strong 拨弦物理建模：激励噪声三轮平滑去起音毛刺，衰减系数随频率变化（低绵长、高收敛）
- 总线 1500Hz 低通滤波，D 宫五声音阶中低音域随机漫步成句，泛音/双音轻点缀，句间留白 5~10 秒，卷积混响
- 零音频文件、零外部请求；默认开启，首次手势启动，切后台自动暂停

## 功能

- **摇卦**：一键盲摆（crypto 熵源、摇出即定、确认前不泄露爻象）或手动录入（后果自负）
- **完整排盘**：卦名卦宫、纳甲六亲、世应、六神、伏神、动爻变卦、旬空、月破、干支四柱（节气精确到分钟）
- **旺衰粗判（规则链）**：取用神（含两现取舍/多现伏神取临世应）→ 月建档 → 真假月破 → 日辰 → 暗动/日破 → 合起合绊 → 旬空/真空 → 动变（回头生克/进退神）→ **其余动爻对用神的生克（原神发动/忌神发动）** → 世爻关系 → 飞伏生克 → 三合刑害，趋势由规则汇聚（非算术评分），附应期线索
  - 五行关系统一走 `relation5()` 五值完备函数（比和/得生/受克/泄/耗），各规则不再用 `else` 兜底猜关系——历史 bug：月建子水配用神亥水（同五行异支）曾落兜底误报「克月建」，用神克日辰曾被误判「日辰比和」并污染月破真假与真空判定

- **AI 断卦**：排盘文本交给大模型按京房纳甲体系论断（用神 → 旺衰生克 → 吉凶 → 应期 → 白话总结），术语规范引自《增删卜易》《卜筮正宗》
- **多模型对比**：可同时勾选多个模型并列输出断卦结果，互为参照
- **进阶探讨**：断卦后可继续追问，各模型独立上下文，保持卦理一致
- **自定义所测**：固定六类用神之外，可自由输入所测之事，写入排盘文本交由 AI 细断
- **卦例库**：D1 数据库存储历史卦例（含各模型对话记录），可回看、删除；**浏览、装入与删除均需口令登录**（LIB_CODE）
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

安全设计：API Key 仅存服务端 secret，模型名服务端白名单校验防注入；**卦例库（读 + 写）由 `LIB_CODE` 口令闸保护**，`ACCESS_CODE` 与 `RATE_LIMIT_PER_MIN` **当前均未启用**，断卦费用敞口靠入模上限 20,000 字符约束。静态资源另有 `_headers` 下发 CSP（`connect-src 'self'` 阻断外域回传、`script-src 'self'` 阻断外部脚本），上游调用的**超时**与**流式缓冲上限**见「多模型 AI 断卦」。

## 文件说明

### 部署目录 `public/`（唯一上传至公网 CDN 的范围）

| 文件 | 说明 |
|------|------|
| `public/index.html` | 页面结构（摇卦、排盘、AI 卡片、模型芯片、卦例库） |
| `public/app.js` | 前端逻辑（盲摆状态机、时间锁、排盘渲染、多模型对比、进阶探讨、失败降级） |
| `public/bgm.js` | 生成式琴音引擎（Karplus-Strong 拨弦建模） |
| `public/core/data.js` | 易学常量（八卦纳甲、64 卦名、冲合刑害、进退神、三合局） |
| `public/core/data-jieqi.js` | 十二节交节时刻表（生成产物，勿手改；由 `tools/gen-jieqi.js` 重新生成） |
| `public/core/calendar.js` | 历法底座（JDN 四柱、五虎遁/五鼠遁、旬空、节气查表、夜子时开关） |
| `public/core/paipan.js` | 排盘事实引擎（纳甲/六亲/世应/六神/伏神，纯函数） |
| `public/core/analyze.js` | 断卦符号层（规则判定链，judgments/trend/yingqiClues） |
| `public/_headers` | 静态资源安全响应头（CSP / nosniff / Referrer-Policy / X-Frame-Options / Permissions-Policy）。**不作用于 `/api/*`**（Functions 响应头由函数自身控制），也不会被当作资源下发 |

### 仓库内（**不**进入部署目录，物理隔离于公网之外）

| 文件 | 说明 |
|------|------|
| `core.js` | Node 聚合入口（浏览器请按序加载 `public/core/` 八个文件，见 `public/index.html`；后三个为不参与排盘的上层契约层，须排在 `analyze.js` 之后） |
| `test-absorb.js` | 上层契约层 128 项自检（敏感分流三档 + 误伤白名单、领域方法的非古籍声明、断后审计四类断言双向用例、推理审查三组成对概念双向用例、应期三层 36 案并集不变量） |
| `test-core.js` | 排盘引擎 89 项基础自检（历法锚点、节气边界、表外降级不中断、夜子时、纳甲六亲、卦序、六神起法；另含 `paipan` 入参校验、非法日期文案、`bian` 语义契约锁定） |
| `test-rules.js` | 断卦规则链 127 项单测（暗动闭环、进退神、三合、夜子时正法、伏神伏世下、两现取舍、交节边界等） |
| `test-diff.mjs` | 三库交叉差分（4096 组合 + 历法时点 + 夜子时双流派 + 节气全量，10 万+字段） |
| `tools/gen-jieqi.js` | 节气表离线生成器（lunar-javascript → 差分压缩表） |
| `functions/api/interpret.js` | 断卦接口（多供应商路由 + 流式 SSE 拼接） |
| `functions/api/models.js` | 模型清单接口 |
| `functions/api/records.js` | 卦例库接口（id 服务端校验/生成，防伪造覆盖） |
| `functions/api/_lib.js` | 供应商解析共享层（`_` 前缀不路由，白名单与清单共用一口径） |
| `.github/workflows/ci.yml` | CI 质量门禁（单测 + 差分 + 语法检查 + 部署隔离断言，只验证不部署） |
| `schema.sql` | D1 建表语句（id 双层兜底：应用层 UUID + DDL DEFAULT 表达式） |
| `wrangler.toml` | 部署配置（D1 绑定 + 环境变量说明；`pages_build_output_dir = "public"`） |
| `package.json` | 仅 devDependencies（测试裁判库），生产构建零 npm 依赖 |

> **为什么要有 `public/` 这一层**：`functions/` 由 wrangler 单独编译为 Pages Functions，不受此目录约束。
> 此前 `pages_build_output_dir = "."` 会把 `wrangler.toml`（含 Account ID、D1 UUID、AI Gateway 路径）、
> `schema.sql`、测试脚本、README 全部作为静态资源上传到公网，任何人可直接下载整套架构拓扑。
> 经实测，Cloudflare Pages **direct upload 不支持 `.pagesignore` / `.assetsignore`**
> （`.assetsignore` 仅对 Workers 静态资源生效，放上去反而自身被上传），
> 因此隔离必须依靠目录物理边界；CI 中的「部署隔离断言」用于防止后续误改回归。

## 环境变量（Pages 后台 → Settings → Environment variables）

**Gemini 通道**

| 变量 | 说明 |
|------|------|
| `GEMINI_API_KEY` | secret，Google AI Studio key（AIza 开头） |
| `GEMINI_BASE_URL` | **secret**，CF AI Gateway 原生路径。含账号 ID 与网关名，故不写进仓库，用 `wrangler pages secret put GEMINI_BASE_URL` 设置；模板：`https://gateway.ai.cloudflare.com/v1/<ACCOUNT_ID>/<GATEWAY_NAME>/google-ai-studio/v1beta`。未配置则回退 Google 原生端点（数据中心 IP 常被拒） |

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
| `LLM_TIMEOUT_MS` | 选填，上游大模型请求硬超时（毫秒），默认 `90000`。覆盖「建连 + 读完整流」，防上游挂起时请求悬置；超时返回 `504 LLM_TIMEOUT` |

**自定义供应商（任意 OpenAI 兼容接口，无需改代码）**

1. 文本变量 `CUSTOM_PROVIDERS`，JSON 数组：

```json
[{"id":"kimi","label":"Moonshot","base":"https://api.moonshot.cn/v1","models":["kimi-k2"]}]
```

2. 密钥变量 `<ID大写>_API_KEY`（如 `KIMI_API_KEY`），设为 secret。

**其他**

- `LIB_CODE`：卦例库口令（secret）。设置后浏览/装入/删除卦例均需先在页面「口令登录」；未设置则卦例库开放（向后兼容本地/测试）。**只管卦例库**，断卦不受其约束。**生产已设**（值只存 CF secret，不落仓库与文档）。
- `ACCESS_CODE`：全站访问口令（secret），设置后**所有接口**（含断卦与卦例读取）都需口令。**2026-09-28 曾在生产启用，同日按需求撤销**——撤销后断卦恢复免口令开放。**当前未设置**。
  - 如需重新启用：`wrangler pages secret put ACCESS_CODE --project-name=liuyao`（值走 stdin）。
  - ⚠️ **实测订正**：secret 变更（尤其**删除**）后，**线上 Functions 仍持有旧环境快照**，必须重新部署一次才生效——只删 secret 不部署，`401` 会持续 3 分钟以上。此前文档写「secret 即时生效、无需重新部署」**不准确**，已按实测更正。
  > 与 `LIB_CODE` 的关系：两者现在是**同一口令闸的两个来源**（`records.js` 的 `requireCode` 取 `LIB_CODE || ACCESS_CODE`，**读、写路径共用同一实现**），差异只在未配置时的回退与失败文案。撤销 `ACCESS_CODE` 后，卦例库闸由 `LIB_CODE` 单独承担；`/api/interpret` 不受任一约束。
- `RATE_LIMIT_PER_MIN`：`/api/interpret` 按访客 IP 的每分钟请求上限，**可选软开关**。写在 `wrangler.toml [vars]`（非敏感、随仓库版本管理）。
  **当前刻意不设 → 不限流**：2026-09-28 曾设 `20`，同日按用户要求「不限流」撤销（该行已在 `wrangler.toml` 中注释保留，取消注释并重新部署即可恢复）。
  恢复时取 20 的理由：正常用法是「一次起卦 + 若干追问」，约 3~6 次/分；20 留 3~5 倍余量，共用出口（同 IP）也不易误伤；对脚本则把天花板压到 ≈2.9 万次/日/IP。仅当前 isolate 内计数，属成本抑制兜底。
- 文件清单新增 `bgm.js`（琴音引擎）。

> ⚠️ 注意：wrangler CLI 部署时 `wrangler.toml [vars]` 会覆盖后台同名**文本**变量（secret 不受影响）。后台改完变量后用 wrangler 重新部署一次生效。
> ⚠️ 本项目已**禁用 GitHub 集成的自动生产部署**——git 构建会复用旧 Functions 编译缓存并抢占生产位置，导致"部署了又变回旧版"。统一用下方 wrangler 命令部署；GitHub 仓库仅作代码备份（经 Contents API 同步）。

## 本地开发

```bash
npm install                       # 安装测试裁判库（devDependencies）
npx wrangler pages dev public     # 本地起 Pages（部署根为 public/，需先在 wrangler.toml 绑定 D1）
npm test                          # 快速环：基础自检 66 项 + 规则链单测 165 项 + 卦型判定回归 88 项（均无需裁判库）
npm run test:fn                   # Functions 层单测 41 项（jsonWithin 合法性/常量时间口令/模型名白名单/去重与读鉴权）
npm run test:paipan               # 排盘金标准回归 173 项（零依赖，只加载 core.js）
npm run test:ui                   # UI 冒烟 49 断言（Playwright + Edge 通道，需先起本地静态服务）
npm run test:all                  # 完整环：上者 + 三库交叉差分（CI 即用此命令）
npm run test:diff                 # 仅差分（差分本身时区无关，CI 仍固定 TZ=Asia/Shanghai）
npm run gen:jieqi                 # 重新生成节气表（改覆盖范围时用）
```

> UI 冒烟用法：`node test-shake.js [baseURL]`，默认 `http://127.0.0.1:8931`（可指向线上验证）。需 `playwright-core`（`npm i -D playwright-core`）与本机 Edge/Chrome。

> 审查提示：若 `raw.githubusercontent.com` 不可达（部分网络环境会静默超时，导致误判"文件不存在"），可用 CDN 镜像取源：
> `https://cdn.jsdelivr.net/gh/idavailable/liuyao@main/public/core/calendar.js`；或直接读 Git 对象树 `git ls-tree -r --name-only origin/main`。

## 部署

**先判断要不要部署**：只有触及 `public/`、`functions/`、`wrangler.toml` 的提交才进部署产物；
只改 `tests/`、`tools/`、README 的提交推上去线上也不会变（本项目自动部署已禁用）。

```bash
npx wrangler pages deploy public --project-name=liuyao --branch=main \
  --commit-hash=$(git rev-parse HEAD) --commit-message="<一句话>"
```

> 部署根是 `public/`（`wrangler.toml` 内 `pages_build_output_dir` 已固定）。
> 部署后请确认 `https://<域名>/wrangler.toml` **不可**取到真实内容
> （若返回 `text/html` 即页面回退，说明隔离正常；返回 `application/toml` 即为泄露）。
> 注意本项目对未知路径有 SPA 回退，故不能只看 HTTP 状态码，必须比对 `Content-Type`。

### ⚠️ 两个会让「逐字节校验」误判的坑（2026-09-28 实测）

**① 行尾：wrangler 把 `public/` 文件原样上传。**
本仓库远端是 LF，而 Windows 工作区被 `core.autocrlf` 检出为 CRLF。
直接 `wrangler pages deploy public` 会把 **CRLF 版本**推上线（`analyze.js` 多出 671 字节、
`app.js` 多出 855 字节）。功能无影响（`index.html` 用的是普通 `<script src>`，无内容哈希），
但「线上 == main 逐字节」这一审计不变量会失效。要保住它，就从 LF 归一化的副本部署：

```bash
rm -rf .tmp-deploy && mkdir -p .tmp-deploy
cp -r public functions wrangler.toml .tmp-deploy/
python -c "import os
for d,_,fs in os.walk('.tmp-deploy'):
    for f in fs:
        p=os.path.join(d,f); b=open(p,'rb').read()
        if b'\r\n' in b: open(p,'wb').write(b.replace(b'\r\n',b'\n'))"
cd .tmp-deploy && npx wrangler pages deploy public --project-name=liuyao --branch=main
```

**② HTML 永远不能逐字节比。**
Cloudflare 会向 `text/html` 注入 Bot Management 脚本
（`window.__CF$cv$params` + `/cdn-cgi/challenge-platform/scripts/jsd/main.js`），
实测首页多出 938 字节。判据要换成「**最长公共前缀 + 最长公共后缀**」：
若 `live = prefix + 注入段 + suffix` 且 `repo = prefix + suffix`，即为注入而非改动。
静态 JS/CSS 不会被注入，可直接 `cmp`。

D1 建库：控制台创建后将 `database_id` 填入 wrangler.toml，并执行 `schema.sql`。

## 许可

仅供学习研究，断卦结果仅供参考。
