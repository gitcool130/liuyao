-- 六爻卦例库 D1 数据库初始化
-- 执行：npx wrangler d1 execute liuyao-db --file=schema.sql
--
-- id 双层兜底：
--   ① 应用层：functions/api/records.js 校验客户端 id（^[A-Za-z0-9_-]{1,64}$），
--      非法或缺失一律 crypto.randomUUID() 生成（主路径）
--   ② DDL 层：本表 id 带 DEFAULT 表达式，即便有其它写入路径（D1 控制台、
--      临时脚本、外部集成）漏传 id，也不会落空主键
-- 注：SQLite 的 DEFAULT 表达式仅在新建表时生效；既有库需执行下方迁移语句。

CREATE TABLE IF NOT EXISTS casts (
  id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  created_at TEXT NOT NULL,
  datetime   TEXT,
  pillars    TEXT,
  question   TEXT,
  hex        TEXT,
  tosses     TEXT,   -- JSON：摇卦记录
  pan_text   TEXT,   -- 排盘文本
  messages   TEXT,   -- JSON：AI 断卦与进阶探讨对话历史
  outcome    TEXT    -- JSON：结果回执（M16/M17）{result, yingqi, window, note, updated_at}，未回填为 NULL
);

-- 既有库补加 outcome 列（SQLite 支持 ALTER TABLE ADD COLUMN，无需重建表）：
--   npx wrangler d1 execute liuyao-db --remote --command="ALTER TABLE casts ADD COLUMN outcome TEXT;"
-- outcome 取值口径（functions/api/records.js 的 sanitizeOutcome 白名单）：
--   result  ∈ success | fail | partial | unclear   （事之成败）
--   yingqi  ∈ on_time | missed | pending | unclear （应期是否按时应验）
--   window  ∈ d3 | d7 | d30 | d90                  （应验窗口分桶，M17 新增；可选）
--   note    ≤ 200 字自由备注；updated_at 由服务端写入
--   window 只用于**分桶统计**：3 日与 90 日不是同一套应期机制（短线靠日辰冲动/值日/出空，
--   长线靠月建旺衰/旬空填实/伏神出现），跨桶相加得到的「准确率」没有意义。

-- 既有库补加 baseline 列（M17-A：判据快照结构化，docs/proposal-baseline-column.md）：
--   npx wrangler d1 execute liuyao-db --local  --command="ALTER TABLE casts ADD COLUMN baseline TEXT;"
--   npx wrangler d1 execute liuyao-db --remote --command="ALTER TABLE casts ADD COLUMN baseline TEXT;"
-- 幂等：SQLite 不支持 ADD COLUMN IF NOT EXISTS，重复执行报 duplicate column name（无害但脏）。
--   执行前先查列，已含 baseline 即跳过；全新空库建表后同样补这条 ALTER
--   （CREATE TABLE IF NOT EXISTS 不会给既有表加列）：
--   npx wrangler d1 execute liuyao-db --local --command="PRAGMA table_info(casts);"
-- baseline 口径：JSON {yongshen, trend, window, confidence, spread}，断卦时刻判据的结构化
--   快照，随 recordPayload 与 pan_text 同批写入（单一事实源仍是 yingqi-window.js 的
--   换算结果，baseline 只是存档不是第二套口径）；缺失一律 null，未快照整列为 NULL。
--   confidence 是盘面要素自洽度（高/中/低）不是命中概率；spread（2/3 日）是工程约定。

CREATE INDEX IF NOT EXISTS idx_casts_created ON casts(created_at DESC);

-- 既有库补加默认值（SQLite 不支持 ALTER COLUMN，需重建表迁移）：
--   1) CREATE TABLE casts_new (... id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))), ...);
--   2) INSERT INTO casts_new SELECT * FROM casts;
--   3) DROP TABLE casts; ALTER TABLE casts_new RENAME TO casts;
--   4) CREATE INDEX idx_casts_created ON casts(created_at DESC);
-- 说明：本项目的写入路径始终由服务端生成/校验 id，既有库不迁移亦不影响正确性。

-- ============================================================
-- M18（任务⑦）：复盘闭环回访任务表 readings（docs/proposal-readings-loop.md §2.2）
-- 只存「哪条卦到该回头看的时间了」，不存回执与卦例正文；
-- 事实单一事实源仍是 casts.outcome / casts.baseline。
-- 派生规则（source='baseline_window'，本期唯一路径）：
--   读 casts.baseline，window.status='ok' 且 hi 为数字 →
--   due_at = casts.datetime（北京墙上日期）+ (hi + 1) 日，即应期窗口走完的次日；
--   baseline 缺失 / 解析失败 / window.status='blocked' → 一律不派生（不猜，宁缺勿造）。
-- 现有历史行（无 baseline 快照）不派生任务；人工回填走既有表单，不受影响。
-- ============================================================
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
-- acted/dismissed 是终态，同 cast 不再二次排队（重新占问同一事是新的 cast_id）。
CREATE UNIQUE INDEX IF NOT EXISTS idx_readings_open ON readings(cast_id)
  WHERE status = 'pending';
