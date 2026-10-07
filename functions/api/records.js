/* Cloudflare Pages Function: /api/records
 * 卦例库（D1 数据库 LIUYAO_DB）
 *   GET    /api/records           → 卦例列表（不含正文，含 question 与 outcome），需口令
 *   GET    /api/records?id=xxx    → 单条卦例详情，需口令
 *   POST   /api/records           → 新建/更新卦例（需 LIB_CODE 口令）
 *   POST   /api/records?verify=1  → 口令验证探针，不落库
 *   POST   /api/records?outcome=1 → 结果回执回填（M16，只写 outcome 列，需口令）
 *   DELETE /api/records?id=xxx    → 删除卦例（需 LIB_CODE 口令）
 * 绑定：Pages 项目 → Settings → Functions → D1 database bindings → 变量名 LIUYAO_DB
 */

import { safeEqual } from './_lib.js';

// 保持既有 import 路径可用（test-functions.mjs 直接从此文件 import safeEqual）；
// 实现已上移到 _lib.js，与 interpret.js 共用同一份常量时间比较
export { safeEqual };

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}

// 卦例 id 白名单。写路径（客户端可自带 id）与读路径（库里可能存有历史脏 id）都必须过这一关：
// 早期版本（e8e86e1 ~ f5a0ca4，2026-09-24 ~ 09-26）写入时 `const id = b.id || crypto.randomUUID()`
// 无任何格式校验，那些行至今可能仍在线上 D1 中，且会被前端拼进 data-id 属性。
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

// 口令闸门：读、写共用同一实现、同一口令来源（LIB_CODE || ACCESS_CODE），差异只在失败文案。
// 两者都未配置时保持开放（向后兼容本地/测试环境）。
//
// 读路径（列表 + 详情）与写路径同源，是第二十轮的收口：
// 第十七轮按要求撤销 ACCESS_CODE 后，读路径曾退化为「未设即放行」——列表下发的 question
// 是起卦时所测之事，?id= 详情还会返回 pan_text 与完整对话历史，对任何访客可见。
async function requireCode(request, env, message) {
  const code = env.LIB_CODE || env.ACCESS_CODE;
  if (!code) return null;
  const given = request.headers.get('X-Access-Code') || '';
  return (await safeEqual(given, code)) ? null : json({ error: 'ACCESS_REQUIRED', message: message }, 401);
}

async function checkAccess(request, env) { return requireCode(request, env, '需要访问口令'); }

// 写入鉴权文案与读略有区别，便于前端区分「浏览」与「装入」两种场景
async function writeGuard(request, env) { return requireCode(request, env, '装入卦例库需要口令'); }

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

// ---------- 结果回执（M16）：白名单校验 ----------
// outcome 是「卦象—结果」成对样本的另一半，取值必须收敛在固定枚举内，
// 否则统计口径会被自由文本污染（「成了」「成了吧」「大概率成」无法汇总）。
const OUTCOME_RESULTS = ['success', 'fail', 'partial', 'unclear'];   // 事之成败
const OUTCOME_YINGQI = ['on_time', 'missed', 'pending', 'unclear'];  // 应期是否按时应验
// 返回值三态：object = 合法回执；null = 显式清除；undefined = 非法输入（调用方应 400）
export function sanitizeOutcome(o) {
  if (o === null) return null;
  if (!o || typeof o !== 'object' || Array.isArray(o)) return undefined;
  const out = {};
  if (OUTCOME_RESULTS.indexOf(o.result) >= 0) out.result = o.result;
  if (OUTCOME_YINGQI.indexOf(o.yingqi) >= 0) out.yingqi = o.yingqi;
  if (typeof o.note === 'string' && o.note.trim()) out.note = o.note.trim().slice(0, 200);
  if (!out.result && !out.yingqi) return undefined; // 成败与应期至少居其一
  out.updated_at = new Date().toISOString();
  return out;
}

// 回执回填：只写 outcome 一列，绝不动卦例本体（pan_text/messages 由断卦流程维护）。
// 与主 POST 的 ON CONFLICT 更新清单互不包含——自动保存不会冲掉已回填的回执，
// 回填回执也不会改写卦例内容。
async function handleOutcome(request, env) {
  let b;
  try { b = await request.json(); } catch (e) { return json({ error: 'BAD_JSON' }, 400); }
  const id = (b && typeof b.id === 'string') ? b.id : '';
  if (!ID_RE.test(id)) return json({ error: 'BAD_ID', message: '非法 id' }, 400);
  const oc = sanitizeOutcome(b ? b.outcome : undefined);
  if (oc === undefined) {
    return json({ error: 'BAD_OUTCOME', message: '回执须含 result（success/fail/partial/unclear）或 yingqi（on_time/missed/pending/unclear）至少一项' }, 400);
  }
  const r = await env.LIUYAO_DB.prepare('UPDATE casts SET outcome = ? WHERE id = ?')
    .bind(oc === null ? null : JSON.stringify(oc), id).run();
  const changes = r && r.meta && typeof r.meta.changes === 'number' ? r.meta.changes : 0;
  if (!changes) return json({ error: 'NOT_FOUND', message: '卦例不存在' }, 404);
  return json({ ok: true, outcome: oc });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const denied = await checkAccess(request, env); if (denied) return denied;
  if (!env.LIUYAO_DB) return noDb();

  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (id) {
    // 非法 id 直接拒绝，不下探数据库（历史脏 id 由列表过滤 + 此处双保险拦下）
    if (!ID_RE.test(id)) return json({ error: 'BAD_ID', message: '非法 id' }, 400);
    const row = await env.LIUYAO_DB.prepare('SELECT * FROM casts WHERE id = ?').bind(id).first();
    return row ? json({ record: row }) : json({ error: 'NOT_FOUND', message: '卦例不存在' }, 404);
  }
  // outcome 一并下发：列表徽标与命中率统计（M16）都在前端据它计算；单条 JSON ≤ 数百字节，100 行体量可控
  const { results } = await env.LIUYAO_DB.prepare(
    'SELECT id, created_at, datetime, question, hex, pillars, outcome FROM casts ORDER BY created_at DESC LIMIT 100'
  ).all();
  // 读路径同样不能信库里的数据：历史无校验写入的非法 id 行一律不下发前端
  // （这些 id 会被拼进 data-id / data-del 属性，是存储型 XSS 的入口）
  return json({ records: (results || []).filter(function (r) { return ID_RE.test(r.id); }) });
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  const denied = await writeGuard(request, env); if (denied) return denied;
  if (!env.LIUYAO_DB) return noDb();
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return json({ error: 'NO_ID', message: '缺少 id' }, 400);
  // 与 GET ?id= 一致：非法 id 直接拒绝，不下探数据库（文件头的「读写路径都必须过 ID_RE」在此补齐）
  if (!ID_RE.test(id)) return json({ error: 'BAD_ID', message: '非法 id' }, 400);
  await env.LIUYAO_DB.prepare('DELETE FROM casts WHERE id = ?').bind(id).run();
  return json({ ok: true });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const denied = await writeGuard(request, env); if (denied) return denied;
  const url = new URL(request.url);
  // 口令验证探针：POST /api/records?verify=1 只校验口令不落库
  if (url.searchParams.get('verify')) return json({ ok: true });
  if (!env.LIUYAO_DB) return noDb();
  // 结果回执回填（M16）：独立分支，只写 outcome 列
  if (url.searchParams.get('outcome')) return handleOutcome(request, env);

  let b;
  try { b = await request.json(); } catch (e) { return json({ error: 'BAD_JSON' }, 400); }
  if (!b.panText) return json({ error: 'NO_PAN', message: '缺少排盘文本' }, 400);

  // id 策略：客户端可携带 id（复用/更新场景），但必须通过格式校验（ID_RE 见文件头）；
  // 缺失或非法一律服务端生成 UUID，杜绝空主键、超长主键与伪造覆盖
  const id = (typeof b.id === 'string' && ID_RE.test(b.id)) ? b.id : crypto.randomUUID();
  // 注意：ON CONFLICT 更新清单刻意不含 outcome——断卦后的自动保存不得冲掉已回填的结果回执
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
