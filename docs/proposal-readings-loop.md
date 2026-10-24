# 复盘闭环：readings 回访任务表 —— 实施方案（任务三阶段一）

> 对应 `docs/optimization-2026-10-24.md` §四 B 项（blog 四·B「复盘闭环」）。
> 本阶段只出方案，不改任何代码；`schema.sql`、`functions/` 现有文件全部只读。
> 实施阶段（阶段二）在方案人工审定后进行，硬约束沿用 planning 文件任务一实施阶段第 1-4 条，
> 另加：schema 变更向后兼容（新表/加列）、迁移幂等、D1 改动先给本地验证步骤（本文 §七）。

---

## 〇、一句话定位

readings 表不存回执、不存卦例正文，**只存「哪条卦到该回头看的时间了」**这一件事：
事实的单一事实源仍是 `casts.outcome`（回执）与 `casts.baseline`（判据快照），
readings 是它们的调度层——到期视图 + 状态机（待回访 → 已回填/不再提醒），
帮 `TODO.md` P0-2「回填 3 条样本」这个**使用期动作**提高完成率，不改变其口径。

## 一、现状锚点（实施前核对用）

| 事实 | 位置 |
|---|---|
| `casts` 表 11 列，`outcome`（M16 回执 JSON）与 `baseline`（M17-A 判据快照）均已存在 | `schema.sql:11-22`，交接快照：remote ALTER 已执行、PRAGMA 复验 11 列 |
| baseline JSON `{yongshen, trend, window, confidence, spread}`；`window.status='ok'` 时含 `lo/hi/dayLo/dayHi/dateLo/dateHi/text`，blocked 时含 `blockedBy/text` | `public/app.js:1732-1756`（baselineSnapshot），`public/core/yingqi-window.js:223-289`（lo=main.d、hi=lo+spread） |
| 回执回填端点 `POST /api/records?outcome=1` 只写 outcome 列，白名单 `sanitizeOutcome` 三态 | `functions/api/records.js:161-191` |
| 回填表单四控件：result / yingqi / window（d3/d7/d30/d90）/ note | `public/app.js:2089-2101` |
| 分桶统计按窗口分行报、不可相加 | `public/app.js:1913-1957`（renderLibStats） |
| D1 现状 14 条卦例、回填 0 条 | `docs/TODO.md` P0-2 查询结果 |
| Pages Functions 无定时能力，Cron Trigger 是 Workers 功能 | 见 §三来源 |
| `wrangler.toml` 无任何 `[triggers]`/cron 配置（Pages 项目） | `wrangler.toml` 全文 |
| test:fn 当前 233 项全绿；D1 测试桩 `mkDb()` 记录 SQL 与绑定参数 | 交接快照；`test-functions.mjs:111-152` |

## 二、问题 1：readings 表——**并存，不迁移**

### 2.1 为什么不迁移 outcome

- `outcome` 是事实回执，M16 全链路（列表下发、徽标、统计、baseline 对照）都读它；
  迁移成表 = 重写全部读取路径，收益为零。
- 两者关注点不同：回执是**终态事实**（写定后只有清除），回访任务是**有状态流转的调度**
  （pending → acted/dismissed）。混在 casts 里就得再给 casts 加列，加一次少一次干净边界。
- 通用红线要求向后兼容（禁删列改名）：新表是唯一零风险路径。

### 2.2 DDL 草案（追加到 schema.sql 末尾，三处均 IF NOT EXISTS → 幂等）

```sql
-- M18（任务三）：复盘闭环回访任务表。只存「哪条卦该回头看」，不存回执与正文；
-- 事实单一事实源仍是 casts.outcome / casts.baseline。
-- 派生规则（source='baseline_window'，本期唯一路径）：
--   读 casts.baseline，window.status='ok' 且 hi 为数字 →
--   due_at = casts.datetime（北京墙上日期）+ (hi + 1) 日，即应期窗口走完的次日；
--   baseline 缺失 / 解析失败 / window.status='blocked' → 一律不派生（不猜，宁缺勿造）。
-- 现有历史行（无 baseline 快照）不派生任务；人工回填走既有表单，不受影响。
CREATE TABLE IF NOT EXISTS readings (
  id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  cast_id    TEXT NOT NULL,              -- 引用 casts.id（不设外键：casts 删除后任务成孤儿，
                                         -- 读路径 JOIN 不中即自动不显示，无需级联）
  due_at     TEXT NOT NULL,              -- 北京日历日 'YYYY-MM-DD'（粒度=日；与全仓北京墙上
                                         -- 时间锚点同口径，字典序即时间序）
  status     TEXT NOT NULL DEFAULT 'pending',  -- pending | acted | dismissed
  source     TEXT NOT NULL DEFAULT 'baseline_window',
  note       TEXT,                       -- 派生时的判据摘要（预判桶位等），只读展示，非事实
  created_at TEXT NOT NULL,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_readings_due ON readings(status, due_at);
-- 部分唯一索引：一条卦例同一时刻最多一个未完结任务。
-- 派生写入用 INSERT OR IGNORE——重复执行不报错、不产重复行（幂等的库侧保证）。
-- 部分唯一索引最终口径：仅约束 pending。acted/dismissed 是终态，同 cast 不再二次排队
-- （重新占问同一事是新的 cast_id，不走旧任务；要再看一眼走详情页）。
CREATE UNIQUE INDEX IF NOT EXISTS idx_readings_open ON readings(cast_id)
  WHERE status = 'pending';
```

- **不加 channel 列**：in_app 是本期唯一通道，将来真做通知再加列（与 outcome/baseline
  同款 `ALTER TABLE ADD COLUMN` 路径，向后兼容），不为想象中的需求预付 schema。

### 2.3 数据迁移策略：无迁移，只有派生

- 现有 14 条卦例**全部无 baseline**（M17-A 部署前入库）→ 无派生依据 → 不派生任何任务，
  旧数据零触碰。这正是「向后兼容」的全量含义。
- 派生时机：主 POST 写入 baseline 的同一批次（D1 `batch`，见 §六），失败不回滚卦例本体
  （任务丢了可重派：`INSERT OR IGNORE` 幂等；卦例不能因派生失败而丢）。
- 无 seed 脚本、无一次性 UPDATE——重复执行任何迁移语句都不产生脏数据（红线要求）。

## 三、问题 2：定时回访在 Cloudflare 上的实现选项与配额

### 3.1 选项清单

| 选项 | 形态 | 结论 |
|---|---|---|
| A. 独立 Worker + Cron Trigger | 新 Worker，`scheduled()` 每日扫 readings 推通知 | 登记为升级路径，**本期不做**（见 3.2） |
| B. **惰性回访（本期实施）** | 打开卦例库时前端并行请求 `GET /api/readings`，库顶展示到期任务；回填成功自动置 acted | **采用**：零新组件、零运维面、无主动通知能力但也不需要 |
| C. Queues / Workflows | 消息队列/编排做延时任务 | 明确不做：为 14 条卦例引入新配额面与新故障面，比例失当 |
| D. Email / push 通知 | 第三方邮件服务或推送 | 明确不做：无用户标识可投递（§五），需验证域名、扩运维面；`channel` 列都不加，届时随需求一起过评审 |

### 3.2 为什么惰性回访够用（对 optimization「留存率风险前提」的正面回应）

- optimization §四 B 项原话：「独立表要先有『回访留存率』这个风险前提被验证」。
  惰性回访就是验证手段本身：**零成本**跑通闭环，先攒「打开页面的人是否回去回填」的
  真实行为数据；留存被验证、真需要离线推送时，再上选项 A——届时 readings 表结构
  不用改（只需新增 Worker 消费同一张表）。
- 技术事实：Pages Functions 不支持 `scheduled()`/Cron Trigger，定时必须独立 Worker
  （Cloudflare 官方文档将 Cron Trigger 归于 Workers；社区确认「Pages Functions 无此支持，
  需用 Workers」——来源见文末）。也就是说选 A 必然多一个部署单元与一个配额面，
  而它换来的「主动推送」在无用户标识（§五）下并没有投递目标。

### 3.3 配额与成本数字（全部有来源，见文末来源表）

- D1 Free：每天 500 万行读、10 万行写、单库 500 MB、每账号 5 GB；**2026-09-01 起超限
  即查询失败**（不再是软限制）。
- 本方案的增量读写：每次打开卦例库多 1 条带索引的 SELECT（`idx_readings_due`，
  个人库规模=个位数行）；每次回填成功多 1 条 UPDATE（命中 ≤1 行）。远低于配额，
  且与「不限流」现状（`wrangler.toml:73-79`）不构成新敞口。
- 若走选项 A：Free 计划每账号 5 个 Cron Trigger、每次调用 CPU 上限 10 ms——够用，
  但它解决的「主动通知」在无标识前提下无意义，故仅为登记。

## 四、问题 3：与应期窗口四档分桶的衔接

- **到期判定**读 `baseline.window`（判据快照，断卦时存档）：`hi` 走完的次日为回访日
  （`hi = lo + spread`，spread 2–3 日是既有工程约定，本方案原样引用，**不新增窗口口径**）。
- **预判桶位**（仅展示用）：按 `hi` 落段映射——≤3 → d3，4–7 → d7，8–30 → d30，
  \>30 → d90。写进 `readings.note`，回访提示里显示「当时判据预计结果落在 N 日内」，
  帮用户回填时选对桶。
- **口径红线（实施必须原样保住）**：预判桶位只用于展示与提醒，**绝不预填、绝不替换**
  用户回填的 `outcome.window`——真正进哪个桶以 `sanitizeOutcome` 白名单校验后的回执为
  唯一事实源。统计聚合仍走现有 `renderLibStats`（分桶分行、跨桶不可相加、样本不足
  明示），回访机制不新增任何统计口径。
- blocked / 无判据的卦不派生任务，因此「拒答盘」（真空/真月破/无用神）不会被回访
  骚扰——与 yingqi-window 的拒答口径（文本不得出现「近期」）同构：没有判据就没有
  可核对的对象，也就没有回访。

## 五、问题 4：隐私与合规最小化

- 本项目**无账号体系**：无用户标识、无邮箱、无推送 token。回访通知=in_app 提示，
  天然不引入任何 PII；这是选惰性回访的合规面理由，不只是成本理由。
- readings 表不复制卦例正文：不含 `question`/`pan_text`/`messages`，`note` 只存
  派生摘要（当时应期窗口文本——它是规则引擎的确定性输出，属公共事实，非 AI 断语；
  与「分享码不存断语」红线同向：存判据、不存断语）。
- 访问控制：`GET /api/readings`、`POST /api/readings` 一律挂 `requireCode`（LIB_CODE），
  与卦例库读写同源同实现（`functions/api/_lib.js`），不存在匿名回访接口。
- 未来若真做离线通知，必须先过「回访后自愿留下联系方式」的 P0 隐私评审——此处登记，
  本期不做。

## 六、实施阶段将触碰的文件清单（本阶段不实施）

| 文件 | 改动 | 约束 |
|---|---|---|
| `schema.sql` | 末尾追加 readings 建表段（§2.2 修正口径） | 只追加；三处 IF NOT EXISTS；幂等 |
| `functions/api/records.js` | 主 POST 落库成功后追加派生写入（`INSERT OR IGNORE`，与主写入同批或紧随其后）；`handleOutcome` 成功分支追加一行 `UPDATE readings SET status='acted' ... WHERE cast_id=? AND status='pending'` | 不重写现有函数、不改 panText/messages/outcome 既有行为；派生失败不阻断主流程 |
| `functions/api/readings.js`（新建） | GET：到期任务视图（JOIN casts 只取 question/hex/baseline 三列 + readings 自身字段）；POST：`{cast_id, action:'dismissed'}` 白名单单值 | 口令闸与 records 同源；SQL 禁 `SELECT *`（防正文泄漏） |
| `public/app.js` | 卦例库顶部新增「回访」区块（到期任务计数 → 展开 → 去回填/不再提醒）；回填成功后刷新回访计数 | 禁改排盘与断语输出；文案红线见下 |
| `test-functions.mjs` | 新增 readings 组（复用 `mkDb()` 桩模式） | 现有断言零改动 |

**前端文案红线**（验收逐条对照）：不出现「准确率/命中率/说对说错」类词；回访提示只说
「已到回访期，请回填结果与应验情况」；预判桶位必须带「当时判据预计」前缀，与回填值
区分；置信度徽标沿用 baselineCmpHTML 的现有口径文案（自洽度、非概率）。

## 七、本地 wrangler 验证步骤（D1 改动的验证，实施阶段执行）

> 环境备注（2026-10-24，本机实测）：本机 `node`/`npx` 不在 PATH（仅
> `%TEMP%\node-v22.20.0-win-x64` 临时解包一份 v22.20.0），`node_modules` 无 wrangler
> （`.gitignore` 已排除 `.wrangler/`，本地 D1 状态文件随快照带来了）。
> 执行本节前需先恢复 Node ≥20 环境（`package.json` engines 要求）并 `npm install`；
> 这属于实施阶段前置，不阻塞本方案评审。

```bash
npm install
# 1) 建表——重复执行第二遍验证幂等（IF NOT EXISTS，不报错不加行）
npx wrangler d1 execute liuyao-db --local --file=schema.sql
npx wrangler d1 execute liuyao-db --local --file=schema.sql
# 2) 验结构与索引
npx wrangler d1 execute liuyao-db --local --command="PRAGMA table_info(readings);"
npx wrangler d1 execute liuyao-db --local --command="SELECT name, sql FROM sqlite_master WHERE tbl_name='readings' AND type='index';"
# 3) 起本地 Pages（与本地 D1 共享 .wrangler/state）
npx wrangler pages dev public
# 4) 造数：带窗口 baseline 的卦例（占问日取过去，使 hi+1 已到期）
curl -s -X POST http://127.0.0.1:8788/api/records -H 'Content-Type: application/json' \
  -d '{"panText":"排盘","tosses":[],"messages":[],
       "baseline":{"yongshen":"妻财 妻财卯木","trend":"","confidence":"中","spread":2,
         "window":{"status":"ok","lo":2,"hi":4,"dayLo":"癸未","dayHi":"乙酉","text":"应期：…"}}}'
# 5) 回访视图应出现该任务（本地未设 LIB_CODE → 开放分支）
curl -s http://127.0.0.1:8788/api/readings
# 6) 幂等复跑第 4) 步同 id，任务数恒为 1：
npx wrangler d1 execute liuyao-db --local --command="SELECT COUNT(*) FROM readings WHERE cast_id='<该id>';"
# 7) 回填闭环：回执成功后任务应变为 acted（视图中消失）
curl -s -X POST 'http://127.0.0.1:8788/api/records?outcome=1' -H 'Content-Type: application/json' \
  -d '{"id":"<该id>","outcome":{"result":"success","yingqi":"on_time","window":"d3"}}'
curl -s http://127.0.0.1:8788/api/readings   # 应不含 <该id>
# 8) blocked baseline 不派生：造一条 window.status='blocked' 的卦例，/api/readings 不出现
# 9) 四件套全绿（数字以实际运行为准）：npm test（751）· npm run test:fn（233+新增组）
#    · node tests/guji/run.mjs（12144）· npm run test:ui（62）
```

**Remote DDL（人工步骤，ZCode 不执行、禁部署红线不破）**：交接快照已警示本轮实施含
remote 建表。步骤与 baseline 列同款：`--remote` 先 `PRAGMA table_info` 确认 readings
不存在 → `--file=schema.sql`（对 remote 是幂等建表）→ 复验 `PRAGMA table_list`。
需要 CF 凭据，由人工执行。

## 八、与既有文档口径的核对（无冲突，显式交代承接关系）

- `optimization-2026-10-24.md` §四 B 项原「不做」理由是「回访留存率风险前提未验证」——
  本方案以惰性回访（零成本）作为该前提的验证手段，属承接而非翻案；表中该行标注的
  前置（`casts` 加 baseline 列）已由 M17-A 完成。
- `TODO.md`「攒回执样本是使用期动作而非工程任务」口径不变：readings 只提高该动作的
  完成率，不代答、不代填。
- P2 三件（分桶样本、取用神两派并置、规则库外化）本方案零触碰。
- 已知边界三条逐条核对：① spread 2–3 日原样引用不新增口径（§四）；② 置信度=自洽度
  非概率，文案红线固化在 §六；③ 分享码不存断语与本方案无交集，但 readings.note
  同向只存判据不存断语（§五）。

## 附：本文引用的数字与来源

| 数字 | 来源 |
|---|---|
| D1 Free：5M 行读/日、100k 行写/日、500 MB 单库、5 GB 账号；2026-09-01 起超限失败 | Cloudflare D1 官方文档 Limits / Pricing；官方 changelog《D1 free-tier limit enforcement》（2026-09-01） |
| Cron Trigger：Free 每账号 5 个、Paid 250；Free CPU 10 ms/次 | Cloudflare Workers 官方文档 Limits（Workers limits 页） |
| Pages Functions 无 Cron/scheduled 支持，需独立 Worker | Cloudflare 官方文档将 Cron Trigger 归于 Workers；Cloudflare 官方社区回帖「Unfortunately not… You will need to use Workers」（community.cloudflare.com 两个主题） |
| casts 11 列、baseline remote 已执行、test:fn 233 全绿 | `docs/planning/交接-2026-10-24晚.md` |
| D1 现状 14 条卦例、回填 0 条 | `docs/TODO.md` P0-2（2026-10-21 快照） |
| 12144 断言 / 404 例 / spread 2–3 / d3–d90 四档 | `tests/guji/run.mjs` 既有口径；`public/core/yingqi-window.js:36`（SPREAD）；`functions/api/records.js:159`（OUTCOME_WINDOWS） |
