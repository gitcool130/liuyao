/* 六爻排盘 UI (app.js) 依赖 core.js（浏览器中挂于 window.LY） */
(function () {
  const C = window.LY;

  const $ = function (s) { return document.querySelector(s); };

  const LINE_NAMES = ['初爻', '二爻', '三爻', '四爻', '五爻', '上爻'];
  const TOSS_MEAN = {
    1: { name: '单', sym: '━━━━━', desc: '少阳 · 静' },
    0: { name: '拆', sym: '━━　━━', desc: '少阴 · 静' },
    9: { name: '重', sym: '━━━━━ ○', desc: '老阳 · 发动' },
    6: { name: '交', sym: '━━　━━ ✕', desc: '老阴 · 发动' }
  };

  let selectedDate = new Date();
  let records = [];            // 已定之爻 {coins, backs, val}
  let curCoins = ['背', '背', '背'];
  let pan = null;
  let lastBullets = [];

  // ---------- 时间 ----------
  function fmtDT(dt) {
    const p = function (n) { return (n < 10 ? '0' : '') + n; };
    return dt.getFullYear() + '-' + p(dt.getMonth() + 1) + '-' + p(dt.getDate()) +
      ' ' + p(dt.getHours()) + ':' + p(dt.getMinutes());
  }
  function renderTime() {
    const pil = C.fourPillars(selectedDate);
    $('#timeInfo').innerHTML =
      '<div class="muted">公历 ' + fmtDT(selectedDate) + '</div>' +
      '<div class="gz">' + pil.yearGZ + '年 · ' + pil.monthGZ + '月 · <b>' + pil.dayGZ + '日</b> · ' + pil.hourGZ + '时</div>' +
      '<div class="muted">月建 <b class="kong">' + C.ZHI[pil.monthZhi] + '</b> ｜ 日辰 <b class="kong">' + C.ZHI[pil.dayZhi] + '</b> ｜ 旬空 <b class="kong">' + pil.kongStr + '</b></div>';
    const p2 = function (n) { return (n < 10 ? '0' : '') + n; };
    if (!$('#dtInput').value) {
      $('#dtInput').value = selectedDate.getFullYear() + '-' + p2(selectedDate.getMonth() + 1) + '-' + p2(selectedDate.getDate()) +
        'T' + p2(selectedDate.getHours()) + ':' + p2(selectedDate.getMinutes());
    }
  }

  // ---------- 起卦 ----------
  function renderCoins() {
    $('#coinRow').innerHTML = curCoins.map(function (c, i) {
      return '<button class="coin' + (c === '字' ? ' is-zhi' : '') + '" data-i="' + i + '">' + c + '</button>';
    }).join('');
    Array.prototype.forEach.call(document.querySelectorAll('.coin'), function (btn) {
      btn.onclick = function () {
        curCoins[+btn.dataset.i] = curCoins[+btn.dataset.i] === '背' ? '字' : '背';
        renderCoins(); renderTossHint();
      };
    });
  }
  function backCount() { return curCoins.filter(function (c) { return c === '背'; }).length; }
  function tossValFromBacks(n) { return n === 1 ? 1 : n === 2 ? 0 : n === 3 ? 9 : 6; }

  function renderTossHint() {
    const n = backCount();
    const v = tossValFromBacks(n);
    const t = TOSS_MEAN[v];
    $('#tossHint').innerHTML = '<b>' + t.name + '</b>（' + n + ' 背 ' + (3 - n) + ' 字）→ ' + t.sym + ' 　' + t.desc;
  }
  function renderStack() {
    let html = '';
    for (let i = 5; i >= 0; i--) {
      const r = records[i];
      if (r) {
        const t = TOSS_MEAN[r.val];
        html += '<div class="yao-slot' + (r.val === 9 || r.val === 6 ? ' moving-y' : '') + '">' +
          '<span class="nm">' + LINE_NAMES[i] + '</span><span>' + t.sym + '</span></div>';
      } else if (i === records.length) {
        html += '<div class="yao-slot current"><span class="nm">' + LINE_NAMES[i] + '</span><span>？</span></div>';
      } else {
        html += '<div class="yao-slot"><span class="nm">' + LINE_NAMES[i] + '</span><span>—</span></div>';
      }
    }
    $('#yaoStack').innerHTML = html;
    $('#stepHint').textContent = records.length < 6 ?
      ('第 ' + (records.length + 1) + ' 次摇卦，装' + LINE_NAMES[records.length] + '。静心默念所测之事。') :
      '六爻已成。';
  }

  $('#btnRandom').onclick = function () {
    curCoins = curCoins.map(function () { return Math.random() < 0.5 ? '背' : '字'; });
    renderCoins(); renderTossHint();
  };
  $('#btnConfirm').onclick = function () {
    if (records.length >= 6) return;
    const n = backCount();
    records.push({ coins: curCoins.slice(), backs: n, val: tossValFromBacks(n) });
    curCoins = ['背', '背', '背'];
    renderCoins(); renderTossHint(); renderStack();
    if (records.length === 6) computePan();
  };
  $('#btnUndo').onclick = function () {
    if (!records.length) return;
    records.pop(); pan = null;
    $('#panCard').hidden = true; $('#analysisCard').hidden = true; $('#aiCard').hidden = true;
    renderStack();
  };
  $('#btnReset').onclick = function () {
    records = []; pan = null; curCoins = ['背', '背', '背'];
    $('#panCard').hidden = true; $('#analysisCard').hidden = true; $('#aiCard').hidden = true;
    $('#useSelect').value = ''; lastBullets = [];
    renderCoins(); renderTossHint(); renderStack();
  };
  $('#dtInput').onchange = function () {
    if (!this.value) return;
    selectedDate = new Date(this.value);
    renderTime();
    if (records.length === 6) computePan();
  };

  // ---------- 排盘 ----------
  function computePan() {
    pan = C.paipan(records.map(function (r) { return r.val; }), selectedDate);
    renderPan();
    resetAIState();
    $('#panCard').hidden = false;
    $('#analysisCard').hidden = false;
    $('#aiCard').hidden = false;
    renderAnalysis();
    $('#panCard').scrollIntoView({ behavior: 'smooth' });
  }

  function yaoSymHTML(yang, moving, old) {
    const base = yang ? '━━━━━━━' : '━━━　━━━';
    const mark = old === 9 ? ' ○' : old === 6 ? ' ✕' : '';
    return '<span class="yao-sym' + (moving ? ' moving' : '') + '">' + base + mark + '</span>';
  }

  function renderPan() {
    const pil = pan.pillars;
    const title = '<b>' + pan.benName + '</b>（' + pan.palace + '宫 · ' + pan.palaceWx + '）' +
      (pan.hasBian ? ' 之 <b>' + pan.bianName + '</b>（' + pan.bianPalace + '宫）' : '（静卦）');
    let rows = '';
    for (let i = 5; i >= 0; i--) {
      const L = pan.lines[i];
      const kongCls = pil.kong.indexOf(L.zhiIdx) >= 0 ? ' class="kong"' : '';
      rows += '<tr>' +
        '<td>' + L.beast + '</td>' +
        '<td class="fu-cell">' + (L.fu ? L.fu.lq + '<br>' + L.fu.zhi : '') + '</td>' +
        '<td>' + L.lq + ' ' + L.gan + L.zhi + '<br>' + yaoSymHTML(L.yang, L.moving, L.old) + '</td>' +
        '<td>' + (L.shi ? '<span class="badge-shi">世</span>' : L.ying ? '<span class="badge-ying">应</span>' : '') + '</td>' +
        '<td class="bian-cell">' + (L.moving && L.bian ? L.bian.lq + ' ' + L.bian.gan + L.bian.zhi : '') + '</td>' +
        '</tr>';
    }
    $('#panBody').innerHTML =
      '<div class="hex-title">' + title + '</div>' +
      '<div class="meta-line">占时 ' + fmtDT(selectedDate) + ' ｜ ' + pil.yearGZ + '年 ' + pil.monthGZ + '月 ' + pil.dayGZ + '日 ' + pil.hourGZ + '时 ｜ 旬空 <span class="kong">' + pil.kongStr + '</span></div>' +
      '<table class="pan"><thead><tr><th>六神</th><th>伏神</th><th>本卦</th><th>世应</th><th>变爻</th></tr></thead><tbody>' + rows + '</tbody></table>';
  }

  // ---------- 断卦 ----------
  // 当前所测之事的文本（固定事类返回标签，自定义返回输入内容）
  function currentQuestion() {
    const t = $('#useSelect').value;
    if (t === '__custom__') return ($('#useCustom').value || '').trim();
    const useMap = { '妻财': '求财·买卖', '官鬼': '功名·官司·疾病', '父母': '考试·文书', '子孙': '子女·医药', '兄弟': '朋友·竞争', 'shi': '自身运势' };
    return useMap[t] || '';
  }

  function renderAnalysis() {
    const target = $('#useSelect').value;
    const list = $('#conclList');
    const vBox = $('#verdictBox');
    const customInput = $('#useCustom');
    customInput.hidden = (target !== '__custom__');
    if (!target || target === '__custom__') {
      // 空选与自定义：无固定用神可取，旺衰硬规则不适用，给出通用次第
      list.innerHTML = '<li>选择所测之事，先观用神旺衰。通用次第：一观世爻旺衰，二观用神与世应，三审动爻生克，四定旬空月破与应期。</li>' +
        (target === '__custom__' ? '<li>自定义所测不作旺衰粗判，所测事项将写入排盘文本交由大模型细断。</li>' : '');
      vBox.hidden = true; lastBullets = [];
      return;
    }
    const res = C.analyze(pan, target);
    lastBullets = res.bullets;
    list.innerHTML = res.bullets.map(function (b) {
      return '<li' + (b.indexOf('⚠') >= 0 ? ' class="warn"' : '') + '>' + b + '</li>';
    }).join('');
    vBox.hidden = false;
    vBox.innerHTML = '<b>粗判</b>　' + res.verdict;
  }
  $('#useSelect').onchange = function () { renderAnalysis(); if ($('#useCustom').hidden === false) $('#useCustom').focus(); };
  $('#useCustom').oninput = function () { /* 输入变化无需重算粗判，buildPanText 实时读取 */ };

  // ---------- 排盘文本（复制与 AI 共用） ----------
  function buildPanText(forAI) {
    const pil = pan.pillars;
    let txt = '【六爻排盘】\n';
    txt += '时间：' + fmtDT(selectedDate) + '（' + pil.yearGZ + '年 ' + pil.monthGZ + '月 ' + pil.dayGZ + '日 ' + pil.hourGZ + '时，旬空' + pil.kongStr + '）\n';
    const q = currentQuestion();
    if (q) txt += '所测：' + q + '\n';
    txt += '本卦：' + pan.benName + '（' + pan.palace + '宫·' + pan.palaceWx + '）' +
      (pan.hasBian ? ' 之 ' + pan.bianName + '（' + pan.bianPalace + '宫）' : '（静卦）') + '\n';
    txt += '六神　伏神　本卦　　　世应　变爻\n';
    for (let i = 5; i >= 0; i--) {
      const L = pan.lines[i];
      const sym = L.yang ? '━━━' : '─ ─';
      const mark = L.old === 9 ? '○' : L.old === 6 ? '✕' : ' ';
      txt += (L.beast + '　　').slice(0, 4) + ' ' +
        (L.fu ? L.fu.lq + L.fu.zhi : '　　') + '　' +
        L.lq + L.gan + L.zhi + sym + mark + '　' +
        (L.shi ? '世' : L.ying ? '应' : '　') + '　' +
        (L.moving && L.bian ? L.bian.lq + L.bian.gan + L.bian.zhi : '') + '\n';
    }
    if (lastBullets.length) {
      txt += '\n【旺衰粗判】\n';
      lastBullets.forEach(function (b) {
        txt += '- ' + b.replace(/<[^>]+>/g, '') + '\n';
      });
    }
    if (!forAI) txt += '\n请依京房纳甲六爻法通盘断卦：世应关系、动爻生克、用神取舍、应期推断，并给出白话结论。';
    return txt;
  }

  // ---------- 复制文本 ----------
  $('#btnCopy').onclick = function () {
    if (!pan) return;
    const txt = buildPanText(false);
    const done = function () {
      const btn = $('#btnCopy'); const old = btn.textContent;
      btn.textContent = '已复制 ✓';
      setTimeout(function () { btn.textContent = old; }, 1500);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(done).catch(function () { fallbackCopy(txt); done(); });
    } else { fallbackCopy(txt); done(); }
  };
  function fallbackCopy(txt) {
    const ta = document.createElement('textarea');
    ta.value = txt; document.body.appendChild(ta);
    ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
  }

  // ---------- AI 断卦 / 进阶探讨 / 卦例库（多模型对比） ----------
  // 模型清单：初始为内置默认，页面加载后从 /api/models 动态拉取（GPT 清单由后台 GPT_MODELS 变量驱动）
  let MODELS = [
    { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash', pv: 'Google', tip: '快' },
    { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash', pv: 'Google', tip: '高峰期易过载' },
    { id: 'deepseek-flash', label: 'DeepSeek Flash', pv: 'DeepSeek', tip: '快' },
    { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', pv: 'DeepSeek', tip: '深推理 · 慢' }
  ];
  const DEFAULT_MODELS = ['gemini-3.6-flash', 'deepseek-flash'];

  // 已知模型的特性提示；后台自定义的模型名无提示
  const MODEL_TIPS = {
    'gemini-3.6-flash': '快',
    'gemini-3.8-flash': '高峰期易过载',
    'deepseek-flash': '快',
    'deepseek-v4-pro': '深推理 · 慢',
    'gpt-6-luna': '便宜 · 快',
    'gpt-6-sol': '均衡',
    'gpt-6-astra': '最强 · 贵'
  };

  // 模型名美化：gemini-3.6-flash → Gemini 3.6 Flash；gpt-6-luna → GPT 6 Luna
  function modelLabel(id) {
    const parts = id.split('-');
    if (parts[0] === 'gpt' || parts[0] === 'o1' || parts[0] === 'o3') {
      return parts[0].toUpperCase() + ' ' + parts.slice(1).join(' ');
    }
    return parts[0].charAt(0).toUpperCase() + parts[0].slice(1) +
      (parts.length > 1 ? ' ' + parts.slice(1).join(' ') : '');
  }

  function applyModels(list) {
    if (!Array.isArray(list) || !list.length) return;
    MODELS = list.map(function (m) {
      return {
        id: m.id,
        pv: m.pv || '',
        label: modelLabel(m.id),
        tip: (m.configured === false) ? '后台未配 key' : (MODEL_TIPS[m.id] || '')
      };
    });
    selModels = loadSelModels();
    renderModelChips();
  }

  async function loadModels() {
    try {
      const res = await fetch('/api/models');
      if (!res.ok) return;
      const data = await res.json();
      applyModels(data.models);
    } catch (e) { /* 本地打开或接口不存在时保留默认清单 */ }
  }

  let selModels = loadSelModels();
  let aiStates = {};   // { modelId: { history: [] } }
  let castId = null;

  function loadSelModels() {
    let saved = [];
    try { saved = JSON.parse(localStorage.getItem('ly_models') || '[]'); } catch (e) {}
    const valid = saved.filter(function (m) { return MODELS.some(function (x) { return x.id === m; }); });
    return valid.length ? valid : DEFAULT_MODELS.slice();
  }

  function renderModelChips() {
    $('#modelChips').innerHTML = MODELS.map(function (m) {
      return '<button class="mchip' + (selModels.indexOf(m.id) >= 0 ? ' on' : '') + '" data-m="' + m.id + '" title="' + esc(m.tip || '') + '">' +
        '<span class="pv">' + m.pv + '</span>' + m.label + (m.tip ? '<span class="pv"> · ' + m.tip + '</span>' : '') + '</button>';
    }).join('');
    Array.prototype.forEach.call(document.querySelectorAll('.mchip'), function (btn) {
      btn.onclick = function () {
        const id = btn.dataset.m;
        const i = selModels.indexOf(id);
        if (i >= 0) { if (selModels.length > 1) selModels.splice(i, 1); }
        else selModels.push(id);
        localStorage.setItem('ly_models', JSON.stringify(selModels));
        renderModelChips();
      };
    });
  }

  function resetAIState() {
    aiStates = {}; castId = null;
    $('#aiReply').innerHTML = '';
    const box = $('#chatBox'); if (box) box.hidden = true;
    const btn = $('#btnSave'); if (btn) btn.textContent = '存入卦例库';
    const btnAI = $('#btnAI'); if (btnAI) { btnAI.disabled = false; btnAI.textContent = '开始断卦'; }
  }

  function apiHeaders() {
    const h = { 'Content-Type': 'application/json' };
    const code = localStorage.getItem('ly_access_code');
    if (code) h['X-Access-Code'] = code;
    return h;
  }

  // 请求封装：401 时清除旧口令并提示重输；silent=true 时不弹框（自动保存场景静默跳过）
  async function apiFetch(path, opts, silent) {
    let res = await fetch(path, Object.assign({ headers: apiHeaders() }, opts || {}));
    if (res.status === 401 && !silent) {
      localStorage.removeItem('ly_access_code');
      renderLoginBtn();
      const code = prompt('需要口令才能继续，请输入：');
      if (code) {
        localStorage.setItem('ly_access_code', code);
        renderLoginBtn();
        res = await fetch(path, Object.assign({ headers: apiHeaders() }, opts || {}));
        if (res.status === 401) localStorage.removeItem('ly_access_code');
        renderLoginBtn();
      }
    }
    return res;
  }

  function esc(s) {
    const d = document.createElement('div');
    d.textContent = String(s);
    return d.innerHTML;
  }
  function mdLite(s) {
    return esc(s)
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      .replace(/^#{1,6}\s*(.+)$/gm, '<b>$1</b>')
      .replace(/\n/g, '<br>');
  }

  // 与服务端 interpret.js 的 SYSTEM_PROMPT 保持一致（用于失败时手动断卦的提示词）
  const SYSTEM_PROMPT = [
    '你是一位精通京房纳甲六爻的卦师，治学严谨，断卦有据。',
    '收到排盘后按以下次序通盘论断：',
    '一、列卦象要点：卦名卦宫、世应、用神（按所测之事取之，两现说明取舍）、动爻及其化出、月建日辰生克、旬空月破、冲合。',
    '二、断吉凶：以旺衰生克为纲，引经据典（《增删卜易》《卜筮正宗》等），术语用规范六爻术语，不得用现代心理学术语。',
    '三、断应期：据旬空、冲合、生扶之理推断应验之时。',
    '四、白话总结：用一段简明中文给出结论与建议。',
    '若信息不足，明确指出需补充何事，不得臆造。',
    '用户后续追问时，保持卦理一致，延续断卦思路作答。'
  ].join('\n');

  // 拼装发给大模型的完整请求文本（失败/无输出时可复制到任意对话窗口手动断卦）
  function buildManualPrompt(history) {
    let txt = SYSTEM_PROMPT + '\n\n' + buildPanText(true);
    (history || []).forEach(function (m) {
      if (m && m.content) {
        txt += '\n\n' + (m.role === 'user' ? '【追问】' : '【前答】') + '\n' + m.content;
      }
    });
    return txt;
  }

  async function callInterpret(model, history) {
    let res, raw;
    try {
      res = await apiFetch('/api/interpret', {
        method: 'POST',
        body: JSON.stringify({ panText: buildPanText(true), messages: history, model: model })
      });
      raw = await res.text();
    } catch (e) {
      throw { kind: 'net', message: '网络请求失败：' + e.message };
    }
    let data;
    try { data = JSON.parse(raw); }
    catch (e) {
      // 返回了 HTML（部署传播中/边缘缓存）——给可读提示，不抛 JSON 天书
      throw { kind: 'html', message: '接口暂未就绪（新部署传播中，稍等片刻重试即可）' };
    }
    if (!res.ok) throw { kind: 'api', message: data.message || data.error || ('HTTP ' + res.status), detail: data.detail || '' };
    if (!data.reply) throw { kind: 'empty', message: '大模型返回为空' };
    return data.reply;
  }

  // 失败/无输出时的降级展示：友好提示 + 完整请求内容（可一键复制去任意对话窗口）
  function renderFailBox(el, model, history, err) {
    const cfg = MODELS.filter(function (x) { return x.id === model; })[0] || {};
    const prompt = buildManualPrompt(history);
    el.innerHTML =
      '<div class="ai-block warn">⚠ ' + esc(err.kind === 'html' ? err.message : '本次未获得断语：' + err.message) +
      (err.detail ? '<div class="muted" style="margin-top:4px;font-size:12px;word-break:break-all">' + esc(String(err.detail).slice(0, 300)) + '</div>' : '') +
      '<div style="margin-top:8px">可将下方请求内容复制到任意大模型对话窗口手动断卦：</div>' +
      '<div class="btn-row" style="margin-top:8px"><button class="btn" data-copy-prompt>复制请求内容</button></div>' +
      '<pre class="pan-text" style="max-height:260px;overflow:auto;margin-top:8px">' + esc(prompt) + '</pre>' +
      '</div>';
    const btn = el.querySelector('[data-copy-prompt]');
    if (btn) btn.onclick = function () {
      const done = function () { btn.textContent = '已复制 ✓'; setTimeout(function () { btn.textContent = '复制请求内容'; }, 1500); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(prompt).then(done).catch(function () { fallbackCopy(prompt); done(); });
      } else { fallbackCopy(prompt); done(); }
    };
  }

  // 模型 id → 安全 DOM id（带哈希，避免 gpt-5.2 与 gpt-52 之类去符号后撞名）
  function midSafe(m) {
    let h = 0;
    for (let i = 0; i < m.length; i++) h = (h * 31 + m.charCodeAt(i)) >>> 0;
    return m.replace(/[^a-zA-Z0-9]/g, '') + h.toString(36);
  }
  function colBody(id) { return document.getElementById('col-' + midSafe(id)); }

  function renderCols() {
    $('#aiReply').innerHTML = selModels.map(function (m, i) {
      const cfg = MODELS.filter(function (x) { return x.id === m; })[0] || {};
      return '<div class="ai-col">' +
        '<div class="ai-col-head">' + esc(cfg.label || m) + '<span class="pv-tag">' + esc(cfg.pv || '') + '</span></div>' +
        '<div class="ai-col-body" id="col-' + midSafe(m) + '"></div>' +
        '</div>';
    }).join('');
  }

  $('#btnAI').onclick = async function () {
    if (!pan) return;
    const btn = $('#btnAI');
    btn.disabled = true; btn.textContent = '卦师推敲中…';
    aiStates = {};
    renderCols();
    selModels.forEach(function (m) {
      colBody(m).innerHTML = '<div class="loading">推卦中…</div>';
    });
    await Promise.all(selModels.map(async function (m) {
      try {
        const reply = await callInterpret(m, []);
        aiStates[m] = { history: [{ role: 'assistant', content: reply }] };
        colBody(m).innerHTML = '<div class="ai-block">' + mdLite(reply) + '</div>';
      } catch (e) {
        renderFailBox(colBody(m), m, [], e);
      }
    }));
    $('#chatBox').hidden = !Object.keys(aiStates).length;
    btn.disabled = false; btn.textContent = '重新断卦';
    autoSaveCast();
  };

  let chatBusy = false;
  async function sendChat() {
    const input = $('#chatInput');
    const q = input.value.trim();
    if (!q || chatBusy || !Object.keys(aiStates).length) return;
    chatBusy = true;
    input.value = '';
    const active = Object.keys(aiStates);
    active.forEach(function (m) {
      aiStates[m].history.push({ role: 'user', content: q });
      colBody(m).insertAdjacentHTML('beforeend',
        '<div class="msg user"><b>问：</b>' + mdLite(q) + '</div><div class="msg ai" id="chatload-' + midSafe(m) + '"><span class="loading">推敲中…</span></div>');
    });
    await Promise.all(active.map(async function (m) {
      const loadEl = document.getElementById('chatload-' + midSafe(m));
      try {
        const reply = await callInterpret(m, aiStates[m].history.slice(0, -1));
        aiStates[m].history.push({ role: 'assistant', content: reply });
        if (loadEl) loadEl.innerHTML = mdLite(reply);
      } catch (e) {
        if (loadEl) {
          const box = document.createElement('div');
          loadEl.innerHTML = '';
          loadEl.appendChild(box);
          renderFailBox(box, m, aiStates[m].history.slice(0, -1), e);
        }
      }
    }));
    chatBusy = false;
    autoSaveCast();
  }
  $('#btnChat').onclick = sendChat;
  $('#chatInput').onkeydown = function (e) { if (e.key === 'Enter') sendChat(); };

  function recordPayload() {
    const pil = pan.pillars;
    return {
      id: castId,
      datetime: fmtDT(selectedDate),
      pillars: pil.yearGZ + '年 ' + pil.monthGZ + '月 ' + pil.dayGZ + '日 ' + pil.hourGZ + '时',
      question: $('#useSelect').value === '__custom__'
        ? currentQuestion()
        : ($('#useSelect').value ? $('#useSelect option:checked').textContent : ''),
      hex: pan.benName + (pan.hasBian ? ' 之 ' + pan.bianName : '（静卦）'),
      tosses: records,
      panText: buildPanText(true),
      messages: aiStates   // { modelId: [{role, content}] }
    };
  }

  async function autoSaveCast() {
    try {
      // silent：未登录时不弹口令框，静默跳过
      const res = await apiFetch('/api/records', { method: 'POST', body: JSON.stringify(recordPayload()) }, true);
      const data = await res.json();
      if (res.ok && data.id) { castId = data.id; $('#btnSave').textContent = '已入卦例库 ✓'; }
    } catch (e) { /* 静默：数据库未绑定或未登录时不打扰断卦 */ }
  }

  $('#btnSave').onclick = async function () {
    if (!pan) return;
    const btn = $('#btnSave'); btn.disabled = true;
    try {
      const res = await apiFetch('/api/records', { method: 'POST', body: JSON.stringify(recordPayload()) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || '保存失败');
      castId = data.id;
      btn.textContent = '已入卦例库 ✓';
    } catch (e) {
      alert('保存失败：' + e.message);
    } finally { btn.disabled = false; }
  };

  // ---------- 卦例库口令登录 ----------
  function renderLoginBtn() {
    const btn = $('#btnLogin'), tip = $('#loginTip');
    if (!btn) return;
    const logged = !!localStorage.getItem('ly_access_code');
    btn.textContent = logged ? '已登录 · 退出' : '口令登录';
    if (tip) tip.textContent = logged ? '已登录，断卦后自动入卦例库' : '卦例浏览开放，装入需口令';
  }
  const _btnLogin = $('#btnLogin');
  if (_btnLogin) _btnLogin.onclick = async function () {
    if (localStorage.getItem('ly_access_code')) {
      localStorage.removeItem('ly_access_code');
      renderLoginBtn();
      return;
    }
    const code = prompt('请输入卦例库口令：');
    if (!code) return;
    localStorage.setItem('ly_access_code', code);
    // 验证探针：只校验口令不落库
    try {
      const res = await fetch('/api/records?verify=1', { method: 'POST', headers: apiHeaders(), body: '{}' });
      if (res.status === 401) {
        localStorage.removeItem('ly_access_code');
        alert('口令错误');
      }
    } catch (e) { /* 网络异常时保留输入，实际写入时再校验 */ }
    renderLoginBtn();
  };

  $('#btnLib').onclick = async function () {
    $('#libList').innerHTML = '<div class="muted">载入中…</div>';
    try {
      const res = await apiFetch('/api/records', {});
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || '读取失败');
      if (!data.records.length) { $('#libList').innerHTML = '<div class="muted">尚无卦例。</div>'; return; }
      $('#libList').innerHTML = data.records.map(function (r) {
        return '<div class="lib-item" data-id="' + r.id + '"><span>' + esc(r.question || '（未注明所测）') + ' · ' + esc(r.hex) + '</span>' +
          '<span class="lib-side"><span class="muted">' + esc((r.created_at || '').slice(0, 10)) + '</span>' +
          '<button class="lib-del" data-del="' + r.id + '" title="删除此卦例">×</button></span></div>';
      }).join('');
      Array.prototype.forEach.call(document.querySelectorAll('.lib-item'), function (el) {
        el.onclick = function () { loadCast(el.dataset.id); };
      });
      Array.prototype.forEach.call(document.querySelectorAll('.lib-del'), function (btn) {
        btn.onclick = async function (e) {
          e.stopPropagation();
          if (!confirm('确定删除此卦例？不可恢复。')) return;
          try {
            const res = await apiFetch('/api/records?id=' + encodeURIComponent(btn.dataset.del), { method: 'DELETE' });
            const d = await res.json();
            if (!res.ok) throw new Error(d.message || '删除失败');
            const item = btn.closest('.lib-item');
            if (item) item.remove();
            $('#libDetail').innerHTML = '';
            if (!$('.lib-item')) $('#libList').innerHTML = '<div class="muted">尚无卦例。</div>';
          } catch (err) { alert('删除失败：' + err.message); }
        };
      });
    } catch (e) {
      $('#libList').innerHTML = '<div class="muted">读取失败：' + esc(e.message) + '</div>';
    }
  };

  async function loadCast(id) {
    const res = await apiFetch('/api/records?id=' + encodeURIComponent(id), {});
    const data = await res.json();
    if (!res.ok) { alert('读取失败：' + (data.message || '')); return; }
    const r = data.record;
    let msgs = {}; try { msgs = JSON.parse(r.messages || '{}'); } catch (e) {}
    // 兼容旧格式（单模型数组）
    if (Array.isArray(msgs)) msgs = msgs.length ? { '（旧版记录）': msgs } : {};
    let colHTML = Object.keys(msgs).map(function (m) {
      const cfg = MODELS.filter(function (x) { return x.id === m; })[0] || { label: m, pv: '' };
      // 兼容两种结构：{模型: [消息...]}（旧）与 {模型: {history: [消息...]}}（现行 aiStates 格式）
      const arr = Array.isArray(msgs[m]) ? msgs[m] : ((msgs[m] && msgs[m].history) || []);
      return '<div class="ai-col">' +
        '<div class="ai-col-head">' + esc(cfg.label || m) + '<span class="pv-tag">' + esc(cfg.pv || '') + '</span></div>' +
        arr.map(function (msg) {
          return '<div class="msg ' + (msg.role === 'user' ? 'user' : 'ai') + '"><b>' +
            (msg.role === 'user' ? '问' : '断') + '：</b>' + mdLite(msg.content) + '</div>';
        }).join('') + '</div>';
    }).join('');
    if (!colHTML) colHTML = '<div class="muted">该卦例无对话记录。</div>';
    $('#libDetail').innerHTML = '<div class="ai-block"><b>' + esc(r.hex) + '</b>　<span class="muted">' +
      esc(r.datetime || '') + '　' + esc(r.pillars || '') + '</span>' +
      '<pre class="pan-text">' + esc(r.pan_text || '') + '</pre>' +
      '<div class="ai-cols">' + colHTML + '</div></div>';
    $('#libDetail').scrollIntoView({ behavior: 'smooth' });
  }

  // ---------- init ----------
  renderModelChips();
  loadModels();
  renderLoginBtn();
  renderTime();
  renderCoins();
  renderTossHint();
  renderStack();
})();
