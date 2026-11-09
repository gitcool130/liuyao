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

import { safeEqual, bodyTooLarge, payloadTooLarge, readJsonCapped, requireJsonContentType, requireCode as requireCodeGate, ID_RE } from './_lib.js';

// 保持既有 import 路径可用（test-functions.mjs 直接从此文件 import safeEqual）；
// 实现已上移到 _lib.js，与 interpret.js 共用同一份常量时间比较
export { safeEqual };

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'   // P2-2：卦例题面/排盘/对话不得被缓存
    }
  });
}

// 卦例 id 白名单 ID_RE 已上移到 _lib.js 统一导出（P2-API-7，2026-11-03）：
// 旧版本文件与 readings.js 各存一份物理拷贝，违背 _lib.js「单一事实源」纪律，
// 任一侧漏改即出现「一端放行、一端拦截」的漂移。写路径（客户端可自带 id）与
// 读路径（库里可能存有历史脏 id）仍都必须过这一关——早期版本
// （e8e86e1 ~ f5a0ca4，2026-09-24 ~ 09-26）写入时无任何格式校验，
// 那些行至今可能仍在线上 D1 中，且会被前端拼进 data-id 属性。

// 列表分页：默认 100 与旧版行为一致；上限 200 防"一次拉全库"。
const PAGE_DEFAULT = 100;
const PAGE_MAX = 200;
const PAGE_MAX_OFFSET = 100000;

// 口令闸门：读、写共用同一实现、同一口令来源（LIB_CODE || ACCESS_CODE），差异只在失败文案。
// 两者都未配置时保持开放（向后兼容本地/测试环境）。
//
// 读路径（列表 + 详情）与写路径同源，是第二十轮的收口：
// 第十七轮按要求撤销 ACCESS_CODE 后，读路径曾退化为「未设即放行」——列表下发的 question
// 是起卦时所测之事，?id= 详情还会返回 pan_text 与完整对话历史，对任何访客可见。
//
// 失败计数（防口令爆破）已上移到 _lib.js 的 requireCode，与 interpret.js 共用同一实现与
// 同一份计数表——两端点若各写一份，姿态迟早漂移（本次审计即指出 interpret 侧无计数）。
async function requireCode(request, env, message) {
  return requireCodeGate(request, env.LIB_CODE || env.ACCESS_CODE, message);
}

async function checkAccess(request, env) { return requireCode(request, env, '需要访问口令'); }

// 写入鉴权文案与读略有区别，便于前端区分「浏览」与「装入」两种场景
async function writeGuard(request, env) { return requireCode(request, env, '装入卦例库需要口令'); }

// 展示类字符串字段守卫（P2-API-5，2026-11-03）：datetime/pillars/question/hex
// 旧版一律 .toString() 强转——客户端误传对象即变 "[object Object]" 入库展示
// （同类 bug 2026-10-21 刚修过 panText，此处补齐同口径）。非字符串一律拒绝（400），
// 不做静默强转；null/undefined 视为缺省（空串，与旧版 b.x || '' 一致）。
// 返回 null 表示该字段类型非法，调用方应 400。
function fieldText(v, max) {
  if (v == null) return '';
  if (typeof v !== 'string') return null;
  return v.slice(0, max);
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

  // 顶层字符串超限：旧版会依次跳过数组分支、对象分支，落到函数末尾
  // return JSON.stringify(null)——内容被静默替换为 null 而非截断保留。
  // shrinkStrings 本身有字符串截断能力，但顶层字符串走不到那个分支。
  if (typeof value === 'string') {
    // 留足引号与转义余量：先截到 maxLen-8 再 stringify，仍超限则再收紧一档
    let s = JSON.stringify(value.slice(0, Math.max(0, maxLen - 8)) + '…');
    if (s.length > maxLen) s = JSON.stringify(value.slice(0, Math.max(0, maxLen - 16)));
    if (s.length <= maxLen) return s;
    // P2-API-6（2026-11-03）：转义膨胀下上面两档仍可能超限——500 个 " 的字符串
    // stringify 后 1002 字符，两档截断都砍不到限内，旧版到此直接把超限字符串
    // 返回，打破「产出不超限」的调用方契约。当前调用点（tosses/messages/baseline）
    // 全是数组/对象、本分支不可达，属潜伏坑；此处按 stringify 实际长度二分收紧
    // （stringify 长度随 slice 长度单调不减，二分有效），保证任何输入都收敛到限内，
    // 并保留「…」截断标记。兜底 '""' 恒为合法 JSON（maxLen≥2 时限内必可达）。
    let lo = 0, hi = value.length, best = '""';
    while (lo <= hi) {
      const mid = (lo + hi + 1) >> 1;
      const probe = JSON.stringify(value.slice(0, mid) + '…');
      if (probe.length <= maxLen) { best = probe; lo = mid + 1; } else { hi = mid - 1; }
    }
    return best;
  }

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
    // 必须用无原型对象承载：普通对象字面量的 out[k]=v 对键名 __proto__
    // 会触发原型 setter（赋对象值时变成改 out 的原型，赋原始值时被静默忽略），
    // 该键既不成为自有属性也不参与长度核算；且下方 `k in out` 因原型链恒为 true，
    // _truncated 标记也不会打——含 __proto__ 键的消息存入 D1 时该键无声消失。
    const out = Object.create(null);
    const has = function (k) { return Object.prototype.hasOwnProperty.call(out, k); };
    let shrunk = false;
    keys.forEach(function (k) {
      let v = value[k];
      let vs;
      try { vs = JSON.stringify(v); } catch (e) { shrunk = true; return; }
      if (vs !== undefined && vs.length > perKey) {
        v = shrinkStrings(v, perKey);
        shrunk = true;
      }
      const probe = Object.assign(Object.create(null), out); probe[k] = v;
      if (JSON.stringify(probe).length > maxLen) { shrunk = true; return; } // 放不下则丢弃整键
      out[k] = v;
    });
    if (shrunk || keys.some(function (k) { return !has(k); })) out._truncated = true;
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
// 应验窗口分桶（M17）：3 日 / 7 日 / 30 日 / 90 日以上。
// 为什么要分桶：术数里远近应期是两套机制——短线靠日辰冲动、值日、出空，
// 长线靠月建旺衰、旬空填实、伏神出现。把两种样本混成一个「准确率」，
// 这个数字就没有意义了（拿短线样本标定长线，是拿日辰冲动的规律去预测太岁）。
// 故本字段只用于**分桶**，任何统计都不许跨桶相加。
const OUTCOME_WINDOWS = ['d3', 'd7', 'd30', 'd90'];
// 返回值三态：object = 合法回执；null = 显式清除；undefined = 非法输入（调用方应 400）
export function sanitizeOutcome(o) {
  if (o === null) return null;
  if (!o || typeof o !== 'object' || Array.isArray(o)) return undefined;
  const out = {};
  if (OUTCOME_RESULTS.indexOf(o.result) >= 0) out.result = o.result;
  if (OUTCOME_YINGQI.indexOf(o.yingqi) >= 0) out.yingqi = o.yingqi;
  if (OUTCOME_WINDOWS.indexOf(o.window) >= 0) out.window = o.window;
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
  try { b = await readJsonCapped(request, 512 * 1024); }
  catch (e) { if (e && e.tooLarge) return payloadTooLarge(); return json({ error: 'BAD_JSON' }, 400); }
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
  // 回访闭环（M18）：回填成功后该卦例的待回访任务置 acted（显式清除回执不触发，
  // 避免误关任务；失败静默——回执本体已保存，任务留到下次回填再关）。
  if (oc !== null) {
    try {
      await env.LIUYAO_DB.prepare("UPDATE readings SET status = 'acted', updated_at = ? WHERE cast_id = ? AND status = 'pending'")
        .bind(oc.updated_at, id).run();
    } catch (e) { /* 不阻断回执主流程 */ }
  }
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
  // outcome 一并下发：列表徽标与命中率统计（M16）都在前端据它计算；单条 JSON ≤ 数百字节。
  // 分页：limit 默认 100（与旧版一致）、上限 200；多取一条判断 hasMore，避免"最后一页
  // 少一条"或"多一页空列表"这类边界。offset 走索引扫描，个人规模下成本可忽略。
  const qLimit = parseInt(url.searchParams.get('limit') || '', 10);
  const qOffset = parseInt(url.searchParams.get('offset') || '', 10);
  const limit = (qLimit > 0) ? Math.min(qLimit, PAGE_MAX) : PAGE_DEFAULT;
  const offset = (qOffset > 0) ? Math.min(qOffset, PAGE_MAX_OFFSET) : 0;
  // P2-API-2（2026-11-03）：ORDER BY 必须带唯一 tiebreaker。created_at 是
  // toISOString() 生成的毫秒串，同毫秒入库的两行顺序不定，OFFSET 翻页会
  // 跳行/重行（上一页末尾与下一页开头同秒时尤甚）。id 为主键、必然唯一，
  // 与 created_at 同向 DESC 后分页游标才确定。LIMIT/OFFSET 不变。
  const { results } = await env.LIUYAO_DB.prepare(
    'SELECT id, created_at, datetime, question, hex, pillars, outcome FROM casts ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?'
  ).bind(limit + 1, offset).all();
  // 读路径同样不能信库里的数据：历史无校验写入的非法 id 行一律不下发前端
  // （这些 id 会被拼进 data-id / data-del 属性，是存储型 XSS 的入口）
  const rows = (results || []).filter(function (r) { return ID_RE.test(r.id); });
  // hasMore 按**过滤前**行数判：SQL 多取一条的本义就是「库中是否还有更多行」，
  // 脏 id 被滤掉只影响本页展示条数、不影响翻页推进（offset 按 SQL 序走）。
  // 旧版按过滤后行数判，脏 id 行恰居 limit+1 位时误报 false，分页提前终止
  // 且无任何提示（2026-10-21 审计修正）。
  return json({
    records: rows.slice(0, limit),
    hasMore: (results || []).length > limit,
    limit: limit,
    offset: offset
  });
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  const denied = await writeGuard(request, env); if (denied) return denied;
  if (!env.LIUYAO_DB) return noDb();
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return json({ error: 'NO_ID', message: '缺少 id' }, 400);
  // 与 GET ?id= 一致：非法 id 直接拒绝，不下探数据库（文件头的「读写路径都必须过 ID_RE」在此补齐）
  if (!ID_RE.test(id)) return json({ error: 'BAD_ID', message: '非法 id' }, 400);
  // P2-API-9（2026-11-03）：旧版不检查 changes，删不存在的 id 也返回 {ok:true}——
  // 与 GET ?id= 的 404 口径不一致，客户端无法区分「删掉了」与「本来就没有」。
  // 与 handleOutcome 同款：用 result.meta.changes 判断，0 变化 → 404。
  const r = await env.LIUYAO_DB.prepare('DELETE FROM casts WHERE id = ?').bind(id).run();
  const changes = r && r.meta && typeof r.meta.changes === 'number' ? r.meta.changes : 0;
  if (!changes) return json({ error: 'NOT_FOUND', message: '卦例不存在' }, 404);
  // P2-9（2026-11-09）：同批清理回访任务。readings 不设外键，旧版删 cast 后
  // pending 任务会以 LEFT JOIN 孤儿形式继续出现在回访列表（前端显示「原卦例已删除」）。
  // 删除失败不阻断卦例删除（任务可人工清理），但正常路径必须一起删。
  try {
    await env.LIUYAO_DB.prepare('DELETE FROM readings WHERE cast_id = ?').bind(id).run();
  } catch (e) { /* 不阻断主删除 */ }
  return json({ ok: true });
}

// ---------- 回访任务派生（M18·任务⑦，docs/proposal-readings-loop.md §2.3/§四） ----------
// 只派生「哪条卦该回头看」，不复制正文；失败不阻断卦例本体（任务丢了可重派，幂等）。
// 预判桶位只进 note 供展示，绝不预填、绝不替换用户回填的 outcome.window。
function deriveReading(id, datetime, baselineRaw) {
  if (!baselineRaw) return null;
  let bl;
  try { bl = JSON.parse(baselineRaw); } catch (e) { return null; }
  const w = bl && bl.window;
  if (!w || w.status !== 'ok' || typeof w.hi !== 'number' || !isFinite(w.hi) || w.hi < 0) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(datetime || ''));
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (isNaN(d.getTime())) return null;
  // P2-API-1（2026-11-03）：Date.UTC 会把 2026-02-31 静默归一化成 2026-03-03——
  // 脏 datetime 会推出错误回访日，而 INSERT OR IGNORE 幂等错了不可纠正（任务一旦
  // 派生，除非人工改库否则一直按错日期提醒）。此处回验 UTC 月/日与输入一致，
  // 不一致视为无效行（不派生，宁缺勿造），不得静默归一化。
  if (d.getUTCFullYear() !== Number(m[1]) || d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3])) return null;
  d.setUTCDate(d.getUTCDate() + Math.floor(w.hi) + 1);   // 应期窗口走完的次日为回访日
  const bucket = w.hi <= 3 ? 'd3' : w.hi <= 7 ? 'd7' : w.hi <= 30 ? 'd30' : 'd90';
  const note = '当时判据预计结果落在 ' + bucket.slice(1) + ' 日内窗口（预判仅供提醒，回填以实际发生为准）';
  return { due_at: d.toISOString().slice(0, 10), note: note.slice(0, 200) };
}

// 布尔查询参数真值判断（P2-API-12，2026-11-03）：旧版 searchParams.get('verify')
// 真值判断，'?verify=0' / '?verify=false' 也进分支（探针/回填被误触发）。
// 只认 '1'/'true'——现有调用方（public/app.js）传的正是 ?verify=1 与 ?outcome=1，
// 行为不变；缺头/空串/其它值一律为假。
function flagOn(url, name) {
  const v = url.searchParams.get(name);
  return v === '1' || v === 'true';
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const denied = await writeGuard(request, env); if (denied) return denied;
  const badCt = requireJsonContentType(request); if (badCt) return badCt;
  const url = new URL(request.url);
  // 口令验证探针：POST /api/records?verify=1 只校验口令不落库
  if (flagOn(url, 'verify')) return json({ ok: true });
  if (!env.LIUYAO_DB) return noDb();
  // 请求体总大小闸门：必须早于 request.json()——后者会把整个 body 先读进 isolate 内存
  if (bodyTooLarge(request)) return payloadTooLarge();
  // 结果回执回填（M16）：独立分支，只写 outcome 列
  if (flagOn(url, 'outcome')) return handleOutcome(request, env);

  let b;
  try { b = await readJsonCapped(request, 512 * 1024); }
  catch (e) { if (e && e.tooLarge) return payloadTooLarge(); return json({ error: 'BAD_JSON' }, 400); }
  // JSON 文本 null 是合法 JSON，await request.json() 返回 null 而不抛错，
  // 下一行 b.panText 会解引用 null 抛未捕获 TypeError → 通用 500。
  // 同文件 handleOutcome 已有 `b && typeof b.id` 守卫，此处补齐主路径。
  if (!b || typeof b !== 'object' || Array.isArray(b)) {
    return json({ error: 'BAD_JSON', message: '请求体应为 JSON 对象' }, 400);
  }
  // 类型边界与 interpret.js 同口径：非字符串 panText 旧版被 .toString() 强转
  // （{} → "[object Object]"）后入库，前端装入即显示垃圾文本（2026-10-21 审计修正）。
  if (typeof b.panText !== 'string' || !b.panText) {
    return json({ error: 'NO_PAN', message: '缺少排盘文本' }, 400);
  }
  // P2-API-5：datetime/pillars/question/hex 同 panText 口径——非字符串拒绝，不强转
  const fDatetime = fieldText(b.datetime, 50);
  const fPillars = fieldText(b.pillars, 80);
  const fQuestion = fieldText(b.question, 100);
  const fHex = fieldText(b.hex, 80);
  if (fDatetime === null || fPillars === null || fQuestion === null || fHex === null) {
    return json({ error: 'BAD_FIELD', message: 'datetime/pillars/question/hex 须为字符串' }, 400);
  }

  // id 策略：客户端可携带 id（复用/更新场景），但必须通过格式校验（ID_RE 见 _lib.js）；
  // 缺失或非法一律服务端生成 UUID，杜绝空主键、超长主键与伪造覆盖
  const id = (typeof b.id === 'string' && ID_RE.test(b.id)) ? b.id : crypto.randomUUID();
  // 判据快照（M17-A）：对象才收，其余一律 null。仅限长不做枚举白名单——
  // baseline 只供详情页对照展示，不是统计枚举来源（统计只吃 outcome 的白名单），渲染端解析失败即降级。
  const baseline = (b.baseline && typeof b.baseline === 'object' && !Array.isArray(b.baseline)) ? b.baseline : null;
  // 注意：ON CONFLICT 更新清单含全部盘面字段（datetime/pillars/question/hex/tosses/pan_text/messages/baseline）——
  // 带已存在 id 的 POST 是「更新此卦」语义，旧版只更 question/messages/baseline，会静默保留旧盘面
  // （重新排盘后保存，落库的还是第一张盘）。仍刻意不含 outcome 与 created_at：
  // outcome 是结果回执（断卦后的自动保存不得冲掉已回填的结果），created_at 须保持首次入库时间。
  await env.LIUYAO_DB.prepare(
    'INSERT INTO casts (id, created_at, datetime, pillars, question, hex, tosses, pan_text, messages, baseline) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ' +
    'ON CONFLICT(id) DO UPDATE SET datetime = excluded.datetime, pillars = excluded.pillars, question = excluded.question, ' +
    'hex = excluded.hex, tosses = excluded.tosses, pan_text = excluded.pan_text, messages = excluded.messages, baseline = excluded.baseline'
  ).bind(
    id,
    new Date().toISOString(),
    fDatetime,
    fPillars,
    fQuestion,
    fHex,
    jsonWithin(b.tosses || [], 4000),
    b.panText.slice(0, 8000),
    jsonWithin(b.messages || [], 100000),
    baseline ? jsonWithin(baseline, 1000) : null
  ).run();
  // 回访任务派生（M18）：主写入成功后追加，INSERT OR IGNORE 幂等；失败不回滚卦例本体
  let readingDue = null;
  try {
    const rd = deriveReading(id, fDatetime, baseline ? jsonWithin(baseline, 1000) : null);
    if (rd) {
      // 终态（acted / dismissed）不再二次排队：唯一索引只约束 pending，
      // 单靠 INSERT OR IGNORE 在 dismissed/acted 之后会重新插一条 pending
      // （P1-3，2026-11-09）。WHERE NOT EXISTS 按 cast_id 判任意状态，
      // 与 schema.sql「acted/dismissed 是终态」的契约一致；inserted 的幂等仍由
      // 部分唯一索引兜并发。绑定顺序：cast_id, due_at, note, created_at, cast_id。
      const ins = await env.LIUYAO_DB.prepare(
        "INSERT OR IGNORE INTO readings (cast_id, due_at, status, source, note, created_at) " +
        "SELECT ?, ?, 'pending', 'baseline_window', ?, ? " +
        "WHERE NOT EXISTS (SELECT 1 FROM readings WHERE cast_id = ?)"
      ).bind(id, rd.due_at, rd.note, new Date().toISOString(), id).run();
      // P2-API-10（2026-11-03）：INSERT OR IGNORE 会吞掉一切约束违反，旧版不看
      // changes——任务行被静默丢弃（未来给 readings 加 NOT NULL 无默认列时必现）
      // 而 readingDue 照常返回，回访闭环无声缺员。插入后检查 changes：
      //   >0：新任务落库，回显派生日；
      //   =0：两种可能——幂等重复（idx_readings_open 部分唯一索引挡下，任务已在）
      //        或约束违反（行被吞）。INSERT OR IGNORE 不区分二者，补一次按 cast_id
      //        的回查把「已处理」与「静默丢失」分开：查得到 → 沿用库中 due_at；
      //        查不到 → readingDue 保持 null，回显不再谎报回访日。
      // 不抛 500：派生失败不阻断主流程（任务可重派），与既有错误处理风格一致。
      const insChanges = ins && ins.meta && typeof ins.meta.changes === 'number' ? ins.meta.changes : 0;
      if (insChanges > 0) {
        readingDue = rd.due_at;
      } else {
        const exist = await env.LIUYAO_DB.prepare(
          "SELECT due_at FROM readings WHERE cast_id = ? AND status = 'pending'"
        ).bind(id).first();
        if (exist && typeof exist.due_at === 'string') readingDue = exist.due_at;
      }
    }
  } catch (e) { /* 派生失败不阻断主流程（任务可重派） */ }
  // 回显判据与回访状态：旧版只回 {id}，于是「存进去了」与「存进去但事后无法统计」
  // 在客户端完全同形——线上 20 卦 0 判据、readings 0 行由此长期不可见。
  return json({ id: id, hasBaseline: !!baseline, reading: readingDue });
}
