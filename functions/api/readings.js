/* Cloudflare Pages Function: /api/readings（M18·任务⑦，docs/proposal-readings-loop.md §六）
 * 复盘闭环回访任务表 readings 的调度视图：
 *   GET  /api/readings                    → 到期回访任务（due_at ≤ 北京今天），需口令
 *   POST /api/readings {cast_id, action}  → action='dismissed' 不再提醒，需口令
 * 绑定：与 /api/records 同一 D1（变量名 LIUYAO_DB）。
 * 口令闸与 records 同源同实现（_lib.requireCode，LIB_CODE || ACCESS_CODE，同一份失败计数表）。
 * SQL 禁 SELECT *：不复制卦例正文（pan_text/messages/question 中的长文不下发——
 * 只取 question 与 hex 供辨认），与「readings 不存正文」红线同向。
 */

import { bodyTooLarge, payloadTooLarge, requireCode as requireCodeGate, ID_RE } from './_lib.js';

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}

// cast_id 白名单与 records.js 共用 _lib.js 导出的同一份 ID_RE（P2-API-7，2026-11-03）：
// 旧版两文件各存一份物理拷贝，违背「单一事实源」纪律，任一侧漏改即漂移。
const TASK_LIMIT = 50;

async function requireCode(request, env, message) {
  return requireCodeGate(request, env.LIB_CODE || env.ACCESS_CODE, message);
}

// 北京日历日（UTC+8）：与 due_at 的口径一致（字典序即时间序）
export function beijingToday() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const denied = await requireCode(request, env, '需要访问口令'); if (denied) return denied;
  if (!env.LIUYAO_DB) return json({ error: 'NO_DB', message: '服务端未绑定 D1 数据库（变量名应为 LIUYAO_DB）' }, 503);
  const today = beijingToday();
  const { results } = await env.LIUYAO_DB.prepare(
    'SELECT r.id, r.cast_id, r.due_at, r.note, c.question, c.hex ' +
    'FROM readings r LEFT JOIN casts c ON c.id = r.cast_id ' +
    "WHERE r.status = 'pending' AND r.due_at <= ? " +
    'ORDER BY r.due_at LIMIT ?'
  ).bind(today, TASK_LIMIT).all();
  // P2-API-8（2026-11-03）：旧版只有 LIMIT 50、无 offset 无总数——排尾部的任务在
  // 头部被逐个处理（回填/dismissed）前永不出现，前端也无法提示「还有 N 条」。
  // 补一条同 WHERE 的 COUNT(*)（参数化，与主查询同一 today 绑定），响应体加 total
  // 字段；既有 today/tasks 字段不动，旧客户端不受影响。
  const totalRow = await env.LIUYAO_DB.prepare(
    "SELECT COUNT(*) AS n FROM readings WHERE status = 'pending' AND due_at <= ?"
  ).bind(today).first();
  const total = totalRow && typeof totalRow.n === 'number' ? totalRow.n : (results || []).length;
  // JOIN 不中（casts 已删）的孤儿任务照发但 question/hex 为空，前端按「原卦已删」降级展示
  return json({ today: today, tasks: results || [], total: total });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const denied = await requireCode(request, env, '需要访问口令'); if (denied) return denied;
  if (!env.LIUYAO_DB) return json({ error: 'NO_DB', message: '服务端未绑定 D1 数据库（变量名应为 LIUYAO_DB）' }, 503);
  if (bodyTooLarge(request)) return payloadTooLarge();
  let b;
  try { b = await request.json(); } catch (e) { return json({ error: 'BAD_JSON' }, 400); }
  const castId = (b && typeof b.cast_id === 'string') ? b.cast_id : '';
  if (!ID_RE.test(castId)) return json({ error: 'BAD_ID', message: '非法 cast_id' }, 400);
  if (!b || b.action !== 'dismissed') {
    return json({ error: 'BAD_ACTION', message: 'action 只支持 dismissed' }, 400);
  }
  const r = await env.LIUYAO_DB.prepare(
    "UPDATE readings SET status = 'dismissed', updated_at = ? WHERE cast_id = ? AND status = 'pending'"
  ).bind(new Date().toISOString(), castId).run();
  const changes = r && r.meta && typeof r.meta.changes === 'number' ? r.meta.changes : 0;
  if (!changes) return json({ error: 'NO_TASK', message: '无待回访任务' }, 404);
  return json({ ok: true });
}
