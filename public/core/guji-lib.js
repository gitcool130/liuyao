/* ============================================================
 * 古籍卦例库 / 古籍原文 (core/guji-lib.js)
 *
 * 三类书，同一套交互：
 *   corpus  仓库自带的断语回归集（六爻爻值齐全，用于对勘规则链）
 *   cases   「六爻数据工坊」转入的原文卦例（只有卦名与变卦名，六爻由卦名还原）
 *   text    古籍全文（章节 → 正文），可检索
 *
 * 数据清单在 public/guji/manifest.json，按需懒加载单本（最大一本约 540KB，
 * 不必开局全下）。自建书籍与卦例存 localStorage，可增可删。
 *
 * 卦名→六爻的还原：卦名唯一确定 6 位阴阳；把本卦与变卦的位逐一比对，
 * 不同的位就是动爻——古籍只写「某卦之某卦」，动爻信息本就编码在里面。
 * ============================================================ */
(function (root) {
  'use strict';
  const W = root;
  // 与 core/local-api.js 同一开关：只有桌面壳/本地模式才挂载古籍库，
  // 线上部署（数据不在仓库里）不出现这张卡片，避免「载入失败」空壳
  if (!W.LY_LOCAL_MODE) return;
  const C = W.LY;
  const USER_KEY = 'ly_guji_user_v1';
  const PAGE = 40;

  const GAN = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'];
  const ZHI = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];
  const LINE_NAMES = ['初爻', '二爻', '三爻', '四爻', '五爻', '上爻'];

  const state = { books: [], cur: null, keyword: '', shown: 0, loading: {}, user: { books: [] } };
  const FONT_KEY = 'ly_reader_font';
  const FONT_MIN = 13, FONT_MAX = 30;
  function fontOf() {
    try {
      const v = parseInt(localStorage.getItem(FONT_KEY) || '', 10);
      if (v >= FONT_MIN && v <= FONT_MAX) return v;
    } catch (e) { }
    return 16;
  }
  function setFont(v) {
    v = Math.max(FONT_MIN, Math.min(FONT_MAX, v));
    try { localStorage.setItem(FONT_KEY, String(v)); } catch (e) { }
    document.querySelectorAll('.guji-text, .rd-text').forEach(function (el) {
      el.style.fontSize = v + 'px';
    });
    const lbl = document.querySelectorAll('.rd-fs-val, .guji-fs-val');
    Array.prototype.forEach.call(lbl, function (x) { x.textContent = v + 'px'; });
    return v;
  }
  function fontBarHTML() {
    return '<span class="guji-fontbar">字号 ' +
      '<button class="guji-fs" data-fs="-1">A−</button>' +
      '<b class="guji-fs-val">' + fontOf() + 'px</b>' +
      '<button class="guji-fs" data-fs="1">A＋</button>' +
      '<button class="guji-fs" data-fs="0">默认</button>' +
      '</span>';
  }
  // 绑定字号按钮（容器内 .guji-fs）
  function bindFontBar(scope) {
    scope.querySelectorAll('.guji-fs').forEach(function (b) {
      b.onclick = function (e) {
        e.stopPropagation();
        const d = parseInt(b.getAttribute('data-fs'), 10);
        setFont(d === 0 ? 16 : fontOf() + d);
        if (window.__rdApply) window.__rdApply();
      };
    });
  }

  /* 全页面阅读：铺满整屏的浮层，Esc 或「关闭」退出。
     与行内阅读共用同一个字号设置。 */
  function openReader(bookName, title, text) {
    const old = document.getElementById('readerOverlay');
    if (old) old.remove();
    const ov = document.createElement('div');
    ov.id = 'readerOverlay';
    ov.innerHTML =
      '<div class="rd-top">' +
      '<span class="rd-title">' + esc(title) + '</span>' +
      '<span class="rd-acts">' +
      '<span class="rd-fs">字号 <button class="rd-fs-btn" data-fs="-1">A−</button>' +
      '<b class="rd-fs-val">' + fontOf() + 'px</b>' +
      '<button class="rd-fs-btn" data-fs="1">A＋</button>' +
      '<button class="rd-fs-btn" data-fs="0">默认</button></span>' +
      '<button class="rd-close">关闭（Esc）</button>' +
      '</span></div>' +
      '<div class="rd-body"><div class="rd-inner">' +
      '<div class="muted rd-src">《' + esc(bookName.replace(' · 原文', '')) + '》</div>' +
      '<div class="rd-text"></div></div></div>';
    document.body.appendChild(ov);
    const body = ov.querySelector('.rd-text');
    body.textContent = text;
    body.style.fontSize = fontOf() + 'px';
    // 按空行切成段，读长文更省眼
    const ps = String(text).split(/\n+/).filter(function (x) { return x.trim(); });
    body.innerHTML = ps.map(function (x) { return '<p>' + esc(x) + '</p>'; }).join('');

    ov.querySelectorAll('.rd-fs-btn').forEach(function (b) {
      b.onclick = function () {
        const d = parseInt(b.getAttribute('data-fs'), 10);
        const v = setFont(d === 0 ? 16 : fontOf() + d);
        body.style.fontSize = v + 'px';
      };
    });
    ov.querySelector('.rd-close').onclick = close;
    function onKey(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey);
    function close() {
      document.removeEventListener('keydown', onKey);
      ov.remove();
    }
    window.__rdApply = function () { body.style.fontSize = fontOf() + 'px'; };
    return ov;
  }


  /* ---------- 工具 ---------- */

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function gzIndexOf(gz) {
    if (!gz || gz.length < 2) return null;
    const g = GAN.indexOf(gz.charAt(0)), z = ZHI.indexOf(gz.charAt(1));
    if (g < 0 || z < 0) return null;
    for (let i = 0; i < 60; i++) if (i % 10 === g && i % 12 === z) return i;
    return null;
  }
  // 卦名 → 6 位阴阳（初→上）。异体字「干」按「乾」处理（旧数据里两者混用）
  function bitsFromName(name) {
    if (!name || !C || typeof C.hexName !== 'function') return null;
    let n = String(name).trim().replace(/\s/g, '');
    if (!n) return null;
    n = n.replace(/干/g, '乾');
    for (let i = 0; i < 64; i++) {
      const bits = [i & 1, (i >> 1) & 1, (i >> 2) & 1, (i >> 3) & 1, (i >> 4) & 1, (i >> 5) & 1];
      if (C.hexName(bits) === n) return bits;
    }
    return null;
  }
  function tossFromNames(ben, bian) {
    const b = bitsFromName(ben);
    if (!b) return null;
    const x = bitsFromName(bian);
    return b.map(function (y, i) {
      const moving = x ? x[i] !== y : false;
      return y ? (moving ? 9 : 1) : (moving ? 6 : 0);
    });
  }

  /* ---------- 用户自建 ---------- */

  function loadUser() {
    try {
      const raw = localStorage.getItem(USER_KEY);
      const o = raw ? JSON.parse(raw) : null;
      if (o && Array.isArray(o.books)) return o;
    } catch (e) { }
    return { books: [] };
  }
  function saveUser(o) {
    try { localStorage.setItem(USER_KEY, JSON.stringify(o)); return true; }
    catch (e) { alert('本机存储写入失败：' + e.message); return false; }
  }

  /* ---------- 装载 ---------- */

  async function loadManifest() {
    state.user = loadUser();
    let list = [];
    try {
      const res = await W.fetch('guji/manifest.json');
      const m = await res.json();
      list = (m.books || []).map(function (b) {
        return { key: b.key, name: b.name, kind: b.kind, count: b.count, file: b.file, loaded: false };
      });
    } catch (e) {
      // 仓库不携带古籍数据（王哥要求不在 GitHub 保留），本地构建时才注入
      state.noData = true;
    }
    state.user.books.forEach(function (b) {
      list.push({
        key: 'user:' + b.name, name: b.name, kind: 'user', count: (b.cases || []).length,
        loaded: true, cases: (b.cases || []).map(function (c) { return normCase(c, b.name); })
      });
    });
    state.books = list;
    if (!state.cur || !list.some(function (x) { return x.key === state.cur; })) {
      state.cur = list.length ? list[0].key : '';
    }
  }

  async function ensureBook(key) {
    const b = state.books.filter(function (x) { return x.key === key; })[0];
    if (!b || b.loaded || b.kind === 'user') return b;
    b.loaded = true;
    try {
      const res = await W.fetch(b.file);
      const data = await res.json();
      if (b.kind === 'text') {
        b.chapters = (data.chapters || []).map(function (c) {
          return { no: c.no, title: c.title || '', text: c.text || '' };
        });
      } else {
        b.cases = (data.cases || []).map(function (c) { return normCase(c, b.name, b.kind); });
      }
    } catch (e) {
      console.warn('[guji] 载入失败', key, e);
      b.error = String(e && e.message || e);
    }
    return b;
  }

  function normCase(c, bookName, kind) {
    if (c.__norm) return c;
    let monthZhi = null;
    if (typeof c.monthZhi === 'number') monthZhi = c.monthZhi;
    else if (typeof c.monthZhi === 'string' && c.monthZhi) {
      const m = ZHI.indexOf(c.monthZhi.charAt(0));
      if (m >= 0) monthZhi = m;
    }
    const dayGZ = c.dayGZ || c.dayGz || '';
    const dayIdx = (typeof c.dayIdx === 'number') ? c.dayIdx : gzIndexOf(dayGZ);

    let toss = Array.isArray(c.toss) ? c.toss.slice(0, 6) : null;
    if (!toss && Array.isArray(c.ben)) {
      // 仓库回归集：ben 里带 yang/moving
      toss = c.ben.map(function (l) {
        const yang = l.yang === true || l.yang === 1;
        return yang ? (l.moving ? 9 : 1) : (l.moving ? 6 : 0);
      });
    }
    if (!toss && c.benGua) {
      // 工坊原文卦例：只有卦名与变卦名
      toss = tossFromNames(c.benGua, c.bianGua);
    }
    const title = c.title
      || (c.question ? String(c.question).replace(/\s+/g, ' ').slice(0, 60) : '')
      || (c.head ? String(c.head).replace(/^例[:：]\s*/, '').slice(0, 60) : '')
      || (c.benGua ? c.benGua + (c.bianGua ? ' 之 ' + c.bianGua : '') : '（无题）');

    return {
      __norm: true,
      id: c.id || ('g' + Math.random().toString(36).slice(2, 10)),
      book: bookName || '',
      title: title,
      chapter: c.chapter || '',
      monthZhi: monthZhi,
      dayIdx: (dayIdx != null && dayIdx >= 0) ? dayIdx : null,
      dayGZ: dayGZ,
      toss: (toss && toss.length === 6) ? toss : null,
      benGua: c.benGua || c.gua || '',
      bianGua: c.bianGua || '',
      question: c.question || '',
      conclusion: c.conclusion || c.text || '',
      quote: c.quote || '',
      raw6: Array.isArray(c.raw6) ? c.raw6 : [],
      note: c.note || '',
      expect: Array.isArray(c.expect) ? c.expect : [],
      kind: kind || 'corpus'
    };
  }

  function curBook() {
    return state.books.filter(function (b) { return b.key === state.cur; })[0] || null;
  }

  /* ---------- 渲染 ---------- */

  function yaoSym(t) {
    return t === 1 ? '━━━' : t === 9 ? '━━━ ○' : t === 6 ? '━ ━ ✕' : '━ ━';
  }

  function renderBookSelect() {
    const sel = document.getElementById('gujiBook');
    if (!sel) return;
    const groups = { corpus: [], duanyu: [], cases: [], text: [], user: [] };
    state.books.forEach(function (b) { (groups[b.kind] || groups.corpus).push(b); });
    const mk = function (arr) {
      return arr.map(function (b) {
        return '<option value="' + esc(b.key) + '"' + (b.key === state.cur ? ' selected' : '') + '>' +
          esc(b.name) + '（' + b.count + (b.kind === 'text' ? ' 章' : ' 例') + '）</option>';
      }).join('');
    };
    let html = '';
    if (groups.corpus.length) html += '<optgroup label="六爻卦例（含爻值）">' + mk(groups.corpus) + '</optgroup>';
    if (groups.duanyu.length) html += '<optgroup label="断语用例（原文＋规则断言）">' + mk(groups.duanyu) + '</optgroup>';
    if (groups.cases.length) html += '<optgroup label="古籍原文卦例">' + mk(groups.cases) + '</optgroup>';
    if (groups.text.length) html += '<optgroup label="古籍全文">' + mk(groups.text) + '</optgroup>';
    if (groups.user.length) html += '<optgroup label="我的书籍">' + mk(groups.user) + '</optgroup>';
    sel.innerHTML = html;
  }

  function renderList() {
    const list = document.getElementById('gujiList');
    const cnt = document.getElementById('gujiCount');
    const moreRow = document.getElementById('gujiMoreRow');
    if (!list) return;
    const b = curBook();
    if (!state.books.length) {
      list.innerHTML = '<div class="muted">本机没有古籍数据包（guji/manifest.json 缺失）。' +
        '可用「新建书籍」自建，或把数据包放进运行目录的 guji/ 下。</div>';
      if (cnt) cnt.textContent = '';
      return;
    }
    if (!b) { list.innerHTML = '<div class="muted">暂无书籍</div>'; return; }
    if (!b.loaded) { list.innerHTML = '<div class="muted">载入中…</div>'; return; }
    if (b.error) { list.innerHTML = '<div class="warn">载入失败：' + esc(b.error) + '</div>'; return; }

    if (b.kind === 'text') { renderChapters(b, list, cnt, moreRow); return; }

    const k = state.keyword.trim().toLowerCase();
    const cases = k ? (b.cases || []).filter(function (c) {
      return [c.title, c.chapter, c.dayGZ, c.conclusion, c.question, c.benGua].join(' ').toLowerCase().indexOf(k) >= 0;
    }) : (b.cases || []);
    if (cnt) cnt.textContent = (k ? '匹配 ' : '共 ') + cases.length + ' 例　·　点条目看原文，可一键装入排盘';
    if (!cases.length) {
      list.innerHTML = '<div class="muted">' + (k ? '没有匹配的卦例。' : '这本书还是空的，可点「添加卦例」。') + '</div>';
      if (moreRow) moreRow.hidden = true;
      return;
    }
    if (!state.shown) state.shown = PAGE;
    const slice = cases.slice(0, state.shown);
    list.innerHTML = slice.map(function (c, i) {
      const gz = (c.monthZhi != null ? ZHI[c.monthZhi] + '月 ' : '') + (c.dayGZ ? c.dayGZ + '日' : '');
      const hex = c.benGua ? '　' + c.benGua + (c.bianGua ? ' 之 ' + c.bianGua : '') : '';
      return '<div class="guji-item" data-k="' + i + '">' +
        '<div class="guji-it-title">' + esc(c.title).slice(0, 96) + '</div>' +
        '<div class="guji-it-meta">' + (gz ? esc(gz) : '') + esc(hex) +
        (c.chapter ? '　' + esc(c.chapter) : '') +
        (c.toss ? '　<span class="muted">' + c.toss.map(yaoSym).join(' ') + '</span>' : '') + '</div>' +
        '</div>';
    }).join('');
    Array.prototype.forEach.call(list.querySelectorAll('.guji-item'), function (el) {
      el.onclick = function () { showCase(slice[parseInt(el.getAttribute('data-k'), 10)]); };
    });
    if (moreRow) moreRow.hidden = (state.shown >= cases.length);
  }

  function renderChapters(b, list, cnt, moreRow) {
    const k = state.keyword.trim();
    const chs = (b.chapters || []).filter(function (c) {
      if (!k) return true;
      return (c.title || '').indexOf(k) >= 0 || (c.text || '').indexOf(k) >= 0;
    });
    if (cnt) cnt.textContent = (k ? '含「' + k + '」的 ' : '共 ') + chs.length + ' 章　·　点章节读原文';
    if (moreRow) moreRow.hidden = true;
    if (!chs.length) { list.innerHTML = '<div class="muted">没有匹配的章节。</div>'; return; }
    list.innerHTML = chs.map(function (c, i) {
      const brief = k ? (function () {
        const at = (c.text || '').indexOf(k);
        const s = Math.max(0, at - 24);
        return '…' + (c.text || '').slice(s, at + 60).replace(/\s+/g, ' ') + '…';
      })() : (c.text || '').replace(/\s+/g, ' ').slice(0, 60);
      return '<div class="guji-item" data-c="' + i + '">' +
        '<div class="guji-it-title">' + esc(c.no ? c.no + '．' : '') + esc(c.title || '（无题）') + '</div>' +
        '<div class="guji-it-meta">' + esc(brief) + '</div></div>';
    }).join('');
    Array.prototype.forEach.call(list.querySelectorAll('.guji-item'), function (el) {
      el.onclick = function () { showChapter(b, chs[parseInt(el.getAttribute('data-c'), 10)]); };
    });
  }

  function showChapter(b, ch) {
    const box = document.getElementById('gujiDetail');
    const bookName = b.name.replace(' · 原文', '');
    box.hidden = false;
    box.innerHTML =
      '<div class="guji-d-title">' + esc(ch.no ? ch.no + '．' : '') + esc(ch.title || '') + '</div>' +
      '<div class="guji-dbar">' +
      '<span class="muted">《' + esc(bookName) + '》</span>' +
      fontBarHTML() +
      '<button class="btn ghost guji-full" id="btnGujiFull" style="padding:2px 10px;font-size:12px">全页面阅读</button>' +
      '</div>' +
      '<div class="guji-text">' + esc(ch.text).replace(/\n/g, '<br>') + '</div>' +
      '<div class="btn-row" style="margin-top:10px">' +
      '<button class="btn ghost" id="btnGujiCopy">复制本章</button>' +
      '<button class="btn ghost" id="btnGujiClose">收起</button></div>';
    const txtEl = box.querySelector('.guji-text');
    txtEl.style.fontSize = fontOf() + 'px';
    bindFontBar(box);
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    document.getElementById('btnGujiFull').onclick = function () {
      openReader(b.name, (ch.no ? ch.no + '．' : '') + (ch.title || ''), ch.text);
    };
    document.getElementById('btnGujiClose').onclick = function () { box.hidden = true; };
    document.getElementById('btnGujiCopy').onclick = function () {
      if (navigator.clipboard) navigator.clipboard.writeText(ch.title + '\n\n' + ch.text).catch(function () { });
    };
  }

  function showCase(c) {
    const box = document.getElementById('gujiDetail');
    if (!box || !c) return;
    const gz = (c.monthZhi != null ? ZHI[c.monthZhi] + '月 ' : '') + (c.dayGZ ? c.dayGZ + '日' : '');
    const raw = (c.raw6 && c.raw6.length)
      ? '<pre class="guji-raw">' + c.raw6.map(function (l) { return esc(String(l).replace(/\t/g, '  ')); }).join('\n') + '</pre>'
      : '';
    const hexLine = c.benGua
      ? '<div class="muted">' + esc(c.benGua) + (c.bianGua ? ' 之 ' + esc(c.bianGua) : '（静卦）') +
        (c.toss ? '　' + c.toss.map(yaoSym).join(' ') : '') + '</div>'
      : '';
    box.hidden = false;
    box.innerHTML =
      '<div class="guji-d-title">' + esc(c.title) + '</div>' +
      '<div class="muted">' + esc(c.book) + (c.chapter ? '　·　' + esc(c.chapter) : '') + (gz ? '　·　' + esc(gz) : '') + '</div>' +
      hexLine + raw +
      (c.quote ? '<div class="guji-quote">原文：' + esc(c.quote) + '</div>' : '') +
      (c.conclusion && c.kind !== 'duanyu' ? '<div class="guji-concl">' + esc(c.conclusion) + '</div>' : '') +
      (c.expect && c.expect.length ? '<div class="guji-expect">规则断言：' + c.expect.map(function (e) {
        if (e.tag && e.rule) return esc(e.tag + ' → ' + e.rule);
        if (e.trend) return esc('引擎判定：' + e.trend);
        return esc(JSON.stringify(e));
      }).join('　｜　') + '</div>' : '') +
      (c.note ? '<div class="guji-quote">校勘：' + esc(c.note) + '</div>' : '') +
      '<div class="btn-row" style="margin-top:10px">' +
      '<button class="btn primary" id="btnGujiLoad"' + (c.toss ? '' : ' disabled') + '>装入排盘</button>' +
      '<button class="btn ghost" id="btnGujiCopy">复制原文</button>' +
      '<button class="btn ghost" id="btnGujiClose">收起</button>' +
      (c.monthZhi == null ? '<span class="muted" style="margin-left:8px">本例未记月建，装入后请自行补选</span>' : '') +
      (c.toss ? '' : '<span class="muted" style="margin-left:8px">本例无可还原的六爻</span>') +
      '</div>';
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    document.getElementById('btnGujiClose').onclick = function () { box.hidden = true; };
    const loadBtn = document.getElementById('btnGujiLoad');
    if (loadBtn) loadBtn.onclick = function () {
      if (typeof W.__lyLoadGujiCase !== 'function') { alert('排盘模块未就绪'); return; }
      W.__lyLoadGujiCase({ monthZhi: c.monthZhi, dayIdx: c.dayIdx, toss: c.toss });
      box.hidden = true;
    };
    document.getElementById('btnGujiCopy').onclick = function () {
      const txt = [c.title, c.book + ' ' + (c.chapter || ''), gz, c.benGua, raw ? c.raw6.join('\n') : '', c.quote, c.conclusion]
        .filter(Boolean).join('\n');
      if (navigator.clipboard) navigator.clipboard.writeText(txt).catch(function () { });
    };
  }

  /* ---------- 添加卦例 / 新建书籍 ---------- */

  function openAddForm() {
    const box = document.getElementById('gujiAdd');
    if (!box) return;
    const b = curBook();
    const cur = (typeof W.__lyGzState === 'function') ? W.__lyGzState() : null;
    let monthOpts = ZHI.map(function (z, i) {
      return '<option value="' + i + '"' + (cur && cur.monthZhi === i ? ' selected' : '') + '>' + z + '月</option>';
    }).join('');
    let dayOpts = '';
    for (let i = 0; i < 60; i++) {
      dayOpts += '<option value="' + i + '"' + (cur && cur.dayIdx === i ? ' selected' : '') + '>' + GAN[i % 10] + ZHI[i % 12] + '日</option>';
    }
    const TOSS = [['1', '少阳（静）'], ['0', '少阴（静）'], ['9', '老阳（动）'], ['6', '老阴（动）']];
    let yaoRows = '';
    for (let i = 5; i >= 0; i--) {
      yaoRows += '<label class="guji-yao">' + LINE_NAMES[i] + '<select class="gu-toss" data-i="' + i + '">' +
        TOSS.map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === '1' ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') +
        '</select></label>';
    }
    box.innerHTML =
      '<div class="guji-add-grid">' +
      '<label>书名<input id="guBook" value="' + esc(b && b.kind === 'user' ? b.name : '我的卦例') + '"></label>' +
      '<label>标题<input id="guTitle" placeholder="如：占乡试（申月癸卯日）"></label>' +
      '<label>章节<input id="guChapter" placeholder="可留空"></label>' +
      '<label>月建<select id="guMonth">' + monthOpts + '</select></label>' +
      '<label>日辰<select id="guDay">' + dayOpts + '</select></label>' +
      '</div>' +
      '<div class="guji-yaos">' + yaoRows + '</div>' +
      '<label class="guji-yao" style="margin-top:8px">原文／断语<textarea id="guText" rows="4" placeholder="粘贴原文断语，可留空"></textarea></label>' +
      '<div class="btn-row" style="margin-top:8px">' +
      '<button class="btn primary" id="btnGuSave">保存卦例</button>' +
      '<button class="btn ghost" id="btnGuCancel">取消</button>' +
      '<span class="muted" id="guTip" style="margin-left:8px"></span></div>';
    box.hidden = false;
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    document.getElementById('btnGuCancel').onclick = function () { box.hidden = true; };
    document.getElementById('btnGuSave').onclick = function () {
      const name = document.getElementById('guBook').value.trim() || '我的卦例';
      const title = document.getElementById('guTitle').value.trim();
      if (!title) { document.getElementById('guTip').textContent = '标题必填'; return; }
      const toss = [];
      Array.prototype.forEach.call(box.querySelectorAll('.gu-toss'), function (s) {
        toss[parseInt(s.getAttribute('data-i'), 10)] = parseInt(s.value, 10);
      });
      const dayIdx = parseInt(document.getElementById('guDay').value, 10);
      const rec = {
        id: 'gu' + Date.now().toString(36),
        title: title,
        chapter: document.getElementById('guChapter').value.trim(),
        monthZhi: parseInt(document.getElementById('guMonth').value, 10),
        dayIdx: dayIdx,
        dayGZ: GAN[dayIdx % 10] + ZHI[dayIdx % 12],
        toss: toss,
        conclusion: document.getElementById('guText').value.trim(),
        raw6: []
      };
      const store = loadUser();
      let bk = store.books.filter(function (x) { return x.name === name; })[0];
      if (!bk) { bk = { name: name, cases: [] }; store.books.push(bk); }
      bk.cases.unshift(rec);
      if (!saveUser(store)) return;
      document.getElementById('gujiSearch').value = '';
      state.keyword = '';
      loadManifest().then(function () {
        state.cur = 'user:' + name; state.shown = PAGE;
        renderBookSelect(); renderList(); renderBookTools();
      });
      box.hidden = true;
    };
  }

  function newBook() {
    const name = prompt('新建书籍，输入书名（如：火珠林、易隐）：');
    if (!name) return;
    const store = loadUser();
    if (store.books.some(function (b) { return b.name === name; })) { alert('同名书籍已存在'); return; }
    store.books.push({ name: name, cases: [] });
    if (!saveUser(store)) return;
    loadManifest().then(function () {
      state.cur = 'user:' + name; state.shown = 0; state.keyword = '';
      renderBookSelect(); renderList(); renderBookTools();
    });
  }

  function renderBookTools() {
    const box = document.getElementById('gujiTools');
    if (!box) return;
    const b = curBook();
    box.innerHTML = (b && b.kind === 'user')
      ? '<button class="btn ghost" id="btnGujiDelBook">删除本书</button>'
      : '<span class="muted">内置书籍只读；要增补请「新建书籍」后添加卦例。</span>';
    const del = document.getElementById('btnGujiDelBook');
    if (del) del.onclick = function () {
      if (!confirm('删除书籍「' + b.name + '」（含 ' + b.count + ' 例）？不可恢复。')) return;
      const store = loadUser();
      store.books = store.books.filter(function (x) { return x.name !== b.name; });
      saveUser(store);
      loadManifest().then(function () { renderBookSelect(); renderList(); renderBookTools(); });
    };
  }

  /* ---------- 挂载 ---------- */

  function build() {
    if (!document.body || document.getElementById('gujiCard')) return;
    const anchor = document.getElementById('panCard');
    const sec = document.createElement('section');
    sec.className = 'card';
    sec.id = 'gujiCard';
    sec.innerHTML =
      '<h2>古籍卦例库</h2>' +
      '<div class="muted" style="margin-bottom:10px">《增删卜易》《卜筮正宗》《易冒》《易隐》《火珠林》等 14 本、共 1687 条（六爻卦例 / 断语用例 / 古籍全文）。' +
      '古籍只写「某卦之某卦」，动爻由本卦与变卦异位反推；点「装入排盘」把六爻与月日原样送进干支排盘对勘。可自建书籍与卦例，存本机。</div>' +
      '<div class="guji-bar">' +
      '<select id="gujiBook" aria-label="选择书籍"></select>' +
      '<input id="gujiSearch" placeholder="搜标题／章节／干支／卦名／原文" aria-label="搜索">' +
      '<button class="btn ghost" id="btnGujiNewBook">新建书籍</button>' +
      '<button class="btn ghost" id="btnGujiNewCase">添加卦例</button>' +
      '</div>' +
      '<div class="guji-tools" id="gujiTools"></div>' +
      '<div class="muted" id="gujiCount" style="margin:6px 0"></div>' +
      '<div id="gujiList" class="guji-list"><div class="muted">载入中…</div></div>' +
      '<div class="btn-row" id="gujiMoreRow" hidden><button class="btn" id="btnGujiMore">加载更多</button></div>' +
      '<div id="gujiDetail" class="guji-detail" hidden></div>' +
      '<div id="gujiAdd" class="guji-add" hidden></div>';
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(sec, anchor);
    else document.querySelector('.wrap').appendChild(sec);

    document.getElementById('gujiBook').onchange = function () {
      state.cur = this.value; state.shown = 0;
      document.getElementById('gujiDetail').hidden = true;
      const b = curBook();
      if (!b) return;
      renderList();
      ensureBook(state.cur).then(function () { renderList(); renderBookTools(); });
    };
    document.getElementById('gujiSearch').oninput = function () {
      state.keyword = this.value; state.shown = 0; renderList();
    };
    document.getElementById('btnGujiNewBook').onclick = newBook;
    document.getElementById('btnGujiNewCase').onclick = openAddForm;
    document.getElementById('btnGujiMore').onclick = function () { state.shown += PAGE; renderList(); };

    loadManifest().then(function () {
      renderBookSelect(); renderBookTools(); renderList();
      ensureBook(state.cur).then(function () { renderList(); });
    });
  }

  const css = document.createElement('style');
  css.textContent =
    '.guji-bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center}' +
    '.guji-bar select,.guji-bar input{font-family:inherit;font-size:13px;padding:6px 8px;border:1px solid var(--line);border-radius:6px;background:#fff;color:var(--ink)}' +
    '.guji-bar input{flex:1;min-width:150px}' +
    '.guji-tools{margin-top:8px;font-size:12px}' +
    '.guji-list{max-height:340px;overflow:auto;border:1px solid var(--line);border-radius:8px;background:#fff}' +
    '.guji-item{padding:7px 10px;border-bottom:1px solid #f0eade;cursor:pointer}' +
    '.guji-item:hover{background:#fbf6ea}' +
    '.guji-it-title{font-size:14px}' +
    '.guji-it-meta{font-size:12px;color:var(--ink-light);margin-top:2px}' +
    '.guji-detail,.guji-add{margin-top:12px;padding:12px 14px;border:1px dashed var(--line);border-radius:8px;background:#fbf8f1}' +
    '.guji-d-title{font-size:15px;font-weight:600;margin-bottom:2px}' +
    '.guji-raw{white-space:pre-wrap;font-family:"Courier New",monospace;font-size:12px;line-height:1.7;background:#fff;border:1px solid var(--line);border-radius:6px;padding:8px;margin:8px 0;overflow:auto}' +
    '.guji-concl,.guji-quote,.guji-text{font-size:13px;line-height:1.9;margin-top:8px;max-height:320px;overflow:auto;white-space:normal}' +
    '.guji-quote,.guji-text{color:var(--ink)}' +
    '.guji-expect{margin-top:8px;padding:8px 10px;border-left:3px solid var(--gold);background:#fdf9ee;font-size:13px;line-height:1.8}' +
    '.guji-text{background:#fff;border:1px solid var(--line);border-radius:6px;padding:10px;line-height:1.95}' +
    '.guji-dbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:6px 0 8px}' +
    '.guji-fontbar{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--ink-light)}' +
    '.guji-fs,.rd-fs-btn{font-family:inherit;font-size:12px;padding:2px 8px;border:1px solid var(--line);border-radius:4px;background:#fff;color:var(--ink);cursor:pointer}' +
    '.guji-fs:hover,.rd-fs-btn:hover{background:#fbf6ea}' +
    '.guji-fs-val,.rd-fs-val{color:var(--ink);min-width:34px;text-align:center;display:inline-block}' +
    '#readerOverlay{position:fixed;inset:0;z-index:9000;background:#f7f3ea;display:flex;flex-direction:column}' +
    '.rd-top{display:flex;align-items:center;gap:12px;padding:10px 22px;border-bottom:1px solid var(--line);background:#fffdf8}' +
    '.rd-title{flex:1;font-size:15px;font-weight:600;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.rd-acts{display:flex;align-items:center;gap:12px}' +
    '.rd-fs{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--ink-light)}' +
    '.rd-close{font-family:inherit;font-size:13px;padding:5px 12px;border:1px solid var(--line);border-radius:6px;background:#fff;color:var(--ink);cursor:pointer}' +
    '.rd-body{flex:1;overflow:auto;padding:20px 0 60px}' +
    '.rd-inner{max-width:820px;margin:0 auto;padding:0 24px}' +
    '.rd-src{font-size:12px;margin-bottom:8px}' +
    '.rd-text{font-size:16px;line-height:2.05;color:var(--ink)}' +
    '.rd-text p{margin:0 0 .9em;text-indent:2em}' +
    '.guji-add-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}' +
    '.guji-add-grid label,.guji-yao{display:flex;flex-direction:column;gap:3px;font-size:12px;color:var(--ink-light)}' +
    '.guji-add-grid input,.guji-add-grid select,.guji-yao select,.guji-yao textarea{font-family:inherit;font-size:13px;padding:5px 7px;border:1px solid var(--line);border-radius:6px;background:#fff;color:var(--ink)}' +
    '.guji-yaos{display:grid;grid-template-columns:repeat(6,1fr);gap:6px;margin-top:8px}' +
    '@media(max-width:640px){.guji-add-grid{grid-template-columns:1fr}.guji-yaos{grid-template-columns:repeat(3,1fr)}}';
  document.head.appendChild(css);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();

  W.LY_GUJI = {
    state: state, loadManifest: loadManifest, ensureBook: ensureBook,
    bitsFromName: bitsFromName, tossFromNames: tossFromNames,
    loadUser: loadUser, USER_KEY: USER_KEY
  };
})(typeof window !== 'undefined' ? window : globalThis);
