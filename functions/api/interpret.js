/* Cloudflare Pages Function: POST /api/interpret
 * 排盘文本 + 对话历史 → 大模型断卦（多供应商：Gemini / DeepSeek）
 *
 * 请求体：{ panText, messages, provider, model }
 *   provider: 'gemini' | 'deepseek'（可省略，按 model 名自动推断）
 *   model:    见下方 MODELS 白名单
 *
 * 环境变量（Pages 项目设置 / wrangler.toml [vars] 配置）：
 *   GEMINI_API_KEY    secret，Google AI Studio key（AIza 开头）
 *   GEMINI_BASE_URL   走 CF AI Gateway 的 google-ai-studio 原生路径（绕开 Google 对数据中心 IP 的拒绝）
 *   DEEPSEEK_API_KEY  secret，DeepSeek key（sk- 开头）
 *   DEEPSEEK_BASE_URL secret，生产走 CF AI Gateway 的 /deepseek 路径（网关重试 + 日志）；
 *                      未配置时回退 https://api.deepseek.com/v1 直连
 *   GPT_API_KEY       secret，OpenAI 兼容接口 key（官方或中转均可）；别名 OPENAI_API_KEY
 *   GPT_BASE_URL      OpenAI 兼容接口地址，默认 https://api.openai.com/v1（中转接口改这里）；别名 OPENAI_BASE_URL
 *   GPT_MODELS        GPT 可用模型清单（逗号分隔），默认 gpt-6-luna,gpt-6-sol,gpt-6-astra；别名 OPENAI_MODELS
 *   兼容回退：LLM_API_KEY / LLM_BASE_URL（旧单模型配置）
 *   ACCESS_CODE       选填，设置后页面需输入访问口令（生产曾于 2026-09-28 启用，同日撤销，当前未设置）
 *   RATE_LIMIT_PER_MIN 选填，按访客 IP 的每分钟请求上限（**未设置则不限流**）。
 *                      仅本 isolate 内计数，属「降低」而非「根治」。
 *                      **生产当前未设 → 实际不限流**（2026-09-28 曾设 =20，同日按用户要求撤销）。
 *   LLM_TIMEOUT_MS    选填，上游大模型请求的**总**硬超时（毫秒），默认 300000（5 分钟）。
 *                      覆盖「建立连接 + 读完整个流」，防止上游挂起（不返回也不断开）时请求悬置。
 *                      注意它**不是**首字节约束：首字节由 LLM_FIRST_BYTE_MS 单独管。
 *   LLM_FIRST_BYTE_MS 选填，上游「吐首字节」的独立上限（毫秒），默认 80000（80 秒）。
 *                      为何单独设：CF 边缘约 100s 无数据即 524/reset，而 DeepSeek 经网关
 *                      首字节实测常 60~90s。旧版只有总超时（300s），永远轮不到自己报错，
 *                      用户拿到的是边缘 reset（AI Gateway 侧表现为 499/连接中断）。
 *                      设得比边缘阈值略低，才能在断连前由我们自己下发可读的终止事件。
 *   SSE_HEARTBEAT_MS  选填，SSE 空闲心跳间隔（毫秒），默认 15000，下限 1000（测试用）。
 *                      上游思考期可能数十秒无输出，CF 边缘约 100s 无数据即 524。
 *   UPSTREAM_IDLE_MS  选填，**上游**静默多久判挂死（毫秒），默认 60000，下限 1000（测试用）。
 *                      与心跳是两件事：心跳证明「本服务还活着」，它证明「模型还在输出」。
 *                      没有它，客户端那条「无输出超时」会被心跳一路续命到 330s 硬顶。
 *   LLM_MAX_TOKENS    选填，单次生成上限；未设置则不传（由上游按自身默认值裁定）。
 *   GPT_EFFORT        选填，gpt-5 / o 系思考模型的推理强度（minimal/low/medium/high），
 *                      默认 low（防超时）；对这些模型会自动剔除其不支持的 temperature。
 */

// 供应商解析共享层（白名单 / 自定义供应商 / json 响应 / 常量时间口令比较），与 models.js 同一口径
import { customProviders, customKeyEnv, modelWhitelist, json, bodyTooLarge, payloadTooLarge, requireCode as requireCodeGate } from './_lib.js';

// 入模规模上限：单请求最多 4,000（排盘）+ 8×2,000（历史）≈ 20,000 字符。
// 旧值 8,000 + 20×4,000 ≈ 88,000，在未设 ACCESS_CODE 时是可直接放大的费用敞口。
const LIMITS = { panText: 4000, historyTurns: 8, perMessage: 2000 };

// 上游流式响应的双重守卫。上游（用户自配的 OpenAI 兼容中转）属「信任边界外」，
// 恶意或异常时可打爆 isolate 内存（CF Workers 上限 128 MB）：
//   ① 持续发送不含 '\n' 的数据 → 行缓冲 buf 永不切分，无限增长；
//   ② 发送无限多条 data: 行   → 拼接正文 full 无限增长。
// 两者正常都不会发生：SSE 单行远小于 1 MB，正常断卦答复远小于 200 KB（约 6 万汉字）。
const SSE_MAX_LINE = 1000000;
const SSE_MAX_REPLY = 200000;

// 从 OpenAI 兼容 SSE 的 delta 中取「应透传给客户端的最终答案文本」。
// 导出供 test-functions.mjs 直接驱动（Pages Functions 只把 onRequest* 视作
// 路由处理函数，其余导出不影响路由）。
// reasoning_content 是模型的思考草稿：实测案例（2026-10-13，百炼思考模型）中，
// 草稿先错判「世在四爻妻财庚辰」、正式稿已自我纠正为「世在三爻妻财庚辰」，
// 旧版 pipeMergedSSE 把草稿一并拼接下传，导致断后 fact-audit 对全文字面
// 匹配出 6 处「与卦盘不符」的假阳性。故正文只认 content，草稿另走缓冲兜底。
export function deltaText(d) {
  if (!d || typeof d !== 'object') return '';
  return typeof d.content === 'string' ? d.content : '';
}

// 取思考草稿文本（仅用于「整条流无任何 content」时的兜底补发，见 pipeMergedSSE）。
export function deltaReasoning(d) {
  if (!d || typeof d !== 'object') return '';
  return typeof d.reasoning_content === 'string' ? d.reasoning_content : '';
}

// 限长读取响应体（非流式路径专用）。await resp.text()/resp.json() 会把整个
// body 先全量读入 isolate 内存（CF 上限 128 MB）——流式路径已有
// SSE_MAX_LINE/SSE_MAX_REPLY 双守卫，非流式兼容路径（上游忽略 stream 参数
// 回 JSON、或错误响应体）此前无对应守卫，信任边界外的异常上游可打爆内存
// （2026-10-21 审计修正）。读满 max 即停并 cancel 上游。
export async function readCapped(resp, max) {
  if (!resp || !resp.body || typeof resp.body.getReader !== 'function') {
    // 无 body（测试桩 / 已耗尽）：退化为 text()，由调用方的 try 兜底
    return (await resp.text()).slice(0, max);
  }
  const reader = resp.body.getReader();
  const dec = new TextDecoder();
  let out = '';
  try {
    while (out.length <= max) {
      const r = await reader.read();
      if (r.done) break;
      out += dec.decode(r.value, { stream: true });
    }
  } catch (e) { /* 上游已断开：返回已读部分 */ }
  try { reader.cancel().catch(function () { /* 已断开则忽略 */ }); } catch (e) { /* 已释放 */ }
  return out.slice(0, max);
}

// 按 IP 的滑动窗口限流（默认关闭，仅在配置了 RATE_LIMIT_PER_MIN 时生效）。
// 生产当前未设该变量 → 恒不触发；本函数保留为可随时启用的软开关。
// 模块级 Map 在 CF Workers 中随 isolate 存活，跨 isolate 不共享，故只是成本抑制的兜底。
const RL_HITS = new Map();
const RL_MAX_IPS = 5000;      // 单 isolate 内最多跟踪的 IP 数
const RL_WINDOW_MS = 60000;   // 窗口长度：1 分钟
// 导出供 test-functions.mjs 直接驱动（与 records.js 导出 jsonWithin/safeEqual 同一先例：
// Pages Functions 只把 onRequest* 视作路由处理函数，其余导出不影响路由）。
export function isRateLimited(request, env) {
  const limit = parseInt(env.RATE_LIMIT_PER_MIN || '0', 10);
  if (!limit || limit <= 0) return false;
  const now = Date.now();
  // IP 取用顺序：CF-Connecting-IP 由 Cloudflare 边缘写入，客户端伪造值会被边缘剥离，可信；
  // X-Forwarded-For 仅作非 CF 部署（本地 wrangler dev 等）的回退——该环境下它可被客户端伪造，
  // 故此时的限流只能算「降级可用」，不可作为安全边界。
  const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
  if (RL_HITS.size > RL_MAX_IPS) {
    // 只淘汰「窗口内已无有效计数」的 IP。旧版直接 clear() 会把正在被限流的访客一并放行。
    RL_HITS.forEach(function (arr, k) {
      if (!arr.length || now - arr[arr.length - 1] >= RL_WINDOW_MS) RL_HITS.delete(k);
    });
  }
  let hits = RL_HITS.get(ip);
  if (!hits) { hits = []; RL_HITS.set(ip, hits); }
  // 原地滑窗：把过期时间戳去掉（不新建数组，避免每次请求都分配）
  let keep = 0;
  for (let i = 0; i < hits.length; i++) { if (now - hits[i] < RL_WINDOW_MS) hits[keep++] = hits[i]; }
  hits.length = keep;
  // 达限即拒、且不再入队，使单个 IP 的数组长度被硬封顶在 limit。
  // 旧版无脑 push 后判 `length > limit`——判定结果与本写法等价，但数组会随请求数无界增长。
  if (hits.length >= limit) return true;
  hits.push(now);
  return false;
}

// ⚠ 与 public/app.js 的 SYSTEM_PROMPT 为同一份契约的两处副本：
//    改任一边都必须同步改另一边（app.js 那份还用于「复制请求内容手动断卦」的降级场景）。
//    test-functions.mjs 有断言守住「两份提示词的关键契约行一致」，见该文件 absorb 组。
export const SYSTEM_PROMPT = [
  '你是一位精通京房纳甲六爻的卦师，治学严谨，断卦有据。',
  '收到排盘后按以下次序通盘论断：',
  '一、列卦象要点：卦名卦宫、卦型（六冲六合游魂归魂）、世应、用神（按所测之事取之，两现说明取舍）、动爻及其化出、月建日辰生克、旬空月破、冲合。',
  '二、断吉凶：以用神与元神、忌神、仇神的生克为主线，以旺衰生克为纲，引经据典（《增删卜易》《卜筮正宗》等），术语用规范六爻术语，不得用现代心理学术语。',
  '三、断应期：据旬空、冲合、生扶之理推断应验之时。',
  '四、白话总结：用一段简明中文给出结论与建议。',
  '若信息不足，明确指出需补充何事，不得臆造。',
  // ↓ 上层契约四段：不可改盘 / 主次次序 / 追问沿用原盘 / 现实边界
  '【盘面事实不可改写】排盘里的六亲、纳甲、世应、动爻、旬空、月破、伏神、卦型均为程序确定性推算结果；' +
  '不得重新推算、不得改写，也不得写出与之矛盾的表述。吉凶、应期与取象可作传统推断，但须与盘面一致。',
  '【主次次序】以作用到世、应、用神的实际生克冲合为主证据；只出现在卦中却未作用到主线的结构，' +
  '列为辅助信息，不得升级为结论。不得用正负计分替代断卦。',
  '【追问沿用原盘】用户就同一事继续追问时，沿用本次排盘的起卦时刻、月日、爻值、世应与用神主线，' +
  '不重新起卦、不因当前日期变化而重算原盘、不事后改写首次结论；' +
  '只有当事项、对象、目标或时间范围发生实质变化时才说明需另起一卦。',
  '【现实边界】健康、生死、失踪、胎儿性别、重大财法决策不得由卦象替代现实判断；' +
  '涉及此类内容须明确提示就医、报警或咨询专业人士，不得写成医学诊断或法律意见。',
  '【用神既定】排盘文本已由规则引擎给出用神（六亲＋地支＋卦位）。断卦须沿用该用神；' +
  '确需另取时，须先说明理由，并保留原用神作对照，不得静默改取。',
  '【判语优先】盘面附带的判语（旺衰、旬空、月破、暗动、动不为空、旺不惧空、用神克世等）为规则链依古法所推，正文须逐条采纳；' +
  '与直觉相反者尤须照办——如「动不为空」「旺不惧空」，不得因「值旬空」就改判为凶。' +
  '若认为某条判语有误，须先引古法原文说明理由，再另行推断，不得静默绕过或只字不提。',
  '【结论须带依据】每条吉凶与应期结论后，用括号注明所依据的盘面要素（用神／世应／月建／日辰／动爻／旬空）；' +
  '找不到盘面依据的推断只能标为存疑，不得写成结论。',
  // ↓ 2026-10-24：应期须落在引擎换算出的窗口内（与 public/app.js 逐字符一致）。
  //   此前排盘文本只给扁平线索，模型只能写「近期会有变化」——线索里没有时间刻度，
  //   它没法更具体；本段把「猜时间」变成「解释这个区间」。
  '【应期按域】排盘文本已给出「应期窗口」（区间＋置信度＋依据＋下调原因），系规则链由出空／冲空／值日／出月／逢冲换算而来。' +
  '「应期」行须落在该区间内、沿用其置信度，并写明下调原因；不得脱离区间另给时间，也不得只写「近期」「不久」「看后续」这类无法核对的措辞。' +
  '短线（日、旬内）以日辰冲动、值日、出空为据；长线（月、年）以月建旺衰、旬空填实、伏神出现为据——两者不得互相套用。' +
  '若认定区间有误，须指明与哪一条盘面要素冲突。' +
  '但与本条与【应期同域】冲突时，以【应期同域】为准：事项以月／季／年为刻度时，' +
  '该窗口只作「节点辅证」——应期主刻度须落到月／季／年或流程节点，' +
  '不得因「须落在区间内」而写成日级干支日。（窗口由出空／值日换算，天然是日级，' +
  '对跨年之事本就无法承载应期，这是窗口的限度，不是盘面矛盾。）',
  // ↓ 2026-10-21：断语结论须与引擎 aggregateTrend 同向。此前只注入盘面、不注入 trend，
  //   同一张盘同一 provider 两次调用断出相反结论（平/凶），trend 算了却没人用。
  '【结论对齐】排盘文本另附「引擎判定」一行（吉／平／凶），系规则链依古法算出的确定性结果，与本提示其余判语同源。' +
  '正文的「结论」行须与之同向；若认定该判定有误，须先引古法原文说明理由，' +
  '并在结论行后括注「（与引擎分歧：引擎判X，此处判Y）」，不得静默给出相反结论。',
  // ↓ 法理层五段（2026-10-21 起）：实测两个大模型断同一「换医生还是不换」盘得出相反建议，
  //   事实层双方全对、分歧全在法理误用与取象越界——变爻跨位冲刑、应爻兼作他用、
  //   前提未定单引一诀、多选一强制站队。五段按「事实→法理→取象→前提→问法→自检」收口。
  '【法理口径】变爻只对本位动爻作回头生克冲合，不得跨位作用于其他爻；三刑冲合须论动静，静爻不成刑冲；' +
  '通关须动爻旺相有力方成；旬空为旬内概念——填实在值日、出空在出旬，不得引申至他月他旬。',
  '【取象边界】卦中无专爻代表所指之人或事时，不得将用神或应爻兼作他用；' +
  '一爻不得同时充任两个相互对立的选项（如既为子女又为「将被换掉的现任医生」）。' +
  '传统正取不在此列——如占病以子孙为医药医道、占财以妻财为货财，取用既定，取象随之。' +
  '取象推断须与旺衰生克之断分开表述，不得把象写成盘面事实。',
  '【前提未定】病之近久、事之进程等直接决定断法的前提，题面未给出时不得单引一诀下断' +
  '（如近病久病未定，不得径引「逢冲则愈/则凶」），须先声明前提未定，再按两种前提分别推断。',
  // ↓ 2026-10-27（M21）：前提元数据 / 缺项分级 / 应期同域 / 应期撤回。
  //   起因：「今年能不能考上市重点」这类问，题面没给时间范围与目标标准，模型直接把
  //   「今年」当本招生年度、把应期写成「甲子日」——跨年之事给了日级应期。修法不是把
  //   升学槽位写进通用规则，而是「原则驱动 + 领域包实例化」：本段只写与领域无关的
  //   五类槽位与两级风险，具体叫法由 core/domain-methods.js 的 premise 字段实例化。
  '【前提元数据】断卦前先核对五类通用前提，缺哪一类直接决定结论与应期怎么写：' +
  '① 时间范围——此事以什么跨度判定（日／旬／月／季／年）；' +
  '② 对象阶段——当事人此刻处在哪个阶段（未开始／进行中／已出结果待揭晓）；' +
  '③ 目标标准——要达成的具体目标与门槛；④ 进程状态——事情推进到哪一步；' +
  '⑤ 规则环境——决定成败的外部规则、政策或条件。五类与领域无关，具体叫法由「领域适配包」实例化。' +
  '（示例只示范写法，不是通用槽位表：问「今年能不能考上市重点」，时间范围＝本招生年度、' +
  '对象阶段＝应届在读、目标标准＝该校录取线、进程状态＝未开考、规则环境＝当地招生政策。）' +
  '古法「须指其所疑之事而占之」，即此意：所疑不明，卦无落点；不知对象阶段，则远近无从定。',
  '【缺项分级】缺项按影响分两级，不得一律回避也不得一律追问：' +
  '高风险（缺了会改变结论方向或应期量级——时间范围、进程状态、目标标准、对象阶段）——' +
  '首轮不得给出单一吉凶与单一应期，须先用一句话说明缺什么、为何影响判断，再按可能情形给条件分支，并提示用户补充；' +
  '低风险（只影响细节与措辞）——标注「前提未定」照常输出结论，可给条件性判断，但须写明所设假设。' +
  '不得替用户假定未说出的前提（如把某一年的考试默认为今年、把「今年」默认为会计年度或自然年）。',
  '【应期同域】古法总纲「远事定之以年月，近事应之于日时」（远近当分），本条即其落实——' +
  '应期粒度不得细于事项的时间跨度：跨月跨年之事只能给月／季／年或流程节点，' +
  '不得用日、旬或具体干支日；只有短期消息、旬内之事可用日旬。尺度取「此事的结论何时可能揭晓」，不取起卦日。' +
  '反向同样成立：旬月内之事给「明年」这类粗两档以上的应期，起不到可核对作用，亦须落到同域粒度。' +
  '用户补充的信息一旦改变时间跨度，原应期即失效，须按【应期撤回】处理，不得改写后继续沿用。',
  '【应期撤回】已给出的应期被新前提证伪时，按此模板撤回，不得静默改写，也不得只字不提：' +
  '「原应期 X 作废：与（哪条前提或盘面要素）冲突；在新前提下应期应落在（同域粒度），需另起一卦重断」。',
  '【多选一问法】所测若为「A还是B还是C」式多选一：卦面无专爻代表各选项，不得强制站队单选其一；' +
  '按「当前态势 → 可核对的节点（出空、填实、值日等） → 各选项适用的条件分支」输出条件决策树，每个分支注明盘面依据。',
  '【输出自检】正文写完后逐条核对：卦名、世应、动爻、旬空是否与排盘一致；所引口诀的前提是否成立；' +
  '应期是否与空破冲合一一对应；吉凶主线是否与世应生克自相矛盾（如世克用却断大吉、用旺无伤却断大凶）。' +
  '发现矛盾即改，不得带着矛盾交稿。',
  '【结构化结论】正文写完后另起五行，单独成行、不加粗、不编号、不加解释：',
  '结论：吉｜凶｜平（只填一个词）',
  '应期：<与事项跨度同域的粒度>（约 <公历区间，形如 10月20日—10月26日>）；跨月跨年之事不得写成具体干支日',
  '验证标志：一句话，须外部可观察、可判定真假（如「对方主动来电给出明确答复」）；不得写「有转机」「看后续」这类无法核对的话，也不得把结论换个说法再写一遍',
  '用神：六亲＋地支＋卦位',
  '前提完整性：完整｜缺失（先列缺失项，再给分支）｜前提未定（列分支）',

].join('\n');

function providerConfig(env, provider) {
  if (provider === 'gemini') {
    return {
      name: 'gemini',
      key: env.GEMINI_API_KEY || env.LLM_API_KEY || '',
      base: (env.GEMINI_BASE_URL || env.LLM_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, '')
    };
  }
  if (provider === 'deepseek') {
    return {
      name: 'deepseek',
      key: env.DEEPSEEK_API_KEY || env.LLM_API_KEY || '',
      base: (env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1').replace(/\/$/, '')
    };
  }
  if (provider === 'gpt') {
    // OpenAI 兼容接口（官方 api.openai.com 或任意中转/代理均可）
    return {
      name: 'gpt',
      key: env.GPT_API_KEY || env.OPENAI_API_KEY || '',
      base: (env.GPT_BASE_URL || env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '')
    };
  }
  // 自定义供应商（CUSTOM_PROVIDERS 声明的），密钥取 <ID>_API_KEY
  const cp = customProviders(env).filter(function (p) { return p.id === provider; })[0];
  if (cp) {
    return {
      name: provider,
      key: env[customKeyEnv(provider)] || '',
      base: (cp.base || 'https://api.openai.com/v1').replace(/\/$/, '')
    };
  }
  return null;
}

function inferProvider(model, wl) {
  const customs = Object.keys(wl).filter(function (k) { return k !== 'gemini' && k !== 'deepseek' && k !== 'gpt'; });
  for (let i = 0; i < customs.length; i++) {
    if (wl[customs[i]].indexOf(model) >= 0) return customs[i];
  }
  if (wl.gemini.indexOf(model) >= 0) return 'gemini';
  if (wl.deepseek.indexOf(model) >= 0) return 'deepseek';
  if (wl.gpt.indexOf(model) >= 0) return 'gpt';
  if (model.indexOf('gpt-') === 0 || model.indexOf('o1') === 0 || model.indexOf('o3') === 0) return 'gpt';
  return null;
}

export async function onRequestPost(context) {
  const { request, env } = context;
  // Pages Functions 的 waitUntil：慢路径必须先返回响应、再等上游落地，
  // 而 handler 返回后「游离 Promise」上的 fetch 会被运行时取消（见 slowSession 注释）。
  const waitUntil = typeof context.waitUntil === 'function' ? context.waitUntil.bind(context) : null;

  if (isRateLimited(request, env)) {
    return json({ error: 'RATE_LIMITED', message: '请求过于频繁，请稍后重试' }, 429);
  }

  // 口令闸走 _lib.js 的共享实现：常量时间比较 + 同 IP 失败计数（20 次/10 分钟 → 429）。
  // 旧版此处只有 safeEqual，没有计数——一旦单独启用 ACCESS_CODE（且未设限流），
  // 断卦端点就是无限速的爆破口；而 ACCESS_CODE 与 LIB_CODE 同源时可换取卦例库读权限。
  const denied = await requireCodeGate(request, env.ACCESS_CODE, '需要访问口令');
  if (denied) return denied;

  // 请求体总大小闸门（L1）：早于 request.json()，避免超大 body 先全量入内存
  if (bodyTooLarge(request)) return payloadTooLarge();

  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'BAD_JSON', message: '请求体解析失败' }, 400); }
  // JSON 文本 null 是合法 JSON，await request.json() 返回 null 而不抛错，
  // 下一行 body.panText 会解引用 null 抛未捕获 TypeError → 无 error code 的通用 500，
  // 前端 isRetriableError 也无法归类。
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return json({ error: 'BAD_JSON', message: '请求体应为 JSON 对象' }, 400);
  }

  // 类型边界：非字符串 panText（{} / [1,2] / 42）旧版被 .toString() 强转
  // （"[object Object]" / "1,2"）后通过非空与长度校验，作为排盘文本提交给
  // 模型——本端点无口令无限流时，这是可直接放大的无意义调用敞口。
  // 空/超限已有显式拒绝，此处补齐类型（2026-10-21 审计修正）。
  if (typeof body.panText !== 'string') {
    return json({ error: 'NO_PAN', message: '排盘文本应为字符串' }, 400);
  }
  const panTextRaw = body.panText;
  if (!panTextRaw) return json({ error: 'NO_PAN', message: '缺少排盘文本' }, 400);
  // 超限显式拒绝，不静默 slice：旧版硬切 4000 字符会把盘面尾巴（伏神/变爻/契约段）
  // 悄无声息地砍掉，模型仍会照着残缺文本断卦，且服务端无任何痕迹。
  if (panTextRaw.length > LIMITS.panText) {
    return json({ error: 'PAN_TOO_LONG', message: '排盘文本超长（上限 ' + LIMITS.panText + ' 字符）' }, 413);
  }
  const panText = panTextRaw;
  const history = Array.isArray(body.messages) ? body.messages.slice(-LIMITS.historyTurns) : [];
  /* skipCache：只影响上游网关缓存，不改任何生成参数。
     2026-10-21 起**首轮断卦默认跳过缓存**，理由是缓存对本产品的害处大于好处：
       ① 网关缓存键 = provider+endpoint+model+鉴权头+整个请求体，同一盘同一问
          重发必命中。首轮断卦的 body 恰好固定，是命中率最高的一类请求。
       ② 它会把**残篇一起固化**：gemini 偶发提前收尾（实测 137/405 tokens、
          正文断在句中），这份残篇进缓存后，用户重试（同一盘同一问）拿回的
          还是它 —— 重试按钮形同虚设。这才是「缓存伤害产品」的真实路径。
       ③ 而它对追问没用：追问 body 含 messages，与首轮不同键，本就不会命中。
       ④ 省下的钱有限：同一用户重复点同一盘断卦属少数场景。
     代价：同一盘重复断卦会真的重新生成（多花一次调用）。这正是我们想要的——
     用户点第二次，应该得到第二次的回答，而不是第一次的存档。
     要恢复旧行为（首轮也吃缓存）：设 env LLM_CACHE_FIRST=1。 */
  const firstTurn = history.length === 0;
  const skipCache = body.skipCache === true || body.skip_cache === true
    || (firstTurn && env.LLM_CACHE_FIRST !== '1');
  // 参数对照实验开关：仅在显式开启 env 时接受 body.variant（A/B/C），
  // 否则一律按 A（旧行为）。防止外部随意改生成参数。
  const variant = (env.LLM_DEBUG_VARIANTS === '1' && typeof body.variant === 'string')
    ? body.variant.toUpperCase().slice(0, 1) : null;

  const model = (body.model || '').toString();
  const wl = modelWhitelist(env);
  let provider = (body.provider || '').toString();
  if (!provider && model) provider = inferProvider(model, wl);
  // 必须用 owns 判定：wl 是普通对象字面量，`wl['constructor']` / `wl['__proto__']` 等
  // 会命中 Object.prototype 上的继承属性（truthy），使下一行 .indexOf 抛 TypeError → 边缘 500。
  if (!Object.prototype.hasOwnProperty.call(wl, provider)) {
    return json({ error: 'BAD_PROVIDER', message: '未知供应商：' + provider }, 400);
  }
  if (wl[provider].indexOf(model) < 0) {
    return json({ error: 'BAD_MODEL', message: '供应商 ' + provider + ' 不支持模型：' + model + '（可选：' + wl[provider].join(' / ') + '）' }, 400);
  }

  const cfg = providerConfig(env, provider);
  if (!cfg.key) return json({ error: 'NO_KEY', message: '服务端未配置 ' + provider.toUpperCase() + '_API_KEY 环境变量' }, 500);

  // Google 原生接口（generativelanguage.googleapis.com 或 AI Gateway 的 google-ai-studio 原生路径）
  // 走 streamGenerateContent?alt=sse + x-goog-api-key，并关闭 thinking（思考路径常因 high demand 503）；
  // 其余（含 Gateway 的 /openai 兼容路径、DeepSeek 等）按 OpenAI 兼容接口处理
  const isGoogle = cfg.base.indexOf('generativelanguage.googleapis.com') !== -1 ||
    (cfg.base.indexOf('google-ai-studio') !== -1 && cfg.base.slice(-7) !== '/openai');

  // 前提预检兜底（M21）：正常请求由 public/core/premise.js 在排盘文本里注入
  // 「【前提预检（…）】」块（五类槽位的确定性命中 + 应期刻度）。直接用 API 打
  // /api/interpret 的调用方不会有这一段，于是缺项分级与应期同域就只剩系统提示里的
  // 原则——模型容易退回「默认一个时间跨度」的老毛病。这里补一段最小限度的兜底：
  // 明确告诉它「没有预检结果，须自行判定并在正文声明假设」，而不是静默按自然年算。
  const PREMISE_FALLBACK = '【前提预检 · 缺失】本文未附规则链的槽位预检结果。' +
    '须先自行核对五类通用前提（时间范围／对象阶段／目标标准／进程状态／规则环境），' +
    '把缺项按【缺项分级】定级并在正文写明所设假设；' +
    '时间跨度不明确时不得给具体干支日，只给区间与触发条件。';
  const userContent = panText.indexOf('【前提预检') >= 0 ? panText : panText + '\n' + PREMISE_FALLBACK;
  const messages = [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: userContent }];
  history.forEach(function (m) {
    if (m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content) {
      messages.push({ role: m.role, content: m.content.slice(0, LIMITS.perMessage) });
    }
  });

  // CF AI Gateway 请求头：网关默认超时（实测 DeepSeek 约 91s）短于函数侧，
  // 显式声明与函数侧一致，避免网关先超时丢包。
  // 同时覆盖默认 3 次指数重试：DeepSeek 本身慢且大概率能成，网关重试会拖死 Worker；
  // Gemini/GPT 等快模型保留轻量重试，constant 1s 延迟足够覆盖偶发 503/429。
  // 注意：必须对**所有**走网关的分支生效——旧版只加在 OpenAI 兼容分支，
  // 而 GEMINI_BASE_URL 指向 gateway 的 google-ai-studio 路径时（README 记载的
  // 生产通道）不带头，函数侧等 300s、网关 ~91s 先 504，与注释意图相悖。
  function gatewayHeaders(base) {
    const h = {};
    if (base.indexOf('gateway.ai.cloudflare.com') === -1) return h;
    h['cf-aig-request-timeout'] = String(timeoutMs);
    h['cf-aig-max-attempts'] = provider === 'deepseek' ? '1' : '2';
    h['cf-aig-retry-delay'] = '1000';
    h['cf-aig-backoff'] = 'constant';
    // 逐请求跳过网关缓存。注意：网关的 cache_ttl=0 **不等于**不缓存——实测 liuyao-gw
    // 在 cache_ttl=0 下 40 条日志仍有 27 条 cached:true（HIT 时 tokens 0、耗时 <300ms）。
    // 缓存键是「provider+endpoint+model+鉴权头+整个请求体」的 SHA-256，故同一盘同一问
    // 重发必命中。产品上这未必是坏事（同一卦得同一断法），但它会把**截断/失败响应
    // 一起固化**，且让「同盘 N 次」拿不到独立样本。评测与重试用 skipCache 绕过。
    if (skipCache) h['cf-aig-skip-cache'] = 'true';
    return h;
  }

  // 按模型组装一次上游调用（Google 原生 SSE；其余 OpenAI 兼容流式）。
  // 抽成函数是为了「跨模型降级」：备选模型要用同一套参数构造规则再发一次。
  function buildCall(modelId) {
    if (isGoogle) {
      const contents = messages.filter(function (m) { return m.role !== 'system'; }).map(function (m) {
        return { role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] };
      });
      // generationConfig 三变体（2026-10-21 对照实验用）：
      //   默认/A = thinkingBudget:0（旧行为，强行关思考）
      //   B        = 不传 thinkingConfig（交给 gemini 3.x 自身动态思考）
      //   C        = 不传 thinkingConfig + maxOutputTokens 8192
      // 背景：gemini-3.6-flash 在 A 下只生成 137/405 tokens 就 finishReason=STOP，
      // 断语断在句中且无「结论：」行；怀疑对 3.x 关思考损伤长输出。
      // 变体只在 env.LLM_DEBUG_VARIANTS === '1' 时生效，生产默认关闭。
      const genCfg = { temperature: 0.2 };
      if (!variant || variant === 'A') {
        genCfg.thinkingConfig = { thinkingBudget: 0 };
      }
      if (maxTokens > 0) genCfg.maxOutputTokens = maxTokens;
      if (variant === 'C') genCfg.maxOutputTokens = 8192;
      return {
        // 原生接口也走流式（alt=sse）：非流式要在服务端等整篇生成完，
        // 期间 CF 边缘无任何字节下发，长答复会撞 ~100s 的 524；流式还能让前端逐段渲染。
        url: cfg.base + '/models/' + encodeURIComponent(modelId) + ':streamGenerateContent?alt=sse',
        headers: Object.assign(
          { 'x-goog-api-key': cfg.key, 'Content-Type': 'application/json' },
          gatewayHeaders(cfg.base)
        ),
        payload: {
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents: contents,
          generationConfig: genCfg
        }
      };
    }
    // 统一走流式（服务端拼接完整文本后返回），避免中转站网关的 60s 整响应硬超时
    const payload = { model: modelId, messages: messages, stream: true };
    if (maxTokens > 0) payload.max_tokens = maxTokens;
    if (/^(gpt-5|o[134])/.test(modelId)) {
      // gpt-5 / o 系思考模型：不支持 temperature；推理强度可用环境变量 GPT_EFFORT 调（minimal/low/medium/high），默认 low 防超时
      const effort = (env.GPT_EFFORT || 'low').trim();
      if (effort && effort !== 'none') payload.reasoning_effort = effort;
    } else {
      payload.temperature = 0.2;
    }
    const headers = Object.assign(
      { 'Authorization': 'Bearer ' + cfg.key, 'Content-Type': 'application/json' },
      gatewayHeaders(cfg.base)
    );
    return {
      url: cfg.base + '/chat/completions',
      headers: headers,
      payload: payload
    };
  }

  // 【死代码，保留备查】流式透传上线后已无调用点（2026-10-13 审计确认）。
  // SSE_MAX_* 双守卫已迁入活路径 pipeMergedSSE；此函数仅留作「非流式降级」
  // 的参考实现，若中转站忽略 stream 参数回 JSON 需重新启用，勿直接删除——
  // 其中的守卫语义（LINE_OVERFLOW / REPLY_OVERFLOW）是活路径的对齐基准。
  async function readSSE(resp) {
    const reader = resp.body.getReader();
    const dec = new TextDecoder();
    let buf = '', full = '', cut = null;
    while (true) {
      const r = await reader.read();
      if (r.done) break;
      buf += dec.decode(r.value, { stream: true });
      // 守卫①：上游持续发送不含换行的数据，行缓冲永不切分。撞上即判定为异常流并断开。
      if (buf.length > SSE_MAX_LINE) { cut = 'LINE_OVERFLOW'; break; }
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (line.indexOf('data:') !== 0) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        try {
          const j = JSON.parse(data);
          const c = j.choices && j.choices[0];
          const d = c && c.delta;
          if (d && d.content) full += d.content;
          else if (c && c.message && c.message.content) full += c.message.content; // 部分中转站流里回完整段
        } catch (e) { /* 忽略无法解析的分片 */ }
      }
      // 守卫②：上游发送无限多条 data: 行，拼接正文无限增长。保留已收到的部分答复后断开。
      if (full.length > SSE_MAX_REPLY) { cut = 'REPLY_OVERFLOW'; break; }
    }
    if (cut) { try { await reader.cancel(); } catch (e) { /* 上游已断开则忽略 */ } }
    return { text: full.slice(0, SSE_MAX_REPLY), cut: cut };
  }

  // 上游硬超时。fetch 默认无超时，上游挂起（不返回也不断开）会让该请求一直悬置，
  // 流式只绕过了「整响应超时」，并不自带超时保护。计时覆盖「建连 + 读完整流」全程；
  // Gemini 断卦约 10–30 s；DeepSeek（含深推理模型）可超 90 s，默认 300 s 留足余量
  // （可用 LLM_TIMEOUT_MS 调）。
  // 计时器覆盖主调用与降级重试的总时长，超时任一环节都会被 abort 并落入下方 504 分支。
  const timeoutMs = Math.max(1000, parseInt(env.LLM_TIMEOUT_MS || '300000', 10) || 300000);
  // 采样日志用的请求起点（见 pipeMergedSSE 末尾 ev=stream_end）
  const startedAt = Date.now();
  // 生成上限：未配置则不传，避免把上游默认值写死；配置后 Google/OpenAI 两条路径同口径。
  const maxTokens = Math.max(0, parseInt(env.LLM_MAX_TOKENS || '0', 10) || 0);
  // 心跳间隔：默认 15s，下限 1s（留 (SSE_HEARTBEAT_MS) 给测试压到 1s 验证「心跳真的发出去了」）。
  const hbMs = Math.max(1000, parseInt(env.SSE_HEARTBEAT_MS || '15000', 10) || 15000);
  const ctrl = new AbortController();
  let timedOut = false;
  // 客户端断开（关标签页 / 前端 abort）与「上游超时」必须区分：
  // 前者应立即掐断上游（否则 stream 写入触发背压挂住，白烧 token 到 300s），
  // 且不得触发跨模型降级重试——没人接收的第二次调用纯属浪费。
  let clientGone = false;
  const timer = setTimeout(function () { timedOut = true; ctrl.abort(); }, timeoutMs);
  if (request.signal) {
    const onClientAbort = function () { clientGone = true; ctrl.abort(); };
    if (request.signal.aborted) onClientAbort();
    else request.signal.addEventListener('abort', onClientAbort, { once: true });
  }
  // 流式透传路径的超时保护必须延续到「读完整条流」全程。
  // return new Response(readable) 会同步触发下方 finally，若在 finally 里无条件
  // clearTimeout，计时器在流还没开始读时就已注销，上游挂起将导致请求无限悬挂。
  // 故流式分支把计时器「托管」给 pipeMergedSSE，由其在流结束时清除；
  // 心跳 setInterval 同理，随流生命周期启停。
  let timerHandedOff = false;
  let heartbeat = null;

  // 首字节独立守卫（2026-10-27）。旧版只有上面的总超时（默认 300s），而 CF 边缘在
  // 「约 100s 无任何字节」时就会 reset —— 于是 300s 那条永远轮不到触发，用户拿到的是
  // 一条没有任何 JSON 的断连。DeepSeek 经网关首字节实测 60~90s（探针：76s 后被 reset、
  // 收到 0 字节），正落在这个窗口里。这里把首字节单独设上限（默认 80s < 边缘阈值），
  // 让我们能在边缘动手之前自己下发可读的终止事件。
  const firstByteMs = Math.max(1000, parseInt(env.LLM_FIRST_BYTE_MS || '80000', 10) || 80000);
  let firstByteTimedOut = false;
  // 先发首字节的阈值：上游若在此时间内给出响应（正常流头 / 4xx / 5xx），沿用原有
  // 「直接返回 JSON 或流」的路径，错误语义与状态码一律不变；超过则先建 SSE 再等，
  // 使等待期不再是零字节（详见下方 FAST_HEADER_MS 分流）。
  // 可临时用 LLM_FAST_HEADER_MS=1 把**所有**请求赶进慢路径，用于压测/回归那条分支。
  const FAST_HEADER_MS = Math.max(1, parseInt(env.LLM_FAST_HEADER_MS || '1500', 10) || 1500);
  function wait(ms) { return new Promise(function (res) { setTimeout(res, ms); }); }

  // 单次上游尝试。成功 → { reply, cut }；失败 → { fail: { status, detail, retryable } }。
  // retryable=false 表示 4xx 客户端错误（模型名非法/请求体错误等），换模型重试无意义；
  // 429/5xx 与网络错误视为可恢复，允许跨模型降级。
  async function attempt(modelId) {
    const call = buildCall(modelId);
    let resp;
    try {
      resp = await fetch(call.url, {
        method: 'POST',
        headers: call.headers,
        body: JSON.stringify(call.payload),
        signal: ctrl.signal
      });
    } catch (e) {
      // 硬超时 / 首字节超时 / 客户端断开交由外层统一处理（不可当成可重试的上游失败，
      // 否则会在同一 ctrl 已被 abort 的前提下再发一次注定失败的请求）
      if (timedOut || clientGone || firstByteTimedOut) throw e;
      return { fail: { status: 0, detail: e.message, retryable: true } };
    }
    if (!resp.ok) {
      // 限长读：上游错误体只进服务端日志（不回传客户端），读满 2 KB 即停，
      // 防止异常/恶意中转站以超大错误体消耗 isolate 内存。
      const t = await readCapped(resp, 2000);
      const st = resp.status;
      return { fail: { status: st, detail: t.slice(0, 500), retryable: st === 429 || st >= 500 } };
    }
    const ct = (resp.headers.get('content-type') || '').toLowerCase();
    // 两条路径现在都走流式：OpenAI 兼容（stream:true）与 Google 原生（alt=sse）。
    // 上游若忽略 stream 参数回 JSON，仍走下面的非流式解析（兼容老中转）。
    if (ct.indexOf('text/event-stream') !== -1 && (isGoogle || call.payload.stream)) {
      // 上游返回 SSE 时，直接透传给客户端，避免服务端缓冲导致 CF 边缘 524 超时。
      // 服务端拼接完整文本的旧路径已弃用：深推理模型的整体响应可超 120s，
      // CF 边缘约 100s 无数据即断连；透传流式后首字节一到即开始向下发送。
      return { stream: resp };
    }
    // 非流式 JSON：同样限长读后解析，reply 按 SSE_MAX_REPLY 截断并标
    // truncated（与流式路径守卫②同口径，见 pipeMergedSSE）。
    const raw = await readCapped(resp, SSE_MAX_REPLY + 1024);
    let data = null;
    try { data = JSON.parse(raw); } catch (e) { /* 解析失败走下方统一失败分支 */ }
    if (!data) {
      return { fail: { status: 502, detail: '非流式响应解析失败', retryable: true } };
    }
    let reply = '';
    if (isGoogle) {
      const cand = data.candidates && data.candidates[0];
      const parts = cand && cand.content && cand.content.parts;
      reply = parts ? parts.map(function (p) { return p.text || ''; }).join('') : '';
    } else {
      const choice = data.choices && data.choices[0];
      reply = choice && choice.message ? (choice.message.content || '') : '';
    }
    /* 空正文必须留痕（2026-10-28）：上游忽略 stream 参数、回一段既无 choices 也无
       candidates 的 JSON 时，旧版只把 reply:'' 交回去，前端显示「大模型返回为空」，
       服务端一行日志都没有——AI Gateway 日志里那串「1 秒完成、0 token」的空返回
       因此无法归因（前端只能看到同一句话重复 N 次）。原始体头部一律打进日志；
       若带 error 字段，直接按上游错误处理，别再当成「静默空返回」再重试一轮。 */
    if (!reply) {
      const head = String(raw).slice(0, 400);
      console.error('[liuyao] 非流式响应无正文:', head);
      if (data.error) {
        return { fail: { status: 502, detail: '上游错误体: ' + head, retryable: true } };
      }
    }
    return { reply: reply.slice(0, SSE_MAX_REPLY), cut: reply.length > SSE_MAX_REPLY ? 'REPLY_OVERFLOW' : null };
  }

  // ---- SSE 会话样板 ----
  // 快速路径（上游在 FAST_HEADER_MS 内响应）与慢速路径（先建流再等上游）共用，
  // 差别只在「谁先建立响应」。首字节、心跳、计时器、writer 收尾集中在这里，
  // 避免两处各写一份又漂移（旧版心跳就曾挂在已 releaseLock 的 writer 上而全程失效）。
  const SSE_HEADERS = {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  };
  let firstByteTimer = null;

  function openSession() {
    const { readable, writable } = new TransformStream();
    const enc = new TextEncoder();
    const writer = writable.getWriter();
    // 首字节：SSE 注释行，客户端解析器直接跳过；作用是让边缘/网关立刻看到数据。
    writer.write(enc.encode(': ping\n\n')).catch(function () { /* 客户端已断开则忽略 */ });
    if (variant) {
      // 对照实验：把实际生效的变体回显给调用方，免得配置没打开却以为测了 B/C
      writer.write(enc.encode('data: ' + JSON.stringify({ variant: variant }) + '\n\n')).catch(function () { });
    }
    // 周期心跳：每 hbMs（默认 15s）写一次注释行。上游思考期（DeepSeek 可数十秒无输出）
    // 超过 CF 边缘 ~100s 无数据即 524 断连，故必须持续写。与正文共用同一 writer：
    // 写入按调用顺序排队，每个 ping 都是完整 SSE 帧，不会与其他帧撕裂。
    heartbeat = setInterval(function () {
      writer.write(enc.encode(': ping\n\n')).catch(function () { /* 客户端断开则停 */ });
    }, hbMs);
    let finished = false;
    function finish() {
      if (finished) return;
      finished = true;
      if (heartbeat) { clearInterval(heartbeat); heartbeat = null; }
      clearTimeout(timer);
      if (firstByteTimer) { clearTimeout(firstByteTimer); firstByteTimer = null; }
      // close() 返回 promise：流已 error 时以存储错误拒绝，同步 try/catch 接不住
      try { writer.close().catch(function () { /* 已关闭则忽略 */ }); } catch (e) { /* 已释放 */ }
    }
    return {
      enc: enc, writer: writer, finish: finish,
      response: new Response(readable, { headers: SSE_HEADERS })
    };
  }

  // 上游 SSE → 客户端 SSE。守卫①②、finishReason、完整性告警、收流日志都在这里。
  // 与旧版的差别只有两处：
  //   ① 思考草稿以 {"r":"…"} **实时**下发（前端只作进度显示，绝不进正文，
  //      原因见上方 deltaText 注释里的 6 处 fact-audit 假阳性）；
  //   ② 跑完整条流仍一个字都没有时，显式下发 {"error":"EMPTY_UPSTREAM"}。
  async function pipeUpstreamSSE(upstream, w, enc) {
    const reader = upstream.body.getReader();
    const dec = new TextDecoder();
    let buf = '', outLen = 0, cut = null, reasBuf = '';
    // 本次回答是否只是「思考草稿兜底补发」的产物（正文其实一个字节都没来）。
    // 置位后要额外下发 DRAFT_ONLY 告警，前端据此提示并走残篇补发，别把草稿当断语。
    let draftOnly = false;
    // 思考片段计数（仅观测，不改输出）：Google 原生流里思考内容以
    // parts[{ text, thought:true }] 返回，而下方统一按 p.text 拼接。
    let thoughtLen = 0;
    // finishReason：上游「为什么停」。旧版完全不读——于是 MAX_TOKENS / SAFETY
    // 截断的半个断语被当作正常完整响应交给用户。
    let finish = null;
    // 文末快照：用于判定「结构化结论」是否齐全（结论四行必在文末）。
    let tail = '';
    const writeErr = async function (code, msg) {
      try {
        await w.write(enc.encode('data: ' + JSON.stringify({ error: code, message: msg }) + '\n\n'));
      } catch (e) { /* 客户端已断开则忽略 */ }
    };
    /* 上游静默看门狗（2026-10-28）。心跳每 15s 写一次 `: ping`，而客户端那条
       「无输出才超时」的守卫把任何字节都当成「还在动」——于是上游挂死时，它会一路
       续命到 330s 硬顶，用户对着「模型思考中… 已输出 6.9k 字」干等五分钟。
       实测：deepseek-flash 在含混题面下吐 ~4KB 思考后整条流彻底静默（服务端连
       r.done 都收不到），本地 curl 同样停在第 232 帧不动。
       这里按「上游多少秒没有任何字节」独立计时：思考片段也是字节，正常长思考不会误杀。 */
    const UPSTREAM_IDLE_MS = Math.max(1000, parseInt(env.UPSTREAM_IDLE_MS || '60000', 10) || 60000);
    let lastUp = Date.now(), stalled = false;
    // 轮询间隔跟着阈值缩（生产 60s → 每 5s 一查；测试把它设成 1s → 每 250ms 一查）
    const stallTickMs = Math.min(5000, Math.max(200, Math.floor(UPSTREAM_IDLE_MS / 4)));
    const stallTimer = setInterval(function () {
      if (stalled || Date.now() - lastUp <= UPSTREAM_IDLE_MS) return;
      stalled = true;
      // cancel() 让挂起的 read() 立即返回，循环自然退出（不抛错，避免与超时分支混淆）
      try { reader.cancel().catch(function () { /* 已释放则忽略 */ }); } catch (e) { /* 已释放 */ }
    }, stallTickMs);
    try {
      while (true) {
        const r = await reader.read();
        if (r.done) break;
        lastUp = Date.now();
        buf += dec.decode(r.value, { stream: true });
        // 守卫①：上游持续发送不含换行的数据，行缓冲永不切分。撞上即判定为异常流并断开。
        if (buf.length > SSE_MAX_LINE) {
          cut = 'LINE_OVERFLOW';
          await writeErr(cut, '上游单行数据异常，已中断');
          break;
        }
        let idx;
        while ((idx = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (!line || line.indexOf(':') === 0) continue;
          if (line.indexOf('data:') !== 0) continue;
          const data = line.slice(5).trim();
          if (!data || data === '[DONE]') continue;
          let chunk = '';
          try {
            const j = JSON.parse(data);
            const c = j.choices && j.choices[0];
            const d = c && c.delta;
            if (c && c.finish_reason) finish = c.finish_reason;
            if (d) {
              // 只把最终答案（content）当正文。reasoning_content 是模型的思考草稿：
              // 内含未纠正的临时判断（实测：草稿写「世在四爻妻财」，正式稿为「三爻」），
              // 一旦并进正文会造成 fact-audit 假阳性、追问历史被污染、用户先读一大段独白。
              chunk += deltaText(d);
              if (!chunk) {
                const rc = deltaReasoning(d);
                if (rc && reasBuf.length <= SSE_MAX_REPLY) {
                  reasBuf += rc;
                  // 实时下发思考进度（独立字段 r）：既让用户在 60~90s 的思考期看到
                  // 「还在动」，也让这条 TCP 流持续有帧，不会因长时间静默被中间层掐断。
                  try {
                    await w.write(enc.encode('data: ' + JSON.stringify({ r: rc }) + '\n\n'));
                  } catch (e) { /* 客户端已断开则忽略 */ }
                }
              }
            } else if (c && c.message && c.message.content) {
              chunk = c.message.content;
            } else if (j.candidates) {
              // Google 原生 SSE（streamGenerateContent?alt=sse）：
              // { candidates:[{ content:{ parts:[{ text:"…" }] } }] }
              const cand = j.candidates[0];
              if (cand && cand.finishReason) finish = cand.finishReason;
              const parts = cand && cand.content && cand.content.parts;
              if (parts) {
                const body = [];
                for (let pi = 0; pi < parts.length; pi++) {
                  const p = parts[pi];
                  if (p && p.thought && typeof p.text === 'string') {
                    // 思考片段（thinkingConfig 被忽略时 gemini 3.x 会真的吐草稿）：
                    // 旧版把它按 p.text 一并拼进正文 —— 正是 2026-10-13 fact-audit
                    // 6 处假阳性的成因。现在与 OpenAI 的 reasoning_content 同待遇：
                    // 只走 r 通道，不进正文。
                    thoughtLen += p.text.length;
                    if (p.text) {
                      try {
                        await w.write(enc.encode('data: ' + JSON.stringify({ r: p.text }) + '\n\n'));
                      } catch (e) { /* 客户端已断开则忽略 */ }
                    }
                    continue;
                  }
                  body.push((p && p.text) || '');
                }
                chunk = body.join('');
              }
            }
          } catch (e) { /* 忽略无法解析的分片 */ }
          if (chunk) {
            outLen += chunk.length;
            // 守卫②：正文总长上限，防上游不限流数据打爆 isolate 内存
            if (outLen > SSE_MAX_REPLY) {
              cut = 'REPLY_OVERFLOW';
              await writeErr(cut, '上游返回过长，已截断');
              break;
            }
            await w.write(enc.encode('data: ' + JSON.stringify({ t: chunk }) + '\n\n'));
            // 只留尾部 600 字符用于「结构化完整性」判定：结论四行必在文末
            tail = (tail + chunk).slice(-600);
          }
        }
        if (cut) break;
      }
      // 被看门狗打断：显式告知，且**不要**再走下面「草稿兜底补发」——上游没写完，
      // 把半截草稿当答复发下去只会让前端多猜一次。
      if (stalled) {
        await writeErr('UPSTREAM_STALL', '上游 ' + Math.round(UPSTREAM_IDLE_MS / 1000) +
          ' 秒内没有任何输出（思考挂死），请换一个模型');
        cut = 'UPSTREAM_STALL';
      }
      // 兜底补发：全程只有 reasoning_content、没有任何 content（个别中转/模型
      // 把最终答案也放进思考字段）时，流末一次性补发，避免客户端按「空响应」
      // 重试或报 EMPTY。走到这里只可能是 r.done 正常收流。
      if (!cut && outLen === 0 && reasBuf) {
        draftOnly = true;
        try {
          // draft:true —— 这一段的身份是**思考草稿**，不是断语。2026-10-28：
          // 旧版原样当 t 正文补发且不带标记，于是「10.2k 字思考」被渲染成断语正文
          // （还会进 fact-audit 造成假阳性），用户看到的就是「思考了很多，正文到某处就没了」。
          await w.write(enc.encode('data: ' + JSON.stringify({ t: reasBuf, draft: true }) + '\n\n'));
          // 补发的是**思考草稿**，也必须计入正文长度与尾部快照。
          outLen += reasBuf.length;
          tail = reasBuf.slice(-600);
        } catch (e) { /* 客户端已断开则忽略 */ }
      }
      // 空流必须显式告知（2026-10-27）：旧版 outLen===0 且无草稿时直接关流，
      // 客户端只看到「流结束、一个字没有」，判为空响应后静默重试 —— AI Gateway
      // 日志里那串 1s 请求就是这么来的（指数退避打满 180s、18 次），用户侧
      // 全程只看到「推卦中…」。现在给它一个明确的终止事件，前端能立刻换模型。
      if (!cut && outLen === 0) {
        await writeErr('EMPTY_UPSTREAM', '上游整条流未返回任何内容（finish=' + (finish === null ? 'none' : finish) + '）');
      }
      // 草稿补发必须自报身份：前端会提示「这是草稿」并改用残篇补发再要一篇正式稿。
      if (!cut && draftOnly) {
        try {
          await w.write(enc.encode('data: ' + JSON.stringify({
            warn: 'DRAFT_ONLY',
            message: '上游只返回了思考草稿（' + outLen + ' 字符），没有正式答复'
          }) + '\n\n'));
        } catch (e) { /* 客户端已断开则忽略 */ }
      }
      // 非正常收尾必须显式告知客户端：MODEL_TRUNCATED 不是网络问题——重试只会
      // 再撞一次同一个上限，所以单列 warn 事件，由前端提示「本卦未完篇」。
      if (!cut && finish && finish !== 'STOP' && finish !== 'stop' && finish !== 'end_turn') {
        try {
          await w.write(enc.encode('data: ' + JSON.stringify({
            warn: 'MODEL_' + finish,
            message: '上游以 ' + finish + ' 收尾，断语未完篇（已收到 ' + outLen + ' 字符）'
          }) + '\n\n'));
        } catch (e) { /* 客户端已断开则忽略 */ }
      }
      /* finish 缺失 = 「上游什么都没说就断了」（2026-10-28 补）。
         正常收流的 SSE 一定带结束原因：OpenAI 兼容是 finish_reason，Gemini 原生是
         finishReason。旧版只在 finish 有值时才判「非正常收尾」，于是 finish === null
         被当成完美完篇 —— 实测正是「正文写到『用神』一行、后面没了、一条告警都没有」
         的成因：流在传输层自然结束，模型既没停也没报错。 */
      if (!cut && finish === null && outLen > 30) {
        try {
          await w.write(enc.encode('data: ' + JSON.stringify({
            warn: 'MODEL_NO_FINISH',
            message: '上游未给出结束原因（流自然结束），断语可能在 ' + outLen + ' 字符处被截断'
          }) + '\n\n'));
        } catch (e) { /* 客户端已断开则忽略 */ }
      }
      // 结构化完整性：《结论对齐》契约要求文末四行。结论行缺失即视为「没断完」，
      // 无论上游自称停得多么正常。只管首次断卦（history 为空）。
      // 注：**不**把「用神：」一并纳入判定——模型在正文明细里常写「用神父母巳火二爻发动」
      // 而不带冒号，硬测会把这个正常完篇判成残篇（test-functions「不告警反向对照」即此形）。
      // 断在「用神」行之后的残篇由上面的 MODEL_NO_FINISH 捕获。
      if (!cut && history.length === 0 && outLen > 30 && !/结[论局]\s*[：:]/.test(tail)) {
        try {
          await w.write(enc.encode('data: ' + JSON.stringify({
            warn: 'INCOMPLETE_STRUCTURE',
            message: '断语缺少「结论：」行，疑未写完（已收到 ' + outLen + ' 字符）'
          }) + '\n\n'));
        } catch (e) { /* 客户端已断开则忽略 */ }
      }
      /* 收流留痕：finish(null 也是有效值)/字符数/思考片段长度一并落日志，
         之后统计即可区分「模型自己停」与「流被提前关闭」，不必再靠猜参数。 */
      try {
        console.log(JSON.stringify({
          ev: 'stream_end',
          finish: finish === null ? null : String(finish),
          chars: outLen,
          thought: thoughtLen,
          cut: cut || null,
          empty: outLen === 0,
          draft: draftOnly,
          first: history.length === 0,
          ms: Date.now() - startedAt
        }));
      } catch (e) { /* 日志失败不影响响应 */ }
    } catch (e) {
      // 上游断连 / abort（含超时）：告知客户端这是中断而非完篇
      await writeErr(timedOut || firstByteTimedOut ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_STREAM_ERROR',
        timedOut || firstByteTimedOut
          ? ('上游 ' + Math.round((firstByteTimedOut ? firstByteMs : timeoutMs) / 1000) + ' 秒内未返回内容')
          : ('上游连接中断：' + (e && e.message ? e.message : '未知原因')));
    } finally {
      clearInterval(stallTimer);
      // cancel() 返回 promise：流已 error 时以存储错误拒绝，必须挂 .catch
      try { reader.cancel().catch(function () { /* 上游已断开则忽略 */ }); } catch (e) { /* 已释放 */ }
    }
  }

  // 慢速会话：先建 SSE（首字节 + 心跳立即生效），再去等上游落地。
  // 这正是「请求一堆却没有内容」的根治点：旧版把等待留在 Response 返回之前，
  // 客户端在 60~90s 内收到的是零字节，边缘 reset 后前端只能判失败并重试。
  function slowSession(pending, usedModel) {
    timerHandedOff = true;
    const s = openSession();
    const w = s.writer, enc = s.enc;
    const frame = function (obj) {
      return w.write(enc.encode('data: ' + JSON.stringify(obj) + '\n\n')).catch(function () { /* 客户端已断开 */ });
    };
    const task = (async function () {
      try {
        let r = await pending;
        if (firstByteTimer) { clearTimeout(firstByteTimer); firstByteTimer = null; }
        // 与快速路径同一条跨模型降级规则（gemini 侧 high demand 持续 503）
        if (r.fail && r.fail.retryable && provider === 'gemini') {
          const alt = wl.gemini.filter(function (m) { return m !== model; })[0];
          if (alt) {
            const r2 = await attempt(alt);
            if (!r2.fail) { usedModel = alt; r = r2; }
          }
        }
        if (r.fail) {
          if (r.fail.status === 0) {
            console.error('[liuyao] 上游连接失败:', r.fail.detail);
            await frame({ error: 'NET_ERROR', message: '无法连接大模型服务，请稍后重试' });
            return;
          }
          console.error('[liuyao] 上游返回 ' + r.fail.status + ':', r.fail.detail);
          // 429 单独映射：配额用尽不是本服务故障，不能按「接口未就绪」重试
          if (r.fail.status === 429) {
            await frame({ error: 'UPSTREAM_RATE_LIMITED', message: '上游模型配额或速率已用尽（429），请换一个模型或稍后再试' }); return;
          }
          await frame({ error: 'LLM_ERROR', message: '大模型接口返回 ' + r.fail.status + '，请稍后重试' }); return;
        }
        if (r.stream) { await pipeUpstreamSSE(r.stream, w, enc); return; }
        if (!r.reply) { await frame({ error: 'EMPTY_UPSTREAM', message: '大模型返回为空' }); return; }
        // 上游忽略了 stream 参数、直接回整段 JSON：同样以 SSE 下发（头已经发出，回不了 JSON）
        await frame({ t: r.reply });
        if (r.cut) await frame({ warn: r.cut, message: '上游返回过长，已截断' });
      } catch (e) {
        if (clientGone) return;
        await frame({
          error: (timedOut || firstByteTimedOut) ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_STREAM_ERROR',
          message: (timedOut || firstByteTimedOut)
            ? ('上游 ' + Math.round((firstByteTimedOut ? firstByteMs : timeoutMs) / 1000) + ' 秒内未返回内容')
            : ('上游连接中断：' + (e && e.message ? e.message : '未知原因'))
        });
      } finally {
        s.finish();
      }
    })();
    /* 没有这一行，慢路径必崩：handler 一返回，运行时就把上面这个「游离」的 fetch 取消掉，
       于是出现「响应头 1.5s 就到了、紧接着上游被掐」的 499（dur≈1.5s），客户端只拿到空流，
       按 6s 退避重试十几次——正是 2026-10-27 15:00 那批日志的形状。
       waitUntil 把这条任务挂在请求生命周期上，fetch 才会继续跑完。 */
    if (waitUntil) {
      try { waitUntil(task); } catch (e) { /* 运行时无此能力则退化为原行为 */ }
    }
    return s.response;
  }

  try {
    let usedModel = model;
    // 立刻发起上游请求（同步启动 fetch）：分流判定期间不浪费任何时间
    const pending = attempt(usedModel);
    firstByteTimer = setTimeout(function () { firstByteTimedOut = true; ctrl.abort(); }, firstByteMs);
    /* 快速/慢速分流（2026-10-27 重构的入口）：
       上游若在 FAST_HEADER_MS 内响应（正常流头 / 4xx / 5xx），走**原有**路径——
       错误照旧返回 JSON、状态码照旧（401/404/429/502），前端契约一行不动。
       超过 FAST_HEADER_MS 仍未响应，说明撞上了「慢思考」模型（DeepSeek 实测
       60~90s 不吐首字节），此时立刻建立 SSE 并下发首字节 + 心跳，再去等上游。
       这样等待期不再有「零字节窗口」，边缘不会 reset，用户也能马上看到进度。 */
    const fast = await Promise.race([
      pending.then(function (v) { return { v: v }; }, function (e) { return { e: e }; }),
      wait(FAST_HEADER_MS).then(function () { return null; })
    ]);
    if (!fast) return slowSession(pending, usedModel);
    if (firstByteTimer) { clearTimeout(firstByteTimer); firstByteTimer = null; }
    if (fast.e) throw fast.e;
    let r = fast.v;
    // gemini 跨模型降级（2026-10-12）：所选模型可恢复性失败（429/5xx/网络错误）时，
    // 自动落到同族备选模型重试一次。起因：gemini-3.8-flash 常因 Google 侧 high demand
    // 整段 503（AI Gateway 日志自 2026-10-01 起反复出现），网关 3 次重试盖不住持续拥塞；
    // 4xx 属配置/请求错误，换模型同样失败，不降级。
    // 备选也失败时保留**首次**错误返回——它更贴近用户所选模型的真实状态。
    let fellBackTo = null;
    if (r.fail && r.fail.retryable && provider === 'gemini') {
      const alt = wl.gemini.filter(function (m) { return m !== model; })[0];
      if (alt) {
        const r2 = await attempt(alt);
        if (!r2.fail) { fellBackTo = alt; usedModel = alt; r = r2; }
      }
    }
    if (r.fail) {
      // 上游原始错误体只进服务端日志，不回传客户端：本端点未配 ACCESS_CODE /
      // RATE_LIMIT_PER_MIN 时完全开放，而自配中转站的错误响应可能回显请求头或
      // key（部分中转确有此类行为），直接透出会造成 *_API_KEY 泄露。
      // 前端只需 data.error 即可完成重试分类，detail 对它没有价值。
      if (r.fail.status === 0) {
        console.error('[liuyao] 上游连接失败:', r.fail.detail);
        return json({ error: 'NET_ERROR', message: '无法连接大模型服务，请稍后重试' }, 502);
      }
      console.error('[liuyao] 上游返回 ' + r.fail.status + ':', r.fail.detail);
      /* 429 单独映射（2026-10-21 晚）：上游是「配额/速率用尽」，不是本服务故障。
         旧版一律 502，前端把它当「接口未就绪」重试 20 轮、耗三分钟才降级，用户
         看到的是「接口暂未就绪」而不是真实原因。实测：Gemini 免费配额打满后，
         每次断卦空转 20 轮。透传 429 + Retry-After，前端据此立即提示换模型。 */
      if (r.fail.status === 429) {
        const resp = json({
          error: 'UPSTREAM_RATE_LIMITED',
          message: '上游模型配额或速率已用尽（429），请换一个模型或稍后再试'
        }, 429);
        resp.headers.set('Retry-After', '60');
        return resp;
      }
      return json({ error: 'LLM_ERROR', message: '大模型接口返回 ' + r.fail.status + '，请稍后重试' }, 502);
    }
    if (r.stream) {
      // 透传 SSE 流到客户端。会话样板（首字节 / 心跳 / 计时器托管 / writer 收尾）已抽到
      // openSession()，解析与守卫在 pipeUpstreamSSE()，此处只做接线——旧版把这三件事
      // 混在一个分支里，才有「心跳挂在已释放 writer 上」那类只在生产才暴露的失效。
      timerHandedOff = true;
      const session = openSession();
      pipeUpstreamSSE(r.stream, session.writer, session.enc)
        .catch(function () { /* 错误已在 pipeUpstreamSSE 内处理并写终止事件 */ })
        .then(session.finish, session.finish);
      return session.response;
    }
    if (!r.reply) return json({ error: 'EMPTY', message: '大模型返回为空' }, 502);
    // 被守卫截断时仍返回已收到的部分答复，并带上原因（truncated 缺省时不出现在 JSON 里）；
    // 发生降级时 fallback 标出实际兜底模型（未降级则不出现该字段）
    return json({ reply: r.reply, provider: provider, model: usedModel, truncated: r.cut || undefined, fallback: fellBackTo || undefined });
  } catch (e) {
    // 客户端已断开：上游已随 ctrl 一并 abort，此处只需安静收尾（响应无人接收）。
    if (clientGone) {
      return json({ error: 'CLIENT_ABORTED', message: '客户端已断开' }, 499);
    }
    // 首字节超时单列：它与「总超时」的处置不同——总超时是上游整篇没救，
    // 首字节超时是「上游一个字都没吐」，改换更快的模型往往就能过。
    if (firstByteTimedOut) {
      return json({
        error: 'UPSTREAM_FIRST_BYTE_TIMEOUT',
        message: '上游 ' + Math.round(firstByteMs / 1000) + ' 秒内未返回首字节，请换一个更快的模型'
      }, 504);
    }
    if (timedOut) {
      return json({ error: 'LLM_TIMEOUT', message: '大模型 ' + Math.round(timeoutMs / 1000) + ' 秒内未返回完整响应，请重试或改用更快的模型' }, 504);
    }
    return json({ error: 'NET_ERROR', message: '无法连接大模型服务：' + e.message }, 502);
  } finally {
    // 流式路径的计时器与心跳都已托管给 openSession()（其 finish() 负责清除），
    // 此处必须跳过——否则 return Response 时外层 finally 会立刻清掉刚建好的
    // setInterval，心跳一次都发不出（与 writer 释放叠加，构成双重失效）。
    if (!timerHandedOff) {
      clearTimeout(timer);
      if (firstByteTimer) { clearTimeout(firstByteTimer); firstByteTimer = null; }
      if (heartbeat) { clearInterval(heartbeat); heartbeat = null; }
    }
  }
}

// 仅供测试的只读探针：暴露限流内部计数长度（不导出 RL_HITS 本体，避免测试耦合实现细节）。
// 用于断言「单 IP 的 hits 数组被封顶在 limit」——旧版无脑 push 时会随请求数无界增长。
export function __rlState() {
  const out = [];
  RL_HITS.forEach(function (arr, ip) { out.push({ ip: ip, len: arr.length }); });
  return out;
}
