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
  outcome    TEXT    -- JSON：结果回执（M16）{result, yingqi, note, updated_at}，未回填为 NULL
);

-- 既有库补加 outcome 列（SQLite 支持 ALTER TABLE ADD COLUMN，无需重建表）：
--   npx wrangler d1 execute liuyao-db --remote --command="ALTER TABLE casts ADD COLUMN outcome TEXT;"
-- outcome 取值口径（functions/api/records.js 的 sanitizeOutcome 白名单）：
--   result  ∈ success | fail | partial | unclear   （事之成败）
--   yingqi  ∈ on_time | missed | pending | unclear （应期是否按时应验）
--   note    ≤ 200 字自由备注；updated_at 由服务端写入

CREATE INDEX IF NOT EXISTS idx_casts_created ON casts(created_at DESC);

-- 既有库补加默认值（SQLite 不支持 ALTER COLUMN，需重建表迁移）：
--   1) CREATE TABLE casts_new (... id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))), ...);
--   2) INSERT INTO casts_new SELECT * FROM casts;
--   3) DROP TABLE casts; ALTER TABLE casts_new RENAME TO casts;
--   4) CREATE INDEX idx_casts_created ON casts(created_at DESC);
-- 说明：本项目的写入路径始终由服务端生成/校验 id，既有库不迁移亦不影响正确性。
