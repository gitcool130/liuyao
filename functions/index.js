/* ============================================================
 * 按盘 OG 预览（functions/index.js —— Pages Function，路由 "/"）
 * 方案：docs/proposal-og-preview.md（M17-B 阶段一）
 *
 * 服务端按 ?s= 解码分享码后注入 og:title / og:description / <title>；
 * 抓取器（微信 / Telegram / X / Discord 等）不执行 JS，客户端改 meta 对预览无效，
 * 故必须在资产层之前改写 HTML。
 *
 * 红线（proposal §四）：
 *   1. og 文案只含「种子 + 确定性重算」的公共事实（卦名 / 四柱 / 所测原文 / 用神类别）。
 *      解码经 ./api/_share.js 门面复用 public/core/share.js 单一实现，
 *      import 白名单封闭为 data / data-jieqi / calendar / paipan / share 五个确定性模块——
 *      analyze（断语规则链）、yingqi-window（置信度）、sensitive 等判读层物理上不在依赖里，
 *      「无法 import」比「约定不 import」强；本文件也不调用任何模型端点。
 *   2. 畸形输入一律降级为站点默认 meta（原样返回资产 HTML，HTTP 200），绝不 500、
 *      绝不输出只解出一半的文案。decode 侧已有 420 字符上限与全串正则，
 *      此处不自造第二道校验（那等于第二份实现）。
 *   3. 锚点替换全或无：四个锚点（og:title / og:description / <title> 三处改写 +
 *      og:site_name 结构守卫）任一正则未命中即放弃改写、回退原样并 console.warn——
 *      宁可没有按盘预览，不可把页面改坏。
 *
 * 不做 UA 分流、不做 og:image / og:url / canonical（proposal §三「本期明确不做」）。
 * ============================================================ */
import { decodeCast, dateOfWall, fourPillars, paipan } from './api/_share.js';

// HTML 属性转义：& " < > 四字符 + 控制字符折叠为空格。
// question 是用户输入，og:title 各分量虽来自封闭枚举（卦名表 / 干支表）也统一过 esc。
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// 用神类别的展示口径：与站内一致（analyze.js 以世爻为用神；app.js 的 __custom__ 即自定义），
// 预览卡与站内呈现不说两套话
function useLabel(use) {
  if (!use) return '未取';
  if (use === 'shi') return '世爻';
  if (use === '__custom__') return '自定义';
  return use;
}

// og:description 总长兜底 ≤ 200 字符（decode 已 slice(0,60)，正常远达不到此上限）
const DESC_MAX = 200;

function ogTextOf(dec) {
  const dt = dateOfWall(dec.wall);
  const pillars = fourPillars(dt);
  const pan = paipan(dec.vals, dt);
  // 盘名段与站内同口径（app.js：pan.benName + (pan.hasBian ? ' 之 ' + pan.bianName : '（静卦）')）
  const gua = pan.benName + (pan.hasBian ? ' 之 ' + pan.bianName : '（静卦）');
  const w = dec.wall;
  const title = gua + ' · ' + pillars.yearGZ + '年 ' + pillars.monthGZ + '月 ' +
    pillars.dayGZ + '日 ' + pillars.hourGZ + '时';
  const desc = ('所测：' + (dec.question || '（未注明）') + '；用神：' + useLabel(dec.use) +
    '；起卦于 ' + w.y + '-' + w.m + '-' + w.d + ' ' + w.h + ':' +
    String(w.min).padStart(2, '0') + '（北京时间）').slice(0, DESC_MAX);
  return { title: esc(title), desc: esc(desc) };
}

// 四锚点契约（与 public/index.html 的 head 结构一一对应，进 test-functions.mjs 钉住）：
// og:site_name 不改写，仅作结构守卫——它紧邻 og:title，若整块 OG meta 被重构，
// 改写后的卡片会展示错位品牌，故任一锚点缺失即整体放弃
const RE_OG_SITE = /<meta property="og:site_name" content="[^"]*">/;
const RE_OG_TITLE = /<meta property="og:title" content="[^"]*">/;
const RE_OG_DESC = /<meta property="og:description" content="[^"]*">/;
const RE_TITLE = /<title>[^<]*<\/title>/;

// 全或无改写：任一锚点未命中返回 null（调用方回退原样）；替换用函数形式，
// 避免 content 中的 $& / $1 被当作替换模式展开
function ogRewrite(html, title, desc) {
  if (!RE_OG_SITE.test(html) || !RE_OG_TITLE.test(html) ||
      !RE_OG_DESC.test(html) || !RE_TITLE.test(html)) return null;
  return html
    .replace(RE_OG_TITLE, () => '<meta property="og:title" content="' + title + '">')
    .replace(RE_OG_DESC, () => '<meta property="og:description" content="' + desc + '">')
    .replace(RE_TITLE, () => '<title>' + title + '</title>');
}

// 已消费 body 后按原样重建响应（fallback 路径用，保留原始头）
function rebuild(asset, body) {
  return new Response(body, { status: asset.status, headers: asset.headers });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  let s = null;
  try {
    s = new URL(request.url).searchParams.get('s');
  } catch (e) { /* URL 不可解析视同无参 */ }
  // 无 s / 空串：直达资产层（app.js 重新起卦后清参，本就是无码态）
  if (!s) return context.next();

  // 畸形码：原样返回资产 HTML（站点默认 meta，200）——流式透传，零改写
  let dec = null;
  try { dec = decodeCast(s); } catch (e) {
    console.warn('[liuyao/og] decodeCast 抛错，回落默认 meta:', e && e.message);
  }
  if (!dec || !dec.ok) return env.ASSETS.fetch(request);

  const asset = await env.ASSETS.fetch(request);
  let html;
  try { html = await asset.text(); } catch (e) {
    console.warn('[liuyao/og] 资产读取失败:', e && e.message);
    return env.ASSETS.fetch(request);
  }
  // 非常规资产响应（非 200 / 非 HTML）不改写
  const ct = (asset.headers.get('content-type') || '').toLowerCase();
  if (asset.status !== 200 || ct.indexOf('html') < 0) return rebuild(asset, html);

  try {
    const { title, desc } = ogTextOf(dec);
    const out = ogRewrite(html, title, desc);
    if (out == null) {
      console.warn('[liuyao/og] OG 锚点未命中（index.html 结构变更？），已回退默认 meta');
      return rebuild(asset, html);
    }
    // 体已改写：原 ETag 必失配，删之；同码同 HTML，确定性输出可安全短缓存
    const headers = new Headers(asset.headers);
    headers.delete('etag');
    headers.delete('last-modified');
    headers.set('cache-control', 'public, max-age=300');
    return new Response(out, { status: asset.status, headers: headers });
  } catch (e) {
    // 理论不可达（封闭枚举输入），仍兜底：宁可没有按盘预览，不可 500
    console.warn('[liuyao/og] 改写抛错，回落默认 meta:', e && e.message);
    return rebuild(asset, html);
  }
}
