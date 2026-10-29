# 修复台账（历史档案）

> 本文件是 `README.md` 拆出的历史记录，**只增不改**。
> 每条记录**当时**的状态（断言数、函数名、实现细节），不代表当前实现。
> 当前实况见 [README](../README.md) 的 §技术要点／§验收标准／§文件说明，
> 并以实跑 `npm test` 的 PASS 数为准。
>
> 维护规则：新增改动在**末尾追加一轮**，不回改旧轮 —— 回改会抹掉决策因果。

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
| `da2ae24` | M16 断卦三族落地（卦型 / 生旺墓绝 / 元神忌神仇神）——按外部审计证据建议顺序 ③→②→① 补齐三块结构性差距；引擎纯新增 439 行，+28 条断语用例（40→68 条，12102→12143 断言），+80 项单测（185→265），覆盖 37/51→64/78 |
| `da2ae24` 之后 | 第二十二轮：三族逐族核验（对证据清单 ①②③）+ `zsby-0875` 补锁「绝于日辰」（12143→12144）+ README 计数漂移收口（详见下方台账） |
| 待提交 | 第二十三轮：外部审计（Kimi）事实核查后的收口——M1 BGM 后台断链、M2 口令改 `sessionStorage` + 旧版迁移、L1 512 KB 请求体闸门、L2 列表分页（`limit/offset/hasMore`）+ 前端「加载更多」、`beijingNow` 的 DST 时柱偏移（`__wall` 锚点）、口令爆破限速（20 次/10 分钟）、两份 SYSTEM_PROMPT 全文一致断言；顺带订正 `wrangler.toml` 中 `LIB_CODE` 的口径注释 |
| `ef099da`（已推送 GitHub + wrangler 部署 production，2026-10-21） | 第二十四轮：全源码审计（六 Pass）后 **16 项全量修复**——P2×3：`app.js` SSE 流守卫改用响应头后重算的剩余量（旧值未扣建连耗时，180 s 截止可被超出）、`interpret.js` `panText` 非字符串直接 400（旧版 `.toString()` 强转使 `{}` 也能消耗一次真实调用）、`analyze.js` `ruleChangsheng` 月建/日辰同支合并为一条陈述（辰月辰日+用神水旧版输出两条「入墓」，与 `ruleXingHai` 合并不先例对齐）。P3×13：`question-shape` 多选一路径补副词排除（「他还是不来，还是算了吧」不再误判 multi，`还是不/还是先` 前接实义时按连接义，顺带修好「他还是不来，还是换一家」漏报 either-or）、`interpret.js` 非流式路径补大小守卫（`readCapped`，错误体 2 KB / 回复 `SSE_MAX_REPLY` 截断并标 `truncated`）、`models.js` 内置三条硬编码收敛为 `_lib.js` 的 `BUILTIN_MODELS`（消除双副本漂移）、`records.js` `hasMore` 改按过滤前行数判（脏 id 不再让分页提前终止）、`records.js` 主 POST `panText` 类型校验、`calendar.js` 删 `termDay` 死代码、DST 注释订正（V8 下归一化实测不复现，锚点价值在统一北京口径）、`domain-methods.js` JSDoc 归位、`bgm.js` localStorage 容错 + 「最高四音」注释订正、`index.html` bgm.js 补 `?v=` 缓存戳（全站升 `?v=20261021c`）+ loginTip 静态文案对齐运行时、`interpret.js` 头注释补 `GPT_EFFORT`、`app.js` `ruleGuaXing` typeof 守卫风格对齐。复跑：test:all 全绿（12144 古籍 + 265 规则 + 181 契约 + 149 Functions + 173 金标准 + 162 外部对账），UI 冒烟 49/49 |
| 待提交（2026-10-21 晚） | 第二十五轮：**残篇根因收敛到单一模型 + 补发换模型**。实测同一盘（坤为地之井，panText 1148 字符）首轮 skipCache，gemini-3.6-flash 13 次里 6 次断在句中（46%，字符 295/511/587/932/1001/1273），gemini-3.8-flash 6 次全部成篇（1154–1573），deepseek-flash 2 次成篇（1368/1406）；换第二张盘（家人之既济）3.6 仍 2/4 残篇——**与盘面无关，不是网关/缓存/通用参数问题**。改动：①`app.js` 残篇补发改用兄弟模型（`retryModelFor`，3.6→3.8；反向换是降级，故 3.8 残篇仍原地重跑），UI 补一行「首稿未完篇，本稿由 X 补全」；②默认模型 3.6→3.8，并对 `localStorage` 里仍是旧默认值的用户做一次性迁移（键 `ly_models_v2`，用户自选组合不动）；③3.6 芯片文案「快」→「快 · 偶发断稿」；④`interpret.js` 收流打 `{"ev":"stream_end","finish":…,"chars":…,"thought":…}` 采样日志，并统计 Google 原生流 `parts[].thought` 字符数（**只观测不拦截**）——此前未成篇样本只报 `INCOMPLETE_STRUCTURE`、无 `MODEL_*`，无法区分「上游自称 STOP」与「流被提前掐断」，这条日志用于定论。复跑：`npm test` 265 + `test:fn` 176 + `test-shake` 62/62（新增「首稿用 3.6」「补全改用 3.8」两条断言）。⑥上游 429 不再笼统成 502：透传 `429 UPSTREAM_RATE_LIMITED` + `Retry-After: 60`，前端把该码列入不重试白名单——2026-10-21 23:40 线上 Gemini 免费配额打满，旧映射让每次断卦空转 20 轮、三分钟才降级，用户只看到「接口暂未就绪」 |
| 待提交（2026-10-24） | **M17-B 阶段一：按盘 OG 预览（文本卡）落地**，方案见 `docs/proposal-og-preview.md`（打包边界实验先行确认 Functions→public/core 的 esbuild 织入可行）。改动：① 新增 `functions/api/_share.js` 零逻辑门面——import `public/core/{data,data-jieqi,calendar,paipan,share}.js` 后直接绑定 `globalThis.LY` 原函数引用（相对 proposal §二 的箭头包转发有一处修正：包转发永远无法通过「门面 decodeCast === core.js 的 LY.decodeCast」严格相等断言，改为模块求值期绑定引用后断言成立且仍无任何解码逻辑）；② 新增 `functions/index.js`（"/" 路由）按 `?s=` 服务端注入 og:title／og:description／`<title>`：四锚点全或无（og:site_name 为结构守卫，任一未命中回退默认 meta + console.warn），标题与站内同口径（`本卦 之 变卦`／`本卦（静卦）`＋四柱，useLabel 映射 shi→世爻、__custom__→自定义），description ≤200 字符、`& " < >`＋控制字符转义、替换一律函数形式（$& 不展开）；畸形／空／无 s 参数回落站点默认 meta（200，绝不 500），改写响应删 etag/last-modified + `Cache-Control: public, max-age=300`；断语层模块物理上不在 import 闭包（白名单测试钉死）；③ `ci.yml` ESM 探测列表加 `_share` 与 `./functions/index.js`；④ `index.html` head 注释由「本轮未做」改为指向已实施说明。`test-functions.mjs` 新增 OG 组 48 项（185→233）：合法码四锚点改写、静卦口径、畸形码原样回落（etag 保留）、空参/无参直通、旧格式（三段最小）码照常改写（未注明/未取）、转义与 $& 字面、decodeCast 同一引用、import 白名单、锚点缺失全或无。未部署（按惯例产物变更留到统一发） |

| 待提交（2026-10-25） | **M19：断卦「先碎片、末尾整篇重来」根因收敛 + 背景音重做（移动端可播）。** 断卦侧三处：① `fact-audit.js` 新增 64 卦名白名单（`guaNameSet`/`isGuaName`/`firstGuaNameIn`，自 `LY.HEXNAMES` 懒建）——「本卦为六冲卦（坤为地）」这类把**卦型**写进「本卦为…」句式的正常断语，旧版把「六冲卦」当卦名比对盘面，凡此必报「本卦卦名：六冲卦 ≠ 坤为地」；而 `app.js` 一旦收到未 accepted 的审计结果就整篇回灌重写，并把重写稿重新流式渲染到同一气泡——用户观感即「断语先出碎片，收尾后又整篇重来」。现只有捕获片段属于 64 卦名之一才作断言，否则看括注（「本卦为六冲卦（水雷屯）」以括号内为准），都没有则不猜不报；写错真卦名、卦型句式夹带错卦名仍照报。② `app.js` 重写期渲染：补全稿/校正稿不再用首稿的 `onStream` 逐帧重画气泡（旧版从空重流一遍），改为「当前稿压暗保留 + 顶部 `.rw-bar` 只更新已收到字数」，完成后由末尾那次整块渲染一次性替换；`index.html` 补 `.rw-bar`/`.rw-draft` 样式。③ 回归：`test-absorb.js` 新增 8 项（四类卦型的「卦型句式不误报」+「括注真写错卦名仍报」+「本卦为静卦不作断言」+「并列写法照旧审」），201→209。背景音侧（`bgm.js` 重写）：音阶 73–247 Hz → D4–B5（旋律限 D4–E5）——旧音区低于手机小喇叭有效输出，是「手机听不到」首因；单音增益 0.05–0.10 → 0.18–0.30、总线 0.6 → 0.9 并串 DynamicsCompressor；总线 lowpass 1500 → 6500 Hz、加 100 Hz highpass（旧版把琴音压成闷响，是「难听」主因）；旋律由纯随机漫步改为「固定动机 + 级进变奏」，句后留白 5–10 s → 2.6–4.2 s，另加极轻低音持续音与句首起音上滑（按音）；起播由单路 pointerdown（且 kick 即摘监听）改为 pointerdown/touchstart/click/keydown 四路 + 静音 buffer 预热 + `ctx.resume()` 后回查 `ctx.state`、失败自动重挂，并对 touchstart/pointerdown 同帧双触发加并发闸（防两条乐句链叠音）。全站资源戳 `?v=20261024a` → `?v=20261025a`。复跑：test 93+280+91+209+55+46、test:fn 254、test:guji 12148、test:guji:self 0 失败、test:paipan 173 全绿（`test:diff`/`test:verify` 因本机缺 `@taoracle/najia` 等裁判库未跑，改动前基线同样报 ERR_MODULE_NOT_FOUND） |
| 待提交（2026-10-25 晚·M19a） | **M19a：线上冒烟转绿 + 断卦重写/背景音浏览器回归。** ① `public/_headers`：CSP 的 `script-src` 增 `https://static.cloudflareinsights.com`、`connect-src` 增 `https://cloudflareinsights.com`。起因：CF 会对本 zone 的 HTML 自动注入 RUM 探测器（`/cdn-cgi/challenge-platform` + `beacon.min.js`），被本站 CSP 拦掉后每个页面控制台都报一条 CSP 违规，`tools/smoke-prod.cjs` 把它算成「JS 运行时错误」（24 通过 / 1 失败）。现只钉这一个 CF 自有主机，不加通配、不引入第三方——流量本就全程过 CF，隐私面无增量；若不想让该脚本运行，应在 CF 后台关 Web Analytics，而不是用 CSP 硬拦（拦了只剩噪音）。修后 `smoke-prod` 25/0。② 新增 `tools/smoke-rewrite.cjs`（真浏览器 + 脚本化 SSE，`SMOKE_PROXY` 可选走代理）：第一稿故意不含「结论：」以触发补全重写，每 40ms 采样 `.ai-col-body`，断言「重写期草稿句始终可见（气泡未从空重画）」「只出现 `.rw-bar` 且字数单调不减」「完成后一次性替换出结论卡」；再验 `#bgmBtn`「首个用户手势自动起播 → 点关 → 点开」。线上实测 15/0——M19 那条观感修复至此有了浏览器级回归，不再只靠单测。③ 部署与推送（2026-10-25 晚）：`git push`（GitHub `main`，`2c4296d..0c71cbc`，随后含 M19a）+ `wrangler pages deploy`（API Token / account `88497ab7…`），部署号 `7ab272db` → `00758fa5`；线上 `app.js`/`bgm.js`/`core/*.js` 与本地逐字节一致（`index.html` 仅差 CF 边缘注入的 bot 检测脚本），资源戳 `?v=20261025a`。④ 同期实测记录（**非本次改动引入**）：`gemini-3.8-flash` 上游长时间不吐首字节——整盘 2 次 524（126s/127s）、短提示探针 70s/130s 均 0 字节；而 `gemini-3.6-flash` 11s 完篇、`deepseek-flash` 76s 完篇（1098 分片 / 1323 字，审计 0 误报）。顺带发现一处口径不匹配：`LLM_TIMEOUT_MS` 默认 300s **大于** CF 边缘约 100s 的等首字节上限，模型挂起时用户先撞 `error code: 524`，而不是代码里设计好的 504 `LLM_TIMEOUT`——待定为「下调默认值」或「给首字节单独设超时」 |
| 待提交（2026-10-28·M26） | **对齐 GitHub main（`7330716→c06fbe0`，含 M21c／M22／M23／M24／M25）后的「仍然没有回答」专项收口。** 本地原状态即为 M21 之前的版本，用户的「无回答」观感在本地有过时的成分，但上游五版并未覆盖以下六条，逐条复现后修复：① **草稿冒充回答**（主因）：服务端流末兜底补发的 `{"t":…,"draft":true}` 被前端 `full += j.t` 直接拼进正文，`DRAFT_ONLY` 告警只进 `streamWarn`（要正文非空才追加提示），于是「10k 字思考」被当正式断语渲染，还进了 `aiStates[m].history` 污染下一轮追问；现 `draftOnly` 单独置位——草稿**不进正文、不上屏、不入历史**，首轮与追问统一抛 `kind:'stream',code:'REASONING_ONLY'` 走换模型。② **残篇被清空**：残篇补发请求自身失败时，异常冒到最外层 `renderFailBox`，已经流出来的正文整栏清空；现捕获后把首稿原样留下并补一行「补发失败（原因），以上为首稿残篇」。③ **追问失败污染历史**：追问拿到异常时 `user` 消息已经入列，下一轮请求带着没有 assistant 的孤儿问题；现在未获得 assistant 回答时回滚该条 `user`。④ **降级资格**：服务端下架/未配 key 的模型（`configured:false`）仍会被 `loadSelModels()` 从 localStorage 加回请求队列，`DEFAULT_MODELS` 也照抄不误，前端于是持续向拿不到 key 的模型发请求；现在清单以服务端为准并回写 localStorage，默认组合回落到第一个可用模型。⑤ **换模型等于没换**：切到备选模型时沿用旧模型的 `start`，预算已被前一个模型耗尽，`switchModelOnce` 后立刻 `break`（界面表现「换了个模型还是秒失败」）；现每个实际生成模型重算自己的时间起步。⑥ **降级窗口裸奔**：快速/慢速两条路径都在跨模型降级**之前**清掉首字节计时器，主模型秒回 503、备选挂起时无人看守；现计时器在备选落地后才清。回归：`test-functions.mjs` 292→**326**（新增跨模型降级期间首字节守卫在快/慢两路都仍生效、清计时器时机在备选之后），`test-shake.js` 62→**75**（新增 B4 补发失败保留残篇 4 条、B5 追问 DRAFT_ONLY 不入答不入史且触发跨模型降级 6 条、B6 已下架模型不复活 + 未配置模型空返回后切换 3 条）；全站资源戳 `?v=20261028d`→`?v=20261028e`。复跑：`npm test` 93+280+91+209+55+46+152、`test:fn` 326、`test:paipan` 173、`test-shake` 75/75 全绿（`test:diff`/`test:verify` 因本机缺 `@taoracle/najia` 等裁判库未跑，与改动前基线一致） |
| 待提交（2026-10-29·回访闭环） | **「20 卦 0 判据」：baseline 写入路径收口 + 入库回执可见化。** 起因：直查线上 D1（`liuyao-db`）实测 `casts` 20 条、`outcome` 回填 **0** 条、`baseline` **20 条全 NULL**、`readings` **0 行**——回访闭环从第一步即空转，命中率分母恒为 0，且界面无任何提示。先排除两项：表结构齐全（`baseline`/`outcome` 列与 `readings` 表均在，非迁移缺失）；`test:fn` 既有 333 项已覆盖「带 baseline 必派生 readings」，非服务端逻辑。定位到前端两处：① `baselineSnapshot()` 直接读 `lastAnalysis`，该值在「先摇卦、后选事类」与「自定义事由推不出关键词」两条流程下为 null，判据整条丢失；② `autoSaveCast()` 的 catch 全静默 + `apiFetch(..., silent)` 未登录即跳过，于是「未登录被拒」「服务端 5xx」「存进去了但无判据」三种状态在界面上完全同形，空转近一月无人察觉。改动：新增 `analysisForSave()`——`lastAnalysis` 为空且盘与事类俱在时现场重算 `analyze`（只读：不写 `lastAnalysis`、不动任何界面），`baselineSnapshot()` 改用它；新增 `showSaveTip()`，据服务端回执分四态在 `#saveTip` 明示，其中「无判据」态给出补救指引（选好事类后重新存入即可补上）；`functions/api/records.js` 的 POST 回执由 `{id}` 扩为 `{id, hasBaseline, reading}`（`reading` 当日派生成功时回 `due_at`）。测试：`test-functions.mjs` 333→**338**（回执四态 + id 向后兼容）；新增 `tools/check-baseline-snapshot.js`——从 `public/app.js` 原样切出 `analysisForSave`/`baselineSnapshot` 两段源码、配真 `core.js` 注入执行，覆盖正常/兜底/自定义/无判据/无盘五组共 15 条，并接入 `npm test`（另留 `npm run test:save` 单跑）。待验：10-27T07:03Z、10-28T03:13Z 两卦在含该功能的生产版本之后仍为 NULL，疑为长开标签页跑旧脚本，本次修后下一卦凭回执即可自证。复跑：`npm test` 93+280+209+55+46+152+**15**、`test:fn` **338** 全绿。**未部署**（按惯例留到统一发） |
| 待提交（2026-10-29·三模型对账） | **三模型对账落地：票源改用 Workers AI 免费额度，不新增任何凭据。** 起因：用户要那张投票页，并指出「只有 2 个 provider 不好用」。选型实测（`tools/model-compare.js`，同一张雷泽归妹盘并行打 5 个候选）：`glm-4.7-flash` 400 tokens 全耗在 reasoning、`content` 恒为 null；`gemma-4-26b` 10s 内 `finish=length` 空返回；`clef-omni` 的 question 键被 `^[A-Za-z0-9_.-]{1,100}$` 拒（422）——**同样中文键 clef 能用、clef-omni 不能用**，故统一改 ASCII 键、在代码里映射回中文。最终三票：`@cf/cloudflare/clef`（直接给概率、输出零计费）、`@cf/qwen/qwen3-30b-a3b-fp8`（干净 JSON，2.08 neurons）、`@cf/openai/gpt-oss-120b`（14.58 neurons，出身不同以保独立性），一轮约 17 neurons，10000/天 ≈ 500 轮。改动：① 新增 `functions/api/vote.js`——三票并行、单票 28s 超时（超时即降级为无效票，不拖垮整页），chat 侧 `extractJson`（剥代码围栏 + 括号配对 + 字符串态跟踪）与 one-hot 归一，解析失败一律 `UNPARSEABLE`/`BAD_FIELDS` 判无效，**绝不猜**；clef 侧把 5/5/4 档 criteria 的 ASCII 概率映射回中文并归一化到 1。② 新增 `public/vote.html`——沿用演示页原版式（宣纸浅色、事实层/结论层/分歧矩阵三连），加 live 通道：主站按钮把盘面快照写 `localStorage['ly.vote.cast']`（30 分钟过期，防旧盘白花配额），页面启动即自动对账；live 路径**不做 jitter**，避免扰动真实数字。③ 主站「断卦」卡片加「三模型对账」按钮，`voteStateText()` 只送盘面事实 + 引擎口径，不送断语全文（否则文风噪音盖过判断差异）。④ `wrangler.toml` 加 `[ai] binding = \"AI\"`；生产绑定已通过 CF API 写入 Pages 项目 `deployment_configs.production.ai_bindings`（Git 集成构建不读本文件 bindings，该段仅供 `wrangler pages dev` 本地调试）。测试：`test-functions.mjs` 338→**361**（三票形状 / 围栏抠 JSON / `"75%"` 归一 / 缺字段 / 单票抛错降级 / 503 / 400 / 405 / ASCII 键回归）；新增 `tools/check-vote-page.js`（DOM 桩 + 假 fetch，验证启动自动对账、4 行事实层、3 卡、4 行矩阵、live 不扰动，PASS 13）并接入 `npm test`，另留 `npm run test:vote`。复跑：`npm test` 93+280+209+55+46+152+**15**+**13**、`test:fn` **361** 全绿。**未部署**——AI 绑定已在项目配置里，部署后 Functions 才能拿到 `env.AI` |
| 待提交（2026-10-29） | **DeepSeek 改官方直连，不再经 CF AI Gateway。** 起因：网关侧请求超时实测约 91s，`cf-aig` 重试与网关缓存都会干扰长断语（思考预算 32768 时总耗时贴近该上限），用户要求直连。改动只有一处行为变更，但做了「防漏」处理：`providerConfig` 里 deepseek 的 base 不再直接取 `env.DEEPSEEK_BASE_URL`——指向 `gateway.ai.cloudflare.com` 的值一律视为遗留配置并**忽略**，回退 `https://api.deepseek.com/v1`（线上 secret 未清理也不会静默继续走网关），命中时打一行 `[liuyao] DEEPSEEK_BASE_URL 指向 AI Gateway，已按配置忽略并直连 …`；非网关地址（自建中转/代理）仍照旧生效。副作用是 `gatewayHeaders()` 对 deepseek 天然返回空对象（base 不含网关域名），`cf-aig-*` 超时/重试/缓存不再参与；Gemini、GPT 若配网关地址仍照旧。回归：`test-functions.mjs` 326→**333**——网关缓存/超时头用例改由 GPT（`GPT_BASE_URL` 指网关）承载，另新增 DeepSeek 专项 5 条：遗留网关地址被忽略→`https://api.deepseek.com/v1/chat/completions`、直连不带 `cf-aig-request-timeout`、不带 `cf-aig-skip-cache`、未设变量同样直连、非网关自定义地址仍生效。同步订正 `wrangler.toml`／`README.md` 的 `DEEPSEEK_BASE_URL` 口径。复跑：`npm test` 93+280+91+209+55+46+152、`test:fn` 333 全绿（`test:diff`/`test:verify` 本机缺裁判库未跑，与基线一致） |
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

**验证方式**：10 项变异逐项回退重跑，**全部转红且每条 FAIL 精准指向被回退的行为**（例：C5 回退 →「单 IP 计数封顶」`got=20 want=3`；C4 回退 →「不再误指节气表」`got=true want=false`；B5 回退 → `got=502 want=504`）。`npm run test:all` EXIT=0（core 89 / rules 265 / functions 117 / gua-types 91 / guji 12144 断言 / selftest 41 / diff 零 BUG / verify 裁决件 162）。

### 第二十二轮台账（M16 三族核验 + README 计数收口）

**输入**：一份外部审计证据（对 `59f6a3e` 的状态结论）——装卦层已达定本水平、主干规则链不远，差在三块：**① 元神/忌神/仇神没有显式体系**（只按五行五值平铺输出「动爻生用/动爻克用」，原神忌神只是文案里的两个词）、**② 长生十二宫未实现**（「用爻遇长生逢帝旺，皆谓之旺」无判定，`zsby-0875`「世爻绝于申日」只能并入「日辰克伤」）、**③ 卦型算了不消费**（`isLiuChong/isLiuHe/soul` 已由 M14 算好，但断卦链不读、panText 不带给 AI）；建议顺序 ③→②→①，且动断卦链前须按 `tests/guji` 铁律先回溯定本、建用例。

**核实结论**：`da2ae24`（M16）已按该顺序把三族全部落地（引擎纯新增 439 行、+28 条断语用例、+80 项单测，覆盖 37/51 → 64/78）。本轮逐族核验实现与证据标准的差距，并**全量回归实跑复验**（非采信提交信息）：

| # | 证据项 | 核实结论 | 落点 |
|---|---|---|---|
| ① | 三神只是文案、无显式识别与「元神受克/忌神被制/仇神发动」连锁判定 | ✅ 已落地：`identifyYJC` 显式识别三神（元神=生用神者、忌神=克用神者、仇神=克元神**且**生忌神——双条件，两书定义皆然）；`ruleYJC` 按〈元神忌神衰旺章第十〉两侧清单判有力/无力（元神 5+6 条、忌神 5+7 条）、仇神发动、贪生忘克（以五行定理覆盖两侧「同动」条目）；日月候选进结构（`isRiYue`）但**不进判定输出**（由主链月建/日辰族覆盖，防同一事实两条断语）。「元神受克」即仇神发动路径，「忌神被制」即无力分支，均已显式化 | `public/core/analyze.js` |
| ② | 长生十二宫未实现，「绝」维度丢失 | ✅ 已落地：`ruleChangsheng` 月日层（长生于/墓于/绝于 × 月建/日辰）+ 动变层（化长生/化旺/化墓/化绝）+ 觉子曰三宽逐条落地（烈火煎金惟金且火多≥2、论生不论墓惟金且墓支逢冲、论生不论绝惟土）；帝旺支即当令支，月日层由「临日月」覆盖故不重复判。**本轮补锁**：`zsby-0875-huihuatouchong` 补断言 `生旺墓绝:绝于日辰`——该例 target=shi（世爻卯木为用神），原文「不宜世爻绝于申日又化回头冲克」把「绝」与「化回头冲克」并写，是外部证据点名的 motivating 用例；此前只锁化回头冲/克 | `analyze.js` ruleChangsheng；`tests/guji/cases/zengshan-boyi.json` |
| ③ | 卦型数据不消费、panText 不带卦型 | ✅ 已落地：`ruleGuaXing` 进断卦链（六冲/六合/游魂/归魂 + 相变五型，只陈述**不入 trend**——吉凶随占类翻转，野鹤「须以用神为主」）；`buildPanText` 增「卦型」行并列入 AI 契约；两份 `SYSTEM_PROMPT` 同步「卦型」要点与「以用神—元神—忌神—仇神为主线」 | `analyze.js` ruleGuaXing；`public/app.js`；`functions/api/interpret.js` |

**README 计数漂移收口**（一律以运行时实跑 `PASS:` 为准，不数静态 `eq(`）：`test-rules` 127→265、`test-core` 66→89、`test-functions` 102→117、`test-gua-types` 88→91（81 金标准 + 10 变异）、guji 12143→12144；分歧段落由「已登记分歧 1 条 + 原第 2 条已修正」改为「5 条 + 1 已修」（与 §七 对齐——漂移源自 `b65893e` 登记 4 条新分歧时只改了主 README 的一处计数）；`npm test` / `test:all` 命令行说明补全（原缺 `test-absorb`/`test:guji`/`test:guji:self`/`test:verify` 且描述停在旧环）。

**验证**：全量回归实跑 EXIT=0——core 89 / rules 265 / absorb 128 / gua-types 91 / guji 12144（含 5 处分歧锁定、31 处文本缺陷登记）/ selftest 41 / coverage 64/78 / functions 117 / diff 104,780 字段零 BUG / verify 173 + 162 / shake 49。三族规则在 `analyze()` 判定链中的接入点、两份 SYSTEM_PROMPT 的同源契约标记均逐处读过，非仅看提交信息。

### 第二十三轮台账（2026-10-17：SSE 心跳 / 审计误报 / 占时口径）

**输入**：DeepSeek V4.1-Flash-1017 发布后的一轮全量复审。基线 `40b2850`，以「读代码 + 实跑实验」为准，不采信注释与既有结论。

| # | 问题 | 核实与修法 | 落点 |
|---|---|---|---|
| ① | **SSE 心跳从未发出**（P0） | 双层失效：心跳闭包引用的是 `releaseLock()` 之后的 writer，`write()` 返回 rejected promise 被 `.catch` 吞掉；即便 writer 有效，外层 `finally` 也会在 `return Response` 时立刻 `clearInterval`（只有 timer 做了 `timerHandedOff` 托管，心跳漏了）。修法：全流共用一个 writer；心跳与 timer 一并在 `pipeMergedSSE.finally` 清理 | `functions/api/interpret.js` |
| ② | 客户端断开不掐上游 | 旧版自建 `AbortController` 只接 `setTimeout`，未接 `request.signal`；前端 abort 后下游背压挂住，上游仍跑到 300s。修法：`request.signal` → `ctrl.abort()`，并置 `clientGone` 跳过降级重试，返回 499 | 同上 |
| ③ | fact-audit 变卦语境误报 | 「变卦三爻为子孙」被判成「本卦三爻实为兄弟」。修法：按断言前最近出现的「变卦/之卦」与「本卦」判定语境，变卦侧比对 `L.bian`（伏神豁免只对本卦成立） | `public/core/fact-audit.js` |
| ④ | fact-audit 书名号误报 | `sameGuaName` 只剥尾字「卦」，`《泽天夬》` 被判不符。修法：先剥 `《》「」『』【】` 等成对符号再比对；写错卦名仍报 | 同上 |
| ⑤ | 占时随本机时区漂移 | 节气表是 UTC+8，`fourPillars` 读本机 getters。实测同一 UTC 时刻：上海得「丙午年庚寅月己酉日庚午时」，纽约得「乙巳年己丑月戊申日甲子时」。修法：`beijingNow()` 让现场占时按北京墙上时间取值，补录输入同口径，UI/panText 标注「北京时间」；core 不动，测试基线不受影响 | `public/app.js` |
| ⑥ | Gemini 走非流式 | `generateContent` 要等整篇生成完，期间边缘无字节下发且前端无渐进渲染。改 `streamGenerateContent?alt=sse`，`pipeMergedSSE` 增 `candidates[].content.parts[].text` 解析（JSON 回包仍兼容） | `interpret.js` |
| ⑦ | `panText` 静默截断 | 旧版 `slice(0,4000)` 会砍掉伏神/变爻/契约段且无痕迹。改为超限 413 `PAN_TOO_LONG` | 同上 |
| ⑧ | 生成上限与心跳不可调 | 新增 `LLM_MAX_TOKENS`（不设则不传，避免写死截断）与 `SSE_HEARTBEAT_MS`（默认 15000，下限 1000） | 同上 |
| ⑨ | 流式渲染每 chunk 重建 DOM | 1017 输出更快，长答复每秒数十次 `innerHTML`。改为 60ms 合并窗口 + 收尾补发（不丢末段） | `public/app.js` |
| ⑩ | 模型清单遗留已停用的 DeepSeek 深推理型号 | 官方自 2026-09-14 起把该型号重定向到 Flash 并按 Flash 费率计费。从白名单与芯片下架；`deepseek-flash` 标注「V4.1 · 1017」 | `_lib.js` / `models.js` / `app.js` |
| ⑪ | 文档默认值漂移 | `LLM_TIMEOUT_MS` 文件头与 README 表格写 90000，代码实为 300000。三处统一为 300000 | `interpret.js` / `README.md` |

| ⑫ | 用神未锁定 | 盘面文本新增「用神：六亲+地支+卦位+旺衰」，两份 `SYSTEM_PROMPT` 同步加【用神既定】契约——模型不得静默改取，确需另取须说明理由并保留原用神对照 | `app.js` / `interpret.js` |
| ⑬ | 盘面冲突只提示不改稿 | 断后 `fact-audit` 检出冲突时，把冲突点回灌模型重写**一次**（失败保留首稿）；仅首轮断卦触发，追问不重复计费 | `public/app.js` |
| ⑭ | 断语无法验证 | 断语下方新增「验证清单」：应期线索、用神位置与旺衰、结果回填指引；只读规则链结果，不新增判断 | 同上 |
| ⑮ | 同盘结论漂移 | 服务端断卦 `temperature` 0.3 → 0.2 | `functions/api/interpret.js` |
| ⑯ | 结论无法机器核对 | 提示词末段要求三行结构化输出（`结论：吉/凶/平`、`应期：…`、`用神：…`）；前端容错解析后渲染结论卡，解析失败只显示原文、不报错 | 两份 `SYSTEM_PROMPT` / `public/app.js` |
| ⑰ | 单模型结论无从校验 | 多选模型时比对各自结论行：不一致显示「此卦存疑」告警，一致提示「一致≠应验」。只比对既有输出，不新增模型调用 | `public/app.js` |
| ⑱ | 自定义事由没有用神 | 复用 `domain-methods.suggestYongshen()` 按关键词推出用神，再走与固定事类相同的 `analyze()` 规则链：自定义也能锁用神、出旺衰/应期/验证清单；推不出关键词才退回通用次第 | `public/core/domain-methods.js` / `public/app.js` |
| ⑲ | 静卦提变卦→误报成六亲写反 | 静卦 `L.bian` 为空时旧版回落到本卦比对，把「凭空造盘」报成「三爻实为官鬼」；现明确报「此卦六爻皆静，无变卦」 | `public/core/fact-audit.js` |
| ⑳ | 静卦提变卦卦名→静默放行 | 旧版 `if (!pair[1]) return` 整段跳过，模型可随口编变卦；现报「无变卦」，但「变卦无／不变」等陈述跳过不误报 | 同上 |
| ㉑ | 旬空完全不校验 | 审计 `checked` 仅四项（六亲/世应/卦名/动爻），「父母持世空亡」这类核心定性依据无人对撞；现新增世/应/爻位旬空，肯定式与否定式分别比对，`用神旬空` 不在本层审 | 同上 |
| ㉒ | 断语无法回填 | 结构化结论由三行扩为四行，新增 `验证标志`：须为外部可观察、可判定真假的事实；「看后续／有转机／待观察」等含糊话在解析层判空并提示「此卦未给出可核对标志，事后无法回填」。这是回填率与命中率统计的地基 | 两份 `SYSTEM_PROMPT` / `public/app.js` |
| ㉓ | 「用神克世」文案不分占类 | 依《黄金策》「用克世勿作凶看……财爻克世者必得；占行人即归；占医药子孙克世者即愈；占功名官鬼克世非祸即灾」——旧版固定写「事与己有碍」，模型据此一概断凶（guji zsby-1406 求财书断「许之必得」即被判反）。改为 `keShiText(target, topic)` 按占类分流；`analyze` 增加第三参 `opts.topic`，自定义事由时由前端传入 | `public/core/analyze.js` / `public/app.js` |
| ㉔ | 判语可被模型无视 | 两份 `SYSTEM_PROMPT` 增【判语优先】：盘面判语须逐条采纳，与直觉相反者（动不为空／旺不惧空）尤须照办；认为有误须引原文说明，不得静默绕过 | 两份 `SYSTEM_PROMPT` |
| ㉕ | 无可用评测样本 | 新增 `tools/guji-trend-candidates.mjs`：从《增删卜易》207 条 `conclusion` 全文按关键词初筛吉凶极性，产出 **79 条候选 + 5 条多卦串案**（不参与计分）。全部 `needsReview: true`，仅作标注辅助 | `tools/` |


**验证**：`core 89 / rules 265 / gua-types 91 / absorb 135 / functions 125` 全绿（本轮 +7 absorb、+8 functions，均含反向对照：变卦语境写错仍报、书名号内写错仍报、旧版心跳只有 1 次 `: ping`、客户端不断开则流不提前结束）。

### 第二十四轮台账（2026-10-21：问法形态 + 法理层提示词契约）

**输入**：实测案例——同一张「天火同人之离为火」盘（占儿子看病：换医生／不换／先不治疗），两个大模型断出**相反建议**（一令换、一令不换）。逐条归因：事实层双方全对（纳甲、世应、旬空、取用、应期完全一致），分歧全在**法理误用**与**取象越界**——甲把应爻用神兼作「现任医生」之象（一爻双象）、近病久病前提未定就单引「逢冲则愈」；乙让变爻跨位冲刑静爻（未冲丑、刑戌）作「不可换」的最硬论据。结论是：「结论相反」主因是提示词只约束了事实层、没约束法理层与取象层；「各自的硬伤」才是模型问题。本轮据此修法理层，不动排盘与规则链。

| # | 问题 | 修法 | 落点 |
|---|---|---|---|
| ① | 多选一问法无出路 | 新增 `questionShape()`：连接词「还是/或者」≥2 次判 multi、单连接词判 either-or（含「A还是不A」回指句式单独识别）、「该不该/要不要」判 should-i；副词「还是」（他还是…／还是算了）有两侧紧邻字排除表，趋势题（能不能/怎么办）一律不报。检出后 UI 给三条改问路径（趋势题／定向假设题／保持原问走决策树），**只提示不拦截** | `public/core/question-shape.js`（新）、`public/app.js`、`public/index.html` |
| ② | 模型遇多选一被迫站队 | 检出多选一时把【问法处理】指令随排盘文本入模：不得强制站队、不得把用神或应爻兼作某选项的代表，按「当前态势 → 可核对节点 → 各选项条件分支」输出决策树 | `public/app.js` buildPanText |
| ③ | 变爻跨位冲刑等法理误用 | 两份 `SYSTEM_PROMPT` 增【法理口径】：变爻只对本位动爻作回头生克冲合；三刑冲合须论动静；通关须动爻旺相；旬空为旬内概念（填实值日、出空出旬），不得引申至他月 | 两份 `SYSTEM_PROMPT` |
| ④ | 用神/应爻兼作他用 | 增【取象边界】：卦中无专爻代表所指之人事时不得兼象；取象推断与旺衰生克之断分开表述 | 同上 |
| ⑤ | 前提未定单引一诀 | 增【前提未定】：病之近久等直接决定断法的前提缺失时，须先声明再按两种前提分别推断，不得径引「逢冲则愈/则凶」 | 同上 |
| ⑥ | 多选一强制站队 | 增【多选一问法】契约段（与 ② 的前端注入互为冗余：前端检测漏了，提示词自身仍兜底） | 同上 |
| ⑦ | 断语带自相矛盾交稿 | 增【输出自检】：交稿前逐条核对卦名/世应/动爻/旬空与排盘一致、所引口诀前提成立、应期与空破冲合对应 | 同上 |
| ⑧ | 契约段看守不足 | `CONTRACT_MARKS` 4 → 6 段（新增法理口径、多选一问法入强制比对名单；另三段由「两份提示词全文一致」断言覆盖），反向对照断言同步改为 6 | `test-functions.mjs` |
| ⑨ | 新模块无回归 | `test-absorb.js` 新增第 9 节 20 项：三型正用例 + 副词/趋势题反用例 + 空输入不炸 + hint/aiNote 成对出现 | `test-absorb.js` |
| ⑩ | CI 脚本顺序断言漏新文件 | 推送后 CI 红：`ci.yml` 的脚本加载顺序 `expect` 清单为硬编码 11 项，未含 `question-shape.js`，语法检查清单同漏。教训：新 core 文件须同步三处——`index.html` script 链、`core.js` 注释与 require、`ci.yml` 两道清单 | `.github/workflows/ci.yml` |
| ⑪ | 外部评审（DeepSeek）复核本轮方案 | 批判性吸收：其「禁止双象」的举例有语病——占病以子孙为医药是传统正取，真问题是「一爻充任两个对立选项」，【取象边界】据此精化并明列传统正取豁免；其自检层「吉凶与世应矛盾」一条为真增量，补入【输出自检】；其余各项（变爻本位、前提校验、空亡、问法三模板、黄金用例）本轮前已落地，不重复做。其「怎么办也强制决策树」不予采纳——怎么办是六爻原生趋势问法，过度约束反稀释断语 | 两份 `SYSTEM_PROMPT` |

**验证**：`core 93 / rules 265 / gua-types 91 / absorb 181 / functions 149 / diff 零 BUG / guji PASS` 全绿（absorb 161 → 181；functions 契约组同步扩段）。`test:diff` 此前在本机报缺依赖，核实为检出目录从未 `npm install`（HEAD 基线同样失败），装齐 devDependencies 后 104780 字段零 BUG。

### 第二十五轮台账（2026-10-21：审计层两处静默放行）

**输入**：外部实测——同一张「坤为地之水风井」盘（2026-10-21 12:01，丙午年戊戌月戊辰日戊午时，旬空戌亥，二三五爻动，月建戌辰日），两个大模型给出**相反结论**（一「平·中等可用」、一「凶·不可堪用」）。逐条对账：**排盘逐字一致**（四柱／月建日辰／旬空／卦名／世应／纳甲六亲／六神／变爻纳甲全对），`fact-audit` 双方零冲突（盘面没写反）；两份断语的真硬伤全在**推理层**，且 `coverage-audit` **一处都未告警**。本轮据此补审计，不动排盘与规则链。

| # | 问题 | 修法 | 落点 |
|---|---|---|---|
| ① | 静爻论「受日辰月建冲动」| 新增 **A3 静爻论冲**：静爻逢冲只有三判——日冲旺相为 `暗动`、日冲休囚为 `日破`、月冲为 `月破`，「受日月冲动」不属任何一种。判法：句内须同时出现 `日辰/月建/日月` 与「受／被／遭…冲」；含 `暗动/日破/月破/冲空/冲起/冲散/冲实/日冲/月冲` 者**豁免**；所提之爻**全部为静**才告警，出现任一发动即放行（保守边界，宁可漏报）| `public/core/coverage-audit.js` |
| ② | 取用两说（一事两体）| 新增 **C2 取用唯一性**：旧版 C 段在首个有效取用处 `break`，故「取父母为用神」＋「应爻官鬼为所测项目之体」并存时不报。改为全篇收集「六亲…为（用神／之体／本体／事体／用爻）」，去重后 **≥2 个六亲**即告警；`为忌/为仇/为原/为闲` 角色词一律豁免 | 同上 |
| ③ | 上述两类无回归 | `test-absorb.js` 新增 7b 节 10 项：4 项前提断言（六冲／用神父母在二爻／初四静而三五动）＋ 2 项正向告警 ＋ 4 项反向对照（判日破已用对术语→放行、动爻受冲→放行、未提爻位→不审、用神＋忌神→不算两说），确保规则会变红且不误报 | `test-absorb.js` |
| ④ | README 计数漂移 | §技术要点 M15 行 `test-absorb.js（161 项）` → **191 项**（与第二十四轮验证行的 absorb 181 及本轮 +10 对齐）| `README.md` |

**验证**：补丁后实测该盘两份断语——第二版 `conflicts` 0 → **2**（静爻论冲 + 取用两说），第一版仍为 **0**（无矛盾、未误报）。`core 93 / rules 265 / gua-types 91 / absorb 181 → 191 / functions 149 / diff 104780 字段零 BUG / guji 12144 / regress 173 / verify 162（引擎错 0）/ shake 49` 全绿，零回归。

> **遗留（下轮再做）**：同盘同模型两次断语结论相反，说明**结论漂移无任何自动化守护**——`interpret.js` 仅把 `temperature` 0.3 → 0.2（第二十三轮 ⑮），属缓解非解决。建议补 `test-drift.mjs`：同盘 × 同问事 × N=5（temp 固定）＋ 跨 provider 各 5 次，统计结论冲突率／用神冲突率／要素错误率（后者可直接用 `fact-audit` 计），并设冲突率 >30% 时前端只出要素表、不出结论。


### 第二十六轮台账（2026-10-21：断语质量基线，四指标）

**输入**：第二十五轮暴露的困境——排盘层 14.8 万断言全绿，但同一张盘、同一 provider 两次独立调用断出**相反结论**（平 / 凶），且「准确率」这个词在项目里从未被定义，因此「提高」也无从度量。本轮**不改任何断卦规则**，只补评测：把不可言的准确率拆成四个可判定指标。

| # | 问题 | 修法 | 落点 |
|---|---|---|---|
| ① | 「准确率」不可测，改进无法度量 | 拆四指标：**引擎一致率**（断语结论 == `analyze().trend`）／**同盘冲突率**（`1 - 最大方向占比`）／**要素错误率**（`auditFactClaims`+`auditCoverage` 判冲突的断语占比）／**边界遵守率**（无独断词、未宣称准确率）。门槛先定死：≥80% / ≤20% / ≤5% / ≥90% | `tests/drift/lib.mjs` |
| ② | 结论方向无法从自由文本稳定提取 | 三级解析：显式 `结论：吉/平/凶` 优先 → `断为/判为` 句式 → 按句计分（凶词优先于吉词，防「不可用」被判吉）。**吉凶句数并列时返回 `null` 而非取多数**——评测器不该比断语本身更武断 | 同上 `directionOf` |
| ③ | 基线本身未达标，若挡住 CI 必被关掉 | `run.mjs` 默认恒 exit 0，只出报告；`--strict` 才按门槛 exit 1。**改门槛须单独提交并说明理由**，否则「提高」退化为「调标准」 | `tests/drift/run.mjs` |
| ④ | 评测器最容易写成恒真断言 | `selftest.mjs` 29 项，逐项反向对照：同向→冲突率 0、一正一反→0.5、三条 2同1异→0.33、独断断语→边界 0、无样本→既不 PASS 也不 FAIL；并用真实语料锁定「第二版至少 2 处硬伤」 | `tests/drift/selftest.mjs` |
| ⑤ | 加语料不该改代码 | `corpus/*.json` 自动发现，schema 见 `tests/drift/README.md`。`at` 用**年月日时分字段**而非 ISO 字符串，避免时区差异让同一份语料在不同机器跑出不同盘 | `tests/drift/corpus/` |
| ⑥ | 新评测未进完整环 | `test:all` 尾部追加 `test:drift`（非阻断，不改变 CI 结论） | `package.json` |

**边界声明（重要）**：四个指标**全部是内部一致性 + 责任边界指标，不是外部正确性指标**。
「引擎一致率」度量的是「断语是否与本仓选定的流派口径自洽」——本仓的 `trend` 建立在真空宽口径、失令优先等**已登记的流派选择**之上（见下节），换流派则正确值随之改变。
「边界遵守率」度量的是「有没有把概率事件说成确定事件」，也不评价推断本身。
故本模块**从不**回答「断得准不准」——吉凶无金标准，程序无权判。全绿只等于「没犯可判定的错」。

**验证**：`npm run test:drift` → 引擎一致率 **50%**（FAIL）／同盘冲突率 **50%**（FAIL）／要素错误率 **50%**（FAIL）／边界遵守率 **100%**（PASS）；`selftest` PASS 29 / FAIL 0。其余套件零改动、零回归。

> **下一步**：这组数字是起点不是成绩。要让一致率从 50% 往上走，靠的是 `interpret.js` 把 `analyze().trend` 与要素表**显式注入提示词并要求断语必须回应**（当前只注入盘面、trend 未强制对齐），而不是继续加断语规则。

### 第二十七轮台账（2026-10-21：引擎判定入模 + 结论对齐契约）

**输入**：第二十六轮基线暴露出真因——`analyze()` 早就算出了 `trend`（该盘取父母为「平」），但 `buildPanText()` **从不注入它**。模型拿到的是完整盘面＋旺衰粗判，唯独没有那个已经被算出来的结论锚点，于是自由发挥，同一 provider 两次调用可以一次「平」一次「凶」，后者甚至与引擎自身判定相反。本轮不改任何断卦规则，只把锚点交给模型，并把「允许分歧但须声明」写成契约。

| # | 问题 | 修法 | 落点 |
|---|---|---|---|
| ① | 引擎判定算了不用 | `buildPanText(true)` 在「旺衰粗判」后注入 `【引擎判定（确定性 · 非推断）】吉/平/凶`，并附两条：与粗判同源、结论行须同向 | `public/app.js` |
| ② | 提示词无对齐约束 | 新增**【结论对齐】**契约段：结论行须与引擎判定同向；认定有误须先引古法原文说明理由 | 两份 `SYSTEM_PROMPT`（逐字符一致） |
| ③ | 一刀切会逼模型沉默照抄 | 分歧允许，但须括注「（与引擎分歧：引擎判X，此处判Y）」——把「不同意」变成可审计的声明，而非静默改写 | 同上 |
| ④ | 显式分歧会被评测当成漂移 | `tests/drift/lib.mjs` 增 `declaredDisagreement` 桶：结论相反**且**标注了分歧口径者，从「引擎一致率」分母剔除，单列计数；未声明的照扣。否则契约里「允许分歧」等于空话 | `tests/drift/lib.mjs` |
| ⑤ | 注入这一层无回归 | `test-shake.js` 新增 B2 组 6 项：选事类后 `panText` 须含「用神：」行、`【引擎判定】`段、值为吉/平/凶之一、含分歧标注指引；**另配反向对照**——不选事类时 `lastAnalysis` 为 null，`panText` 必无该段，证明断言非恒真 | `test-shake.js` |
| ⑥ | 契约段看守漏新段 | `CONTRACT_MARKS` 6 → 7（加 `【结论对齐】`），反向对照断言同步改为 7 | `test-functions.mjs` |

**验证**：`core 93 / rules 265 / gua-types 91 / absorb 191 / functions 149→151 / gui 12144 / regress 173 / verify 162 / shake 49→55 / drift selftest 34` 全绿。

> ⚠ **本轮 baseline 数字不变（仍 50%/50%/50%/100%），这是预期而非失败**：`corpus/` 里是**注入之前**采集的历史断语，提示词改动只影响之后的调用。要验证效果必须用新提示词重跑同一张盘并新增 corpus 文件——本轮未做（需真实 API 调用与费用）。**在拿到新语料之前，不能声称「一致率提高了」。**

> **下一步**：同一盘（坤为地之水风井，2026-10-21 12:01，用神父母）× 同一 provider × N=3，用新提示词采集，落 `corpus/2026-10-2x-kun-weijing-v2.json`，与旧语料并排跑，看一致率是否从 50% 抬起来。若仍不达标，则说明问题不在「模型不知道」，而在「模型知道了也不照办」——那是另一个层次的修法（换模型 / 加后置校验 / 降级为要素表）。

### 第二十八轮台账（2026-10-21：A/B 实测 —— 引擎判定注入后同盘重采）

**做法**：用线上 `deepseek-flash` 对**同一张盘**（坤为地之水风井，2026-10-21 12:01，用神父母，旬空戌亥，引擎判定「平」）重新采集断语，与第二十六轮 v1（注入前）并排跑。盘面经「按卦名排（坤为地＋动爻 2,3,5）＋补录时刻 12:01」精确复现，逐字核对四柱/世应/纳甲/六神/变爻均与原语料一致。

| case | 提示词 | 样本 | 方向分布 | 同盘冲突度 | 引擎一致率 | 含硬伤 |
|---|---|---|---|---|---|---|
| v1（第二十六轮） | 注入前 | 2 | 平 1 / 凶 1 | **50%** | **50%** | 1 条（2 处：静爻论冲、取用两说） |
| v2（本轮） | 注入后 | 2 | 平 2 / 凶 0 | **0%** | **100%** | **0** |

**方向是对的**：注入前同一 provider 能断出一平一凶，注入后两条都落在引擎判定「平」上，且没有出现「与引擎分歧」标注——说明模型不是被括注豁免掉的，是真的同向了。

> **但样本量不足，不得当统计结论。** 每臂 n=2，单盘、单 provider，且 v2 的所测文案是「考试·文书」（界面取用「父母」），与 v1 的「此项目准确度如何」不同——断语内容因此偏到考试文书方向。方向性证据，不是效应量证据。

**跨 case 聚合仍未达标**：引擎一致率 75%（3/4）、同盘冲突率 25%、要素错误率 25%、边界遵守率 100%。门槛是 80/20/5/90 —— 前三项仍 FAIL，因为 v1 那两条无论如何都还在语料里。**旧语料不删是对的**：删了就等于「只统计成功的实验」。

**采集成功率 3/7**：7 次调用只有 3 次拿到完整响应，其余为网关超时（最长 300 s 无响应）。这本身是个产品问题——比断语不准更直接地伤害体验。已记入待办，不属本轮范围。

**顺带修掉一个评测器 bug**：`evaluateCorpus` 里「最大方向占比」的分母 `stated` 是跨 case 累加的全局量，第二个 case 的冲突度被前一个 case 的样本量稀释。单 case 时看不出来，v1/v2 并排一跑就把 50% 算成 75%。已改为 per-case 的 `statedLocal`，并补 3 条断言（多 case 各 case 独立、聚合取均值、表态数不被前案污染）。**这正是并排跑才暴露的问题——单 case 永远测不出来。**

**验证**：`drift selftest 34→37` 全绿；`npm run test:drift` 两 case 四断语，方向分布与上表一致。

> **下一步**：把每臂样本提到 N≥5，并补第二个卦、第二个 provider（gemini）做交叉。n=2 只能说「没看到反向证据」，不能说「已收敛」。

### 第二十九轮台账（2026-10-21：扩样本撞出上游缓存与两处误报）

**做法**：把样本扩到多臂——坤为地（trend=平）× deepseek、坤为地 × gemini、风火家人之水火既济（trend=**凶**）× deepseek，每臂目标 N=5。

**结果**：目标没达成，但撞出三件更要紧的事。

| # | 发现 | 证据 | 影响 |
|---|---|---|---|
| ① | **同一请求体重复调用返回逐字节相同的响应** | kun-deepseek 3/3、kun-gemini 6/6、jiaren-deepseek 6/6，各臂内 md5 全同；跨约 10 分钟、跨并发仍然相同 | 函数侧已设 `Cache-Control: no-cache`、无 `seed` 参数、`SSE_MAX_REPLY` 为 200000（不是限长截断）→ 缓存发生在上游（CF AI Gateway 或供应商侧）。**「同盘冲突率」在当前链路下测不出真值，0% 是伪像而非稳定** |
| ② | **判别实验**：panText 尾部加一个换行 → 返回完全不同的一份断语 | 原样请求多次相同；加 `\n` 后 19214B 全新响应 | 缓存键是**逐字节请求体**。所以「N 次同请求」拿不到 N 个独立样本，扩样本必须改变输入，不能只重复调用 |
| ③ | **gemini 输出稳定截断在 470 字符**，正文断在句中，无「结论：」行 | 6/6 全是同一份 470 字符文本，尾部为「但五爻亥水动」 | 该 provider 目前产不出结构化结论，`drift` 无法评测它。疑似撞 `LLM_MAX_TOKENS`（gemini 正文加粗多、token 更费），待查 |

**顺带修掉两处评测器误报**（都是扩样本才暴露，单样本永远看不到）：

| 误报 | 真实原文 | 修法 |
|---|---|---|
| 「月破无中生有」 | `月建戌，日辰辰，旬空戌亥；月破无。` —— 说的是**没有**月破 | `coverage-audit` 增**后置否定**豁免：否定词紧跟被断言词之后（「月破无」「旬空不见」）即视为否定。只看紧邻 2 字，故「月破，无救」仍告警 |
| 断语「独断」 | `应期只主文书消息……不等于必然录取或签约` —— 是在**否认**独断 | `tests/drift/lib.mjs` 独断词改查**同小句前置**否定。只查前置：独断词后的「无/不」属谓语，「必然无救」照样算独断 |

**扩样本后的真实四指标**（6 条独立断语，3 个 case）：

```
引擎一致率 83%   门槛 ≥80%   PASS   （5/6，唯一不符者是治理前的 v1 历史断语）
同盘冲突率 17%   门槛 ≤20%   PASS   （但见 ①，此值暂不可信）
要素错误率 17%   门槛 ≤5%    FAIL   （仅 v1 那条历史断语带 2 处硬伤）
边界遵守率 100%  门槛 ≥90%   PASS
```

**关于「是不是无脑照抄引擎」**：坤为地盘判「平」、家人盘判「凶」，deepseek 各随其盘同向，且两盘正文差异很大（1781 / 1339 字符，应期节点不同）。排除「无条件照抄」的简单解释——但**也不能排除「看了引擎判定后向它靠」**，那本来就是契约的目的。

**验证**：`absorb 191→194`、`drift selftest 37→41` 全绿；`guji 12144` / `regress 173` 零回归。

> **下一步（按优先级）**：① 先解决上游缓存——否则任何「稳定性」指标都是伪值，这比继续调断语重要得多；② 查 gemini 470 字符截断；③ 扩样本改为「每次改变输入」（如微调 panText 的无关空白）或直连供应商，才能拿到独立样本。

### 第三十轮台账（2026-10-21：网关缓存坐实 + gemini 截断根因 + 完整性守卫）

**输入**：上一轮把「同请求重发得到逐字节相同响应」记为疑似上游缓存，本轮直接查网关 API 落实。

| # | 结论 | 证据 |
|---|---|---|
| ① | **缓存确实开着，且 `cache_ttl: 0` 不等于不缓存** | `GET .../ai-gateway/gateways` 显示 `liuyao-gw` 的 `cache_ttl: 0`；但该网关 40 条日志中 **27 条 `cached: true`**，HIT 时 `tokens_in/out` 均为 0、耗时 73–319 ms、cost 0 |
| ② | 缓存键是 **provider + endpoint + model + 鉴权头 + 完整请求体** 的 SHA-256（官方文档明载） | 故同一盘同一问必命中；尾部加一个换行即换 key、返回全新响应（上一轮判别实验与此吻合） |
| ③ | 缓存对产品**未必有害**：同一卦得同一断法，符合六爻语义，且省费 | 但会**把截断/失败响应一起固化**；且让「同盘 N 次」拿不到独立样本 |
| ④ | gemini 截断**不是缓存、也不是传输问题** | 网关日志：`google/gemini-3.6-flash` `in/out 2846/137`、`duration 3046ms`、`success: true` —— 模型只生成 137 tokens 就正常收尾。前后两次分别 405 / 137 tokens，长度不稳，**是模型侧提前停** |
| ⑤ | 旧版完全不读 `finishReason`，半个断语被当完整答案交付 | `grep finishReason` 在 `interpret.js` 里零命中 |

**改动**：

| # | 修法 | 落点 |
|---|---|---|
| ① | 请求体新增 `skipCache`（及别名 `skip_cache`）→ 透传 `cf-aig-skip-cache: true`。**默认不传**，普通断卦继续吃缓存；仅供评测取独立样本、截断后重试 | `functions/api/interpret.js` |
| ② | 读取 `finish_reason` / `finishReason`（两条流式分支都读），异常收尾发 `warn: MODEL_<finish>` | 同上 |
| ③ | 新增**结构化完整性守卫**：首轮断卦（history 为空）正文 >30 字符却无「结论：」行 → `warn: INCOMPLETE_STRUCTURE`。这条与 finishReason 互补——前者管「上游怎么停的」，它管「产物是否成形」。**只限首轮**，追问是对话式的、本就不带四行结构 | 同上 |
| ④ | 前端收集全部 warn，文末显示「本卦断语未完篇（…）。建议重试或换模型。」 | `public/app.js` |

**验证**：`test-functions.mjs` 151 → **160**（新增 8 项：skipCache 三态、finishReason 三态、缺结论行告警、齐全不告警），`absorb 194` / `core 93` / `drift selftest 41` 全绿。

> **下一步**：gemini 参数适配。`thinkingConfig: { thinkingBudget: 0 }` 对 gemini 3.x 很可能不适配（强行关闭思考会损伤长输出），需做「传 0 / 不传 / 给足 maxOutputTokens」三组对照，看哪种能稳定产出完整四行结论。在此之前，**gemini 芯片对长断语不可靠，应以 deepseek 为默认**。

### 第三十一轮台账（2026-10-21：gemini 变体对照 —— 推翻上一轮的「稳定截断」结论）

**做法**：加 `LLM_DEBUG_VARIANTS` 环境开关 + 请求体 `variant`（A/B/C），一次部署跑三组对照。A=`thinkingBudget:0`（旧行为），B=不传 `thinkingConfig`，C=不传 + `maxOutputTokens 8192`。全部带 `skipCache:true`。

**结果（以网关日志的 `tokens_out` 为准，客户端耗时受沙箱网络影响不可信）**：

| 时刻 | 变体 | tokens_out | 耗时 | 结论行 | 判定 |
|---|---|---|---|---|---|
| 06:13 | A | **137** | 3.0 s | 无 | 截断 |
| 06:16 | A（默认） | **1282** | 9.9 s | 有 | 完整 |
| 06:23 | B | 962 | 21 s | 有 | 完整 |
| 06:24 | C | 0 | — | — | 上游 503（Gemini 高负载，与参数无关） |

**结论被推翻**：上一轮说「gemini 稳定截断在 470 字符」是**错的**。同一个变体 A 三次分别产出 137 / 405 / 1282 tokens —— 截断是**间歇性**的，不是参数决定。

那 6 次「逐字节相同的 470 字符」是怎么来的？**一次坏生成被网关缓存，重放 6 次**。缓存把「偶发截断」放大成了「稳定截断」，我据此误判了根因。

**修正后的认识**：
1. gemini 偶发提前收尾（约 2/3 次），原因未定，**不能归咎于 `thinkingBudget:0`**（A 也产出过完整的 1282 tokens）。
2. 真正被修复的是**发现能力**：`finishReason` + `INCOMPLETE_STRUCTURE` 两条守卫，让这类残篇不再冒充完整断语。
3. **缓存会固化并放大偶发故障**——这是本轮最有价值的教训，比 gemini 参数重要得多。

**处置**：不擅自改 gemini 默认参数（证据不足，样本 n=4 且网络不稳）。`variant` 开关保留，但生产**默认关闭**（`LLM_DEBUG_VARIANTS` 未设 → 参数被忽略，仍走 A）。`wrangler.toml` 的临时变量已还原。

**验证**：`test-functions 160 → 168`（变体三态 + 未开开关时忽略 + 回显事件），`absorb 194` / `core 93` / `drift selftest 41` 全绿。

> **教训（写给下一轮）**：上一轮我在 `cached:true` 已确认的情况下，仍用「6 次响应逐字节相同」当作「稳定」的证据，这是把缓存伪像当成了模型行为。**判断模型的稳定性，必须先排除缓存；样本要来自 `skipCache` 或不同输入。**

### 第三十二轮台账（2026-10-21：评测分代 —— 把历史从当期分母里摘出去）

**输入**：`要素错误率 17%` 长期不达标。先核实那 1 条带 2 处硬伤的断语是真是假。

**核实结果：审计判得对，不是误报。** 原文写「四爻兄弟癸丑土、初爻兄弟乙未土受日辰月建冲动」，而该盘日辰辰、月建戌——丑、未皆不被冲；且静爻本不因日月之冲而「动」（日冲旺相为暗动、休囚为日破，月冲为月破）。两处都是真错。

**所以问题不在代码，在分母。** 那两条断语出自**治理前**（提示词尚无【法理口径】），把它们算进当期分子，「要素错误率」就永远卡在 17%，提示词改到什么程度都不达标。**那不是严格，是把历史当成现值。**

| 项 | 处置 |
|---|---|
| 语料分代 | case 增 `cohort`：`legacy`（治理前）/ `current`（治理后，缺省） |
| 门槛口径 | **只判 current**；legacy 单列展示，标注「仅对照，不参与判定」 |
| 历史语料 | **不删、不隐藏**——它一旦变差说明审计放行逻辑退化，仍需报警 |
| 全量数字 | 照常打印供对照，但不用作门禁依据 |

**结果（同一批语料，只改口径）**：

```
当期（2 case / 4 条）    一致率 100% PASS　冲突率 0% PASS　错误率 0% PASS　边界 100% PASS
治理前（1 case / 2 条）  一致率  50%　　　 冲突率 50%　　 错误率 50%　 边界 100%　（仅对照）
全量（3 case / 6 条）    一致率  83% PASS　冲突率 17% PASS　错误率 17% FAIL
```

**验证**：`drift selftest 41 → 47`（分代两代独立、当期不受 legacy 污染、legacy 仍如实计数、未标 cohort 默认归当期）。

> **仍未解决**：冲突率 0% 虽有 3 条**内容各不相同**的断语支撑，但它们采于缓存开启期，严格说不是受控独立样本。要拿到可信真值，必须用 `skipCache` 重采（每盘 N≥5）。这一步要花真钱调用，**未做**。

### 第三十三轮台账（2026-10-21：独立样本重采 —— 14 条里抓出 10 处误报）

**做法**：`skipCache` 重采独立样本（每盘 5 次、deepseek-flash），10 次调用 **20/20 内容互异**，确认缓存真的被绕开。并入 corpus 时保留旧样本、标 `batch`，当期扩到 14 条。

**结果：要素错误率从 0% 跳到 43%。** 这不是模型变差，是**样本量终于够看出问题**。上一轮那个 0% 是 4 条样本的假象。

逐条核对后，43% 里 **10 处全是我的审计误报**，且属同一类——**引述被当成主张**：

| 误报 | 原文 | 修法 |
|---|---|---|
| 旬空误置 ×7 | 「《卜筮正宗》谓“旺不为空，动不为空”……故“动不为空”“旺不惧空”**皆不适用**」 | 先立后破的正确写法。加**引文后否定**识别（不适用／不成立／皆不／并非…） |
| 同上 | 引文那句后面 24 字内没有否定词（否定在下一句） | 光靠后置否定救不了 → 扫描主张时**整体跳过引号区间** |
| 月破无中生有 ×2 | 「- 月破：盘面未列爻逢月破」「- 旬空月破：旬空戌亥…」 | 「月破：」只是**列表小标题**，不是主张 |
| 同上 | 「卦中无爻逢月破」「盘面未列爻逢月破」 | 否定词距被断言词 4–5 字 → 前置窗口 3→6 字 |

**反向对照全部保留告警**（这是关键，否则等于把审计改成永不报错）：
「用神月破，凶」「月破，无救」「真破难扶，事不可为」「无救，今查月破」「此卦旺不为空，可言有成」。

`isRefutedAfter` 特意**不收**宽松的「不可/误/错」——「事不可为」里的「不可」是谓语，不是否认「真破」；写成宽松匹配，`test-absorb` 的反例立刻变红。

**同时：首轮断卦默认跳过网关缓存。** 缓存键含整个请求体，首轮断卦正是命中率最高的一类；而它会把**残篇一起固化**（gemini 偶发 137/405 tokens 截断），残篇进缓存后用户重试拿回的还是它——重试按钮形同虚设。追问 body 含 `messages`、键不同，本就不命中，故只绕首轮。回退开关 `LLM_CACHE_FIRST=1`。

**最终四指标**：

```
当期（2 case / 14 条）  一致率 100% PASS　冲突率 0% PASS　错误率 0% PASS　边界 100% PASS
治理前（1 case / 2 条）  50% / 50% / 50% / 100%（仅对照）
全量（16 条）            94% / 17% / 6% / 100%
```

**验证**：`absorb 194→198`（引文豁免 + 4 组反向对照）、`functions 160→170`（首轮跳缓存三态）、`drift selftest 47` 全绿，`guji 12144` / `regress 173` 零回归。

> **诚实收尾**：0% 只等于「**在我目前能判定的维度上没抓到错**」。这轮 14 条里 10 处是我的误报而不是模型的错，说明审计层的假阳性率还很高——下一步真正该做的不是加门槛，而是**继续拿独立样本喂它、把误报一条条打掉**。

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
- **流式 SSE 透传**：所有 OpenAI 兼容通道统一 `stream: true`，服务端把上游 SSE 逐行归一为 `data: {"t":"..."}` 后透传给客户端——突破部分中转站 60 秒整响应硬超时，边读边渲染避免长时间无数据被浏览器/代理断开；期间每 15 s 写一次 `: ping` 心跳注释行，防上游思考期（DeepSeek 可数十秒无输出）撞 CF 边缘 100 s 无数据规则遭 524 断连
- **思考草稿剥离**：`reasoning_content`（模型思考过程）不透传。实测百炼思考模型的草稿内含未经自我纠正的临时错判（草稿写「世在四爻妻财」而正式稿实为「世在三爻」），旧版把草稿一并拼接下传，导致断语正文被独白污染、断后 fact-audit 对全文字面匹配误报「与卦盘不符」。现正文只透传 `content`；仅当整条流没有任何 `content` 时（个别中转把正文放思考字段），流末一次性兜底补发，避免空响应
- **流式缓冲双守卫**：上游属信任边界外（用户自配中转），故两条无界路径均设硬上限——① 持续发送**不含换行**的数据会使行缓冲永不切分；② 发送**无限多条** `data:` 行会使透传正文无限增长（CF Workers isolate 内存上限 128 MB）。阈值 `SSE_MAX_LINE` 1 MB / `SSE_MAX_REPLY` 200 KB（约 6 万汉字）；撞限即在流内写 `data: {"error":"LINE_OVERFLOW"/"REPLY_OVERFLOW"}` 终止事件并断开，客户端 `readStreamSSE` 据此抛错走重试——「中途断流」与「正常完篇」由此可区分（旧版静默关闭会把无声截断的半篇当完整答案渲染）
- **上游硬超时**：`fetch` 默认无超时，上游挂起（不返回也不断开）会让请求一直悬置；流式只绕开了「整响应超时」，并不自带超时保护。现用 `AbortController` + `setTimeout` 覆盖「建连 + 读完整流」全程，默认 300 s（`LLM_TIMEOUT_MS` 可调），超时返回 `504 LLM_TIMEOUT`；计时器在流式路径「托管」给 `pipeMergedSSE`，流结束才清除
- **gpt-5/o 系参数适配**：自动识别思考型模型，剥离其不支持的 `temperature`，改用 `reasoning_effort`（默认 low，环境变量 `GPT_EFFORT` 可调）
- **动态模型清单**：`/api/models` 由环境变量实时驱动（`GPT_MODELS` + `CUSTOM_PROVIDERS`），前端启动时拉取渲染芯片，后台增删模型/供应商零代码改动
- **失败降级**：断卦失败时不输出报错，而是展示可复制的完整 prompt，可粘贴到任意对话窗口手动断卦
- **前端重试与延迟降级**：`app.js` 对 gemini/deepseek 等模型在 180 秒截止内按返回类型自动重试（指数退避），只有截止时间到了仍无结果才渲染「复制请求内容」降级；期间 UI 实时显示「第 N 次尝试 / X 秒后重试」
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
- **口令存储与爆破防护（第二十三轮）**：口令由 `localStorage` 改为 `sessionStorage`（键名不变）——同一标签页刷新免重输，关标签页即失效；首次载入会把旧版残留的 `localStorage` 明文迁移过来并**立即删除**，不在磁盘上留第二份。注意这缩的是「持久化窗口」，`sessionStorage` 同样可被 XSS 读取，那一层只能靠转义与 CSP。服务端对同 IP 的口令失败计数：10 分钟窗口内错 20 次 → `429 TOO_MANY_ATTEMPTS`，成功一次清零（与 `interpret.js` 的限流同属 isolate 内软限制）。
- **密钥不出服务端**：API Key 全部存 CF secret（加密变量，wrangler 部署不覆盖），模型名白名单 + 输入长度截断防注入
- **读接口开放的影响范围（第五轮提出 → 第二十轮彻底闭合）**：`GET /api/records` 列表与 `?id=` 详情原先**始终开放**，在只设 `LIB_CODE` 的配置下任何访客可读到全部卦例的 `question`（占问之事）与 `pillars`；猜中/拿到 id 后 `?id=` 还会返回 **`pan_text` 全文与 `messages`（各模型完整 AI 对话历史）**。问病、问讼、问感情类占问内容属隐私。
  2026-09-28 曾随全站 `ACCESS_CODE` 收口，同日按需求撤销 `ACCESS_CODE` 时**未单独评估这条连带影响**，读路径遂退化为「未设即放行」（实测 `GET /api/records` → `200`）。**第二十轮把读路径与写路径收口到同一口令闸**（`records.js` 的 `requireCode`，认 `LIB_CODE || ACCESS_CODE`）：无口令读列表/详情 → `401 ACCESS_REQUIRED`。当前口径为「卦例库**读与写均需口令**，`/api/models` 免口令」。
- **静态资源安全响应头（第二十一轮 C7）**：新增 `public/_headers`，对静态资源下发 CSP + `X-Content-Type-Options: nosniff` + `Referrer-Policy` + `X-Frame-Options: DENY` + `Permissions-Policy`。CSP 的价值在于兜住**外联与回传**（`script-src 'self'` 挡外部脚本、`connect-src 'self'` 挡 fetch/XHR/WebSocket 把卦例/提示词 exfil 到外域；**顶层导航不在 CSP 管辖内**——`navigate-to` 未被浏览器实现，故 `location=` 跳转型外泄仍需靠转义挡住）；`'unsafe-inline'` 为必需项——页面含内联 `<style>`，且 **Cloudflare 会向 HTML 注入内联的 `__CF$cv$params`**（Bot Management），不带它会被本页自己的 CSP 拦掉。前端已逐处 `esc()`/`escAttr()`/`mdLite()` 转义，CSP 在此是**第二道防线**而非唯一防线。注意 `_headers` **不作用于 Pages Functions 响应**，`/api/*` 的头由函数自身控制。
- **限流窗口的单 IP 计数有界（第二十一轮 C5）**：旧版每次请求都 `hits.push()`，单个 IP 的数组随请求数**无界增长**，且 `RL_HITS.size` 超限时 `clear()` 会**把正在被限流的访客一并放行**。现改为「达限即拒且不再入队」（数组长度硬封顶在 `limit`）＋「只淘汰窗口内已无有效计数的 IP」。IP 取用顺序为 `CF-Connecting-IP`（边缘写入、客户端伪造值被剥离）→ `X-Forwarded-For`（非 CF 部署的回退，该环境下可伪造，故此时限流只算降级可用）。
- **请求规模与限流**：`/api/interpret` 单请求上限为 4,000（排盘）+ 8×2,000（历史）≈ 20,000 字符；两个写端点另有 **512 KB 请求体闸门**（按 `Content-Length` 在 `request.json()` 之前 413，chunked 无该头时只能靠字段限长与平台上限兜底）；`RATE_LIMIT_PER_MIN` 为可选软开关（按访客 IP 滑窗，仅 isolate 内计数），**生产当前未设 → 不限流**（2026-09-28 曾设 20，同日按用户要求撤销）。全站口令 `ACCESS_CODE` 于同日启用后撤销，`/api/interpret` **回归无口令开放**（实测无口令 → 越过守卫，直接进入参数校验）。费用敞口现**仅由「入模上限 ≈ 20,000 字符」单独约束**
- **部署防回归**：已禁用 GitHub 集成的自动生产部署（其 Functions 构建缓存会回滚代码并抢占生产），统一由 wrangler direct upload 部署

### 生成式琴音（bgm.js）

- Karplus-Strong 拨弦物理建模：激励噪声三轮平滑去起音毛刺，衰减系数随频率变化（低绵长、高收敛）
- 总线 1500Hz 低通滤波，D 宫五声音阶中低音域随机漫步成句，泛音/双音轻点缀，句间留白 5~10 秒，卷积混响
- 零音频文件、零外部请求；默认开启，首次手势启动，切后台自动暂停

## M18（2026-10-24，第三波 ⑥⑦）

- **⑥ 取用神两现口径参数化**：`LY.ysDupMode`（默认 `'priority'` 逐字节不变；`'kongpo'` 依《增删卜易·两现章第三十二》野鹤法新增陈述层断语 `两现:用空破者应期` + 应期锚点线索，主用爻/trend 零改动）。test-rules 265→280；guji 新增 3 条 kongpo 用例（zsby-1406/1414/1422-kongpo），12144→12148；selftest 41→43（kongpo 层 2 类行为变异）；覆盖率 65/79=82.3%。方案：`docs/proposal-yongshen-parameterization.md`
- **⑦ 复盘闭环（readings 回访任务表）**：新表 `readings`（只存「哪条卦该回头看」，幂等派生自 `casts.baseline` 应期窗口次日）；`/api/readings` GET 到期视图 / POST dismissed（口令与 records 同源，禁 SELECT *）；回填成功自动置 acted；卦例库顶部「回访提醒」区块。test:fn 233→254。方案：`docs/proposal-readings-loop.md`
- **⑥阶段四（应期窗口联动）按方案「可独立砍除」条款砍除**：kongpo 空锚点暂不进窗口数字，断语与线索已完整

## M20（2026-10-27，线上「请求一堆却没有内容」根治）

线上实症（用户截图 + AI Gateway 日志 + curl 探针共同确认）：
① AI Gateway 里 `deepseek/deepseek-flash` 出现一串间隔 1.2→2.4→4.8→6s 的请求（指数退避），
   每条 duration ≈1s、tokens 为 `-`，同时前端一直显示「推卦中…」；
② `curl` 直打线上 `/api/interpret`（deepseek）**76 秒后连接被 reset，收到 0 字节**；
③ 同条件 `gemini-3.6-flash` 正常吐正文（402B 时仍在生成）——接口与 key 没问题。

根因四条，全部落在 `functions/api/interpret.js`：

- **A. 首字节前没有任何数据**：旧版 `await attempt()` 要等上游响应头才 `return new Response(...)`，
  首字节 `: ping` 与 15s 心跳都在那之后才写。DeepSeek 前 60~90s 只吐 `reasoning_content`，
  客户端全程零字节 → CF 边缘 ~100s 无数据即 reset。**用户看到的「没内容」是边缘 reset，不是模型没答**。
- **B. `LLM_TIMEOUT_MS`（默认 300s）永远轮不到**：它大于边缘阈值，模型挂起时先撞边缘，
  代码里设计好的 504 根本发不出去。
- **C. 思考草稿只在「正常收流」时兜底补发**：流被 abort 就一个字节都补不上，客户端拿空。
- **D. 空流（`outLen===0` 且无草稿）直接 `w.close()`，不写任何终止事件**：前端判 `empty` →
  指数退避重试 18 次、耗满 180s 截止 —— 就是 AI Gateway 那串 1s 请求的来历。

修复（`tests` 覆盖见 `test-functions.mjs` #25，断言 254 → 275）：

1. **先发首字节再打上游**：新增 `FAST_HEADER_MS = 1500` 分流。上游 1.5s 内响应（正常流头 / 4xx / 5xx）
   走原路径，**错误仍返回 JSON、状态码不变**（前端契约一行不动）；超过则 `slowSession()` 立刻建 SSE、
   下发 `: ping` + 心跳，再去等上游。等待期不再是零字节，边缘不会再 reset。
2. **首字节独立守卫** `LLM_FIRST_BYTE_MS`（默认 80s < 边缘阈值），到点返回
   `504 UPSTREAM_FIRST_BYTE_TIMEOUT`，前端列为**不重试**（重试同一个慢模型毫无意义）。
3. **思考草稿走独立通道 `data:{"r":"…"}`**：实时下发但绝不混进正文（草稿含未纠正的临时判断，
   混进去会复发 2026-10-13 那 6 处 fact-audit 假阳性）；前端只拿它更新「模型思考中… 已输出 N 字」，
   同时让 TCP 流持续有帧。
4. **空流显式终止**：`outLen===0` 时下发 `{"error":"EMPTY_UPSTREAM"}`，前端立即换模型/提示，不再空转 18 轮。
5. **会话样板收敛**：`openSession()` / `pipeUpstreamSSE()` 两处复用，杜绝「心跳挂在已 releaseLock 的
   writer 上」这类只在生产暴露的失效。
6. **顺便修掉 gemini 侧的同类问题**：`thinkingBudget:0` 并不总被 gemini 3.x 采纳，实测会真吐
   `parts[{text, thought:true}]`，旧版按 `p.text` 一并拼进正文（2026-10-13 那 6 处假阳性的另一半成因）。
   现在 thought 片段与 `reasoning_content` 同待遇：只走 `r` 通道，不进正文。

**AI Gateway 里没有 gemini 日志**（同日排查）：代码只有在 `GEMINI_BASE_URL` 含 `google-ai-studio` 时
才走网关原生路径，否则回退 `generativelanguage.googleapis.com` 直连 —— 直连不经过网关，自然一条日志都没有。
该变量是 Pages secret，**改完必须重新部署**（Functions 持旧环境快照）；本地 `wrangler pages dev`
没有 `.dev.vars`，因此本地恒为直连、恒无日志，且 Worker 的 `fetch()` 不读 `HTTP_PROXY`（挂 7890 也没用）。

## M20b（2026-10-27，同上，waitUntil 收口）

M20 部署后线上仍在 07:00 出现一串 `499 dur≈1.5s`（8 条，间隔 6–8s）：慢路径把 `Response`
返回给运行时之后，上游 `fetch` 仍是一个**孤儿 promise**——处理函数一返回，运行时即撤掉
整个请求上下文，上游随即被掐，客户端拿到「流头到了、内容一个字没有」。

修法：`onRequestPost` 开头取 `context.waitUntil`，慢路径把整段任务登记进去，让上游活到写完。
部署后实测（同一网关日志）：`07:31:56 status=200 dur=30990ms tokens=1538/4094`、
`07:45:23 200 dur=19497ms 1596/2813`、`07:47:38 200 dur=30935ms 1596/4169`——三次全部拿到正文，
`499` 不再出现。**这条是「十几次请求没结果」的最后一块**：M20 让首字节不再为零，M20b 让上游不被
提前掐断，两者缺一仍是「请求一堆、屏幕空白」。

## M21（2026-10-27，前提元数据 / 缺项分级 / 应期同域）

**触发案例**：问「今年能不能考上市重点」，断语把「今年」当本招生年度、把对象阶段默认成应届，
并给出「甲子日」这种日级应期——跨年之事给了日级刻度。用户要的不是把升学写进通用规则，
而是任何领域都先核一遍前提，并在输出前校验「应期粒度 ≤ 事项时间跨度」。

**病根**：排盘文本里**没有刻度**。模型手上只有一句所测之事，其余全靠默认值，
而默认值不写在输出里，用户看不见，于是同一句话在不同人心里指不同的事。

**四层结构**（越往下越具体，只有上两层进系统提示）：

| 层 | 内容 | 落点 |
| --- | --- | --- |
| L1 原则 | 五类通用前提 + 两级风险 | `SYSTEM_PROMPT`【前提元数据】【缺项分级】 |
| L2 校验 | 应期粒度不得细于跨度；被证伪须按模板撤回 | `SYSTEM_PROMPT`【应期同域】【应期撤回】 |
| L3 领域包 | 本类时间锚点、关键槽位、典型刻度 | `DOMAIN_METHODS[].premise` + `premise.js` 的 `KEYWORD_PACKS` |
| L4 实例 | 「今年」在升学＝招生年度、在回款＝账期 | 预检块的「口径歧义」行，逐次生成 |

**落地**：

1. 新增 `public/core/premise.js`（前提预检层，纯判定、零 I/O）：`spanOf` 五档刻度判定、
   `judge` 五槽位明示/缺项与分级、`block` 生成预检块、`checkYingqi` 应期同域校验、
   `withdraw` 撤回模板、`followUpHint` 同盘追问提示。
2. `DOMAIN_METHODS` 七个用神值各加 `premise: { anchors, decisive, typicalSpan, spanNote }`；
   `KEYWORD_PACKS` 六包（升学／求职／诉讼／健康／交易／感情）只在「自定义所测」时按事由关键词挑包。
   **升学只是六包之一**，通用段不出现任何领域槽位表（测试锁定这一条）。
3. 风险分级用双条件，避免「缺项就拦」：高风险 = 缺项翻转结论或应期量级 **且** 本类确实需要它
   （进程状态：官讼/占病；目标标准：`GOAL_RE` 命中的目标类问法）。时间范围缺失不升高风险——
   由本类典型刻度兜底，但必须在正文写明「这是假设」。反向对照已入测试：
   「这周会不会来电」缺门槛不拦，「下个月能签合同吗」缺门槛要拦。
4. 应期同域判定表：年/季 + 裸干支日 = `violation`；年/季 + 干支日 **且** 同句给了月／季／流程节点
   = `warn YINGQI_DAY_AS_AUX`（日级只作辅）；月 + 裸干支日 = `warn`（月 + 干支日 + 公历区间放行，
   因为引擎应期窗口本身就是这个写法）；日/旬 + 只有年份 = `warn`；跨度未明示不判。
   **与引擎窗口和解**：预检块在「本次盘面带日级节点窗口且事项按年/季判定」时多写一行
   「窗口是节点、不是应期」——否则模型要么违背窗口、要么把节点当日期，三条规则互相打架。
5. 结构化结论由四行扩**五行**（新增 `前提完整性`），`parseConclusion` 解析后进结论卡：
   自报「完整」灰字、自报缺失黄字、**漏报而引擎判定有高风险缺项**时显式提示「前提 未申报」。
6. 冲突时结论卡同时给**撤回模板成品句**：`原应期 X 作废：… ；在新前提下应期应落在（N 刻度），需另起一卦重断。`
7. 同盘追问：`followUpHint` 比较前后跨度，变了就在排盘文本里发「原应期 + 跨度变化」提示，
   逼模型走撤回模板——旧版是静默把日级应期改写成新的日级日期，读起来像同一份断语。
8. 服务端兜底：`panText` 不含「【前提预检」时补一段「无预检结果，须自行核对五类槽位并声明假设，
   时间跨度不明确时不得给具体干支日」——防止绕过前端又退回默认时间跨度。
9. 资源戳 `20261027b → 20261027c`，`index.html` 挂载 `core/premise.js`。

**测试**：新增 `test-premise.js`（110 断言，`npm test` 已并入，总计 751 → 861）；
`test-functions.mjs` 279 → 292（契约段 7 → 11、前提预检兜底 5 条）。
跨领域用例覆盖升学／短讯／诉讼／求职／健康／交易／感情七种问法，防止把某一领域写成通用规则。

**方案与提示词差异说明**：[`docs/proposal-premise-metadata.md`](proposal-premise-metadata.md)

### M20c（2026-10-27，客户端流式守卫：绝对上限 → 空闲超时）

M20b 之后线上仍能复现「十几条请求、屏幕空白」。用 curl 直连生产实测得到关键数据：
DeepSeek Flash 在**题面含混**时会把 reasoning 写上百秒（一次实测 150s 仍在写、
`t` 帧 0 条），而前端当时用的是「距 180s 截止的剩余量」做**绝对上限** ——
数据明明还在流，到点照样 abort，随后从头重试，用户看到的就是「思考中 N 字」反复归零。

修法：

1. `readStreamSSE` 增加第 4 参 `onTick`，每收到一块数据（含 `: ping` 心跳）就重置计时。
2. 流式守卫改为 `AI_STREAM_IDLE_MS = 65s`（无任何字节才超时）＋ `AI_STREAM_MAX_MS = 330s`
   硬上限（与函数侧 `LLM_TIMEOUT_MS` 默认 300s 对齐）。
3. 新增「只想不答」终止：流正常结束、正文为空而思考草稿 >500 字时抛
   `REASONING_ONLY` 直接收手，不再按「返回为空」一路退避重试——这类失败重试必然复发。

## M21b（2026-10-27，古法溯源 / 规则打架修正 / partial 降级修正）

三处改动，前两处是**发现的真 bug**，不是新增功能。

### 1. 【应期按域】与【应期同域】在跨年之事上互相打架（根因级）

`【应期按域】`要求「应期行须落在引擎窗口区间内」，而引擎窗口由出空／值日／逢冲换算，
天然是**日级**区间（形如「癸未日前后，11月5日—11月7日」）；`【应期同域】`又禁止
跨月跨年之事写干支日。跨年之事两条同时成立时模型只能二选一，它选了服从前者
（措辞更硬：不得脱离区间）。

**原始案例里的「乙酉日—辛卯日」很可能就是这条逼出来的**，不是模型随口给的。
这与 M21 之前「模型默认时间跨度」的判断并不矛盾：默认跨度＋强制落窗口，两件事叠在一起。

修法：`【应期按域】`末尾显式定优先级——与`【应期同域】`冲突时以后者为准，
窗口降为「节点辅证」，主刻度须落到月／季／年或流程节点，并说明这是窗口的限度而非盘面矛盾。

### 2. 部分明示一律降为 mid，导致最该拦的案例不拦

`judge()` 里 `else if (partial) risk = 'mid'`：只要写了「考上」就算部分明示，
于是「今年能不能考上市重点」（不知门槛、不知阶段）**没有高风险缺项**，
预检块只给「如需补充」，模型照样给单一结论与日级应期——正是原始案例。

修法：部分明示 + 本类关键槽位 + `GOAL_RE` 命中的目标类问法 → 仍判 `high`。
升学／求职的领域包把「对象阶段」列入关键（不知孩子初几，远近当分无从执行）。
反向守护入测试：短讯「这周会不会来电」不升级、不写古法依据。

### 3. 古法溯源：判定带出处

五个槽位各加 `source`（古法原文大意），高风险缺项时预检块输出一行
「古法依据（用于判断，不必写入正文）」。系统提示`【前提元数据】`与`【应期同域】`
各加一句古法锚（「须指其所疑之事而占之」「远事定之以年月，近事应之于日时」）。

目的不是装饰：模型对「书上那句」的服从度高于对「工程规则」的服从度，
而这一层规则本来就出自古法，不需要伪装成新发明。

**引文按通行本大意，版本字句待校**——已写入 `docs/proposal-premise-metadata.md`，
对外引用前须核所据版本。

### 测试

`test-premise.js` 120 → **125**（新增古法依据 3 条、古法依据不误伤 1 条、修订 2 条原断言：
原「升学·无高风险缺项（不拦结论）」与需求相反，已改为「高风险含对象阶段与目标标准」）。
`test-functions.mjs` 保持 **292 PASS**（两份提示词逐字符一致断言照旧通过）。
资源戳 `20261027d → 20261027e`。

## M22（2026-10-28，断流静默交付半篇 / 草稿冒充正文 / 补发被自己的告警骗过）

线上现象（用户报）：同一盘 Gemini 正常，DeepSeek 思考 10.2k 字后「没给正文」——
其实是正文写到「用神」一行就没了，随后反复重试十余次。对着 HEAD 逐条核对，四处
互相独立的缺口叠加成了这个观感，均可在本地复现（`functions/api/interpret.js` 打桩驱动，
不联网）：

| 场景（上游收尾方式） | 旧版服务端 | 旧版前端 |
|---|---|---|
| 正文断在「用神」行，流自然结束、无 `finish_reason` | **零告警**（`finish === null` 跳过全部判定） | 当完整稿交付 |
| 只有 `reasoning_content`、无 `content` | 把草稿当 `t` 正文补发，无标记 | 10.2k 字独白渲染成断语（「只想不答」守卫因此永不可达） |
| 残篇 + `INCOMPLETE_STRUCTURE` 告警 | 告警文案含「结论：」 | 对全文测 `/结[论局]/` → 残篇恒判完篇，**自动补发从未触发** |
| 流从中间断开 | 下发 `UPSTREAM_STREAM_ERROR` | 已收到的正文随异常丢弃，从头重跑 |

改动：

1. `interpret.js` `pipeUpstreamSSE`：`finish === null && outLen > 30` 增发
   `warn: MODEL_NO_FINISH`。正常收流必带结束原因（OpenAI 兼容 `finish_reason`、
   Gemini 原生 `finishReason`），缺失即「上游什么都没说就断了」。
   `stream_end` 日志同步加 `draft` 字段。
2. 同处纯草稿兜底补发改发 `{t, draft:true}` + `warn: DRAFT_ONLY`，草稿不再自报家门为正文。
3. `app.js` 新增 `stripStreamWarn()`：判残篇、解析结论卡一律先剥掉自己拼的
   「> ⚠ 本卦断语…」提示段。判定条件同时改为「结构缺结论行 **或** 带过提示」——
   带过提示就说明这一稿不足以交付，结构齐全也要再要一稿。
4. `readStreamSSE` 捕获异常时把已收正文挂在 `err.partial` 上；`callInterpret` 在
   `partial.length >= 200` 时直接当残稿返回（尾巴注明传输中断），不再丢稿重跑。
5. 新增 `AI_MAX_ATTEMPTS = 6`（补发/校正两条二次生成给 3）。旧版只有「空稿 2 次」
   「流中断 3 次」两个计数，`AbortError`（空闲 65s / 硬顶 330s）与 JSON 5xx /
   `LLM_ERROR` 完全不计数，只靠 180s 截止兜——快速失败下能打满十几次付费请求。
6. 残稿不做盘面校正：半篇里的「冲突」多半是没写完，纠正它收益为零
   （`HAS_ABSORB && !curTruncated`）。

测试：`test-functions.mjs` 292 → **296**（`finish` 缺失告警且不写成 error、
纯草稿兜底带 `draft:true` 与 `DRAFT_ONLY`）。`npm test` 全绿（93/280/91/209/55/46/152）。
未把「用神：」纳入结构判定——模型常在正文明细写「用神父母巳火二爻发动」不带冒号，
硬测会把正常完篇判成残篇（`test-functions` 的「不告警反向对照」即此形）。
资源戳 `20261027e → 20261028a`（`app.js` 有改动，必须提戳否则老用户拿缓存旧版）。

## M23（2026-10-28，deepseek-flash 只想不答：心跳续命 / 原地空转 / 上游挂死无感）

线上现象（用户报，附 AI Gateway 日志）：同一盘 Gemini 完篇，deepseek-flash 思考 6.9k 字后
「没给正文」，一次点击跑了 6 次尝试、三分钟，全空。

**用真实接口复现（不靠猜）**：`curl --noproxy '*'` 直打线上 `/api/interpret`，同一
panText、model=deepseek-flash：

| 请求 | 结果 |
|---|---|
| deepseek-flash #1 | 200，首字节 1.7s，**277 帧 `{"r":…}` 全为思考，0 帧正文**，第 45s 起彻底静默，330s 被 curl 掐断 |
| deepseek-flash #2 | 同上，232 帧后静默（与用户日志里那条 45,439ms 完全吻合） |
| gemini-3.6-flash（对照） | 200，52s 完篇，43 帧正文，零告警 |

即：**模型只会思考、不出正文；流在 45s 处静默，连 `r.done` 都收不到**。三条代码缺口
让这件事从「一个模型不好用」放大成「一次点击烧 6 次调用、白等三分钟」：

1. **心跳把客户端超时守卫废掉了**（`app.js` `readStreamSSE`）：旧版「有字节到达就重置
   空闲计时」，而服务端每 15s 发一帧 `: ping` 保活。上游挂死后心跳照发，65s 空闲超时
   永不触发，只能等 330s 硬顶。改为**只认模型真产出**（`{"t"}` / `{"r"}`）才续命。
2. **上游静默无人察觉**（`interpret.js` `pipeUpstreamSSE`）：新增 `UPSTREAM_IDLE_MS`
   （默认 60s，下限 1000 供测试）看门狗，超时即 `reader.cancel()` 并下发
   `UPSTREAM_STALL`，跳过草稿补发。生产口径：45s 静默 + 60s 判定 ≈ 105s 就给用户交代。
3. **原地重试确定性失败**（`app.js` `callInterpret`）：`REASONING_ONLY` / `UPSTREAM_STALL`
   / 连续 `EMPTY` 三类错，旧版一律退避重试——deepseek 只有单模型，重试十次也是十次同样的
   空转。改为 `switchModelOnce()`：换一次 `fallbackModelFor()`（首选实测稳定的
   gemini-3.6-flash），成稿在末尾自报「本稿由 X 生成（Y 只思考未产出正文）」，换过仍失败
   就直接报错收手。`EMPTY`（服务端 502 空返回）也并入「连续两次即换模型」。

顺带两处：

- `interpret.js` 非流式 JSON 分支：上游回一段没有 `choices`/`candidates` 的 JSON 时，
  旧版只回 `reply:''`，服务端一行日志都没有——AI Gateway 里那串「1 秒完成、0 token」
  的空返回无法归因。现在把原始体头部打进 `console.error`；带 `error` 字段的直接按上游
  错误处理，不再当成静默空返回再重试一轮。
- `app.js` 失败框的 `第1次…第6次` 会原样重复两遍（看起来像跑了 12 次）：循环末尾统一
  拼 `details`，而三处 `break` 前已经先填了一份。全部改为 `detail: ''`。

测试：`test-functions.mjs` 296 → **298**（上游静默 → `UPSTREAM_STALL` 且不补发草稿）。
`npm test` 全绿（93/280/91/209/55/46/152）。资源戳 `20261028a → 20261028b`。

**未做**：没有替 deepseek-flash 调参（`max_tokens` / `reasoning_effort`）。DeepSeek 文档里
`max_tokens` 不含思维链输出，硬截只会更早断流；真要救它得改系统提示让它别把盘面
当谜题反复自问（实测它在草稿里反复问「这是六爻从初到上排列？」），属另一件事。

### M23 补记（同日，部署后复测发现：心跳与看门狗在生产环境都没跑起来）

部署 `ec171c80` 后按同一盘面再打一次 deepseek-flash，结果与部署前一致：
200s、45s 后无任何字节、**没有 `UPSTREAM_STALL`**。回看四次真实请求的原始流：

| 请求 | 时长 | `: ping` 帧数 |
|---|---|---|
| deepseek-flash #1/#2（旧版） | 330s / 200s | 1（只有 `openSession` 开头那一帧） |
| deepseek-flash #3（新版，带看门狗） | 200s | 1 |
| gemini-3.6-flash（对照，52s 正常完篇） | 52s | 1 |

`SSE_HEARTBEAT_MS` 默认 15s、`UPSTREAM_IDLE_MS` 默认 60s，按道理该有 3~13 帧 ping 和一帧
`UPSTREAM_STALL`，实际一帧都没有。结论：**Pages Functions 生产环境里，定时器回调里的
流写入没有生效**（Node 侧的 `test-functions` 心跳/看门狗断言全绿，workerd 生产不绿——
这正是「服务端保活」这类设计的盲区）。

因此所有超时兜底改为**客户端自己认**，不再依赖服务端心跳：

- `app.js` `readStreamSSE`：空闲计时只认 `{"t"}` / `{"r"}`（上一版已改，此处不再重复计入 ping）。
- `app.js` `callInterpret`：新增「超时 + 期间只收到思考、正文为零」分支
  （`thinkThisAttempt > 500` 且无 `partial`）——直接按 `REASONING_ONLY` 处理，
  `switchModelOnce()` 换一次模型；换过仍不行才报错。旧版把这种超时算作「请求超时」
  原地重试，每次都要再等 65s 静默，6 次就是十几分钟。

服务端看门狗保留（Node/本地开发与将来运行时行为一致时仍然有效），但**不再作为唯一保障**。
资源戳 `20261028b → 20261028c`。

## M24（2026-10-28，按模型分策略：不再用同一套参数对付两种失败）

用户提问：「deepseek 和 gemini 你为啥要选相同的策略呢，没有针对性吗」。查下来的答案比
「没做」更糟：**做了，但方向是反的**。

| 维度 | gemini-3.6-flash | deepseek-flash | 旧版问题 |
|---|---|---|---|
| 思考预算 | 被硬塞 `thinkingBudget: 0`（关思考） | 完全不限 | 对最好的模型做最不利的事 |
| 正文预算 | 不传 | 不传 | 等于把配额控制权全交出去 |
| 系统提示 | 同一份 | 同一份 | 无「别把盘面当谜题」约束 |
| 尝试次数 | 6 | 6 | 确定性失败也重试 6 次 |
| 空闲判死 | 65s | 65s | 实测静默点在 45s，白等 20s |
| 硬顶 | 330s | 330s | 一次点击可烧 5 分钟 |

自相矛盾之处：本文件 M24 之前的注释就写着「gemini-3.6-flash 在 A（`thinkingBudget:0`）下
只生成 137/405 tokens 就 `finishReason=STOP`，断语断在句中且无结论行」——记录在案，却仍
是生产默认。而对真正出问题的 deepseek 反倒毫无约束（10.2k 字草稿、正文零字）。

改动：

**服务端 `interpret.js`**

1. 新增 `modelPolicy(model, isGoogle)`，把「思考预算 / 正文预算 / 成文约束」三件事按模型
   分开，env 可逐项覆盖：
   - `GEMINI_THINKING_BUDGET`：默认 **不传**（留空/-1 = 交给 3.x 动态思考），`0` = 关思考
     （可回退到旧行为），正整数 = 显式上限；
   - `DEEPSEEK_MAX_TOKENS`：默认 8192（旧版 `LLM_MAX_TOKENS` 未设时完全不传）；
   - `DEEPSEEK_TAME`：默认开，`0` 可关掉追加段。
2. deepseek 追加【直接成文】约束段：不得自问自答（实测它在草稿里反复问「这是六爻从初到
   上排列？」「通常排盘从下往上」）、不得复述盘面原文、从「一、卦象要点」直接起笔。
   追加只发生在**发请求时**（`sysPrompt`），不改 `SYSTEM_PROMPT` 常量——`app.js` 那份
   副本用于「复制请求内容手动断卦」，不该被某个供应商的调参污染（有断言守住）。
3. `max_tokens` 优先级：全局 `LLM_MAX_TOKENS` > `policy.maxTokens` > 不传。
   Google / OpenAI 兼容两条路径同口径。

**前端 `app.js`**

4. 新增 `isThinkerModel()` / `modelLimits()`，按模型给额度：

   | 模型 | 尝试 | 空闲判死 | 硬顶 |
   |---|---|---|---|
   | 思考型（deepseek / o1-o4 / r1 / reasoning） | 2 | 45s | 150s |
   | 其余（gemini / gpt） | 3 | 65s | 330s |

   理由：gemini 的失败是偶发的，多试两次有意义；deepseek 是确定性的，第 2 次和第 6 次
   结果逐字相同，差别只是多烧几笔付费调用。`attempt` 在 `switchModelOnce()` 里归零并
   重算额度——否则「deepseek 试满 2 次 → 切 gemini」会在第 1 轮就撞 break，等于没换。
5. `AI_MAX_ATTEMPTS` 6 → 3（通用上限；思考型另给 2）。

测试：`test-functions.mjs` 298 → **310**（新增 #26 组 12 条：gemini 不传 thinkingConfig、
deepseek `max_tokens=8192` 且含【直接成文】、追加段在契约之后、常量未被污染、三个 env
覆盖项、全局上限仍优先）。同时改掉一条**钉死旧行为**的断言（原「未开调试开关 → 仍为
thinkingBudget:0」，那正是要修的东西）。`npm test` 全绿（93/280/91/209/55/46/152）。

资源戳 `20261028c → 20261028d`。

**待线上验证的风险点**：gemini 解除关思考后，是否真的完篇更快/更稳，还是如历史注释
担心的那样「思考路径 high demand 503」。若不行，设 `GEMINI_THINKING_BUDGET=0` 即可原地
退回，无需回滚部署。

### M24 补记（同日，gemini 放开思考的线上 A/B 实测：更差，已回退）

上节把 gemini 的 `thinkingBudget` 从 0 改成「不传（动态思考）」，理由是本文件旧注释写着
「关思考下 3.6-flash 只 137/405 tokens 就 STOP」。部署后立即用同一盘面对打，实测推翻了
那条注释的适用条件：

| 配置 | 首字节 | 结果 |
|---|---|---|
| `thinkingBudget: 0`（关思考，旧默认） | 1.7s | 52s 完篇，43 帧正文，零告警 |
| 不传（动态思考，本次试改） | 4.8s | 200s 时**仍在流中**，仅 36 帧 / 1103 字，正文断在「三、断应期」第 3 点中途，无「结论：」行 |

即：3.x 的动态思考会吃掉输出预算并显著拖慢生成，对「长结构化断语」这个任务是负收益。
「137/405 tokens 就 STOP」那条记录的触发条件不是「关思考」，不能作为放开的依据。

处置：`modelPolicy` 的 gemini 分支默认值回到 **0**，`GEMINI_THINKING_BUDGET` 语义改为
`-1 = 不传（动态思考）`、正整数 = 显式上限、未设/`0` = 关思考。策略结构保留（这才是
M24 的核心），只在 gemini 这一项上采信实测而非旧注释。

deepseek 侧改动不受影响（`max_tokens=8192` + 【直接成文】），另行实测。
测试同步：`test-functions` 311（比上节 +1，多一条 `-1` 语义）。

### M24 再补记（同日，deepseek 预算两轮实测：8192 比不传更糟，32768 仍不出正文）

| deepseek-flash 的 `max_tokens` | 结果（同一盘面） |
|---|---|
| 不传（上游默认 8192，M22 实测） | 思考 10.2k 字后正文起头，断在「用神」行 |
| 显式 `8192` | 8123 帧 / 13243 字思考在 41s 内打满，**正文 0 字**，`finish_reason=length` |
| 显式 `32768` | 10599 帧 / 12974 字思考，60.7s 结束，**正文仍 0 字**（这次不是 length，是思考完就停） |

由此确认两件事：

1. **DeepSeek 的 `max_tokens` 包含思维链**（与「不含 CoT 输出」的文档说法不符）——所以
   「压预算逼它少想」是反的：压到 8192 直接 length 截断，正文一个 token 都分不到。
2. 给足到 32768 也不出正文，说明**不是预算不足，而是这个模型把这套提示当成了待解的谜题**。
   【直接成文】那段约束对 reasoning 阶段无效——它的草稿开口就是 `Let me carefully parse
   the chart.`，逐行复述初爻到上爻的干支。

结论：deepseek-flash 在「长结构化断语」这个任务上**调参救不了**。`max_tokens` 保留 32768
（至少不制造 `length` 截断，上限本身不额外计费），但真正的处置是产品层的：
建议从默认模型清单移除，或保留为「手动选择 + 明确告知不可靠」。此项待定，未擅自改动。

### 同窗口的基线观察：gemini 上游自身在退化，现场无法作为验证依据

按同一盘面对打，**旧部署（M22 `38a06d13`）与新部署都拿不到完篇**：

| 部署 | 结果 |
|---|---|
| M22 `38a06d13`（旧代码，关思考） | 190 字，**10.7s 干净结束**（提前 STOP） |
| M24 `b08dda6a`（动态思考） | 1103 字，200s 仍挂住，断在「三、断应期」 |
| M24 `70b20350` / `c4e1e15e`（回退关思考） | 127→408 字，150~180s 挂住，断在「二、断吉凶」 |

即：**旧的好的基线（今天早先 52s 完篇 43 帧）此刻已不可复现**，新旧版本都退化，所以本轮
gemini 侧无法给出「改动后完篇」的正面证据——能确定的只是「请求体与旧版逐字段等价」
（探针已验证：`thinkingConfig.thinkingBudget=0`、`temperature=0.2`、无 `maxOutputTokens`、
系统提示未追加），故不会比旧版更差。待上游恢复后需复测。

## M25（2026-10-28，借鉴 qimen：提示词按模型分两版 + 一条能自证的诊断通道）

用户问：「qimen 的为啥可以 你不借鉴一下吗」。参照仓库 `idavailable/qimen`（同一账号、
同一家中转、同样 CF Pages + SSE）逐字对比后，先得出一张差异表，再用**真实盘面 +
服务端诊断帧**验证——结论推翻了本文件 M24 的一条判断，一并记在下面。

### 一、两边到底差在哪（静态对比）

| | qimen | liuyao（M24 时） |
|---|---|---|
| 系统提示词 | 953 字 / 13 条 | 3004 字 / 30 余条 |
| 「须」 | 2 次 | 24 次 |
| 「不得」 | 13 次 | 39 次 |
| 「说明理由」 | 0 次 | 3 次 |
| 「逐条」 | 0 次 | 2 次 |
| 「只输出正文」硬约束 | **有**（第 8 条） | **没有** |
| 请求体 | `{model, messages, stream}` | 追加 max_tokens / CF 网关参数 |

性质差别：qimen 那份是**照办清单**（盘面既定，直接断），liuyao 那份是**审计清单**
（逐条采纳判语、每条结论括注依据、对引擎判定有异议须先引古法说明理由、写完自检五遍）。
后者每一条都在邀请模型复核，对 reasoning 模型是一串深坑。

实现：新增 `LEAN_SYSTEM_PROMPT`（1127 字，压缩 62%），保留四步次序 + 四段硬契约 +
结论对齐 + 结构化五行（前端解析靠它），去掉论证入口，补上 qimen 那句「只输出断卦
正文本身」。开关 `DEEPSEEK_PROMPT=lean` 启用。

### 二、实测把两个结论都推翻了

**① M24 的核心判断「deepseek 调参救不了」是错的**

用 `core/paipan.js` 真实排盘（雷风恒之泽风大过，五爻官鬼庚申✕动化丁酉，六亲齐全）
重建 panText，再用新增的 `diag` 通道取**服务端视角**：

| 提示词 | 服务端正文字数 | 耗时 | finish |
|---|---|---|---|
| 完整版（默认） | **1862 字** | 37.3s | stop |
| 精简版 | **1179 字** | 27.8s | stop |

两版都正常出正文，尾部五行齐全（`验证标志／用神：妻财戌土／前提完整性：缺失…`）。
即 deepseek 从来不是「只想不答」。**默认因此回到完整版**（内容更详实，且契约更全），
精简版降级为「更快的可选项」（快 25%、字数少 37%）。

**② 为什么之前所有实测都显示「正文 0 字」——本机出口只剩 391 B/s**

同一时刻量本地到 CF 的静态下载：`app.js` 157308 字节，120 秒只到 46998 字节，
`speed=391 B/s`。而 qimen 的 232 字节 JSON 接口 1.4 秒返回。也就是说：**小响应正常、
持续数据流被压到近乎为零**。SSE 逐字下发在这种链路下必然表现为「只收到开头几百字
思考就卡住」，与模型行为无关。

教训：**长连接 + 本地窄带下，客户端拿到的字节数不能作为「上游有没有给内容」的证据**。
M22–M24 三轮里多次据此下的判断（含「上游退化」「模型不出正文」）都应作废。

### 三、真正的失败形态（网关日志）

| 北京时间 | 模型 | status | 耗时 | in/out |
|---|---|---|---|---|
| 13:22 | deepseek-flash | 200 | 41s | 1283 / 7736 |
| 13:26 | deepseek-flash | 200 | 22s | 1464 / 3762 |
| 13:36 | deepseek-flash | 200 | 27.6s | 1464 / 5315 |
| 13:39 | deepseek-flash | 200 | 37s | 2863 / 6401 |
| **13:41** | deepseek-flash | **499** | **57.7s** | **0 / 0** |

499 = 上游在 57.7 秒里**一个字都没吐**，被服务端 `UPSTREAM_IDLE_MS`（默认 60s）看门狗
取消。这才是用户看到「思考 N 字后没有正文」的真实来源：**间歇性上游静默**，不是模型
特性、不是提示词、不是预算。旧版表现为「原地重试 17 次」，每次都撞同一段静默。

### 四、改动

1. `LEAN_SYSTEM_PROMPT` + `modelPolicy().promptMode`（默认 full，`DEEPSEEK_PROMPT=lean`
   可切换）。**不动** `SYSTEM_PROMPT` 常量——app.js 那份副本用于「复制请求内容手动断卦」，
   有断言守住不被污染。
2. **新增 `body.diag` 诊断模式**：不逐字下发，只在流末回一帧摘要
   `{diag:{chars, thought, finish, cut, draftOnly, ms, tail}}`（几百字节）。慢网也拿得到，
   用来区分「上游没给正文」与「正文在路上但传不下来」。这是本轮唯一能穿透窄带的自证手段。
3. 修 `thoughtLen` 只在 Google 分支累加的老缺口：OpenAI 兼容路径的 `reasoning_content`
   从来没计过数，于是 `stream_end` / diag 里的 `thought` 恒为 0，「思考了多少字」只剩前端猜。

测试：`test-functions` 316 → **318**（默认走完整版、lean 仅在显式开关下生效）。
`npm test` 全绿（93/280/91/209/55/46/152）。
