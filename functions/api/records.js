/* Cloudflare Pages Function: /api/records
 * 卦例库（D1 数据库 LIUYAO_DB）
 *   GET    /api/records          → 卦例列表（不含正文），开放
 *   GET    /api/records?id=xxx   → 单条卦例详情，开放
 *   POST   /api/records          → 新建/更新卦例（需 LIB_CODE 口令）
 *   POST   /api/records?verify=1 → 口令验证探针，不落库
 *   DELETE /api/records?id=xxx   → 删除卦例（需 LIB_CODE 口令）
 * 绑定：Pages 项目 → Settings → Functions → D1 database bindings → 变量名 LIUYAO_DB
 */

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}

// 口令比较：先 SHA-256 再逐字节异或，长度不参与比较、耗时与口令内容无关
// （直接字符串 === 比较会因短路提前返回而泄露前缀信息）
export async function safeEqual(input, expected) {
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(String(input == null ? '' : input))),
    crypto.subtle.digest('SHA-256', enc.encode(String(expected == null ? '' : expected)))
  ]);
  const va = new Uint8Array(a), vb = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < va.length; i++) diff |= va[i] ^ vb[i];
  return diff === 0;
}

async function checkAccess(request, env) {
  if (!env.ACCESS_CODE) return null;
  const code = request.headers.get('X-Access-Code') || '';
  return (await safeEqual(code, env.ACCESS_CODE)) ? null : json({ error: 'ACCESS_REQUIRED', message: '需要访问口令' }, 401);
}

// 写入鉴权：优先专用卦例库口令 LIB_CODE，未配置则回退全站 ACCESS_CODE；
// 两者都未配置时保持开放（向后兼容本地/测试环境）
async function writeGuard(request, env) {
  const code = env.LIB_CODE || env.ACCESS_CODE;
  if (!code) return null;
  const given = request.headers.get('X-Access-Code') || '';
  return (await safeEqual(given, code))
    ? null
    : json({ error: 'ACCESS_REQUIRED', message: '装入卦例库需要口令' }, 401);
}

// 按结构收缩字符串值（截断字符串"内容"仍产出合法 JSON，与截断 JSON"文本"有本质区别）
function shrinkStrings(v, maxLen) {
  const s = (function () { try { return JSON.stringify(v); } catch (e) { return null; } })();
  if (s !== null && s.length <= maxLen) return v;
  if (typeof v === 'string') return v.slice(0, Math.max(0, maxLen)) + '…';
  if (Array.isArray(v)) {
    const n = Math.max(1, v.length);
    return v.map(function (x) { return shrinkStrings(x, Math.max(64, Math.floor(maxLen / n))); });
  }
  if (v && typeof v === 'object') {
    const ks = Object.keys(v);
    const out = {};
    ks.forEach(function (k) { out[k] = shrinkStrings(v[k], Math.max(64, Math.floor(maxLen / Math.max(1, ks.length)))); });
    return out;
  }
  return v;
}

// 序列化并限制长度，但**绝不截断 JSON 文本**：
// 旧实现 JSON.stringify(x).slice(0, N) 会产出非法 JSON，前端 JSON.parse 直接抛异常。
// 此处在超限时按结构收缩（数组保留前段元素、对象逐键保留、单值过大则截断字符串内容），
// 保证写入 D1 的永远是合法 JSON，且尽量保留可用内容。
export function jsonWithin(value, maxLen) {
  let raw;
  try { raw = JSON.stringify(value === undefined ? null : value); }
  catch (e) { return 'null'; }
  if (raw && raw.length <= maxLen) return raw;

  if (Array.isArray(value)) {
    // 二分：保留尽量多的前段元素（卦例的 tosses / 对话历史都以开头为要）
    let lo = 0, hi = value.length;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (JSON.stringify(value.slice(0, mid)).length <= maxLen) lo = mid; else hi = mid - 1;
    }
    if (lo > 0) return JSON.stringify(value.slice(0, lo));
    if (value.length) {
      // 连一个元素都放不下：保留首元素并截断其字符串内容
      const one = [shrinkStrings(value[0], Math.max(64, maxLen - 32))];
      const s = JSON.stringify(one);
      return s.length <= maxLen ? s : JSON.stringify([]);
    }
    return '[]';
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value);
    const perKey = Math.max(128, Math.floor((maxLen - 64) / Math.max(1, keys.length)));
    const out = {};
    let shrunk = false;
    keys.forEach(function (k) {
      let v = value[k];
      let vs;
      try { vs = JSON.stringify(v); } catch (e) { shrunk = true; return; }
      if (vs !== undefined && vs.length > perKey) {
        v = shrinkStrings(v, perKey);
        shrunk = true;
      }
      const probe = Object.assign({}, out); probe[k] = v;
      if (JSON.stringify(probe).length > maxLen) { shrunk = true; return; } // 放不下则丢弃整键
      out[k] = v;
    });
    if (shrunk || keys.some(function (k) { return !(k in out); })) out._truncated = true;
    let s = JSON.stringify(out);
    while (s.length > maxLen) {                        // 极端兜底：逐键精简直至合法且不超限
      const ks = Object.keys(out).filter(function (k) { return k !== '_truncated'; });
      if (!ks.length) break;
      delete out[ks[0]];
      out._truncated = true;
      s = JSON.stringify(out);
    }
    return s;
  }
  return JSON.stringify(null);
}



function noDb() {
  return json({ error: 'NO_DB', message: '服务端未绑定 D1 数据库（变量名应为 LIUYAO_DB）' }, 503);
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const denied = await checkAccess(request, env); if (denied) return denied;
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

export async function onRequestDelete(context) {
  const { request, env } = context;
  const denied = await writeGuard(request, env); if (denied) return denied;
  if (!env.LIUYAO_DB) return noDb();
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return json({ error: 'NO_ID', message: '缺少 id' }, 400);
  await env.LIUYAO_DB.prepare('DELETE FROM casts WHERE id = ?').bind(id).run();
  return json({ ok: true });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const denied = await writeGuard(request, env); if (denied) return denied;
  // 口令验证探针：POST /api/records?verify=1 只校验口令不落库
  if (new URL(request.url).searchParams.get('verify')) return json({ ok: true });
  if (!env.LIUYAO_DB) return noDb();

  let b;
  try { b = await request.json(); } catch (e) { return json({ error: 'BAD_JSON' }, 400); }
  if (!b.panText) return json({ error: 'NO_PAN', message: '缺少排盘文本' }, 400);

  // id 策略：客户端可携带 id（复用/更新场景），但必须通过格式校验；
  // 缺失或非法一律服务端生成 UUID，杜绝空主键、超长主键与伪造覆盖
  const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
  const id = (typeof b.id === 'string' && ID_RE.test(b.id)) ? b.id : crypto.randomUUID();
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
    jsonWithin(b.tosses || [], 4000),
    (b.panText || '').toString().slice(0, 8000),
    jsonWithin(b.messages || [], 100000)
  ).run();
  return json({ id: id });
}
