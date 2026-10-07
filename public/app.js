/* 六爻排盘 UI (app.js) 依赖 core.js（浏览器中挂于 window.LY） */
(function () {
  const C = window.LY;

  // 核心脚本加载守卫（core/*.js 依次挂载 window.LY）：
  // 任一核心文件 404/被缓存或插件拦截时，旧版会在 renderTime() 处抛
  // 「C.fourPillars is not a function」并让整页交互全部失效且无任何提示。
  if (!C || typeof C.fourPillars !== 'function' || typeof C.paipan !== 'function' || typeof C.analyze !== 'function') {
    const box = document.createElement('div');
    box.style.cssText = 'margin:16px;padding:16px;line-height:1.8;border:1px solid #b22c2c;border-radius:8px;background:#fff8f6;color:#3a2b22;font-size:14px';
    box.innerHTML = '<b>排盘内核未能加载</b><br>' +
      '核心脚本（core/*.js）没有就绪，页面无法排盘。请先强制刷新（Ctrl+F5 / Cmd+Shift+R）。<br>' +
      '若仍失败：可能是浏览器插件或 CDN 缓存拦截了 core/ 下的脚本。';
    document.body.insertBefore(box, document.body.firstChild);
    return;
  }

  const $ = function (s) { return document.querySelector(s); };

  // 上层契约层（sensitive / domain-methods / fact-audit）可用性探测。
  // 这三个文件排在 analyze.js 之后加载；旧缓存页面可能只加载到 analyze.js，
  // 此时不应整页失效——降级为「关闭新增能力」，排盘主流程照旧可用。
  const HAS_ABSORB = !!(C.classifySensitive && C.domainBlock && C.auditFactClaims);
  if (!HAS_ABSORB) {
    console.warn('[liuyao] core/sensitive.js / domain-methods.js / fact-audit.js 未加载，' +
      '敏感分流、分析方法注入与断后事实审计已降级关闭。');
  }

  const LINE_NAMES = ['初爻', '二爻', '三爻', '四爻', '五爻', '上爻'];
  const TOSS_MEAN = {
    1: { name: '单', sym: '━━━━━', desc: '少阳 · 静' },
    0: { name: '拆', sym: '━━　━━', desc: '少阴 · 静' },
    9: { name: '重', sym: '━━━━━ ○', desc: '老阳 · 发动' },
    6: { name: '交', sym: '━━　━━ ✕', desc: '老阴 · 发动' }
  };

  // 手动录入标记：初始三背不可直接当作「已定结果」展示（未点任何东西即显示「重·老阳·发动」会误导）
  let manualTouched = false;

  let selectedDate = new Date();
  let records = [];            // 已定之爻 {coins, backs, val, mode}
  let curCoins = ['背', '背', '背'];
  let pan = null;
  let lastBullets = [];
  let lastAnalysis = null;

  // ---------- 盲摆状态机（M5/M6/M8） ----------
  // pendingToss: null | { coins, val, mode: 'blind' }
  //   blind：点[摇卦]后爻值已由 crypto 熵源内定，UI 不显示字/背，点[落爻]才揭晓记入
  //   manual：用户自行翻铜钱后直接落爻（后果自负）
  let pendingToss = null;
  // revealed: null | { coins, val } —— 盲摆落爻后的揭晓态：
  //   铜钱展示本次摇出的真实字/背，只读不可翻，直到下一次[摇卦]/[撤销]/[重置]才清除。
  //   （此前落爻后直接重置回「背背背」，用户全程只见背面，误以为摇卦失效）
  let revealed = null;

  // 密码学随机源（M8）：优先 crypto.getRandomValues，无则降级并警告
  function secureCoin() {
    const c = (typeof crypto !== 'undefined' && crypto.getRandomValues) ? crypto : null;
    if (c) return c.getRandomValues(new Uint8Array(1))[0] & 1; // 0/1 均匀
    console.warn('当前环境无 crypto.getRandomValues，降级 Math.random');
    return Math.random() < 0.5 ? 1 : 0;
  }
  function cryptoToss() {
    const coins = [secureCoin(), secureCoin(), secureCoin()].map(function (b) { return b ? '背' : '字'; });
    const backs = coins.filter(function (x) { return x === '背'; }).length;
    return { coins: coins, backs: backs, val: tossValFromBacks(backs) };
  }

  // ---------- 时间锁（M7） ----------
  // 现场摇卦（默认）：第一次摇卦瞬间锁定时刻，dtInput 不可编辑
  // 补录模式：时间可编辑（为既往时刻补卦）
  let timeMode = 'live';       // 'live' | 'backfill'
  let timeLocked = false;      // 现场模式一旦开摇即锁
  let lockedDate = null;       // 首摇锁定的时刻（切补录改时后切回现场，据此恢复，防绕过锁定）

  // ---------- 时间 ----------
  function fmtDT(dt) {
    const p = function (n) { return (n < 10 ? '0' : '') + n; };
    return dt.getFullYear() + '-' + p(dt.getMonth() + 1) + '-' + p(dt.getDate()) +
      ' ' + p(dt.getHours()) + ':' + p(dt.getMinutes());
  }
  function renderTime() {
    const pil = C.fourPillars(selectedDate);
    $('#timeInfo').innerHTML =
      '<div class="muted">公历 ' + fmtDT(selectedDate) +
      (timeMode === 'live' ? '（现场摇卦 · ' + (timeLocked ? '已锁定于首摇' : '开摇即锁定') + '）' : '（补录模式 · 时间可改）') + '</div>' +
      '<div class="gz">' + pil.yearGZ + '年 · ' + pil.monthGZ + '月 · <b>' + pil.dayGZ + '日</b> · ' + pil.hourGZ + '时</div>' +
      '<div class="muted">月建 <b class="gz-hi">' + C.ZHI[pil.monthZhi] + '</b> ｜ 日辰 <b class="gz-hi">' + C.ZHI[pil.dayZhi] + '</b> ｜ 旬空 <b class="kong">' + pil.kongStr + '</b></div>' +
      (pil.outOfTable
        ? '<div class="warn">⚠ 历法精度降级：' + selectedDate.getFullYear() + ' 年超出节气时刻表覆盖范围（1900–2100），月柱与年柱按典型交节日近似（±2 日以内）；日柱、时柱不受影响。古籍卦例回归请注意此项。</div>'
        : '');
    const p2 = function (n) { return (n < 10 ? '0' : '') + n; };
    // 始终与 selectedDate 同步：切模式/锁定时刻恢复/补录改时后，
    // #timeInfo 与输入框必须指向同一时刻（旧版仅在输入框为空时赋值，二者会不一致）
    $('#dtInput').value = selectedDate.getFullYear() + '-' + p2(selectedDate.getMonth() + 1) + '-' + p2(selectedDate.getDate()) +
      'T' + p2(selectedDate.getHours()) + ':' + p2(selectedDate.getMinutes());
    $('#dtInput').disabled = (timeMode === 'live'); // 现场模式不可改时间
  }

  // ---------- 起卦 ----------
  // blind 遮蔽：已摇未落期间，铜钱显示「？」，不泄露爻象（M5）
  function renderCoins() {
    const hidden = !!(pendingToss && pendingToss.mode === 'blind');
    const showing = revealed ? revealed.coins : curCoins;
    $('#coinRow').innerHTML = showing.map(function (c, i) {
      return '<button class="coin' + (hidden ? ' is-hidden' : (c === '字' ? ' is-zhi' : '')) + (revealed && !hidden ? ' is-revealed' : '') + '" data-i="' + i + '">' +
        (hidden ? '？' : c) + '</button>';
    }).join('');
    Array.prototype.forEach.call(document.querySelectorAll('.coin'), function (btn) {
      btn.onclick = function () {
        if (pendingToss && pendingToss.mode === 'blind') return; // 已摇出，不可翻看
        if (revealed) return; // 已揭晓的盲摇结果不可翻（下一爻请点[摇卦]）
        manualTouched = true;
        curCoins[+btn.dataset.i] = curCoins[+btn.dataset.i] === '背' ? '字' : '背';
        renderCoins(); renderTossHint();
      };
    });
  }
  function backCount() { return curCoins.filter(function (c) { return c === '背'; }).length; }
  function tossValFromBacks(n) { return n === 1 ? 1 : n === 2 ? 0 : n === 3 ? 9 : 6; }

  function renderTossHint() {
    const hint = $('#tossHint');
    if (pendingToss && pendingToss.mode === 'blind') {
      // 盲摆中：只报进度，不报结果
      hint.innerHTML = '<b>第 ' + (records.length + 1) + ' 爻已摇出</b> · 请落爻';
      return;
    }
    if (revealed) {
      // 揭晓态：报告刚落之爻的真实结果（records.length 已含本爻，即第 N 爻）
      const t = TOSS_MEAN[revealed.val];
      const nb = revealed.coins.filter(function (x) { return x === '背'; }).length;
      hint.innerHTML = '<b>第 ' + records.length + ' 爻已落</b> · ' + t.name + '（' + nb + ' 背 ' + (3 - nb) + ' 字）→ ' + t.sym + ' 　' + t.desc +
        '<div class="muted" style="font-size:12px;margin-top:2px">盲摇已定 · ' + (records.length < 6 ? '请摇下一爻' : '六爻已成') + '</div>';
      return;
    }
    if (!records.length && !manualTouched) {
      // 初始态：默认三背不是「已定结果」，不可直接显示「重·老阳·发动」
      hint.innerHTML = '<b>点[摇卦]</b>由密码学熵源定爻，再点[落爻]记入；亦可自行翻铜钱后直接[落爻]手动录入。' +
        '<div class="muted" style="font-size:12px;margin-top:2px">静心默念所测之事，六爻依次自初爻装起</div>';
      return;
    }
    const n = backCount();
    const v = tossValFromBacks(n);
    const t = TOSS_MEAN[v];
    hint.innerHTML = '<b>' + t.name + '</b>（' + n + ' 背 ' + (3 - n) + ' 字）→ ' + t.sym + ' 　' + t.desc +
      '<div class="muted" style="font-size:12px;margin-top:2px">手动录入 · 后果自负</div>';
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
        // 当前爻：盲摆中显示已摇出，否则显示待摇
        html += '<div class="yao-slot current"><span class="nm">' + LINE_NAMES[i] + '</span><span>' +
          (pendingToss && pendingToss.mode === 'blind' ? '已摇出' : '？') + '</span></div>';
      } else {
        html += '<div class="yao-slot"><span class="nm">' + LINE_NAMES[i] + '</span><span>—</span></div>';
      }
    }
    $('#yaoStack').innerHTML = html;
    $('#stepHint').textContent = records.length < 6 ?
      ('第 ' + (records.length + 1) + ' 次摇卦，装' + LINE_NAMES[records.length] + '。静心默念所测之事。') :
      '六爻已成。';
  }

  function resetTossState() {
    pendingToss = null;
    revealed = null;
    manualTouched = false;
    curCoins = ['背', '背', '背'];
  }

  // 摇卦（M5）：crypto 熵源内定，摇与落之间不可反悔
  $('#btnRandom').onclick = function () {
    if (records.length >= 6) return;
    if (pendingToss && pendingToss.mode === 'blind') return; // 已摇出，禁重摇
    revealed = null; // 清除上一爻的揭晓态，进入新一轮盲摆
    // 现场模式：首摇瞬间锁定占时（M7）
    if (timeMode === 'live' && !timeLocked) {
      selectedDate = new Date();
      timeLocked = true;
      lockedDate = selectedDate; // 记忆锁定时刻，供模式往返后恢复
      renderTime();
    }
    pendingToss = { mode: 'blind', coins: null, val: null };
    const t = cryptoToss();
    pendingToss.coins = t.coins; pendingToss.backs = t.backs; pendingToss.val = t.val;
    curCoins = t.coins.slice(); // 暂存（落爻时揭晓显示后随重置）
    renderCoins(); renderTossHint(); renderStack();
  };

  // 落爻：揭晓并记入（blind），或手动录入（manual）
  $('#btnConfirm').onclick = function () {
    if (records.length >= 6) return;
    let rec;
    if (pendingToss && pendingToss.mode === 'blind') {
      rec = { coins: pendingToss.coins.slice(), backs: pendingToss.backs, val: pendingToss.val, mode: 'blind' };
    } else {
      // 手动模式：用户自主定结果（后果自负）
      const n = backCount();
      rec = { coins: curCoins.slice(), backs: n, val: tossValFromBacks(n), mode: 'manual' };
    }
    records.push(rec);
    if (rec.mode === 'blind') {
      // 盲摆落爻：揭晓真实铜钱并展示，供用户核对（只读），下次摇卦才清除
      pendingToss = null;
      revealed = { coins: rec.coins.slice(), val: rec.val };
    } else {
      resetTossState();
    }
    renderCoins(); renderTossHint(); renderStack();
    if (records.length === 6) computePan();
  };

  // 撤销（M6 修复）：撤销必须彻底重置当前爻状态（含 curCoins 与盲摆内定值），
  // 杜绝「复制上一爻」与「摇后撤销再摇」两类状态残留
  $('#btnUndo').onclick = function () {
    if (!records.length) { resetTossState(); renderCoins(); renderTossHint(); renderStack(); return; }
    records.pop(); pan = null; lastBullets = []; lastAnalysis = null;
    resetTossState(); // ★ 关键修复：清掉 curCoins / pendingToss
    $('#panCard').hidden = true; $('#analysisCard').hidden = true; $('#aiCard').hidden = true;
    renderCoins(); renderTossHint(); renderStack();
  };

  $('#btnReset').onclick = function () {
    records = []; pan = null; lastBullets = []; lastAnalysis = null;
    resetTossState();
    timeLocked = false;           // 重新起卦解锁时间，等待新的首摇
    lockedDate = null;
    if (timeMode === 'live') selectedDate = new Date();
    $('#panCard').hidden = true; $('#analysisCard').hidden = true; $('#aiCard').hidden = true;
    $('#useSelect').value = '';
    const uc = $('#useCustom'); if (uc) { uc.value = ''; uc.hidden = true; }
    // 一并清掉新增三块的状态：敏感提示、按卦名提示、被拦截而禁用的断卦按钮
    const sb = $('#senseBox'); if (sb) { sb.hidden = true; sb.innerHTML = ''; lastSensitive = null; }
    const bnh = $('#byNameHint'); if (bnh) bnh.innerHTML = '';
    const bai = $('#btnAI'); if (bai) bai.disabled = false;
    renderTime(); renderCoins(); renderTossHint(); renderStack();
  };

  // 时间模式切换（M7）：现场摇卦 ↔ 补录
  $('#btnTimeMode').onclick = function () {
    timeMode = (timeMode === 'live') ? 'backfill' : 'live';
    if (timeMode === 'backfill') {
      timeLocked = false; // 补录允许改时间；首摇锁定时刻由 lockedDate 记忆，切回现场时恢复
    } else {
      const hasProgress = records.length > 0 || !!pendingToss;
      timeLocked = hasProgress;
      if (hasProgress) {
        // 已开摇的现场模式：恢复首摇锁定的时刻——补录期间改过时间也不得污染锁定值
        if (lockedDate) selectedDate = new Date(lockedDate.getTime());
      } else {
        lockedDate = null; // 尚未开摇：解除记忆，取当前时刻
        selectedDate = new Date();
      }
    }
    this.textContent = (timeMode === 'live') ? '切换补录模式' : '切回现场摇卦';
    const lbl = $('#dtLabel');
    if (lbl) lbl.textContent = timeMode === 'live' ? '占问时刻（现场摇卦 · 首摇锁定）：' : '占问时刻（补录模式 · 可改）：';
    renderTime();
    // 六爻已成时：时刻变了必须重排盘，否则 #timeInfo 显示锁定时刻而 pan.pillars 仍是补录时刻
    if (records.length === 6) computePan();
  };

  $('#dtInput').onchange = function () {
    if (timeMode === 'live') return; // 现场模式时间已锁（保险：disabled 之外双保险）
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
    renderWxBlock();
  }

  // 旺相休囚死：五行之气在当月令下的流转（自旺至死）。
  // 只陈述时令旺衰这一层事实，不掺吉凶——与「无评分制」同一立场。
  function renderWxBlock() {
    const box = $('#wxBlock');
    if (!box || !pan || typeof C.wangXiangXiuQiuSi !== 'function') return;
    const mz = pan.pillars.monthZhi;
    const GRADES = ['旺', '相', '休', '囚', '死'];
    const rows = ['木', '火', '土', '金', '水'].map(function (w) {
      return { w: w, g: C.wangXiangXiuQiuSi(w, mz) };
    }).sort(function (a, b) { return GRADES.indexOf(a.g) - GRADES.indexOf(b.g); });
    box.innerHTML = '<div class="verdict" style="margin-top:12px;padding:10px 14px;font-size:14px">' +
      '<b>旺相休囚死</b>（月令 ' + C.ZHI[mz] + '）　' +
      rows.map(function (r) { return r.w + '<b>' + r.g + '</b>'; }).join(' · ') +
      '<div class="muted" style="margin-top:4px">五行之气在本月令下的流转，自旺至死；只陈述时令旺衰，不作吉凶断语。</div></div>';
  }

  // ---------- 按卦名起卦（复现古籍卦例 / 录入已有之卦） ----------
  // 卦名 → 六爻卦画（自下而上）→ 叠加动爻 → tossVals。
  // 全链路确定性换算，不经手大模型，也不掷币：古籍卦例只记卦画与动爻，本来就没有爻值。
  function guaBitsByName(name) {
    const keys = Object.keys(C.HEXNAMES).filter(function (k) { return C.HEXNAMES[k] === name; });
    if (!keys.length) return null;
    const key = keys[0];                       // key = 下卦名 + 上卦名（各一字）
    const lo = key.slice(0, 1), up = key.slice(1);
    if (!C.TRIG[lo] || !C.TRIG[up]) return null;
    return C.TRIG[lo].bits.concat(C.TRIG[up].bits);   // 自下而上 [初..上]
  }

  // val → 背面个数（与 tossValFromBacks 互逆）：9=3背 1=1背 0=2背 6=0背
  function coinsFromVal(val) {
    const backs = val === 9 ? 3 : val === 1 ? 1 : val === 0 ? 2 : 0;
    const coins = [];
    for (let i = 0; i < 3; i++) coins.push(i < backs ? '背' : '字');
    return coins;
  }

  function castByName() {
    const hint = $('#byNameHint');
    const name = ($('#guaNameInput').value || '').trim();
    const raw = ($('#guaDongInput').value || '').trim();
    if (!name) { hint.innerHTML = '<span style="color:#a83f39">请输入卦名。</span>'; return; }
    const bits = guaBitsByName(name);
    if (!bits) { hint.innerHTML = '<span style="color:#a83f39">未收录该卦名，请从下拉清单中选六十四卦之一。</span>'; return; }
    let dong = [];
    if (raw) {
      dong = raw.replace(/[，、\s]+/g, ',').split(',').filter(Boolean).map(function (s) { return parseInt(s, 10); });
      if (!dong.length || dong.some(function (n) { return !(n >= 1 && n <= 6); })) {
        hint.innerHTML = '<span style="color:#a83f39">动爻须为 1–6 的数字，多个以逗号分隔（如 3,4）。</span>';
        return;
      }
    }
    records = [];
    for (let i = 0; i < 6; i++) {
      const moving = dong.indexOf(i + 1) >= 0;
      const val = bits[i] === 1 ? (moving ? 9 : 1) : (moving ? 6 : 0);
      records.push({ coins: coinsFromVal(val), backs: val === 9 ? 3 : val === 1 ? 1 : val === 0 ? 2 : 0, val: val, mode: 'byname' });
    }
    resetTossState();
    // 现场模式下首摇会锁时刻；按卦名起卦不经过首摇，故补一次锁定，保持口径一致
    if (timeMode === 'live' && !timeLocked) {
      selectedDate = new Date(); timeLocked = true; lockedDate = selectedDate; renderTime();
    }
    computePan();
    hint.innerHTML = '已按「' + esc(name) + (dong.length ? '，动爻 ' + dong.join('、') : '，静卦') + '」起卦。' +
      (timeMode === 'live'
        ? '<div class="muted" style="margin-top:4px">复现古籍卦例需指定古占之日：点[切换补录模式]再改占问时刻。</div>'
        : '');
  }

  // ---------- 断卦 ----------
  // 当前所测之事的文本（固定事类返回标签，自定义返回输入内容）
  function currentQuestion() {
    const t = $('#useSelect').value;
    if (t === '__custom__') return ($('#useCustom').value || '').trim();
    const useMap = { '妻财': '求财·买卖', '官鬼': '功名·官司·疾病', '父母': '考试·文书', '子孙': '子女·医药', '兄弟': '朋友·竞争', 'shi': '自身运势' };
    return useMap[t] || '';
  }

  // ---------- 敏感问题确定性分流（core/sensitive.js） ----------
  // 只对「用户自己写下的事由」分流：固定事类的下拉标签（如「功名·官司·疾病」）
  // 带「疾病」二字纯属分类说明，拿它去分流会让每个选官鬼的人都吃到就医提示。
  let lastSensitive = null;
  function sensitiveDecision() {
    if (!HAS_ABSORB) return { category: 'not_sensitive', action: 'pass', urgent: false, message: '' };
    const isCustom = $('#useSelect').value === '__custom__';
    return C.classifySensitive(isCustom ? currentQuestion() : '');
  }
  function renderSensitive() {
    const box = $('#senseBox'), btn = $('#btnAI');
    if (!box) return;
    const d = sensitiveDecision();
    lastSensitive = d;
    if (d.action === 'pass') {
      box.hidden = true; box.innerHTML = '';
      if (btn) btn.disabled = false;
      return;
    }
    box.hidden = false;
    // block 用告警框（朱红），advisory 用普通提示框
    box.className = d.action === 'block' ? 'ai-block warn' : 'verdict';
    box.innerHTML = (d.urgent ? '<b>⚠ 紧急　</b>' : '') + esc(d.message) +
      (d.action === 'block'
        ? '<div class="muted" style="margin-top:6px">此问已按安全边界拦截，不进入大模型断卦；排盘与旺衰粗判仍可查看。</div>'
        : '<div class="muted" style="margin-top:6px">可继续断卦，但断语不得写成医学诊断或替代现实处置。</div>');
    if (btn) btn.disabled = (d.action === 'block');
  }

  function renderAnalysis() {
    const target = $('#useSelect').value;
    const list = $('#conclList');
    const vBox = $('#verdictBox');
    const customInput = $('#useCustom');
    customInput.hidden = (target !== '__custom__');
    renderSensitive();     // 每次改选事类都重算分流（含把拦截态解除）
    if (!target || target === '__custom__') {
      // 空选与自定义：无固定用神可取，旺衰硬规则不适用，给出通用次第
      list.innerHTML = '<li>选择所测之事，先观用神旺衰。通用次第：一观世爻旺衰，二观用神与世应，三审动爻生克，四定旬空月破与应期。</li>' +
        (target === '__custom__' ? '<li>自定义所测不作旺衰粗判，所测事项将写入排盘文本交由大模型细断。</li>' : '');
      vBox.hidden = true; lastBullets = [];
      return;
    }
    const res = C.analyze(pan, target);
    lastBullets = res.bullets;
    lastAnalysis = res;
    list.innerHTML = res.bullets.map(function (b) {
      return '<li' + (b.indexOf('⚠') >= 0 ? ' class="warn"' : '') + '>' + b + '</li>';
    }).join('');
    vBox.hidden = false;
    const TREND_LABEL = { '吉': '趋吉', '凶': '趋凶', '平': '持平', '待审': '待审' };
    // 应期三层展示（主应期 / 辅助节点 / 风险窗口）：结构化视图优先，
    // 老版本引擎（无 yingqiLayers）自动回落到扁平线索，不因字段缺失而空白。
    const LAYER_LABEL = { main: '主应期', auxiliary: '辅助节点', risk: '风险窗口' };
    const ly = res.yingqiLayers;
    let yq = '';
    if (ly && (ly.main.length || ly.auxiliary.length || ly.risk.length)) {
      yq = ['main', 'auxiliary', 'risk'].filter(function (k) { return ly[k] && ly[k].length; })
        .map(function (k) {
          return '<div class="muted" style="margin-top:4px">' + LAYER_LABEL[k] + '：' + esc(ly[k].join('；')) + '</div>';
        }).join('');
    } else if (res.yingqiClues && res.yingqiClues.length) {
      yq = '<div class="muted" style="margin-top:6px">应期线索：' + esc(res.yingqiClues.join('；')) + '</div>';
    }
    vBox.innerHTML = '<b>粗判（' + TREND_LABEL[res.trend] + '）</b>　' + res.verdict + yq;
  }
  $('#useSelect').onchange = function () { renderAnalysis(); if ($('#useCustom').hidden === false) $('#useCustom').focus(); };
  // 自定义事由逐字输入即重算分流：写到「能不能活多久」这类词时立刻拦截，
  // 不必等点击断卦才提示（粗判不重算——自定义本就不作旺衰粗判）。
  $('#useCustom').oninput = function () { renderSensitive(); };

  // ---------- 排盘文本（复制与 AI 共用） ----------
  function buildPanText(forAI) {
    const pil = pan.pillars;
    let txt = '【六爻排盘】\n';
    txt += '时间：' + fmtDT(selectedDate) + '（' + pil.yearGZ + '年 ' + pil.monthGZ + '月 ' + pil.dayGZ + '日 ' + pil.hourGZ + '时，旬空' + pil.kongStr + '）\n';
    if (pil.outOfTable) txt += '注：该年超出节气时刻表覆盖范围（1900–2100），月柱与年柱按典型交节日近似（±2 日以内），日柱与时柱为精确值。\n';
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
      txt += '\n【旺衰粗判（规则链 · 非评分制）】\n';
      lastBullets.forEach(function (b) {
        txt += '- ' + b.replace(/<[^>]+>/g, '') + '\n';
      });
    }
    if (forAI && HAS_ABSORB) {
      // 领域分析方法注入：只规定看盘次序与常见误判，不预设吉凶，也不得被当成古籍引文。
      const blk = C.domainBlock($('#useSelect').value, currentQuestion());
      if (blk) txt += '\n' + blk;
      const d = sensitiveDecision();
      if (d.action === 'advisory') txt += '\n【现实边界提示】' + d.message + '\n';
      // 契约：盘面事实不可改写，传统推断可自由但不得与盘面矛盾。
      txt += '\n【契约】「卦象」「旺衰粗判」两节为确定性结果：六亲、纳甲、世应、动爻、旬空、月破' +
        '不得改写或重新推算。吉凶、应期与取象可作传统推断，但每一条都须与上述盘面事实一致。\n';
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
    // 合并而非覆盖：清单异步返回期间用户已点选的模型不得被静默丢弃
    const current = (selModels || []).filter(function (id) {
      return MODELS.some(function (x) { return x.id === id; });
    });
    loadSelModels().forEach(function (id) {
      if (current.indexOf(id) < 0) current.push(id);
    });
    selModels = current.length ? current : DEFAULT_MODELS.slice();
    renderModelChips();
  }

  async function loadModels() {
    const warn = $('#modelWarn');
    try {
      const res = await fetch('/api/models');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      if (!data || !Array.isArray(data.models) || !data.models.length) throw new Error('模型清单为空');
      applyModels(data.models);
      // 服务端配置告警（后台变量写错、模型缺 key 等）直接展示，不再静默
      const ws = Array.isArray(data.warnings) ? data.warnings.filter(Boolean) : [];
      if (warn) {
        if (ws.length) { warn.hidden = false; warn.textContent = '⚠ ' + ws.join('；'); }
        else { warn.textContent = ''; warn.hidden = true; }
      }
    } catch (e) {
      // 本地打开或接口异常：保留内置清单，但要让用户知道「芯片是内置兜底清单」
      if (warn) {
        warn.hidden = false;
        warn.textContent = '⚠ 未能读取后台模型清单（' + (e.message || '接口不可用') + '），当前显示内置清单，可能遗漏已在后台配置的模型或未配 key。';
      }
    }
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
    // 模型 id/label/pv/tip 来自后台环境变量（CUSTOM_PROVIDERS / GPT_MODELS），一律转义后入 DOM
    $('#modelChips').innerHTML = MODELS.map(function (m) {
      return '<button class="mchip' + (selModels.indexOf(m.id) >= 0 ? ' on' : '') + '" data-m="' + escAttr(m.id) + '" title="' + escAttr(m.tip || '') + '">' +
        '<span class="pv">' + esc(m.pv) + '</span>' + esc(m.label) + (m.tip ? '<span class="pv"> · ' + esc(m.tip) + '</span>' : '') + '</button>';
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

  // 请求头浅合并：调用方传入的 headers 不得整体覆盖 Content-Type / 口令头
  function withHeaders(opts) {
    const o = Object.assign({}, opts || {});
    o.headers = Object.assign({}, apiHeaders(), o.headers || {});
    return o;
  }

  // 请求封装：401 时清除旧口令并提示重输；silent=true 时不弹框（自动保存场景静默跳过）
  async function apiFetch(path, opts, silent) {
    let res = await fetch(path, withHeaders(opts));
    if (res.status === 401 && !silent) {
      localStorage.removeItem('ly_access_code');
      renderLoginBtn();
      const code = prompt('需要口令才能继续，请输入：');
      if (code) {
        localStorage.setItem('ly_access_code', code);
        renderLoginBtn();
        res = await fetch(path, withHeaders(opts));
        if (res.status === 401) localStorage.removeItem('ly_access_code');
        renderLoginBtn();
      }
    }
    return res;
  }

  // 文本位转义：基于 textContent → innerHTML，转义 & < >，但**不转义引号**，
  // 因此只能用于文本节点位置；放进属性值会被引号逃逸（见 escAttr）。
  function esc(s) {
    const d = document.createElement('div');
    d.textContent = String(s);
    return d.innerHTML;
  }
  // 属性值专用转义：esc() 之上再补 双引号/单引号，
  // 否则 data-id="x" onmouseover="..." 这类引号逃逸可注入属性与事件处理器。
  function escAttr(s) {
    return esc(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
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
    // ↓ 以下四段为「上层契约」（不可改盘 / 盘面优先 / 追问不重起卦 / 现实边界），
    //   与 functions/api/interpret.js 的 SYSTEM_PROMPT 保持一致，改一处须改两处。
    '【盘面事实不可改写】排盘里的六亲、纳甲、世应、动爻、旬空、月破、伏神均为程序确定性推算结果；' +
    '不得重新推算、不得改写，也不得写出与之矛盾的表述。吉凶、应期与取象可作传统推断，但须与盘面一致。',
    '【主次次序】以作用到世、应、用神的实际生克冲合为主证据；只出现在卦中却未作用到主线的结构，' +
    '列为辅助信息，不得升级为结论。不得用正负计分替代断卦。',
    '【追问沿用原盘】用户就同一事继续追问时，沿用本次排盘的起卦时刻、月日、爻值、世应与用神主线，' +
    '不重新起卦、不因当前日期变化而重算原盘、不事后改写首次结论；' +
    '只有当事项、对象、目标或时间范围发生实质变化时才说明需另起一卦。',
    '【现实边界】健康、生死、失踪、胎儿性别、重大财法决策不得由卦象替代现实判断；' +
    '涉及此类内容须明确提示就医、报警或咨询专业人士，不得写成医学诊断或法律意见。'
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

  // 断后事实审计：把断语里显式写出的盘面断言与卦盘对撞，只提示冲突，不改断语、不评吉凶。
  // 流式输出没有回检时，「三爻为妻财」写错也照样通顺，故此处补一道确定性对照。
  function auditHTML(reply) {
    if (!HAS_ABSORB || !pan) return '';
    let r;
    try { r = C.auditFactClaims(reply, pan); }
    catch (e) { return ''; }   // 审计自身出错不得影响断语展示
    if (!r || r.accepted) return '';
    return '<div class="ai-block warn" style="margin-top:8px;font-size:13px;line-height:1.7">⚠ ' +
      esc(C.auditText(r)) + '</div>';
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
    // err.detail 的截断顺序：先 slice(0,300) 再 esc()，不可颠倒——
    // 先转义后截断会在 HTML 实体（&amp; / &lt; 等）中间切断，产出半个实体字符串。
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
    // 整体 try/finally：renderCols()/colBody()/Promise.all() 任一在 try 之外抛错，
    // 按钮恢复那两行就不会执行，按钮将永久停在「卦师推敲中…」禁用态。
    try {
      aiStates = {};
      renderCols();
      selModels.forEach(function (m) {
        colBody(m).innerHTML = '<div class="loading">推卦中…</div>';
      });
      await Promise.all(selModels.map(async function (m) {
        try {
          const reply = await callInterpret(m, []);
          aiStates[m] = { history: [{ role: 'assistant', content: reply }] };
          colBody(m).innerHTML = '<div class="ai-block">' + mdLite(reply) + '</div>' + auditHTML(reply);
        } catch (e) {
          renderFailBox(colBody(m), m, [], e);
        }
      }));
      $('#chatBox').hidden = !Object.keys(aiStates).length;
      autoSaveCast();
    } finally {
      btn.disabled = false; btn.textContent = '重新断卦';
    }
  };

  let chatBusy = false;
  async function sendChat() {
    const input = $('#chatInput');
    const q = input.value.trim();
    if (!q || chatBusy || !Object.keys(aiStates).length) return;
    chatBusy = true;
    input.value = '';
    // 整体 try/finally：Promise.all 之外若抛错（如 colBody 返回 null 使 insertAdjacentHTML 失败），
    // 末行 chatBusy=false 不会执行，此后所有追问都会被 chatBusy 永久静默拦截。
    try {
      const active = Object.keys(aiStates);
      active.forEach(function (m) {
        aiStates[m].history.push({ role: 'user', content: q });
        colBody(m).insertAdjacentHTML('beforeend',
          '<div class="msg user"><b>问：</b>' + mdLite(q) + '</div><div class="msg ai" id="chatload-' + midSafe(m) + '"><span class="loading">推敲中…</span></div>');
      });
      await Promise.all(active.map(async function (m) {
        const loadEl = document.getElementById('chatload-' + midSafe(m));
        // 本次追问已入栈，须整段送出：旧版 slice(0,-1) 把刚入栈的问题切掉，大模型收不到追问
        const historySnapshot = aiStates[m].history.slice();
        try {
          const reply = await callInterpret(m, historySnapshot);
          aiStates[m].history.push({ role: 'assistant', content: reply });
          if (loadEl) loadEl.innerHTML = mdLite(reply) + auditHTML(reply);
        } catch (e) {
          if (loadEl) {
            const box = document.createElement('div');
            loadEl.innerHTML = '';
            loadEl.appendChild(box);
            // 失败降级：手动提示词须含本次追问（同样用整段历史）
            renderFailBox(box, m, historySnapshot, e);
          }
        }
      }));
      autoSaveCast();
    } finally {
      chatBusy = false;
    }
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
    if (tip) tip.textContent = logged ? '已登录，断卦后自动入卦例库' : '卦例库需口令，浏览与装入均需登录';
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
        return '<div class="lib-item" data-id="' + escAttr(r.id) + '"><span>' + esc(r.question || '（未注明所测）') + ' · ' + esc(r.hex) + '</span>' +
          '<span class="lib-side"><span class="muted">' + esc((r.created_at || '').slice(0, 10)) + '</span>' +
          '<button class="lib-del" data-del="' + escAttr(r.id) + '" title="删除此卦例">×</button></span></div>';
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

  // 卦例详情区的失败呈现：写入可见文本并提示。
  // loadCast 的调用点（el.onclick）是同步调用 async 函数且未接 .catch，
  // 故异常必须在本函数内部收口，否则 Promise rejection 无处落地。
  function libDetailError(msg) {
    const det = $('#libDetail');
    if (det) det.innerHTML = '<div class="muted">' + esc(msg) + '</div>';
    alert(msg);
  }

  async function loadCast(id) {
    try {
      const res = await apiFetch('/api/records?id=' + encodeURIComponent(id), {});
      const data = await res.json();
      if (!res.ok) { libDetailError('读取失败：' + (data.message || '')); return; }
      const r = data.record;
      if (!r) { libDetailError('读取失败：卦例不存在'); return; }
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
    } catch (e) {
      // 部署传播期 / 网络抖动 / 后端 500 返回 HTML → res.json() 在此抛出
      libDetailError('读取失败：' + ((e && e.message) || '接口不可用，请稍后重试'));
    }
  }

  // ---------- init ----------
  // 卦名下拉：64 卦全量（由 HEXNAMES 反查，避免手抄清单与排盘引擎脱节）
  const _dl = $('#guaList');
  if (_dl) {
    _dl.innerHTML = Object.keys(C.HEXNAMES).map(function (k) {
      return '<option value="' + escAttr(C.HEXNAMES[k]) + '"></option>';
    }).join('');
  }
  const _btnByName = $('#btnByName');
  if (_btnByName) _btnByName.onclick = castByName;
  ['#guaNameInput', '#guaDongInput'].forEach(function (sel) {
    const el = $(sel);
    if (el) el.onkeydown = function (e) { if (e.key === 'Enter') castByName(); };
  });

  renderModelChips();
  loadModels();
  renderLoginBtn();
  renderTime();
  renderCoins();
  renderTossHint();
  renderStack();
})();
