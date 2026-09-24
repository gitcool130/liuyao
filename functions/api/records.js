/* Cloudflare Pages Function: /api/records
 * 卦例库（D1 数据库 LIUYAO_DB）
 *   GET  /api/records          → 卦例列表（不含正文）
 *   GET  /api/records?id=xxx   → 单条卦例详情
 *   POST /api/records          → 新建/更新卦例（传 id 则更新对话记录）
 * 绑定：Pages 项目 → Settings → Functions → D1 database bindings → 变量名 LIUYAO_DB
 */

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}

function checkAccess(request, env) {
  if (!env.ACCESS_CODE) return null;
  const code = request.headers.get('X-Access-Code') || '';
  return code === env.ACCESS_CODE ? null : json({ error: 'ACCESS_REQUIRED', message: '需要访问口令' }, 401);
}

// 写入鉴权：优先专用卦例库口令 LIB_CODE，未配置则回退全站 ACCESS_CODE；
// 两者都未配置时保持开放（向后兼容本地/测试环境）
function writeGuard(request, env) {
  const code = env.LIB_CODE || env.ACCESS_CODE;
  if (!code) return null;
  return (request.headers.get('X-Access-Code') || '') === code
    ? null
    : json({ error: 'ACCESS_REQUIRED', message: '装入卦例库需要口令' }, 401);
}

function noDb() {
  return json({ error: 'NO_DB', message: '服务端未绑定 D1 数据库（变量名应为 LIUYAO_DB）' }, 503);
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const denied = checkAccess(request, env); if (denied) return denied;
  if (!env.LIUYAO_DB) return noDb();

  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (id) {
    const row = await env.LIUYAO_DB.prepare('SELECT * FROM casts WHERE id = ?').bind(id).first();
    return row ? json({ record: row }) : json({ error: 'NOT_FOUND', message: '卦例不存在' }, 404);
  }
  const { results } = await env.LIUYAO_DB.prepare(
    'SELECT id, created_at, datetime, question, hex, pillars FROM casts ORDER BY created_at DESC LIMIT 100'
  ).all();
  return json({ records: results || [] });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const denied = writeGuard(request, env); if (denied) return denied;
  // 口令验证探针：POST /api/records?verify=1 只校验口令不落库
  if (new URL(request.url).searchParams.get('verify')) return json({ ok: true });
  if (!env.LIUYAO_DB) return noDb();

  let b;
  try { b = await request.json(); } catch (e) { return json({ error: 'BAD_JSON' }, 400); }
  if (!b.panText) return json({ error: 'NO_PAN', message: '缺少排盘文本' }, 400);

  const id = b.id || crypto.randomUUID();
  await env.LIUYAO_DB.prepare(
    'INSERT INTO casts (id, created_at, datetime, pillars, question, hex, tosses, pan_text, messages) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ' +
    'ON CONFLICT(id) DO UPDATE SET question = excluded.question, messages = excluded.messages'
  ).bind(
    id,
    new Date().toISOString(),
    (b.datetime || '').toString().slice(0, 50),
    (b.pillars || '').toString().slice(0, 80),
    (b.question || '').toString().slice(0, 100),
    (b.hex || '').toString().slice(0, 80),
    JSON.stringify(b.tosses || []).slice(0, 4000),
    (b.panText || '').toString().slice(0, 8000),
    JSON.stringify(b.messages || []).slice(0, 100000)
  ).run();
  return json({ id: id });
}
