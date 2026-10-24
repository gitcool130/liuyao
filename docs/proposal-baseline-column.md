# 判据快照结构化：casts 加 baseline 列 —— 实施方案（M17-A 阶段一）

2026-10-24。对应 `docs/optimization-2026-10-24.md` §四「判据快照结构化」与
「建议的下一步 1」：`baseline` 列 + 回执表单「当时判据 vs 事后事实」并排——
「决策留痕」真正的形状。

**本文只做方案，不改任何代码。** 文中所有 diff 均为建议形态，实施时以实际代码为准。

---

## 〇、一句话定位

`baseline` 是**断卦时刻判据的结构化快照**：用神、粗判走向、应期区间、置信度、区间宽度。
它**不新增任何判据**——同样的内容此刻已随 `pan_text` 落库（`buildPanText` 注入
【应期窗口（规则链换算 · 非推断）】段，`public/app.js:657-668`，含依据与下调原因全文），
baseline 只是把可展示、可对照、未来可分桶分析的那几个值**从散文里拎成字段**。
单一事实源仍是 `yingqi-window.js` 的换算结果；baseline 是它的存档，不是第二套口径。

---

## 一、现状锚点（实施前核对用）

| 事实 | 位置 |
|---|---|
| `recordPayload()` 组装 POST 体（现 8 字段，不含判据） | `public/app.js:1728-1742` |
| 两个调用点：`autoSaveCast()`（断卦/追问后自动）、`#btnSave`（手动） | `public/app.js:1753`、`1768` |
| 应期窗口对象挂载：`out.yingqiWindow = LY.yingqiWindow(pan, out)`（可选依赖，异常置 null） | `public/core/analyze.js:1211-1214` |
| 窗口换算与置信度唯一实现 | `public/core/yingqi-window.js:90-288` |
| `pan_text` 注入应期段（`C.yingqiText(w)` 含依据/下调原因） | `public/app.js:660-668`；`yingqi-window.js:291-297` |
| 服务端主写路径：`INSERT INTO casts (…9 列…) … ON CONFLICT(id) DO UPDATE SET question, messages` | `functions/api/records.js:273-287` |
| ON CONFLICT 更新清单刻意不含 outcome（自动保存不冲回填） | `functions/api/records.js:272` 注释 |
| 回执回填独立分支：只 UPDATE outcome 列 | `functions/api/records.js:174-191` |
| 列表 SELECT **不含** pan_text/baseline；详情 `SELECT *` 返回整行 | `functions/api/records.js:213-215`、`203` |
| 回填表单与「当前值」行（#ocNow / #ocResult / #ocYingqi / #ocWindow / #ocNote） | `public/app.js:2000-2068` |
| 分桶统计 `renderLibStats`（按 OC_WINDOW_ORDER 四桶分行报） | `public/app.js:1843-1883` |
| 置信度徽标既有文案（中性 oc-badge + title「盘面要素的自洽程度，不是命中概率」） | `public/app.js:595-605` |
| casts 现有 9 列 + 既有库 outcome 迁移先例（ALTER TABLE ADD COLUMN） | `schema.sql:11-25` |

既有测试与本方案的相容性（已核对 `test-functions.mjs`）：
`主 POST 的 INSERT 不含 outcome 列`（312 行，`indexOf('outcome') < 0`）在加 baseline 后**仍为真**；
列表 SQL 断言（307 行）与回填 UPDATE 正则（293 行）不涉 baseline。**既有 180 项断言无需改动。**

---

## 二、问题 1：迁移策略（ALTER TABLE casts ADD COLUMN baseline TEXT）

### 2.1 DDL（唯一一条，只允许 ADD COLUMN）

```sql
ALTER TABLE casts ADD COLUMN baseline TEXT;
```

- 不加 NOT NULL、不加 DEFAULT：旧行的语义就是「无快照」，SQLite 里表达「无」的既有惯例
  与 `outcome` 列一致（`schema.sql:21`「未回填为 NULL」）。baseline 照抄：**未快照为 NULL**。
- SQLite 不支持 `ADD COLUMN IF NOT EXISTS`，重复执行报 `duplicate column name`（无害但脏），
  故执行前先查列（见 2.3）。

### 2.2 三个环境怎么执行

```bash
# ① 本地（wrangler dev 的本地 D1，与 pages dev 共享 .wrangler/state 持久化）
npx wrangler d1 execute liuyao-db --local --command="ALTER TABLE casts ADD COLUMN baseline TEXT;"

# ② 生产（与 schema.sql:25 给 outcome 留的先例同一条命令形状）
npx wrangler d1 execute liuyao-db --remote --command="ALTER TABLE casts ADD COLUMN baseline TEXT;"

# ③ 全新空库（schema.sql 建表后同样补这一条 ALTER；CREATE TABLE IF NOT EXISTS 不会给既有表加列）
```

`schema.sql` 本次**只读不动**。后续若愿意，可把上面这条 ALTER 以注释形式追加到
schema.sql 的 outcome 迁移注释旁（schema.sql:24-25 同款），属于独立的小提交，不在本方案范围。

### 2.3 执行顺序与回滚安全性（不可反）

1. **先迁移，后部署代码**。次序反了：新代码的 INSERT 引用不存在的列，主写路径整体报错。
2. 反向组合是安全的——**旧代码 + 新列**：新列对旧代码透明，恒为 NULL，什么都不发生。
   这就是「先加列」的回滚保证：代码回滚不需要回滚 schema。
3. 执行前后各跑一次 `PRAGMA table_info(casts);`（D1 支持），确认第 10 列出现。

```bash
npx wrangler d1 execute liuyao-db --local --command="PRAGMA table_info(casts);"
```

### 2.4 向后兼容：旧行 baseline 为 NULL 时读取路径如何降级

| 路径 | 现状 | 加列后 | 改动 |
|---|---|---|---|
| 列表 `GET /api/records` | SELECT 六列 + outcome | 不含 baseline | **零改动**（列表本就不下发正文，徽标与统计只吃 outcome） |
| 详情 `GET /api/records?id=` | `SELECT *` | 自动多出 `baseline` 字段（旧行为 null / 键缺失） | 服务端零改动 |
| 前端详情渲染 | `r.outcome` → `parseOutcome` 防御解析 | `r.baseline` 同款防御解析（try/catch JSON.parse + 类型检查，失败按 null 处理） | 新增一段渲染逻辑，见 §五 |
| 回填 `POST ?outcome=1` | 只 UPDATE outcome 列 | 不变 | 零改动 |
| 统计 `renderLibStats` | 只读 outcome | 不变 | 零改动 |

降级显示规则（前端）：`baseline` 为 null、解析失败、或 yongshen/trend/window 三者全空时，
详情页**不渲染对照区**，代之以一行 muted 说明（文案见 §五.4）——旧行从来看不到这块，
回执表单照常可用。「缺快照」本身如实陈述，不猜测、不补造。

---

## 三、问题 2：baseline JSON 结构与字段来源

### 3.1 存储形状（五字段，与 optimization §四定义一致并显式化 spread）

```json
{
  "yongshen": "妻财 己卯",
  "trend": "吉",
  "window": {
    "status": "ok",
    "lo": 12, "hi": 14,
    "dayLo": "癸未", "dayHi": "乙酉",
    "dateLo": "11月5日", "dateHi": "11月7日",
    "text": "应期：癸未日前后（第 12–14 日，11月5日—11月7日），置信中等"
  },
  "confidence": "中",
  "spread": 2
}
```

window 的两种合法形态（读取端只看 `status`，其余字段按形态取）：

```json
// status = ok（正常换算成功）
{ "status": "ok", "lo": 12, "hi": 14, "dayLo": "癸未", "dayHi": "乙酉",
  "dateLo": "11月5日", "dateHi": "11月7日", "text": "应期：…" }

// status = blocked（拒答：真空 / 真月破 / 无盘 / 无用神）——拒答文案本身就是判据，照存
{ "status": "blocked", "blockedBy": "真空", "text": "应期：用神真空，无应期可立——宜另择用神或以世爻参断" }

// window 整体为 null：yingqiWindow 不可得（旧缓存页面模块未加载 / analyze.js:1212 异常 catch 置 null）
null
```

### 3.2 字段来源逐条（指向 yingqi-window.js / analyze.js 的具体变量）

| 字段 | 来源变量 | 值域 | 取不到时**显式规定** |
|---|---|---|---|
| `yongshen` | `analysis.yongshen.type + ' ' + yongshen.line.lq + yongshen.line.zhi`（analyze.js:1181-1185 组装；与 buildPanText 用神行同源，app.js:630-633） | 字符串，如「妻财 己卯」「世爻 壬寅」 | **null**（yongshen 为 null，即 blocked: no_yongshen 场景） |
| `trend` | `analysis.trend`（analyze.js aggregateTrend，1041-1077） | `吉 / 凶 / 平 / 待审` | **null**（lastAnalysis 缺失） |
| `window` | `analysis.yingqiWindow`（yingqi-window.js `yingqiWindow()` 的返回对象 out）：ok 形态取 `out.status/out.lo/out.hi/out.dayLo/out.dayHi/out.dateLo/out.dateHi/out.text`（lo/hi 出自 220-223 行 sort 后 `main = cands[0]`、`lo = Math.max(1, main.d)`、`hi = lo + main.spread`；dayLo/dayHi 出自 268-269 行 `gzOfDayIdx(dayIdx + lo/hi)`；dateLo/dateHi 出自 272-275 行 `fmtMD(addDays(...))`；text 出自 277-279 行）；blocked 形态取 `out.status/out.blockedBy/out.text`（93-104、115-126 行） | 见 3.1 两种形态 | **null**（yingqiWindow 为 null 或 lastAnalysis 缺失） |
| `confidence` | `out.confidence`（yingqi-window.js:225-264：consistency 基准 1；用神旺/相 +1、休/囚/死 −1；±3 日内非 default 候选互证 ≥2 条 +1；冲散 −1；伏藏 −1；≥3 高、=2 中、余低） | `高 / 中 / 低` | **null**（window 整体为 null 时）；**blocked 时照写 `out.confidence`（即「低」）**——与 renderYingqi 徽标对 blocked 的既有显示完全一致（app.js:597-598 不分支） |
| `spread` | `out.spread`（= `main.spread`，yingqi-window.js:267 行；宽度常量 38 行 `SPREAD = { fast: 2, normal: 2, slow: 3 }`） | `2` 或 `3`（单位：日） | **null**（blocked 或 window 整体为 null 时——blocked 路径从不给 out.spread 赋值，照抄即 null） |

**缺失值一律 `null`，不用空串、不用 0、不用「未知」。**
理由：confidence 的值域是「高/中/低」、spread 的值域是 {2, 3}——空串与 0 都不是值域成员，
写进去就是发明第三套口径；JSON 的 null 是唯一无歧义的「无」，且前端渲染时 null 项直接不渲染该行。

**整列跳过规则**：`lastAnalysis` 为 null（起卦后未选用神类别就手动保存）或
yongshen / trend / window 三者全为 null 时，**baseline 整体不写入（列保持 NULL）**，
不落一个「全 null 对象」——没有任何判据可留痕时，诚实的存档是「无存档」。

**口径红线（照抄，不重新解释）**：
- `confidence` 是**盘面要素的自洽度，不是命中概率**（yingqi-window.js:26 注释原文；
  界面措辞以 app.js:595-605 为准）——baseline 存的只是该值的快照，不换算、不标百分比。
- `spread` 是**工程约定，不是古法**（yingqi-window.js:25 注释原文）——照存数字，不解释成卦理。
- `window` 的区间与文案是 yingqi-window.js 的换算产物，快照原样拷贝 `text`，
  读取端**永远展示 text 原文**，不从 lo/hi 重新拼装（避免第二套文案与既显示内容漂移）。

**不存 basis / downgrades 的理由**：两者已随 `C.yingqiText(w)` 全文进入 `pan_text`
（app.js:662 → yingqi-window.js:294-295），快照再存一份就是同一文本的第二份拷贝，
将来改措辞必漂移。判据的完整叙述看 pan_text；baseline 只做结构化索引。

---

## 四、问题 3：recordPayload() 写入点改动（与 panText 同批）

### 4.1 前端 `public/app.js`

**改动点 A：新增 `baselineSnapshot()`（建议插在 `recordPayload` 定义正上方，约 1727 行）**

```js
// 判据快照：把断卦时刻的用神/粗判/应期窗口/置信度/区间宽度固化成 JSON，
// 随 recordPayload 与 panText 同批入库。字段来源与缺失规则见 docs/proposal-baseline-column.md §三。
// 缺失一律 null（不用空串/0）；无任何判据可存时整体返回 null（列保持 NULL）。
function baselineSnapshot() {
  const a = lastAnalysis;
  if (!a) return null;
  const w = a.yingqiWindow || null;
  const y = a.yongshen;
  const snap = {
    yongshen: (y && y.line) ? (y.type + ' ' + y.line.lq + y.line.zhi) : null,
    trend: a.trend || null,
    window: null,
    confidence: w ? w.confidence : null,          // blocked 时照写（'低'），与 renderYingqi 显示一致
    spread: (w && w.spread != null) ? w.spread : null
  };
  if (w) {
    snap.window = (w.status === 'blocked')
      ? { status: 'blocked', blockedBy: w.blockedBy || '', text: w.text || '' }
      : { status: 'ok', lo: w.lo, hi: w.hi, dayLo: w.dayLo, dayHi: w.dayHi,
          dateLo: w.dateLo, dateHi: w.dateHi, text: w.text };
  }
  if (!snap.yongshen && !snap.trend && !snap.window) return null;
  return snap;
}
```

**改动点 B：`recordPayload()` 返回对象加一行（app.js:1730-1741，diff 位置）**

```diff
   return {
     id: castId,
     datetime: fmtDT(selectedDate),
     pillars: pil.yearGZ + '年 ' + pil.monthGZ + '月 ' + pil.dayGZ + '日 ' + pil.hourGZ + '时',
     question: $('#useSelect').value === '__custom__'
       ? currentQuestion()
       : ($('#useSelect').value ? $('#useSelect option:checked').textContent : ''),
     hex: pan.benName + (pan.hasBian ? ' 之 ' + pan.bianName : '（静卦）'),
     tosses: records,
     panText: buildPanText(true),
+    baseline: baselineSnapshot(),
     messages: aiStates   // { modelId: [{role, content}] }
   };
```

`baseline` 与 `panText` 处于**同一个 JSON body、同一次 POST**，天然同批——
`recordPayload()` 的两个调用点（`autoSaveCast()` app.js:1753、`#btnSave` app.js:1768）
**都不需要任何改动**，自动保存与手动保存两条链同时生效。

### 4.2 服务端 `functions/api/records.js`（onRequestPost 主写路径）

**改动点 C：INSERT 列清单、VALUES、bind 各加一项（records.js:273-287，diff 位置）**

```diff
+  // 判据快照（M17-A）：对象才收，其余一律 null。仅限长不做枚举白名单——
+  // baseline 只供详情页对照展示，不是统计枚举来源（统计只吃 outcome 的白名单），渲染端解析失败即降级。
+  const baseline = (b.baseline && typeof b.baseline === 'object' && !Array.isArray(b.baseline)) ? b.baseline : null;
   await env.LIUYAO_DB.prepare(
-    'INSERT INTO casts (id, created_at, datetime, pillars, question, hex, tosses, pan_text, messages) ' +
-    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ' +
-    'ON CONFLICT(id) DO UPDATE SET question = excluded.question, messages = excluded.messages'
+    'INSERT INTO casts (id, created_at, datetime, pillars, question, hex, tosses, pan_text, messages, baseline) ' +
+    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ' +
+    'ON CONFLICT(id) DO UPDATE SET question = excluded.question, messages = excluded.messages, baseline = excluded.baseline'
   ).bind(
     id,
     new Date().toISOString(),
     (b.datetime || '').toString().slice(0, 50),
     (b.pillars || '').toString().slice(0, 80),
     (b.question || '').toString().slice(0, 100),
     (b.hex || '').toString().slice(0, 80),
     jsonWithin(b.tosses || [], 4000),
     b.panText.slice(0, 8000),
-    jsonWithin(b.messages || [], 100000)
+    jsonWithin(b.messages || [], 100000),
+    baseline ? jsonWithin(baseline, 1000) : null
   ).run();
```

逐项说明：

- **列名显式**（INSERT 带列清单），新列加在第 10 位不影响既有 9 个位置参数的语义。
- **`jsonWithin(baseline, 1000)`**：与 tosses/messages 同一序列化闸门，保证落库永远是
  合法 JSON 且 ≤1000 字节（真实快照约 200–400 字节，余量充足）；`records.js:75` 的实现已在本文件，
  无新依赖。
- **ON CONFLICT 更新清单加入 `baseline = excluded.baseline`**：baseline 与 question/messages
  同属断卦流程产出——用户「重新断卦」后自动保存应刷新快照，停留在首断版本才是错的。
  同时**维持既有隔离原则不变**（records.js:272 注释）：更新清单仍**绝不含 outcome**，
  回填的回执永不被自动保存冲掉；两份清单互不包含的关系原样保留。
- **零改动清单**：`sanitizeOutcome` / `handleOutcome`（174-191）、GET 列表（213-215）、
  GET 详情 `SELECT *`（203，自动带出新列）、DELETE（231-241）、`_lib.js` 全部不动。

---

## 五、问题 4：回填表单「当时判据 vs 事后事实」并排 UI

### 5.1 位置与结构

在 `loadCast()` 渲染的 `#libDetail` 中，**结果回执区（oc-box）内部顶部、「当前值」行上方**
插入「判据对照」块——判据与事实在同一视线里，回填表单就在下方（app.js:2014 的 oc-box HTML 前插）。

```html
<div class="cmp-box">
  <b>判据对照</b>　<span class="muted" style="font-size:12px">左：断卦时存的判据快照　右：事后据实回填的事实</span>
  <div class="cmp-grid">
    <!-- 行 1：事之走向 -->
    <div class="muted">事之走向（当时粗判）</div><div class="muted">事之成败（事后）</div>
    <div>趋吉</div>                                          <div>事已成</div>
    <!-- 行 2：应期 -->
    <div class="muted">应期（当时判据）</div><div class="muted">应期（事后）</div>
    <div>癸未日前后（第 12–14 日，11月5日—11月7日）　<span class="oc-badge" title="盘面要素的自洽程度，不是命中概率">置信中等</span></div>
    <div>应期准 · 3 日内</div>
    <!-- 行 3（可合并进行 1）：用神（判据侧单列，无对照项） -->
    <div class="muted">用神（当时所取）</div><div class="muted"></div>
    <div>妻财 己卯</div>                                     <div>—</div>
  </div>
  <div class="muted" style="margin-top:4px;font-size:12px">
    置信度只表示盘面要素的自洽程度，不是命中概率。对照仅为决策留痕，不做对错判定。
  </div>
</div>
```

- 样式建议：`.cmp-grid { display:grid; grid-template-columns:1fr 1fr; gap:2px 12px }`，
  窄屏（`@media (max-width:600px)`）退化为单列、左右两栏改为上下两块——并排的**语义**是
  「同一行左边当时、右边事后」，断行不丢语义。样式加进 `public/index.html` 既有 `<style>` 区。
- 文案映射**全部复用既有常量，不新造口径词**：trend 用 `TREND_LABEL`
  （app.js:568，趋吉/趋凶/持平/待审——现为 renderAnalysis 内局部常量，实施时提到 IIFE 顶层共用）；
  result/yingqi/window 用 `OC_RESULT / OC_YINGQI / OC_WINDOW`（app.js:1813-1819）。
- `baseline.window.text` **原文展示**（去掉「应期：」前缀的展示方式与 renderYingqi 一致），
  不从 lo/hi 重拼。
- `spread` 不参与主展示（留痕在库里即可）；如需提示，放 title 或小字「区间宽度为换算约定（±2–3 日）」，
  不解释成卦理。

### 5.2 降级显示

| 数据状态 | 显示 |
|---|---|
| `baseline` 为 null / 解析失败 / 三主字段全空 | 整块不渲染，代之一行 muted：**「此例无当时判据快照（保存于判据快照上线前）。」** 回执表单照常 |
| `window.status === 'blocked'` | 应期行判据侧显示 `window.text` 原文（拒答文案本身即是判据：如「用神真空，无应期可立——宜另择用神或以世爻参断」），不显示区间；置信徽标照显示（低） |
| `window` 为 null 但 yongshen/trend 有值 | 应期行判据侧显示「—」 |
| 单侧字段缺失 | 缺的一格显示「—」，不造占位解释 |

### 5.3 文案红线（验收时逐条对照）

1. 新增区块的任何文案（标题、行名、说明、title、占位）**不得出现**「准确率」「命中率」
   「命中概率」「判对」「判错」「正确」「预测效」等词。
2. **不加对错判定**：不渲染 ✓/✗、不渲染「与事实一致/不一致」的机器结论行——并排即止，
   结论留给看的人。左栏判据文字与右栏事实文字都用中性色（muted），**事实侧不复用
   `oc-success / oc-fail` 彩色徽标**——那两色在本页语义是「事之成败」，出现在对照区
   会被读成「判据答对了/答错了」；列表徽标（app.js:1831-1838）保持既有不动。
3. 置信度：徽标复用 renderYingqi 同款中性 `oc-badge` + 逐字相同的 title
   （「盘面要素的自洽程度，不是命中概率」，app.js:597），块底说明与 app.js:605 逐字同口径。
   **confidence 不显示为百分比、不与 outcome 结果做任何并排「命中」暗示。**
4. 既有「命中率统计（按应验窗口分桶）」区块（app.js:1875）与其反准确率说明文案
   **一字不动**——本方案的新增文案是加法，不动任何既有口径表述。

### 5.4 交互

对照区**只读**：无输入、无按钮、不参与保存。它唯一的数据源是 GET 详情返回的
`r.baseline`（服务端 `SELECT *` 已带出）与 `parseOutcome(r.outcome)`——后者是既有函数
（app.js:1820-1830，防原型链 pick），直接复用。

---

## 六、问题 5：本地 wrangler dev 下验证写入与读取

```bash
cd <liuyao 仓库根>

# 0) 前置：npm install（devDependencies 仅供测试；dev 本身零依赖）

# 1) 本地 D1 首次建表（若从未建过）
npx wrangler d1 execute liuyao-db --local --file=schema.sql

# 2) 加列前先查（应无 baseline 列）
npx wrangler d1 execute liuyao-db --local --command="PRAGMA table_info(casts);"

# 3) 加列
npx wrangler d1 execute liuyao-db --local --command="ALTER TABLE casts ADD COLUMN baseline TEXT;"
#    复跑第 2) 步确认第 10 列出现

# 4) 起本地 Pages（README「本地开发」既有命令；本地未设 LIB_CODE/ACCESS_CODE
#    → 读写路径开放，records.js:36 的向后兼容分支）
npx wrangler pages dev public
```

**写入验证**（实施代码后）：

```bash
# 5) 浏览器 http://127.0.0.1:8788 ：起卦 → 选事类 → 断卦（确认应期窗口已渲染）→「入卦例库」

# 6) 直查本地库，确认 baseline 已随同批落库（与 pan_text 同一行）
npx wrangler d1 execute liuyao-db --local --command="SELECT id, json_extract(baseline,'$.yongshen'), json_extract(baseline,'$.trend'), json_extract(baseline,'$.window.status'), json_extract(baseline,'$.window.lo'), json_extract(baseline,'$.confidence'), json_extract(baseline,'$.spread') FROM casts ORDER BY created_at DESC LIMIT 3;"

# 7) 服务端守卫直测：手工 body 带 baseline（字符串→应存 null；合法对象→应原样限长落库）
curl -s -X POST http://127.0.0.1:8788/api/records -H 'Content-Type: application/json' \
  -d '{"panText":"验证排盘","tosses":[],"messages":[],"baseline":"垃圾"}'
curl -s -X POST http://127.0.0.1:8788/api/records -H 'Content-Type: application/json' \
  -d '{"panText":"验证排盘2","tosses":[],"messages":[],"baseline":{"yongshen":"妻财 己卯","trend":"吉","window":null,"confidence":null,"spread":null}}'
```

**读取与降级验证**：

```bash
# 8) 详情接口：新行 baseline 应为对象；旧行应为 null
curl -s "http://127.0.0.1:8788/api/records?id=<第5步返回的id>"

# 9) 造一行「迁移前旧数据」（不带 baseline 列 → 天然 NULL，id 须过 ID_RE）
npx wrangler d1 execute liuyao-db --local --command="INSERT INTO casts (id, created_at, pan_text) VALUES ('legacy-baseline-null', '2026-01-01T00:00:00.000Z', '旧行排盘文本');"
curl -s "http://127.0.0.1:8788/api/records?id=legacy-baseline-null"   # baseline 应为 null，不报错
```

- 浏览器打开卦例库 → 点开旧行详情：应显示「此例无当时判据快照（保存于判据快照上线前）。」且页面零报错。
- 点开新行详情：对照区左栏应与排盘页 renderYingqi 显示的区间/置信逐字一致；右栏回填一条
  outcome（事之成败 + 应期 + 窗口）后两栏齐备。
- **隔离性回归**：回填 outcome 后再做一次追问（触发 autoSaveCast）→ 重新打开详情：
  outcome 仍在（ON CONFLICT 不含 outcome）、baseline 已刷新（含 baseline）——两清单互不包含的实测。

**回归测试**：

```bash
npm run test:fn    # 既有 180 项必须全过（已核对：INSERT 断言只禁 outcome 列，加 baseline 不冲突）
npm test           # 前端核心环 751 项不受影响（本方案不触 core/）
```

实施时建议在 `test-functions.mjs` 增补断言（属改代码，随实施提交）：
① 主 INSERT 的 SQL 含 `baseline` 列且不含 `outcome`；② ON CONFLICT 清单含 `baseline` 不含 `outcome`；
③ 非对象 baseline（字符串/数组）落库为 null；④ 合法 baseline 经 jsonWithin 落库可 parse；
⑤ 列表 SELECT 仍不含 baseline。

**已知环境注意**：`wrangler d1 execute --local` 与 `wrangler pages dev` 共享 `.wrangler/state`
的本地 D1（同 database_id）。若个别 wrangler 版本出现「execute 查不到 dev 写的行」，
先跑第 6) 步自证两侧命中同一库；确属分离时改用 `--persist-to` 指向同一目录，或在
pages dev 会话内用浏览器链路完成查询侧验证。

---

## 七、明确不做（本阶段边界）

- **不改 schema.sql 文件**：DDL 只存在于本方案与执行命令中；追加注释进 schema.sql 是后续独立小提交。
- **不动 outcome 口径**：白名单四值/三关校验/分桶统计/统计文案，全部原样。
- **不动置信度与窗口宽度的既有口径**：confidence 仍是盘面要素自洽度（高/中/低），
  spread 仍是 2/3 日工程约定；不引入百分比、不打分、不做「判据 vs 事实」的机器对错判定。
- **不做 Brier / I(Z;Y) 分析**：那是 optimization §四「建议的下一步 2/3」——攒 20 条带窗口
  回执之后的事，本方案只负责让样本带得上判据。
- **不做 readings 表 / 定时回访**（B 复盘闭环）：baseline 列是它的**前提**，不是它本身。
