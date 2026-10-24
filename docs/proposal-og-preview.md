# 按盘 OG 预览方案（M17-B 阶段一 · proposal）

对应 `optimization-2026-10-24.md` §四「按盘 OG 预览图」项（P1-2）。本文只做两件事：

1. **记录打包边界确认实验的结论与证据**（第一步，只读实验，已完成）；
2. **给出按盘 OG 预览的设计**（本文档本身是唯一产出；不实施、不改 `functions/` 与 `public/` 任何现有文件）。

**结论先说**：

- 实验结论是**可行，无待核实项**：CF Pages 对 Functions 的打包（esbuild）会跟随
  `functions/` 内 import 跨入 `public/`，把 `public/core/share.js` 等文件作为**模块源码**
  织入 Worker bundle；且已在本地 workerd 运行时跑通 `decodeCast → fourPillars → paipan`
  全链路（§一）。
- 方案核心是**单一实现留在 `public/core/share.js`（零改动），`functions/api/_share.js`
  只做零逻辑门面**；OG 注入放在新增 `functions/index.js`，按 `?s=` 改写 og meta；
  畸形码原样回落站点默认 meta；不做 UA 分流、不做 og:image（§二–§四）。

---

## 一、第一步：打包边界确认实验（只读，已完成）

### 问题

`functions/api/` 内 `import '../public/core/share.js'`（从 `functions/api/` 实为
`'../../public/core/share.js'`）是否可行 / 会被打包？

### 结论

**会。** Pages Functions 的打包单位是「`functions/` 下每个路由文件为入口的 esbuild
依赖闭包」，入口的相对 import 指向哪里就织入哪里，与 `pages_build_output_dir`
无交集——后者只决定**静态资产**的上传范围（`wrangler.toml:11` 注释的隔离设计不受影响：
`public/core/share.js` 被 import 时进入 Worker bundle 的是模块代码，资产侧行为不变）。

### 方法

- 环境：wrangler 4.152.0（`npx --yes wrangler`，本机 Node v22.20.0）。
- scratch 目录复刻仓库关键面（仓库文件**只读复制**，未动仓库一个字节）：
  `wrangler.toml`（`pages_build_output_dir = "public"`、`compatibility_date = "2026-09-24"`，
  与线上同参）+ `public/core/{data,data-jieqi,calendar,paipan,share}.js`（仓库原件拷贝）。
- `functions/api/probe.js` 以 `'../../public/core/*.js'` 五连 import，onRequestGet 里执行
  解码与排盘；`functions/api/_probe.js` 只导出普通函数，验证下划线不成路由。

### 证据（四项）

| # | 验证点 | 结果 |
|---|---|---|
| 1 | `npx wrangler pages functions build` 产物含跨目录内容 | 产物 `dist/index.js`（69 KB）中 `encodeCast`×4、`BASE_JDN`×3、`fourPillars`×7、`nightZiMode`×3、`paipan`×8 —— 五个 public/core 文件全部织入 |
| 2 | 路由清单不含下划线文件 | 产物内 `routes` 数组仅注册 `/api/probe`；`_probe.js` 未成路由（与 `_lib.js` 在生产的既有先例一致） |
| 3 | workerd 运行时全链路 | `npx wrangler pages dev public` 后 `curl /api/probe` 返回：`window` 为 `undefined`（IIFE 落到 `globalThis`，share.js:182 的根选择正确）；`decodeCast` 解出 wall/vals/use/question 原文；`fourPillars` 得 `丙午年/戊戌月/辛未日/壬辰时/旬空戌亥`；`paipan` 得 `风火家人/天雷无妄` —— 与浏览器端和 `test-share.js` 的期望同构 |
| 4 | OG 注入机制本体 | 新增 `functions/index.js`（onRequestGet）+ `context.env.ASSETS.fetch` 取原始 HTML + 锚点替换：`/?s=<合法码>` 返回按盘 og:title/og:description/`<title>`；`/?s=<畸形码>` 与 `/` 返回未改写的默认 meta（200） |

实验中的完整命令与探针源码见附录 A。一个**已知的本地产物差异**顺带记录：
`pages dev` 下未命中资产回退为「200 + index.html」（SPA 式），线上 CF Pages 对不存在
资产是 404——此差异不影响上述任何结论（下划线不路由的判据是路由清单，不是状态码）。

### 对 CI 门禁的影响核对

| CI 步骤（ci.yml） | 影响 |
|---|---|
| `node --check` 浏览器脚本 ×14 | 无（public/ 零改动） |
| Functions ESM 动态 import 解析（`['_lib','interpret','models','records']`） | **需扩**：加入 `./functions/index.js` 与 `_share`（§五落地清单） |
| index.html 脚本加载顺序断言 | 无（不加、不删、不换序 script 标签） |
| 部署隔离断言（public/ 内无源码配置测试） | 无（public/ 零新增文件） |

---

## 二、问题 1：单一实现的归属与导入方式

### 归属决策：实现留在 `public/core/share.js`，`functions/api/_share.js` 是门面

优化文档 §四的原表述是「把 share 码解析抽成 `functions/api/_share.js` 单一实现，再由
浏览器端复用（需改打包边界）」。实验结果让这句话有了更优的字面落点——**复用方向反转**：

- 若把实现**物理搬进** `functions/api/_share.js`，浏览器端复用只剩两条路，都更差：
  (a) 部署期把 `_share.js` 复制一份进 `public/`——凭空多一个复制步骤和一个可被手改的
  副本，漂移风险回来了（还要加 CI 字节比对来防守）；(b) 经 Function 端点回源模块文本
  ——自噬结构，直接否决。
- 实验证明 `functions/ → public/` 的 import 边界天然可用，那么**实现留在原地
  （浏览器零改动，script 标签、加载顺序、全局 `LY` 命名空间全不动），Worker 经打包边界
  把它拉进 bundle**。「打包边界」的改动量最小：不新增构建步骤、不改部署流水线、
  不改 `public/` 任何字节。

故「单一实现」的物理位置仍是 `public/core/share.js` 一份；`functions/api/_share.js`
（下划线 = 非路由，与 `_lib.js` 同规）是**零逻辑门面**：

```js
/* functions/api/_share.js —— Worker 侧门面，不含任何解码逻辑。
 * 顺序不可换：share.js 在模块求值期就要读 LY.jdn 算 BASE_JDN（share.js:42），
 * 且 decodeCast 依赖 LY.jdnToDate；calendar 必须先于 share 执行。
 * data/data-jieqi 是 calendar 的节气表依赖，paipan 供 OG 组卦名（见 §四）。
 * 红线：禁止在此 import analyze / yingqi-window / sensitive 等断语层模块。
 */
import '../../public/core/data.js';
import '../../public/core/data-jieqi.js';
import '../../public/core/calendar.js';
import '../../public/core/paipan.js';
import '../../public/core/share.js';

const LY = () => globalThis.LY;   // 运行时取引用，不在顶层解构（share 是挂全局，非 ESM 导出）
export const decodeCast = (s) => LY().decodeCast(s);
export const dateOfWall = (w) => LY().dateOfWall(w);
export const fourPillars = (dt) => LY().fourPillars(dt);
export const paipan = (vals, dt) => LY().paipan(vals, dt);
```

两侧的引用方式：

| 侧 | 引用方式 | 改动 |
|---|---|---|
| 浏览器（public/ 打包侧） | `<script src="core/share.js?v=…">`，读 `window.LY`——现状原样 | **零** |
| Worker（Functions 侧） | `import { decodeCast, … } from './_share.js'`（esbuild 织入 public/core 五文件） | 新增门面一个文件 |

### 单一实现的防漂移不变量

1. 物理实现全仓仍只此一份：门面里没有任何编码/解码/校验逻辑，只有 import 与转发。
2. 存量 `test-share.js` 46 项继续钉住实现本身。
3. 新增断言（进 `test-functions.mjs`）：Node 里
   `import('./functions/api/_share.js')` 后取到的 `decodeCast` 与
   `require('./core.js')` 的 `globalThis.LY.decodeCast` **是同一函数引用**
   （Node ESM import CJS 语义下两侧共享同一 globalThis，严格相等可断言）——
   它红掉即意味着有人在门面里私藏了第二份实现。

### 风险预案（登记，本期不做）

该结论依赖「Functions 目录模式 + wrangler/esbuild 打包」这一现有部署形态
（direct upload 与 Git 集成构建同引擎，均成立）。若未来 public/ 与 functions/ 分仓，
边界失效，届时回落到「实现搬 functions/ + 部署期同步复制 + CI 字节比对」方案。

---

## 三、问题 2：OG 预览的实现位置与本期范围

### 位置：新增 `functions/index.js`（Pages Function，路由 `/`），服务端按 `?s=` 注入

不做静态 meta（静态拿不到 `?s=`，做不到按盘）；也不做 SPA 客户端改 meta
（`public/index.html:6-10` 的注释已写明：抓取器不执行 JS，客户端改 meta 对预览无效）。
流程：

```
GET /（onRequestGet）
 ├─ URL 无 s 参数            → return context.next()（直达资产层，零开销）
 ├─ s 为空串                  → 同上（app.js 侧重新起卦后清参，本就是无码态）
 ├─ decodeCast(s) → ok:false  → 原样返回资产 HTML（站点默认 meta，HTTP 200）
 └─ ok:true
     ├─ dateOfWall → fourPillars → paipan（确定性重算，无任何模型参与）
     ├─ 组装 og 文案（§四红线）→ 对 head 做锚点式替换（og:title / og:description / <title>）
     └─ 响应头：保留 Content-Type，删 etag / last-modified（体已改写，原 ETag 必失配），
        设 Cache-Control: public, max-age=300（同码同 HTML，确定性输出，可安全短缓存）
```

锚点替换是**全或无**：四个锚点中任一正则未命中（如 index.html 结构变更）→ 放弃改写、
回退原样并 `console.warn`——宁可没有按盘预览，不可把页面改坏。锚点正则作为契约进测试。

### 抓取器差异：本期一律不处理，理由与边界

微信（聊天卡片）、Telegram、Twitter/X、Discord、Slack、iMessage 的链接抓取器行为
同构：**无 JS 的 GET + 读 og:/twitter: meta**。服务端注入对全部生效，因此：

- **不做 UA 分流**。UA 白名单是被维护负担，且漏登一个抓取器就退化成默认卡；
  无分流时浏览器侧多付一次亚毫秒级解码，换来「抓取器与浏览器见到同一 HTML」的
  简单不变量。`twitter:card` 保持既有的 `summary`（无图即文本卡，不必动）。
- 已知平台差异登记但不入本期：微信对任意站点的 og:image 缩略策略（需公众号 JSSDK
  签名端点）、Twitter 大图卡需绝对 URL 的 og:image——本期无图，全部天然规避。

### 本期明确不做

og:image / og:video（动态出图需 Worker 端 SVG→PNG，workerd 无 canvas；预生成
64 卦 × 节令组合不现实）、微信 JSSDK、按 UA 的 HTML 变体、`_middleware` 全站拦截、
og:url / canonical 注入（保持现状：各平台对缺省 og:url 回退请求 URL 本身，行为可接受；
不给带参 URL 造 canonical，避免与站点根的 SEO 纠缠）。

---

## 四、问题 3 + 4：内容红线与畸形降级

### 红线：og 文案只含「种子 + 确定性重算」的公共事实

| 字段 | 内容 | 来源 |
|---|---|---|
| og:title | `{本卦} 之 {变卦} · {年柱}年 {月柱}月 {日柱}日 {时柱}时`；静卦（无 9/6 爻）按站内口径写 `{本卦}（静卦）` | paipan + fourPillars |
| og:description | `所测：{question|（未注明）}；用神：{六亲|未取}；起卦于 YYYY-M-D HH:mm（北京时间）` | decodeCast 直出 |
| 不变项 | og:type / og:site_name / twitter:card 沿用站点默认 | index.html 既有 |

标题格式与 `app.js:1737`（`pan.benName + (pan.hasBian ? ' 之 ' + pan.bianName : '（静卦）')`）
同口径，预览卡与站内呈现不说两套话。

**断语零通道，且是物理性的**：分享码不存断语是刻意设计（盘面是公共事实，断语不是，
见 `share.js:1-23` 头注与 optimization §二.1），OG 端点的 import 白名单封闭为
`data / data-jieqi / calendar / paipan / share` 五个确定性模块——analyze（断语规则链）、
yingqi-window（置信度与下调原因属判读性陈述）、sensitive / domain-methods /
question-shape / fact-audit 全部不在清单内。「无法 import」比「约定不 import」强。
页面上既有提示语「断语不在链接里，需重新断卦」（`app.js:2134`）——OG 卡同样
不得暗示链接里有结论；og:description 里唯一的话术性成分是所测之事原文（用户自己写的）。

**转义与长度**：question 是用户输入进入 HTML 属性，统一走 esc（`& " < >`）+
控制字符折叠为空格；decode 已 `slice(0, 60)`，og:description 总长再兜底 ≤ 200 字符。
og:title 各分量来自封闭枚举（卦名表 / 干支表），仍统一过 esc。

### 畸形码降级：全或无，不产「半个盘」

- `decodeCast` 返回 `{ok:false, reason}` → 返回**未改写的**资产 HTML（默认 meta，
  HTTP 200）。与页面行为对齐：app.js 同样不炸，走「已按空白起卦 + 黄条提示」
  （`app.js:2103-2105`）。绝不 404、绝不输出只解出一半的文案。
- decode 成功但后续任何一步抛错（理论不可能——封闭枚举输入）→ try/catch 兜底
  同样回退未改写 HTML + `console.warn`（`wrangler tail` 可观测）。
- 结构保证：改写在内存字符串上完成后一次性输出；不存在「部分替换落盘」的路径。
- 超长参数：decode 侧已有 420 字符上限与全串正则（`share.js:44-51`），OG 端点
  无需第二道闸（也不再自造一套校验——那等于第二份实现）。

---

## 五、落地清单（实施阶段引用，本期不实施）

1. 新增 `functions/api/_share.js`（门面，§二源码）。
2. 新增 `functions/index.js`（OG 注入，§三流程 + §四红线）。
3. `test-functions.mjs` 增组：合法码四锚点改写、静卦标题口径、畸形码原样回落、
   空参直通、question 含 `"><` 时属性完整（转义）、门面与 `core.js` 的
   `decodeCast` 同一引用断言。
4. `ci.yml` Functions ESM 探测列表加 `./functions/index.js` 与 `_share`。
5. 届时改写 `index.html:6-10` 注释（「本轮未做」→ 指向本方案）与
   `optimization-2026-10-24.md` §四对应行；README M 表 + CHANGELOG 随实施补。
6. 部署判据：新增 Function 属产物变更，按 README 判据需 `wrangler pages deploy`；
   无新 secret、无新绑定（`ASSETS` 是 Pages Functions 自动绑定，不需配置）。

---

## 附录 A：实验复现命令（scratch，仓库只读）

```bash
# 目录：任意 scratch（本实验未写入仓库任何文件）
mkdir -p og-exp/public/core og-exp/functions/api && cd og-exp
cp <repo>/public/core/{data,data-jieqi,calendar,paipan,share}.js public/core/
printf '<!DOCTYPE html>...' > public/index.html          # 或拷仓库 head 段
cat > wrangler.toml <<'EOF'
name = "liuyao-og-exp"
compatibility_date = "2026-09-24"
pages_build_output_dir = "public"
EOF
# ① 生成合法分享码（用仓库自己的装载器，保证口径一致）
node -e "const C=require('<repo>/core.js');const D=new Date(2026,9,24,8,30);
D.__wall={y:2026,m:10,d:24,h:8,min:30};
console.log(C.encodeCast({time:D,vals:[1,0,9,6,1,1],use:'妻财',question:'这个项目能不能成'}))"
# ② functions/api/probe.js：import '../../public/core/{...}.js' ×5，onRequestGet 内
#    decodeCast→dateOfWall→fourPillars→paipan 并 Response.json 回显
# ③ 构建产物检查：跨目录内容是否织入 + 路由清单
npx wrangler pages functions build --outdir=dist-fn
grep -c encodeCast dist-fn/index.js && grep -n "routePath" dist-fn/index.js
# ④ 运行时验证（workerd）
npx wrangler pages dev public --port 8791 &
curl -s http://127.0.0.1:8791/api/probe
# ⑤ OG 机制验证：functions/index.js + env.ASSETS.fetch + 锚点替换（§三流程的探针版）
curl -s "http://127.0.0.1:8791/?s=<①的码>" | grep -E "og:title|og:description|<title>"
curl -s "http://127.0.0.1:8791/?s=999.zzzz.!!!!"  | grep -E "og:title|<title>"   # 默认 meta 原样
```

实测关键输出（④）：

```json
{"hasLY":true,"jdn":"function","jdnToDate":"function","fourPillars":"function",
 "decodeCast":"function","encodeCast":"function","windowType":"undefined",
 "decode":{"wall":{"y":2026,"m":10,"d":24,"h":8,"min":30},"vals":[1,0,9,6,1,1],
 "use":"妻财","question":"这个项目能不能成"},
 "pillars":{"yearGZ":"丙午","monthGZ":"戊戌","dayGZ":"辛未","hourGZ":"壬辰","kongStr":"戌亥",...},
 "gua":{"ben":"风火家人","bian":"天雷无妄"}}
```

实测关键输出（⑤）：

```html
<meta property="og:title" content="风火家人 之 天雷无妄 · 丙午年 戊戌月 辛未日 壬辰时">
<meta property="og:description" content="所测：这个项目能不能成；用神：妻财；起卦于 2026-10-24 8:30（北京时间）">
<title>风火家人 之 天雷无妄 · 丙午年 戊戌月 辛未日 壬辰时</title>
```
