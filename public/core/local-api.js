/* ============================================================
 * 本地接口层 (core/local-api.js)
 *
 * 桌面便携版没有 Cloudflare Functions / D1，故把页面用到的 /api/* 全部在本层
 * 接管，页面代码一行不改：
 *
 *   /api/models    读本机配置的接口清单（未填 Key 的不出现）
 *   /api/interpret 直连服务商（OpenAI 兼容 /chat/completions，SSE 流式），
 *                  把 delta 重新封装成页面认识的 {t}/{r} 事件
 *   /api/records   卦例库 → localStorage（含回执、删除、回填）
 *   /api/readings  回访任务 → 恒空（本地不做派发）
 *
 * 为什么直连而不是在壳里做代理：DeepSeek / Gemini(OpenAI 兼容端点) 都按 Origin
 * 回 Access-Control-Allow-Origin（已实测），浏览器能直连；少一层代理就少一处
 * 要维护的转发逻辑，Key 也不经过任何中间进程。
 *
 * 安全边界：Key 只写在本机 localStorage，不入库、不上传、不进分享链接。
 * ============================================================ */
(function (root) {
  'use strict';
  const W = root;

  /* 只在「本机模式」启用：桌面壳把 public/ 映射成 https://liuyao.local，
   * 或直接用 file:// 打开。部署到 Cloudflare 时（真实域名 / 本地静态服务器）
   * 本文件整体不生效，页面照旧走服务端 Functions —— 否则线上会被本地
   * localStorage 顶掉，库里一条都存不进去。
   * 本地调试想启用：http://127.0.0.1:PORT/index.html?local=1 */
  const LOCAL_MODE = (function () {
    try {
      const h = location.hostname;
      if (h === 'liuyao.local') return true;
      if (location.protocol === 'file:') return true;
      if ((h === '127.0.0.1' || h === 'localhost') && /[?&]local=1(?:&|$)/.test(location.search)) return true;
    } catch (e) { }
    return false;
  })();
  W.LY_LOCAL_MODE = LOCAL_MODE;
  if (!LOCAL_MODE) return;

  const CFG_KEY = 'ly_api_cfg_v1';
  const REC_KEY = 'ly_records_v1';
  const nativeFetch = W.fetch.bind(W);

  /* ---------- 配置 ---------- */

  function defaultCfg() {
    return {
      providers: [
        { id: 'deepseek', name: 'DeepSeek', base: 'https://api.deepseek.com/v1', model: 'deepseek-chat', key: '' },
        { id: 'gemini', name: 'Gemini', base: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.5-flash', key: '' },
        { id: 'openai', name: 'OpenAI 兼容', base: 'https://api.openai.com/v1', model: 'gpt-4o-mini', key: '' }
      ]
    };
  }
  function loadCfg() {
    try {
      const raw = localStorage.getItem(CFG_KEY);
      if (!raw) return defaultCfg();
      const cfg = JSON.parse(raw);
      if (!cfg || !Array.isArray(cfg.providers) || !cfg.providers.length) return defaultCfg();
      // 补齐新增字段：老配置缺 provider 时不让整块失效
      cfg.providers = cfg.providers.map(function (p) {
        return {
          id: p.id || ('p' + Math.random().toString(36).slice(2, 8)),
          name: p.name || '未命名', base: p.base || '', model: p.model || '', key: p.key || ''
        };
      });
      return cfg;
    } catch (e) { return defaultCfg(); }
  }
  function saveCfg(cfg) {
    try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); return true; }
    catch (e) { return false; }
  }
  function usable(p) { return !!(p && p.base && p.model && p.key); }

  /* ---------- 小工具 ---------- */

  function json(obj, status) {
    return new Response(JSON.stringify(obj), {
      status: status || 200,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
    });
  }
  function sseError(code, message) {
    const body = 'data: ' + JSON.stringify({ error: code, message: message }) + '\n\n';
    return new Response(body, {
      status: 200,
      headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store' }
    });
  }

  // 与服务端 interpret.js 同一段兜底：没有规则链预检结果时，要求模型自陈假设
  const PREMISE_FALLBACK = '【前提预检 · 缺失】本文未附规则链的槽位预检结果。' +
    '须先自行核对五类通用前提（时间范围／对象阶段／目标标准／进程状态／规则环境），' +
    '把缺项按【缺项分级】定级并在正文写明所设假设；' +
    '时间跨度不明确时不得给具体干支日，只给区间与触发条件。';

  /* ---------- 断卦 ---------- */

  async function handleInterpret(req) {
    let body;
    try { body = await req.json(); } catch (e) { return sseError('BAD_JSON', '请求体不是合法 JSON'); }
    const cfg = loadCfg();
    const chosen = (cfg.providers || []).filter(function (p) {
      return (body && body.model && p.id === body.model) || (!body || !body.model);
    })[0];
    const p = chosen && usable(chosen) ? chosen : (cfg.providers || []).filter(usable)[0];
    if (!p) {
      return sseError('NO_PROVIDER',
        '还没有可用的 AI 接口。请在「AI 接口设置」里填入接口地址、模型名与 API Key（只存本机）。');
    }
    if (!body || typeof body.panText !== 'string' || !body.panText) {
      return sseError('NO_PAN', '缺少排盘文本');
    }

    const sys = W.LY_SYSTEM_PROMPT;
    if (!sys) {
      return sseError('NO_PROMPT', '内置提示词未加载（core/prompt.js 缺失），无法断卦。');
    }
    const panText = body.panText;
    const userContent = panText.indexOf('【前提预检') >= 0 ? panText : panText + '\n' + PREMISE_FALLBACK;
    const msgs = [{ role: 'system', content: Array.isArray(sys) ? sys.join('\n') : String(sys) },
                  { role: 'user', content: userContent }];
    (body.messages || []).forEach(function (m) {
      if (m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content) {
        msgs.push({ role: m.role, content: m.content.slice(0, 2000) });
      }
    });

    const url = p.base.replace(/\/+$/, '') + '/chat/completions';
    let up;
    try {
      up = await nativeFetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + p.key },
        body: JSON.stringify({ model: p.model, messages: msgs, stream: true, temperature: 0.6 }),
        signal: req.signal
      });
    } catch (e) {
      return sseError('UPSTREAM_NET', '连接 ' + p.name + ' 失败：' + (e.message || e) +
        '（检查网络、接口地址与代理设置）');
    }
    if (!up.ok) {
      let detail = '';
      try { detail = (await up.text() || '').slice(0, 300); } catch (e) { }
      const hint = up.status === 401 ? '（Key 无效或已过期）'
        : up.status === 402 ? '（账户余额不足）'
          : up.status === 404 ? '（接口地址或模型名不对）'
            : up.status === 429 ? '（触发限流，稍后再试）' : '';
      return sseError('UPSTREAM_HTTP', p.name + ' 返回 ' + up.status + hint + '：' + detail);
    }

    const enc = new TextEncoder();
    const reader = up.body.getReader();
    const dec = new TextDecoder();
    const stream = new ReadableStream({
      start: function (ctrl) {
        function emit(o) { try { ctrl.enqueue(enc.encode('data: ' + JSON.stringify(o) + '\n\n')); } catch (e) { } }
        let buf = '';
        let got = 0;
        (async function pump() {
          try {
            for (; ;) {
              const r = await reader.read();
              if (r.done) break;
              buf += dec.decode(r.value, { stream: true });
              let idx;
              while ((idx = buf.indexOf('\n')) >= 0) {
                const line = buf.slice(0, idx).trim();
                buf = buf.slice(idx + 1);
                if (!line || line.charAt(0) === ':' || line.indexOf('data:') !== 0) continue;
                const d = line.slice(5).trim();
                if (!d || d === '[DONE]') continue;
                let j;
                try { j = JSON.parse(d); } catch (e) { continue; }
                if (j.error) { emit({ error: 'UPSTREAM', message: j.error.message || String(j.error) }); continue; }
                const ch = j.choices && j.choices[0];
                const dl = ch && (ch.delta || ch.message);
                if (!dl) continue;
                if (dl.reasoning_content) { emit({ r: String(dl.reasoning_content) }); got++; }
                if (dl.content) { emit({ t: String(dl.content) }); got++; }
              }
            }
            if (!got) emit({ error: 'EMPTY', message: p.name + ' 没有返回任何内容（模型名或额度可能有问题）' });
            ctrl.close();
          } catch (e) {
            // 用户主动 abort 时不当作错误，否则界面会弹出无意义的失败提示
            if (!(e && (e.name === 'AbortError' || /aborted/i.test(e.message || '')))) {
              try { emit({ error: 'STREAM', message: e.message || String(e) }); } catch (_) { }
            }
            try { ctrl.close(); } catch (_) { }
          }
        })();
      },
      cancel: function () { try { reader.cancel(); } catch (e) { } }
    });
    return new Response(stream, {
      status: 200,
      headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store' }
    });
  }

  /* ---------- 卦例库（本机） ----------
   * 桌面壳里有文件通道（core/file-store.js）→ 存成软件目录下的 JSON：
   *     <exe 目录>\data\卦例库.json
   * 浏览器里没有壳 → 退回 localStorage。
   * 首次升级：文件不存在但 localStorage 有数据时，自动搬过去，不丢一条。 */
  const REC_FILE = '卦例库.json';
  const FS = W.LY_FS || null;
  const FILE_MODE = !!(FS && FS.available);
  let recCache = null;

  function localRecs() {
    try {
      const raw = localStorage.getItem(REC_KEY);
      const a = raw ? JSON.parse(raw) : [];
      return Array.isArray(a) ? a : [];
    } catch (e) { return []; }
  }

  async function readRecs() {
    if (!FILE_MODE) return localRecs();
    if (recCache) return recCache;
    try {
      const txt = await FS.read(REC_FILE);
      if (txt && txt.trim()) {
        const a = JSON.parse(txt);
        recCache = Array.isArray(a) ? a : ((a && Array.isArray(a.records)) ? a.records : []);
      } else {
        // 首次：把 localStorage 里的存量搬到文件，一条不丢
        recCache = localRecs();
        if (recCache.length) await FS.write(REC_FILE, JSON.stringify(recCache, null, 1));
        else await FS.write(REC_FILE, '[]');
      }
    } catch (e) {
      console.warn('[records] 读文件失败，退回 localStorage', e);
      recCache = localRecs();
    }
    return recCache;
  }

  async function writeRecs(arr) {
    recCache = arr;
    if (!FILE_MODE) {
      try { localStorage.setItem(REC_KEY, JSON.stringify(arr)); return true; }
      catch (e) {
        alert('本机存储写入失败（可能已满）。请先导出备份再清理旧卦例。');
        return false;
      }
    }
    try {
      await FS.write(REC_FILE, JSON.stringify(arr, null, 1));
      // 同时更新 localStorage 那份，作为第二道保险（文件坏了还能救）
      try { localStorage.setItem(REC_KEY, JSON.stringify(arr)); } catch (e) { }
      return true;
    } catch (e) {
      alert('写入卦例库文件失败：' + (e && e.message || e) + '\n已退回存在浏览器存储里，请尽快导出备份。');
      try { localStorage.setItem(REC_KEY, JSON.stringify(arr)); return true; } catch (e2) { return false; }
    }
  }

  /* 供「AI 接口设置」里的存储位置一行使用 */
  W.__lyRecordsInfo = async function () {
    if (!FILE_MODE) return { mode: 'localStorage', path: '浏览器 localStorage（' + REC_KEY + '）', count: localRecs().length };
    let dir = '';
    try { dir = await FS.info(); } catch (e) { }
    const arr = await readRecs();
    const joined = dir ? (String(dir).replace(/[\\/]+$/, '') + '\\' + REC_FILE) : REC_FILE;
    return { mode: 'file', path: joined, dir: dir, count: arr.length };
  };
  W.__lyOpenDataDir = function () { if (FILE_MODE) FS.open().catch(function () { }); };
  /* 导出的文件落哪：桌面壳里是 <exe>\\导出，浏览器里只能进下载目录 */
  W.__lyExportDir = function () {
    if (!FS || !FS.available) return Promise.resolve('浏览器默认下载目录');
    return FS.exportDir().catch(function () { return '（取不到）'; });
  };
  W.__lyOpenExportDir = function () { if (FS && FS.available) FS.openExport().catch(function () { }); };
  function nowISO() { return new Date().toISOString(); }

  async function handleRecords(req, url) {
    const q = url.searchParams;
    const method = req.method.toUpperCase();
    let recs = await readRecs();

    if (q.get('verify')) return json({ ok: true, local: true });

    if (q.get('outcome')) {
      return (async function () {
        let b; try { b = await req.json(); } catch (e) { return json({ ok: false }, 400); }
        const id = b && b.id;
        const i = recs.findIndex(function (r) { return r.id === id; });
        if (i < 0) return json({ error: 'NOT_FOUND', message: '卦例不存在' }, 404);
        recs[i].outcome = b.outcome || null;
        recs[i].outcome_at = nowISO();
        await writeRecs(recs);
        return json({ ok: true, outcome: recs[i].outcome });
      })();
    }

    if (q.get('conclusion')) {
      return (async function () {
        let b; try { b = await req.json(); } catch (e) { return json({ ok: false }, 400); }
        const id = b && b.id;
        const i = recs.findIndex(function (r) { return r.id === id; });
        if (i < 0) return json({ error: 'NOT_FOUND', message: '卦例不存在' }, 404);
        if (typeof b.conclusion !== 'string') return json({ error: 'BAD_FIELD', message: 'conclusion 须为字符串' }, 400);
        // 断语单独一路：只改这一条记录的断语，不动盘面与对话历史（旧卦例补断语用）
        recs[i].conclusion = b.conclusion;
        recs[i].updated_at = nowISO();
        if (!(await writeRecs(recs))) return json({ error: 'STORAGE_FULL', message: '本机存储写入失败' }, 507);
        return json({ ok: true, conclusion: recs[i].conclusion });
      })();
    }

    if (q.get('id')) {
      const id = q.get('id');
      const hit = recs.filter(function (r) { return r.id === id; })[0];
      if (method === 'DELETE') {
        if (!hit) return json({ error: 'NOT_FOUND', message: '卦例不存在' }, 404);
        await writeRecs(recs.filter(function (r) { return r.id !== id; }));
        return json({ ok: true });
      }
      return hit ? json({ record: hit }) : json({ error: 'NOT_FOUND', message: '卦例不存在' }, 404);
    }

    if (method === 'POST') {
      return (async function () {
        let p; try { p = await req.json(); } catch (e) { return json({ error: 'BAD_JSON' }, 400); }
        if (!p) return json({ error: 'BAD_JSON' }, 400);
        /* id 由服务端兜底生成（functions/api/records.js 同一策略）：首次存入时
         * 前端传的是 castId = null，本地层若照抄服务端的「缺 id 就 400」，
         * 「存入卦例库」会静默失败——实测就是这条被 UI 冒烟抓出来的。 */
        const id = (typeof p.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(p.id))
          ? p.id
          : ('c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
        const i = recs.findIndex(function (r) { return r.id === id; });
        const base = i >= 0 ? recs[i] : { created_at: nowISO() };
        const merged = Object.assign({}, base, p, { id: id, updated_at: nowISO() });
        // 回执不被后续保存冲掉（与服务端同一条约束）
        if (base.outcome && !p.outcome) merged.outcome = base.outcome;
        /* 空对话不覆盖已有对话：从卦例库「装入」后点「更新卦例库」，本轮没断过卦，
         * messages 是 {}——旧版直接覆盖，会把这条记录原来的 AI 断卦历史抹掉。 */
        const msgEmpty = !p.messages ||
          (typeof p.messages === 'object' && !Array.isArray(p.messages) && !Object.keys(p.messages).length) ||
          (typeof p.messages === 'string' && (p.messages === '' || p.messages === '{}' || p.messages === '[]'));
        if (base.messages && msgEmpty) merged.messages = base.messages;
        if (i >= 0) recs[i] = merged; else recs.unshift(merged);
        if (!(await writeRecs(recs))) return json({ error: 'STORAGE_FULL', message: '本机存储写入失败' }, 507);
        return json({ ok: true, id: merged.id, created_at: merged.created_at });
      })();
    }

    // 列表：新→旧，分页
    const limit = Math.min(200, Math.max(1, parseInt(q.get('limit') || '100', 10) || 100));
    const offset = Math.max(0, parseInt(q.get('offset') || '0', 10) || 0);
    recs = recs.slice().sort(function (a, b) {
      return String(b.created_at || '').localeCompare(String(a.created_at || ''));
    });
    const page = recs.slice(offset, offset + limit);
    return json({ records: page, hasMore: offset + page.length < recs.length, total: recs.length });
  }

  /* ---------- fetch 接管 ---------- */

  W.fetch = function (input, init) {
    let url = null, req = null;
    try {
      const href = (typeof input === 'string') ? input : (input && input.url) || '';
      url = new URL(href, location.href);
      const same = url.origin === location.origin;
      if (same && url.pathname.indexOf('/api/') === 0) {
        req = new Request(url.href, init);
        const path = url.pathname;
        if (path === '/api/models') {
          const cfg = loadCfg();
          const list = (cfg.providers || []).filter(usable).map(function (p) {
            return { id: p.id, label: p.name + ' · ' + p.model, pv: p.name, tip: '本机直连' };
          });
          const warnings = list.length ? [] : ['尚未填入 API Key：展开「AI 接口设置」填好后即可断卦（Key 只存本机）。'];
          return Promise.resolve(json({ models: list, warnings: warnings, local: true }));
        }
        if (path === '/api/interpret') return Promise.resolve(handleInterpret(req));
        if (path === '/api/records') return Promise.resolve(handleRecords(req, url));
        if (path === '/api/readings') return Promise.resolve(json({ tasks: [], total: 0, local: true }));
        if (path === '/api/vote') {
          return Promise.resolve(json({
            error: 'LOCAL_NO_VOTE',
            message: '本地版不含「三模型对账」（服务端才有多模型轮询与计费闸），单个模型断卦照常可用。'
          }, 501));
        }
        return Promise.resolve(json({ error: 'NOT_IMPLEMENTED', message: '本地版未实现：' + path }, 501));
      }
    } catch (e) { /* 落到原生 fetch */ }
    return nativeFetch(input, init);
  };

  /* ---------- AI 接口设置卡片 ---------- */

  function buildSettingsCard() {
    if (!document.body || document.getElementById('localApiCard')) return;
    const anchor = document.getElementById('aiCard');
    const sec = document.createElement('section');
    sec.className = 'card';
    sec.id = 'localApiCard';
    sec.innerHTML =
      '<h2>AI 接口设置</h2>' +
      '<div class="muted" style="margin-bottom:10px">断卦由本机直连服务商，不走任何中转。' +
      '<b>Key 只存在本机浏览器</b>，不入库、不上传、不进分享链接。任意 OpenAI 兼容接口都可以（DeepSeek / Gemini / OpenAI / 中转站）。</div>' +
      '<div id="localApiRows"></div>' +
      '<div class="btn-row" style="margin-top:10px">' +
      '<button class="btn primary" id="btnLocalApiSave">保存</button>' +
      '<button class="btn ghost" id="btnLocalApiTest">测试连接</button>' +
      '<span class="muted" id="localApiTip" style="margin-left:8px"></span>' +
      '</div>' +
      '<details style="margin-top:10px"><summary class="muted" style="cursor:pointer">本机卦例库（备份 / 还原 / 清空）</summary>' +
      '<div class="muted" id="libStorePath" style="margin-top:6px;font-size:12px;line-height:1.7"></div>' +
      '<div class="btn-row" style="margin-top:8px">' +
      '<button class="btn ghost" id="btnLibExport">导出 JSON</button>' +
      '<button class="btn ghost" id="btnLibImport">导入 JSON</button>' +
      '<button class="btn ghost" id="btnLibClear">清空卦例库</button>' +
      '<button class="btn ghost" id="btnOpenDataDir" title="在资源管理器里打开数据目录">打开数据目录</button>' +
      '<span class="muted" id="libLocalTip" style="margin-left:8px"></span>' +
      '</div>' +
      '<div class="muted" style="margin-top:6px;font-size:12px">卦例库存本机 localStorage。导出后请自行保存到别处——换电脑、清缓存都会丢。</div>' +
      '</details>';

    const rows = sec.querySelector('#localApiRows');
    const cfg = loadCfg();
    rows.innerHTML = cfg.providers.map(function (p, i) {
      const on = p.key ? '' : ' style="opacity:.72"';
      return '<div class="local-api-row" data-i="' + i + '"' + on + '>' +
        '<div class="local-api-name">' + p.name + (p.key ? ' · 已填 Key' : ' · 未填 Key') + '</div>' +
        '<div class="local-api-grid">' +
        '<label>接口地址<input class="la-base" value="' + escAttr(p.base) + '" placeholder="https://api.deepseek.com/v1"></label>' +
        '<label>模型名<input class="la-model" value="' + escAttr(p.model) + '" placeholder="deepseek-chat"></label>' +
        '<label>API Key<input class="la-key" type="password" value="' + escAttr(p.key) + '" placeholder="sk-..."></label>' +
        '</div></div>';
    }).join('');

    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(sec, anchor);
    else document.querySelector('.wrap').appendChild(sec);

    sec.querySelector('#btnLocalApiSave').onclick = function () {
      const cfg2 = loadCfg();
      Array.prototype.forEach.call(sec.querySelectorAll('.local-api-row'), function (row) {
        const i = parseInt(row.getAttribute('data-i'), 10);
        if (!cfg2.providers[i]) return;
        cfg2.providers[i].base = row.querySelector('.la-base').value.trim();
        cfg2.providers[i].model = row.querySelector('.la-model').value.trim();
        cfg2.providers[i].key = row.querySelector('.la-key').value.trim();
      });
      if (!saveCfg(cfg2)) { alert('保存失败：本机存储不可写'); return; }
      const tip = sec.querySelector('#localApiTip');
      tip.textContent = '已保存到本机' + (typeof W.__lyReloadModels === 'function' ? '，模型清单已刷新' : '，刷新页面后生效');
      if (typeof W.__lyReloadModels === 'function') W.__lyReloadModels();
      buildSettingsCard_refresh();
    };

    sec.querySelector('#btnLocalApiTest').onclick = function () {
      const tip = sec.querySelector('#localApiTip');
      tip.textContent = '测试中…';
      const cfg2 = loadCfg();
      Array.prototype.forEach.call(sec.querySelectorAll('.local-api-row'), function (row) {
        const i = parseInt(row.getAttribute('data-i'), 10);
        if (!cfg2.providers[i]) return;
        cfg2.providers[i].base = row.querySelector('.la-base').value.trim();
        cfg2.providers[i].model = row.querySelector('.la-model').value.trim();
        cfg2.providers[i].key = row.querySelector('.la-key').value.trim();
      });
      const p = (cfg2.providers || []).filter(usable)[0];
      if (!p) { tip.textContent = '请先填好地址、模型名与 Key'; return; }
      const url = p.base.replace(/\/+$/, '') + '/chat/completions';
      const t0 = Date.now();
      nativeFetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + p.key },
        body: JSON.stringify({ model: p.model, messages: [{ role: 'user', content: '连通性测试，回复「好」即可。' }], max_tokens: 8 })
      }).then(function (r) {
        return r.text().then(function (t) {
          if (r.ok) tip.textContent = '连接正常（' + (Date.now() - t0) + ' ms）';
          else tip.textContent = '返回 ' + r.status + '：' + t.slice(0, 160);
        });
      }).catch(function (e) { tip.textContent = '连接失败：' + (e.message || e); });
    };

    /* 存储位置：桌面壳里是软件目录下 data\卦例库.json；浏览器里是 localStorage。
     * 换电脑只要拷 data 目录（或整个程序文件夹），比 leveldb 好懂多了。 */
    const locEl = sec.querySelector('#libStorePath');
    if (locEl) {
      if (typeof W.__lyRecordsInfo === 'function') {
        // 两段异步必须拿到一起再写，否则谁后到谁把对方盖掉（踩过一次）
        Promise.all([
          W.__lyRecordsInfo().catch(function () { return null; }),
          (typeof W.__lyExportDir === 'function' ? W.__lyExportDir() : Promise.resolve('')).catch(function () { return ''; })
        ]).then(function (r) {
          const info = r[0], dir = r[1];
          let html = '';
          if (info) {
            html = info.mode === 'file'
              ? '存储位置：<b>' + String(info.path).replace(/&/g, '&amp;') + '</b>（' + info.count + ' 条）'
              : '存储位置：' + info.path + '（' + info.count + ' 条，浏览器模式）';
          }
          if (dir) html += '<br>导出的文件落在：<b>' + String(dir).replace(/&/g, '&amp;') + '</b>';
          locEl.innerHTML = html;
        });
      }
    }
    const openDir = sec.querySelector('#btnOpenDataDir');
    if (openDir) openDir.onclick = function () {
      if (typeof W.__lyOpenDataDir === 'function') W.__lyOpenDataDir();
      else sec.querySelector('#libLocalTip').textContent = '浏览器模式没有数据目录';
    };

    // ---- 卦例库备份 ----
    sec.querySelector('#btnLibExport').onclick = async function () {
      const arr = await readRecs();
      const d = new Date();
      const pad = function (n) { return (n < 10 ? '0' : '') + n; };
      const name = '六爻卦例库-' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '.json';
      const txt = JSON.stringify(arr, null, 2);
      const tip2 = sec.querySelector('#libLocalTip');
      // 有壳就直写 <exe>\导出\（浏览器下载在无边框壳里不可靠，且用户找不到文件）
      if (FS && FS.available && FS.saveExport) {
        try {
          const full = await FS.saveExport(name, txt);
          tip2.textContent = '已导出 ' + arr.length + ' 条 → ' + full;
          return;
        } catch (e) {
          tip2.textContent = '写入失败，改用浏览器下载：' + (e && e.message || e);
        }
      }
      const blob = new Blob([txt], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      if (!FS || !FS.available) tip2.textContent = '已导出 ' + arr.length + ' 条（浏览器下载）';
    };
    sec.querySelector('#btnLibImport').onclick = function () {
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = '.json,application/json';
      inp.onchange = function () {
        const f = inp.files && inp.files[0];
        if (!f) return;
        const fr = new FileReader();
        fr.onload = async function () {
          try {
            const arr = JSON.parse(String(fr.result));
            if (!Array.isArray(arr)) throw new Error('不是数组');
            const cur = await readRecs();
            const byId = {};
            cur.forEach(function (r) { byId[r.id] = r; });
            let add = 0;
            arr.forEach(function (r) { if (r && r.id && !byId[r.id]) { cur.unshift(r); add++; } });
            await writeRecs(cur);
            sec.querySelector('#libLocalTip').textContent = '导入 ' + add + ' 条（重复 id 已跳过），共 ' + cur.length + ' 条';
            if (typeof W.__lyReloadModels === 'function') setTimeout(function () { location.reload(); }, 900);
          } catch (e) { alert('导入失败：' + e.message); }
        };
        fr.readAsText(f, 'utf-8');
      };
      inp.click();
    };
    sec.querySelector('#btnLibClear').onclick = async function () {
      const cur = await readRecs();
      const n = cur.length;
      if (!n) { sec.querySelector('#libLocalTip').textContent = '卦例库已经是空的'; return; }
      if (!confirm('清空本机卦例库（' + n + ' 条）？不可恢复，建议先导出备份。')) return;
      await writeRecs([]);
      try { localStorage.removeItem(REC_KEY); } catch (e) { }
      sec.querySelector('#libLocalTip').textContent = '已清空';
      setTimeout(function () { location.reload(); }, 600);
    };
  }
  function buildSettingsCard_refresh() {
    const old = document.getElementById('localApiCard');
    if (old) old.parentNode.removeChild(old);
    buildSettingsCard();
  }
  function escAttr(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  // 样式（卡片内的密排表单，尽量不复用页面已有类，避免影响原版渲染）
  const css = document.createElement('style');
  css.textContent =
    '.local-api-row{border:1px solid var(--line);border-radius:8px;padding:10px 12px;margin-bottom:8px;background:#fbf8f1}' +
    '.local-api-name{font-size:13px;color:var(--ink-light);margin-bottom:6px}' +
    '.local-api-grid{display:grid;grid-template-columns:1.4fr 1fr 1.2fr;gap:8px}' +
    '.local-api-grid label{display:flex;flex-direction:column;gap:3px;font-size:12px;color:var(--ink-light)}' +
    '.local-api-grid input{font-family:inherit;font-size:13px;padding:6px 8px;border:1px solid var(--line);border-radius:6px;background:#fff;color:var(--ink)}' +
    '@media(max-width:640px){.local-api-grid{grid-template-columns:1fr}}';
  document.head.appendChild(css);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', buildSettingsCard);
  } else {
    buildSettingsCard();
  }

  // 对外暴露，便于排障与将来加「书籍/卦例」导入
  W.LY_LOCAL = {
    loadCfg: loadCfg, saveCfg: saveCfg, loadRecs: readRecs, saveRecs: writeRecs,
    REC_KEY: REC_KEY, CFG_KEY: CFG_KEY
  };
})(typeof window !== 'undefined' ? window : globalThis);
