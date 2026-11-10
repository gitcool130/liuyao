/* D1 真实 SQL 集成测试（2026-11-09）
 * 目的：test-functions.mjs 的 mkDb 是纯桩，schema/唯一索引/INSERT OR IGNORE
 * 语义从未被执行；本文件用 Node 内置 node:sqlite 跑真实 schema.sql，
 * 覆盖：
 *   ① 空库执行 schema.sql 后，casts 含 baseline 列、主 POST 可写入；
 *   ② readings 派生一次；dismiss 后再次保存不得重新排队（终态）；
 *   ③ 删除 cast 时同批删除 readings（若已实现）。
 *
 * Node 22.5+ / 24 提供 node:sqlite（实验 API）；CI 的 Node 22 若没有该模块
 * 则跳过（不让旧运行时把测试卡红），本地 Node 24 必须实跑。
 */
import { readFileSync } from 'node:fs';
import { onRequestPost as recordsPost, onRequestDelete as recordsDelete } from './functions/api/records.js';
import { onRequestPost as readingsPost } from './functions/api/readings.js';

let pass = 0, fail = 0;
function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + ' got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)); }
}

let DatabaseSync;
try { ({ DatabaseSync } = await import('node:sqlite')); }
catch (e) {
  console.log('SKIP: node:sqlite 不可用（' + (e && e.message) + '）');
  process.exit(0);
}

function makeD1(db) {
  return {
    prepare(sql) {
      let args = [];
      const api = {
        bind() { args = Array.prototype.slice.call(arguments); return api; },
        run() {
          const r = db.prepare(sql).run(...args);
          return { meta: { changes: Number(r.changes || 0) } };
        },
        first() { return db.prepare(sql).get(...args) || null; },
        all() { return { results: db.prepare(sql).all(...args) } }
      };
      return api;
    }
  };
}

const schema = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
const db = new DatabaseSync(':memory:');
db.exec(schema);

// ① schema 完整性
const cols = db.prepare('PRAGMA table_info(casts)').all().map(r => r.name);
eq('schema.sql 建出的 casts 含 baseline', cols.indexOf('baseline') >= 0, true);

const d1 = makeD1(db);
const env = { LIUYAO_DB: d1, LIB_CODE: 'k' };
const headers = { 'content-type': 'application/json', 'X-Access-Code': 'k' };
const BL = { yongshen: '妻财 妻财卯木', trend: '吉', confidence: '中', spread: 2,
  window: { status: 'ok', lo: 2, hi: 4, dayLo: '癸未', dayHi: '乙酉', text: '应期：出空之日' } };
const body = { panText: '排盘', tosses: [], messages: [], datetime: '2026-10-01 10:00:00', baseline: BL };

async function postCast() {
  return recordsPost({
    request: new Request('https://x/api/records', { method: 'POST', headers, body: JSON.stringify(body) }),
    env
  });
}
const r1 = await postCast();
eq('空库主 POST 成功', r1.status, 200);
const j1 = await r1.json();
eq('回执带 reading=10-06', j1.reading, '2026-10-06');
eq('readings 派生一行 pending', db.prepare("SELECT COUNT(*) AS n FROM readings WHERE status='pending'").get().n, 1);

// ② dismiss 后再次保存：终态不再排 pending
const castId = j1.id;
const rDis = await readingsPost({
  request: new Request('https://x/api/readings', { method: 'POST', headers, body: JSON.stringify({ cast_id: castId, action: 'dismissed' }) }),
  env
});
eq('dismiss 成功', rDis.status, 200);
body.id = castId;   // 同一卦例再次保存（前端 autoSaveCast 的更新语义）
const r2 = await postCast();
eq('dismiss 后再次保存仍成功', r2.status, 200);
const j2 = await r2.json();
eq('dismiss 后再次保存不新排 reading', j2.reading, null);
eq('dismissed 后 pending 行仍为 0', db.prepare("SELECT COUNT(*) AS n FROM readings WHERE status='pending'").get().n, 0);
eq('dismissed 行未被删除', db.prepare("SELECT COUNT(*) AS n FROM readings WHERE status='dismissed'").get().n, 1);

// ③ 删除 cast 同步清理 readings（P2-9）
const rDel = await recordsDelete({
  request: new Request('https://x/api/records?id=' + castId, { method: 'DELETE', headers }),
  env
});
eq('删除卦例成功', rDel.status, 200);
eq('删除卦例同步清掉 readings', db.prepare('SELECT COUNT(*) AS n FROM readings').get().n, 0);

console.log('PASS: ' + pass + '  FAIL: ' + fail);
process.exit(fail ? 1 : 0);
