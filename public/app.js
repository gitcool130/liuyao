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
  // coverage-audit 是后加的第四块，旧缓存页面可能没有它：
  // 缺了就只跑盘面对撞，不让整块校对能力失效。
  const HAS_COVER = !!(C.auditCoverage && C.coverageText);
  // question-shape 是后加的第五块（多选一问法检测与改写建议），
  // 同样按「缺了就降级关闭」处理，不影响断卦主流程。
  const HAS_SHAPE = typeof C.questionShape === 'function';
  // 应期域层（core/yingqi-window.js）：把扁平应期线索换算成区间＋置信度。
  const HAS_WINDOW = typeof C.yingqiWindow === 'function';
  // 链接层（core/share.js）：盘面种子的序列化/反序列化（只存种子，不存断语）。
  const HAS_SHARE = typeof C.encodeCast === 'function' && typeof C.decodeCast === 'function';
  if (!HAS_WINDOW) {
    console.warn('[liuyao] core/yingqi-window.js 未加载，应期区间与置信度已降级关闭（仅保留线索陈述）。');
  }
  if (!HAS_SHARE) {
    console.warn('[liuyao] core/share.js 未加载，分享链接与按链接还原盘面已降级关闭。');
  }
  if (!HAS_ABSORB) {
    console.warn('[liuyao] core/sensitive.js / domain-methods.js / fact-audit.js 未加载，' +
      '敏感分流、分析方法注入与断后事实审计已降级关闭。');
  }
  if (!HAS_SHAPE) {
    console.warn('[liuyao] core/question-shape.js 未加载，多选一问法检测已降级关闭。');
  }
  // 前提预检层（core/premise.js）：五类通用前提 + 缺项分级 + 应期同域。
  // 与 question-shape 同一降级策略——缺了只关闭本层能力，断卦主流程照旧。
  const HAS_PREMISE = !!(C.premise && typeof C.premiseBlock === 'function');
  if (!HAS_PREMISE) {
    console.warn('[liuyao] core/premise.js 未加载，前提预检与应期同域校验已降级关闭。');
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

  // 占时口径固定为北京时间（UTC+8），与 core/data-jieqi.js 的节气时刻表同源。
  // 旧版直接用 new Date()：本机时区不是 UTC+8 时，同一瞬间会排出不同的年月柱
  // （实测同一 UTC 时刻，上海得「丙午年庚寅月」，纽约得「乙巳年己丑月」）。
  // 返回的 Date 在「本机 getters」上恰好呈现北京墙上时间——四柱计算、#dtInput、
  // fmtDT 读的是同一组 getters，因此三者天然同源，core 无需改动。
  // 补录模式输入的字符串按「北京墙上时间」解释（new Date('...') 在任意时区下
  // 本机 getters 都等于用户输入值），与现场模式口径一致。
  //
  // ⚠ 夏令时例外：实行 DST 的时区在春令切换日会把 02:00–02:59 归一化成 03:xx，
  //   此时「本机 getters 呈现北京墙上时间」不成立（实测 America/New_York
  //   2026-03-08 02:30 得 03:30），时柱会错一位。故把真实墙上分量钉在 __wall 上，
  //   由 fourPillars 与显示层优先读取；克隆 Date 时须一并复制（见 cloneDate）。
  const WALL = '__wall';
  function beijingNow() {
    const b = new Date(Date.now() + 8 * 3600 * 1000);
    const wall = {
      y: b.getUTCFullYear(), m: b.getUTCMonth() + 1, d: b.getUTCDate(),
      h: b.getUTCHours(), min: b.getUTCMinutes()
    };
    const dt = new Date(wall.y, wall.m - 1, wall.d, wall.h, wall.min, b.getUTCSeconds());
    dt[WALL] = wall;
    return dt;
  }
  // 墙上时间分量：有 __wall 用 __wall，否则退回本机 getters（补录输入、测试传入的普通 Date）
  function wallOf(dt) {
    const w = dt && dt[WALL];
    if (w) return { y: w.y, m: w.m, d: w.d, h: w.h, min: w.min };
    return { y: dt.getFullYear(), m: dt.getMonth() + 1, d: dt.getDate(), h: dt.getHours(), min: dt.getMinutes() };
  }
  // 克隆 Date 时保留 __wall：lockedDate 往返恢复用的就是 new Date(t)，
  // 不复制锚点会让锁定的时刻在 DST 跳变窗口内退回错值。
  function cloneDate(dt) {
    const c = new Date(dt.getTime());
    if (dt && dt[WALL]) c[WALL] = dt[WALL];
    return c;
  }

  let selectedDate = beijingNow();
  let records = [];            // 已定之爻 {coins, backs, val, mode}
  let curCoins = ['背', '背', '背'];
  let pan = null;
  let lastBullets = [];
  let lastAnalysis = null;
  // 粗判走向的展示文案：renderAnalysis（粗判标题）与卦例库「判据对照」共用，不新造口径词
  const TREND_LABEL = { '吉': '趋吉', '凶': '趋凶', '平': '持平', '待审': '待审' };

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
    const w = wallOf(dt);
    return w.y + '-' + p(w.m) + '-' + p(w.d) + ' ' + p(w.h) + ':' + p(w.min);
  }
  function renderTime() {
    const pil = C.fourPillars(selectedDate);
    $('#timeInfo').innerHTML =
      '<div class="muted">公历 ' + fmtDT(selectedDate) + '（北京时间）' +
      (timeMode === 'live' ? '（现场摇卦 · ' + (timeLocked ? '已锁定于首摇' : '开摇即锁定') + '）' : '（补录模式 · 时间可改）') + '</div>' +
      '<div class="gz">' + pil.yearGZ + '年 · ' + pil.monthGZ + '月 · <b>' + pil.dayGZ + '日</b> · ' + pil.hourGZ + '时</div>' +
      '<div class="muted">月建 <b class="gz-hi">' + C.ZHI[pil.monthZhi] + '</b> ｜ 日辰 <b class="gz-hi">' + C.ZHI[pil.dayZhi] + '</b> ｜ 旬空 <b class="kong">' + pil.kongStr + '</b></div>' +
      (pil.outOfTable
        ? '<div class="warn">⚠ 历法精度降级：' + wallOf(selectedDate).y + ' 年超出节气时刻表覆盖范围（1900–2100），月柱与年柱按典型交节日近似（±2 日以内）；日柱、时柱不受影响。古籍卦例回归请注意此项。</div>'
        : '');
    const p2 = function (n) { return (n < 10 ? '0' : '') + n; };
    // 始终与 selectedDate 同步：切模式/锁定时刻恢复/补录改时后，
    // #timeInfo 与输入框必须指向同一时刻（旧版仅在输入框为空时赋值，二者会不一致）
    const w = wallOf(selectedDate);
    $('#dtInput').value = w.y + '-' + p2(w.m) + '-' + p2(w.d) + 'T' + p2(w.h) + ':' + p2(w.min);
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
      selectedDate = beijingNow();
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
    if (timeMode === 'live') selectedDate = beijingNow();
    $('#panCard').hidden = true; $('#analysisCard').hidden = true; $('#aiCard').hidden = true;
    $('#useSelect').value = '';
    const uc = $('#useCustom'); if (uc) { uc.value = ''; uc.hidden = true; }
    // 一并清掉新增四块的状态：敏感提示、问法提示、按卦名提示、被拦截而禁用的断卦按钮
    const sb = $('#senseBox'); if (sb) { sb.hidden = true; sb.innerHTML = ''; lastSensitive = null; }
    const shb = $('#shapeBox'); if (shb) { shb.hidden = true; shb.innerHTML = ''; }
    const bnh = $('#byNameHint'); if (bnh) bnh.innerHTML = '';
    const shh = $('#shareHint'); if (shh) shh.innerHTML = '';
    const yqb = $('#yingqiBox'); if (yqb) { yqb.hidden = true; yqb.innerHTML = ''; }
    // 清掉地址栏的分享参数：否则刷新页面又回到旧盘，与「重新起卦」的语义冲突
    try {
      if (location.search.indexOf('s=') >= 0) history.replaceState(null, '', location.pathname);
    } catch (e) { /* file:// 或受限环境忽略 */ }
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
        if (lockedDate) selectedDate = cloneDate(lockedDate);
      } else {
        lockedDate = null; // 尚未开摇：解除记忆，取当前时刻
        selectedDate = beijingNow();
      }
    }
    this.textContent = (timeMode === 'live') ? '切换补录模式' : '切回现场摇卦';
    const lbl = $('#dtLabel');
    if (lbl) lbl.textContent = timeMode === 'live' ? '占问时刻（北京时间 · 现场摇卦 · 首摇锁定）：' : '占问时刻（北京时间 · 补录模式 · 可改）：';
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
      selectedDate = beijingNow(); timeLocked = true; lockedDate = selectedDate; renderTime();
    }
    // 三件套必须重渲染：resetTossState 已把 curCoins 重置为背背背、revealed 置空，
    // 但 DOM 仍是上一轮状态——爻位堆叠显示旧卦爻值（与排盘表矛盾）、
    // 铜钱残留上一爻的揭晓样式、提示文字陈旧。旧版只调 computePan()，
    // 用户看到的是「排盘表新、爻栈旧」的自相矛盾盘面。
    computePan();
    renderCoins();
    renderTossHint();
    renderStack();
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

  // ---------- 多选一问法检测（core/question-shape.js） ----------
  // 实测「是换医生还是不换还是先不治疗了」这类问法，两个模型断出相反建议：
  // 卦面无专爻代表各选项，各执一象必致分歧。此层只提示改问（趋势题 /
  // 定向假设题 / 决策树），永不拦截；同层还有一段「问法处理」指令随
  // 排盘文本入模，约束模型按条件决策树输出。
  function questionShapeDecision() {
    if (!HAS_SHAPE) return null;
    // 只看用户自己写下的事由：固定事类的下拉标签不是多选一问法
    const isCustom = $('#useSelect').value === '__custom__';
    const q = isCustom ? currentQuestion() : '';
    if (!q) return null;
    try { return C.questionShape(q); } catch (e) { return null; }
  }
  function renderQuestionShape() {
    const box = $('#shapeBox');
    if (!box) return;
    const d = questionShapeDecision();
    if (!d || !d.shape) { box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    box.className = 'verdict';
    box.innerHTML = '<b>问法提示</b>　' + esc(d.hint).replace(/\n/g, '<br>');
  }

  function renderAnalysis() {
    const target = $('#useSelect').value;
    const list = $('#conclList');
    const vBox = $('#verdictBox');
    const customInput = $('#useCustom');
    customInput.hidden = (target !== '__custom__');
    renderSensitive();     // 每次改选事类都重算分流（含把拦截态解除）
    renderQuestionShape(); // 多选一问法检测同轮重算（改选固定事类即解除提示）

    /* 自定义事由：先按关键词推出用神（复用 domain-methods 的 INTENT_YONGSHEN），
       再走与固定事类完全相同的规则链。推不出关键词才退回通用次第。
       此前自定义一律 lastAnalysis=null，用神只能由模型自取，盘面也没有「用神：」行。 */
    let effTarget = target, customKw = '';
    if (target === '__custom__') {
      const sug = (pan && typeof C.suggestYongshen === 'function') ? C.suggestYongshen(currentQuestion()) : null;
      if (sug) { effTarget = sug.rel; customKw = sug.kw; }
    }

    if (!target || (target === '__custom__' && !customKw)) {
      // 空选 / 自定义但无关键词可推：无固定用神可取，给出通用次第
      list.innerHTML = '<li>选择所测之事，先观用神旺衰。通用次第：一观世爻旺衰，二观用神与世应，三审动爻生克，四定旬空月破与应期。</li>' +
        (target === '__custom__' ? '<li>自定义未能从描述中推定用神，可补写事由（如「求财」「考试」「官司」），或改选上方对应类别。</li>' : '');
      vBox.hidden = true; lastBullets = [];
      // 清空旧分析：否则断后审查会拿「上一次所选事类」的 judgments
      // 去撞自定义事由的断语，必然误报（如旧选妻财、新问跳槽取官鬼）。
      lastAnalysis = null;
      renderYingqi(null);
      return;
    }
    if (!pan) {
      list.innerHTML = '<li>先完成起卦，再选所测之事。</li>';
      vBox.hidden = true; lastBullets = []; lastAnalysis = null;
      renderYingqi(null);
      return;
    }
    // 自定义事由带具体文本时，把事由一并交给规则链：「用神克世」的吉凶随占类翻转
    // （求财必得／行人即归／医药即愈／功名非祸即灾），没有事由就只能给全量书证。
    const res = C.analyze(pan, effTarget, customKw ? { topic: currentQuestion() } : undefined);
    if (customKw) {
      res.bullets.unshift('自定义事由按关键词「' + customKw + '」推定为「' + (res.yongshen ? res.yongshen.type : effTarget) +
        '」用神（规则链已按此取用；若卦理显见他亲更切，可在追问中说明理由）');
    }
    lastBullets = res.bullets;
    lastAnalysis = res;
    list.innerHTML = res.bullets.map(function (b) {
      return '<li' + (b.indexOf('⚠') >= 0 ? ' class="warn"' : '') + '>' + b + '</li>';
    }).join('');
    vBox.hidden = false;
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
    renderYingqi(res.yingqiWindow);
  }

  // ---------- 应期窗口（core/yingqi-window.js） ----------
  // 展示「区间 + 置信度 + 依据 + 下调原因」。与旺衰粗判分开一栏，是因为二者性质不同：
  // 粗判答「成不成」，应期答「什么时候能验」——后者是本项目唯一可被事后核对的对象
  // （回执分桶统计的横轴就是它）。blocked 时不写「近期」兜底，直接说明为何不立应期。
  function renderYingqi(w) {
    const box = $('#yingqiBox');
    if (!box) return;
    if (!w) { box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    // 置信度徽标刻意不套「成/败」的红绿色：那两色在本页表示事之成败，
    // 借来标置信会被读成吉凶（高置信≠吉）。此处只用中性徽标 + 明确措辞。
    const badge = '<span class="oc-badge" title="盘面要素的自洽程度，不是命中概率">置信' +
      esc(w.confidence === '中' ? '中等' : w.confidence) + '</span>';
    box.innerHTML = '<b>应期窗口</b>　' + esc(w.text.replace(/^应期：/, '')) + '　' + badge +
      (w.basis && w.basis.length
        ? '<div class="muted" style="margin-top:6px">依据：' + esc(w.basis.join('；')) + '</div>' : '') +
      (w.downgrades && w.downgrades.length
        ? '<div class="muted" style="margin-top:4px">下调原因：' + esc(w.downgrades.join('；')) + '</div>' : '') +
      '<div class="muted" style="margin-top:4px;font-size:12px">区间由出空／冲空／值日／出月／逢冲等盘面要素换算；' +
      '置信度只表示要素之间的自洽程度，不是命中概率。</div>';
  }
  $('#useSelect').onchange = function () { renderAnalysis(); if ($('#useCustom').hidden === false) $('#useCustom').focus(); };
  // 自定义事由逐字输入即重算分流：写到「能不能活多久」这类词时立刻拦截，
  // 不必等点击断卦才提示（粗判不重算——自定义本就不作旺衰粗判）。
  // 自定义事由逐字输入：立刻重算分流；用神推断加 250ms 防抖，避免每敲一个字重排规则链
  let customTimer = null;
  $('#useCustom').oninput = function () {
    renderSensitive();
    renderQuestionShape();
    clearTimeout(customTimer);
    customTimer = setTimeout(renderAnalysis, 250);
  };

  // ---------- 排盘文本（复制与 AI 共用） ----------
  // 同盘追问时给模型的提示（R5）：上一轮已给的应期 + 本轮补充把跨度改成了什么。
  // 由 sendChat 在发请求前写入、断卦入口清空——buildPanText 本身不知道该不该带历史。
  let followUpNote = '';

  function buildPanText(forAI) {
    const pil = pan.pillars;
    let txt = '【六爻排盘】\n';
    txt += '时间：' + fmtDT(selectedDate) + '（北京时间；' + pil.yearGZ + '年 ' + pil.monthGZ + '月 ' + pil.dayGZ + '日 ' + pil.hourGZ + '时，旬空' + pil.kongStr + '）\n';
    if (pil.outOfTable) txt += '注：该年超出节气时刻表覆盖范围（1900–2100），月柱与年柱按典型交节日近似（±2 日以内），日柱与时柱为精确值。\n';
    const q = currentQuestion();
    if (q) txt += '所测：' + q + '\n';
    txt += '本卦：' + pan.benName + '（' + pan.palace + '宫·' + pan.palaceWx + '）' +
      (pan.hasBian ? ' 之 ' + pan.bianName + '（' + pan.bianPalace + '宫）' : '（静卦）') + '\n';
    // 用神由规则链先定，明确写进盘面文本：模型自取用神是断错整盘的首要来源。
    if (lastAnalysis && lastAnalysis.yongshen) {
      const y = lastAnalysis.yongshen, yl = y.line;
      txt += '用神：' + y.type + ' ' + yl.lq + yl.zhi + '（' + LINE_NAMES[yl.pos] + '，' + yl.wx +
        '，' + y.wang + '，' + (yl.moving ? '发动' : '安静') + (yl.isFu ? '，伏神' : '') + '）\n';
    }
    // 卦型行：六冲/六合/游魂/归魂/相变——确定性陈述（与 ruleGuaXing 同一判定，非推断）
    // typeof 守卫与 371/518 行同风格：ruleGuaXing 与核心守卫已覆盖的 analyze 同在
    // analyze.js（同生同灭），实际不会缺；此处对齐代码风格（2026-10-21 审计修正）。
    const gxRules = (typeof C.ruleGuaXing === 'function' ? C.ruleGuaXing(pan) : []).map(function (j) { return j.rule; });
    if (gxRules.length) txt += '卦型：' + gxRules.join('、') + '\n';
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
    // 应期窗口：由规则链把出空／冲空／值日／出月／逢冲换算成具体天数。
    // 不注入这一段时，模型只能写「近期会有变化」——线索里没有时间刻度，
    // 它没法更具体。注入后模型的任务从「猜时间」变为「解释这个区间」。
    if (lastAnalysis && lastAnalysis.yingqiWindow) {
      const w = lastAnalysis.yingqiWindow;
      txt += '\n【应期窗口（规则链换算 · 非推断）】\n' + (typeof C.yingqiText === 'function' ? C.yingqiText(w) : w.text) + '\n';
      txt += '- 区间由盘面要素（出空／冲空／值日／出月／逢冲／引拔）换算而来；置信度表示这些要素的自洽程度，不是命中概率。\n';
      if (forAI) {
        txt += '- 正文与「应期」行须落在该区间内，并沿用其置信度；若认定区间有误，须指明依据与上述哪一条要素冲突，' +
          '不得只写「近期」「不久」这类无法核对的措辞。\n';
      }
    }
    if (forAI && lastAnalysis && lastAnalysis.trend) {
      // 引擎判定：aggregateTrend 的确定性结论。旧版算出了 trend 却从不注入，
      // 模型无从得知，于是同一张盘、同一 provider 两次调用可断出相反结论
      // （2026-10-21 实测：一次「平」、一次「凶」，第二条与引擎自身判定相反）。
      // 注入 + 【结论对齐】契约 = 让「结论」行有锚点；仍允许分歧，但必须显式标注。
      txt += '\n【引擎判定（确定性 · 非推断）】' + lastAnalysis.trend + '\n';
      txt += '- 由规则链 aggregateTrend 依本仓已定流派口径算出，与上「旺衰粗判」同源；正文「结论」行须与之同向。\n';
      txt += '- 若认定该判定有误，须先引古法原文说明理由，并在结论行后括注「（与引擎分歧：引擎判' +
        lastAnalysis.trend + '，此处判X）」，不得静默给出相反结论。\n';
    }
    if (forAI && followUpNote) txt += '\n' + followUpNote + '\n';
    if (forAI && HAS_PREMISE) {
      // 前提预检（core/premise.js）：五类通用前提的明示/缺项、口径歧义与应期刻度。
      // 只陈述「题面命中了什么词」，不做推断；模型据此决定要不要给条件分支。
      // 放在领域方法之前：先定「这件事的时间刻度与缺项」，再谈看盘次序。
      // 第三参：本次盘面是否带了引擎的日级节点窗口（有则预检块补一行「窗口是节点、不是应期」，
      // 否则模型要么违背窗口、要么把节点当日期，前端一致性校验会判它冲突）。
      const w = lastAnalysis && lastAnalysis.yingqiWindow;
      const pb = C.premiseBlock(currentQuestion(), $('#useSelect').value,
        { dayNodeWindow: !!(w && (w.dayLo || w.dayHi)) });
      if (pb) txt += '\n' + pb;
    }
    if (forAI && HAS_ABSORB) {
      // 领域分析方法注入：只规定看盘次序与常见误判，不预设吉凶，也不得被当成古籍引文。
      const blk = C.domainBlock($('#useSelect').value, currentQuestion());
      if (blk) txt += '\n' + blk;
      // 多选一问法处理指令：模型须按条件决策树输出，不得强制站队——
      // 实测此类问法两模型各执一象，断出完全相反的建议。
      const shape = questionShapeDecision();
      if (shape && shape.aiNote) txt += '\n' + shape.aiNote + '\n';
      const d = sensitiveDecision();
      if (d.action === 'advisory') txt += '\n【现实边界提示】' + d.message + '\n';
      // 契约：盘面事实不可改写，传统推断可自由但不得与盘面矛盾。
      txt += '\n【契约】「卦象」「卦型」「旺衰粗判」三节为确定性结果：六亲、纳甲、世应、动爻、旬空、月破、卦型' +
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
      const btn = $('#btnCopy'); if (!btn) return;
      // 原始文案缓存到 dataset：旧版在 done() 里读 btn.textContent，
      // 连点两次时第二次读到的是第一次刚改成的「已复制 ✓」，
      // 其还原定时器最终把按钮永久停在「已复制 ✓」，原文案丢失。
      if (!btn.dataset.label) btn.dataset.label = btn.textContent;
      btn.textContent = '已复制 ✓';
      setTimeout(function () { btn.textContent = btn.dataset.label; }, 1500);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(done).catch(function () { fallbackCopy(txt); done(); });
    } else { fallbackCopy(txt); done(); }
  };
  // ---------- 分享链接（core/share.js） ----------
  // 只序列化「种子」：占时（北京墙上时间，分钟级）+ 六爻爻值 + 所测之事 + 用神类别。
  // 断语不进链接：同一盘在任何浏览器重算必得同一盘（确定性），而断语是条件生成，
  // 塞进 URL 会让链接变成「别人家模型当时怎么说的」的二手存档。
  function currentShareCode() {
    if (!HAS_SHARE || !pan || records.length !== 6) return '';
    const useVal = $('#useSelect').value;
    return C.encodeCast({
      time: selectedDate,
      vals: records.map(function (r) { return r.val; }),
      use: useVal,
      question: useVal === '__custom__' ? currentQuestion() : ''
    });
  }
  $('#btnShare').onclick = function () {
    const btn = $('#btnShare'), hint = $('#shareHint');
    if (!pan || records.length !== 6) {
      if (hint) hint.textContent = '先完成起卦，再分享盘面。';
      return;
    }
    const code = currentShareCode();
    if (!code) {
      if (hint) hint.textContent = '当前盘面无法生成分享参数（占时超出 1900–2100 或爻值异常）。';
      return;
    }
    const url = C.shareUrl(code);
    const done = function () {
      btn.textContent = '已复制 ✓';
      if (hint) hint.textContent = '链接只含占时、爻值与所测之事，不含任何断语；打开方看到的盘与本地逐字一致。';
      setTimeout(function () { btn.textContent = '复制分享链接'; }, 1500);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(done).catch(function () { fallbackCopy(url); done(); });
    } else { fallbackCopy(url); done(); }
  };

  function fallbackCopy(txt) {
    const ta = document.createElement('textarea');
    ta.value = txt; document.body.appendChild(ta);
    ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
  }

  /* ---------- AI 输出复制按钮 ----------
     断语正文含引号、换行、尖括号，用 data-* 属性传递还得再转义一层，易写错；
     故按钮只作触发器，原文由闭包持有。host 为按钮的挂载容器（列头 / 消息气泡）。 */
  function attachCopyBtn(host, text) {
    if (!host) return null;
    const prev = host.querySelector('[data-copy]');
    if (prev && prev.parentNode) prev.parentNode.removeChild(prev);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'copy-btn';
    btn.setAttribute('data-copy', '1');
    btn.textContent = '复制';
    // 连点两次时不能读已被改写的按钮文案，故还原定时器固定用「复制」
    btn.onclick = function (ev) {
      if (ev && ev.stopPropagation) ev.stopPropagation();   // 卦例项/列头有父级点击
      const txt = String(text == null ? '' : text);
      if (!txt) return;
      btn.textContent = '已复制 ✓';
      btn.classList.add('done');
      clearTimeout(btn._copyTimer);
      btn._copyTimer = setTimeout(function () {
        btn.textContent = '复制'; btn.classList.remove('done');
      }, 1500);
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).catch(function () { fallbackCopy(txt); });
      } else { fallbackCopy(txt); }
    };
    host.appendChild(btn);
    return btn;
  }
  // 模型列头：按钮挂在列头右侧（列体由 renderCols 生成，head 是 body 的兄弟节点）
  function colHeadOf(model) {
    const body = colBody(model);
    return body && body.parentNode ? body.parentNode.querySelector('.ai-col-head') : null;
  }

  // ---------- AI 断卦 / 进阶探讨 / 卦例库（多模型对比） ----------
  // 模型清单：初始为内置默认，页面加载后从 /api/models 动态拉取（GPT 清单由后台 GPT_MODELS 变量驱动）
  let MODELS = [
    { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash', pv: 'Google', tip: '快 · 偶发断稿' },
    { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash', pv: 'Google', tip: '高峰易过载' },
    { id: 'deepseek-flash', label: 'DeepSeek V4.1 Flash', pv: 'DeepSeek', tip: '1017 快照' }
  ];
  // 默认模型（2026-10-21 调整）：3.6 → 3.8。
  // 实测 13 次首轮断卦，gemini-3.6-flash 有 6 次断在句中（46%），gemini-3.8-flash
  // 六次全部成篇。默认配置不该选那个「一半概率给半篇」的。
  const DEFAULT_MODELS = ['gemini-3.8-flash', 'deepseek-flash'];

  // 已知模型的特性提示；后台自定义的模型名无提示
  const MODEL_TIPS = {
    // 「快」是真的快（8–20 s），但实测 46% 断在句中，标签不能只写优点
    'gemini-3.6-flash': '快 · 偶发断稿',
    'gemini-3.8-flash': '高峰易过载',
    'deepseek-flash': 'V4.1 · 1017',
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

  /* 残篇补发用哪个模型：优先同供应商的兄弟模型，gemini 家族优先 3.8。
     理由（2026-10-21 实测，n=13）：gemini-3.6-flash 有 46% 断在句中，用**同一个**
     模型重跑仍有一半概率撞同一处；gemini-3.8-flash 六次全部成篇。
     补发是为了拿到完篇，不是为了复现失败——所以能换就换。
     没有兄弟模型（如 deepseek 单模型）时原地重跑，行为同旧版。 */
  function retryModelFor(m) {
    const cur = MODELS.filter(function (x) { return x.id === m; })[0];
    if (!cur || !cur.pv) return m;
    // 只在「有实测更稳的兄弟」时才换。反过来的情况（3.8 残篇 → 换 3.6）是降级，
    // 宁可原地重跑：不能为了换而换，把稳定模型换成 46% 断稿的那个。
    const stable = MODELS.filter(function (x) {
      return x.pv === cur.pv && x.id !== m && x.id === 'gemini-3.8-flash';
    })[0];
    return stable ? stable.id : m;
  }

  function applyModels(list) {
    if (!Array.isArray(list) || !list.length) return;
    MODELS = list.map(function (m) {
      return {
        id: m.id,
        pv: m.pv || '',
        label: modelLabel(m.id),
        tip: (m.configured === false) ? '后台未配 key' : (pick(MODEL_TIPS, m.id) || '')
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

  /* 老用户默认模型迁移（2026-10-21）：默认从 3.6 换成 3.8，但 localStorage 里
     还存着旧默认值，只改常量对老用户不生效。只迁移「一直没动过选择」的那批
     ——存的正好是旧默认两项才替换；用户自己勾过的组合一律不动。
     用一次性标记，避免他们以后主动选回 3.6 又被下次加载改掉。 */
  (function migrateDefaultModels() {
    try {
      if (localStorage.getItem('ly_models_v2') === '1') return;
      const raw = localStorage.getItem('ly_models');
      if (raw) {
        const arr = JSON.parse(raw);
        const oldDefaults = ['gemini-3.6-flash', 'deepseek-flash'];
        if (Array.isArray(arr) && arr.length === oldDefaults.length &&
          oldDefaults.every(function (id) { return arr.indexOf(id) >= 0; })) {
          lsSet('ly_models', JSON.stringify(DEFAULT_MODELS));
        }
      }
    } catch (e) { /* 脏数据不迁移，保持原样 */ }
    lsSet('ly_models_v2', '1');
  })();

  let selModels = loadSelModels();
  let aiStates = {};   // { modelId: { history: [] } }
  // 各模型最近一轮的结构化结论（trend/yingqi/yongshen/verify/premise）。
  // 提为模块级：追问要据此判断「原应期是否还成立」（R5 应期撤回），
  // 旧版只在断卦处理函数内可见，追问拿不到。
  let concl = {};
  let lastVerify = ''; // 本轮断语给出的「验证标志」；重新起卦时清空
  let castId = null;
  // AI 请求代际管理：每次「开始断卦」递增代数并新建 AbortController；
  // resetAIState（重新起卦/撤销）时 abort 在途请求并递增代数，
  // 旧请求的回调凭代数比对后丢弃，避免旧卦断语污染新卦栏目与对话上下文。
  let aiGen = 0;
  let aiAbort = null;

  // localStorage 写入容错：Safari 隐私模式 / 配额超限时 setItem 会抛
  // QuotaExceededError。旧版裸调，抛错后 selModels 已变而 renderModelChips()
  // 不执行——芯片 UI 与内部状态不一致，且持久化写入失败。
  function lsSet(key, val) {
    try { localStorage.setItem(key, val); return true; } catch (e) { return false; }
  }
  function lsRemove(key) {
    try { localStorage.removeItem(key); return true; } catch (e) { return false; }
  }

  // 对象字面量查表防原型链：key 可来自外部数据（卦例库 outcome、服务端 error code、
  // 模型 id），obj['__proto__'] / obj['toString'] / obj['constructor'] 会因原型属性
  // 为 truthy 而通过校验，随后把 Object.prototype 或函数源码 esc() 之后渲染进徽章；
  // noRetry['constructor'] 更会把本可重试的错误误判为不重试。
  function pick(map, key) {
    if (typeof key !== 'string') return undefined;
    return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : undefined;
  }

  function loadSelModels() {
    let saved = [];
    try { saved = JSON.parse(localStorage.getItem('ly_models') || '[]'); } catch (e) {}
    // 旧版未校验类型：localStorage 里若是合法 JSON 但非数组（"x"/null/{}），
    // 下一行 saved.filter 抛 TypeError，而本函数在 IIFE 中段被调用，
    // 异常会中断其后全部事件绑定与 init——铜钱区、时间区全空白。
    if (!Array.isArray(saved)) saved = [];
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
        const before = selModels.slice();
        if (i >= 0) { if (selModels.length > 1) selModels.splice(i, 1); }
        else selModels.push(id);
        // 持久化失败时回滚选中态，保证芯片 UI 与内部状态一致
        if (!lsSet('ly_models', JSON.stringify(selModels))) selModels = before;
        renderModelChips();
      };
    });
  }

  function resetAIState() {
    // 中断在途 AI 请求并递增代数：旧请求回调随后凭 aiGen 比对被丢弃。
    // 无此机制时，断卦在途点[重新起卦]会让旧卦断语写入新卦栏目，
    // 追问在途时更会把两个卦象的盘面文本混进同一趟上下文发给模型。
    aiGen++;
    if (aiAbort) { try { aiAbort.abort(); } catch (e) { /* 已 abort 则忽略 */ } }
    aiAbort = null;
    aiStates = {}; concl = {}; castId = null; lastVerify = '';
    $('#aiReply').innerHTML = '';
    const cs = $('#aiConsensus'); if (cs) { cs.hidden = true; cs.innerHTML = ''; }
    const box = $('#chatBox'); if (box) box.hidden = true;
    const btn = $('#btnSave'); if (btn) btn.textContent = '存入卦例库';
    const btnAI = $('#btnAI'); if (btnAI) { btnAI.disabled = false; btnAI.textContent = '开始断卦'; }
  }

  // ---------- 口令存储（M2）----------
  // 口令是可直接换取全库读写的凭据，不应长期落盘。改用 sessionStorage：
  // 同一标签页刷新仍免重输，关标签页即失效；同时把旧版留在 localStorage 的明文
  // 一次性迁移过来并删除，避免磁盘上继续残留。
  // 注意：sessionStorage 同样可被 XSS 读取，这一步缩的是「持久化窗口」，
  // 不是「XSS 可读」——后者只能靠转义与 CSP 兜。
  const CODE_KEY = 'ly_access_code';
  let memCode = '';                       // 存储被禁用（Safari 隐私模式等）时的页内兜底
  function readCode() {
    try {
      const s = sessionStorage.getItem(CODE_KEY);
      if (s) return s;
      const legacy = localStorage.getItem(CODE_KEY);
      if (legacy) {
        sessionStorage.setItem(CODE_KEY, legacy);
        localStorage.removeItem(CODE_KEY); // 迁移即清除，不留第二份明文
        return legacy;
      }
    } catch (e) { /* 存储不可用：退回 memCode */ }
    return memCode;
  }
  function writeCode(code) {
    memCode = code || '';
    try {
      if (code) sessionStorage.setItem(CODE_KEY, code);
      else sessionStorage.removeItem(CODE_KEY);
    } catch (e) { /* 存储不可用：仅保留 memCode */ }
    try { localStorage.removeItem(CODE_KEY); } catch (e) { /* 清旧版残留，失败无妨 */ }
  }

  function apiHeaders() {
    const h = { 'Content-Type': 'application/json' };
    const code = readCode();
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
      writeCode('');
      renderLoginBtn();
      const code = prompt('需要口令才能继续，请输入：');
      if (code) {
        writeCode(code);
        renderLoginBtn();
        res = await fetch(path, withHeaders(opts));
        if (res.status === 401) writeCode('');
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
  function scrollBody(el) {
    if (!el) return;
    // 只在用户没有主动向上滚动时自动跟到底部；
    // 若用户已向上翻看历史内容，不强行拉回。
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }

  // 与服务端 interpret.js 的 SYSTEM_PROMPT 保持一致（用于失败时手动断卦的提示词）
  const SYSTEM_PROMPT = [
    '你是一位精通京房纳甲六爻的卦师，治学严谨，断卦有据。',
    '收到排盘后按以下次序通盘论断：',
    '一、列卦象要点：卦名卦宫、卦型（六冲六合游魂归魂）、世应、用神（按所测之事取之，两现说明取舍）、动爻及其化出、月建日辰生克、旬空月破、冲合。',
    '二、断吉凶：以用神与元神、忌神、仇神的生克为主线，以旺衰生克为纲，引经据典（《增删卜易》《卜筮正宗》等），术语用规范六爻术语，不得用现代心理学术语。',
    '三、断应期：据旬空、冲合、生扶之理推断应验之时。',
    '四、白话总结：用一段简明中文给出结论与建议。',
    '若信息不足，明确指出需补充何事，不得臆造。',
    // ↓ 以下四段为「上层契约」（不可改盘 / 盘面优先 / 追问不重起卦 / 现实边界），
    //   与 functions/api/interpret.js 的 SYSTEM_PROMPT 保持一致，改一处须改两处。
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
    // ↓ 2026-10-24：应期须落在引擎换算出的窗口内（与 functions/api/interpret.js 逐字符一致）。
    //   此前排盘文本只给扁平线索，模型只能写「近期会有变化」——线索里没有时间刻度，
    //   它没法更具体；本段把「猜时间」变成「解释这个区间」。
    '【应期按域】排盘文本已给出「应期窗口」（区间＋置信度＋依据＋下调原因），系规则链由出空／冲空／值日／出月／逢冲换算而来。' +
    '「应期」行须落在该区间内、沿用其置信度，并写明下调原因；不得脱离区间另给时间，也不得只写「近期」「不久」「看后续」这类无法核对的措辞。' +
    '短线（日、旬内）以日辰冲动、值日、出空为据；长线（月、年）以月建旺衰、旬空填实、伏神出现为据——两者不得互相套用。' +
    '若认定区间有误，须指明与哪一条盘面要素冲突。',
    // ↓ 2026-10-21：断语结论须与引擎 aggregateTrend 同向（与 functions/api/interpret.js 逐字符一致）。
    //   此前只注入盘面、不注入 trend：同一张盘同一 provider 两次调用断出相反结论（平/凶），trend 算了却没人用。
    '【结论对齐】排盘文本另附「引擎判定」一行（吉／平／凶），系规则链依古法算出的确定性结果，与本提示其余判语同源。' +
    '正文的「结论」行须与之同向；若认定该判定有误，须先引古法原文说明理由，' +
    '并在结论行后括注「（与引擎分歧：引擎判X，此处判Y）」，不得静默给出相反结论。',
    // ↓ 法理层五段（2026-10-21 起）：与 functions/api/interpret.js 逐字符一致，
    //   改一处必须同步另一处（test-functions.mjs 有全文比对断言）。
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
    '对象阶段＝应届在读、目标标准＝该校录取线、进程状态＝未开考、规则环境＝当地招生政策。）',
    '【缺项分级】缺项按影响分两级，不得一律回避也不得一律追问：' +
    '高风险（缺了会改变结论方向或应期量级——时间范围、进程状态、目标标准、对象阶段）——' +
    '首轮不得给出单一吉凶与单一应期，须先用一句话说明缺什么、为何影响判断，再按可能情形给条件分支，并提示用户补充；' +
    '低风险（只影响细节与措辞）——标注「前提未定」照常输出结论，可给条件性判断，但须写明所设假设。' +
    '不得替用户假定未说出的前提（如把某一年的考试默认为今年、把「今年」默认为会计年度或自然年）。',
    '【应期同域】应期粒度不得细于事项的时间跨度：跨月跨年之事只能给月／季／年或流程节点，' +
    '不得用日、旬或具体干支日；只有短期消息、旬内之事可用日旬。尺度取「此事的结论何时可能揭晓」，不取起卦日。' +
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
    let out = '';
    // 一、盘面事实对撞（六亲 / 世应 / 卦名 / 动爻写没写反）
    try {
      const r = C.auditFactClaims(reply, pan);
      if (r && !r.accepted) {
        out += '<div class="ai-block warn" style="margin-top:8px;font-size:13px;line-height:1.7">⚠ ' +
          esc(C.auditText(r)) + '</div>';
      }
    } catch (e) { /* 审计自身出错不得影响断语展示 */ }

    // 二、推理一致性审查（真空/动空混淆、暗动写成日破、取错用神、漏审结构）
    // 第三参传 pan：A2「无中生有」类须按全盘六爻重算——analyze 只判用神一线，
    // 断语谈其他爻的旬空/月破/日冲完全合法，只看 judgments 会误报。
    if (!HAS_COVER) return out;
    try {
      const cv = C.auditCoverage(reply, lastAnalysis, pan);
      const txt = C.coverageText(cv);
      if (!txt) return out;
      // 概念误置是硬告警，纯遗漏只作普通提示——两者视觉上必须分清，
      // 否则用户会把「提醒」当「错误」，真告警反而被无视。
      out += '<div class="' + (cv.accepted ? 'verdict' : 'ai-block warn') +
        '" style="margin-top:8px;font-size:13px;line-height:1.7">' +
        (cv.accepted ? '· ' : '⚠ ') + esc(txt) + '</div>';
    } catch (e) { /* 同上 */ }
    return out;
  }

  // 结构化结论行解析：模型按提示词末尾输出「结论/应期/用神」三行。
  // 取最后一次出现（正文里也可能提到这些词），失败返回空字段，不抛错。
  function parseConclusion(text) {
    const src = String(text || '');
    const last = function (re) {
      const g = new RegExp(re.source, 'g');
      let m, out = '';
      while ((m = g.exec(src)) !== null) out = m[1];
      return String(out || '').replace(/^\*+|\*+$/g, '').trim();
    };
    let trend = last(/结论\s*[:：]\s*[\[【]?\s*(吉|凶|平|中|待审)/);
    if (trend === '中') trend = '平';
    return {
      trend: trend,
      yingqi: last(/应期\s*[:：]\s*([^\n]{1,90})/),
      // 验证标志：模型须给可观察事实。缺失或含糊（「看后续」「有转机」）时置空，
      // 前端据此提示「此卦无法回填」——这是回填率的地基，不是装饰。
      verify: (function (v) {
        const t = String(v || '').trim();
        if (!t) return '';
        if (/看后续|有转机|待观察|视情况|自行判断|难以判断|无法判断|顺其自然/.test(t)) return '';
        return t;
      })(last(/验证标志\s*[:：]\s*([^\n]{1,100})/)),
      yongshen: last(/用神\s*[:：]\s*([^\n]{1,60})/),
      // 前提完整性（M21）：模型须自报五类前提是完整、缺失还是前提未定。
      // 它是「结论可信度」的元信息，不参与吉凶判断；缺失或与引擎预检矛盾时在卡片上标出来。
      premise: last(/前提完整性\s*[:：]\s*([^\n]{1,80})/)
    };
  }

  // 双模型互证：只比对各自「结论」行，不一致就明说存疑；不做新的判断。
  function renderConsensus(map) {
    const el = $('#aiConsensus');
    if (!el) return;
    const items = Object.keys(map).filter(function (k) { return map[k] && map[k].trend; })
      .map(function (k) { return { id: k, trend: map[k].trend }; });
    if (items.length < 2) { el.hidden = true; el.innerHTML = ''; return; }
    const uniq = [];
    items.forEach(function (x) { if (uniq.indexOf(x.trend) < 0) uniq.push(x.trend); });
    const label = function (id) {
      const cfg = MODELS.filter(function (x) { return x.id === id; })[0] || {};
      return cfg.label || id;
    };
    el.hidden = false;
    if (uniq.length > 1) {
      el.className = 'warn';
      el.innerHTML = '⚠ 模型结论不一致：' + items.map(function (x) { return esc(label(x.id)) + '＝' + esc(x.trend); }).join('，') +
        '。此卦存疑——宜补问关键细节，或另择时再起一卦；不要只看其中一列。';
    } else {
      el.className = 'verdict';
      el.innerHTML = '· 模型结论一致（' + esc(items[0].trend) + '）：一致只说明解读口径相近，不等于应验；仍以事后回填为准。';
    }
  }

  // 验证清单：把「怎么算应验」写成可核对的三条，逼出可回填的样本。
  // 只读规则链已给出的用神/应期，不新增判断，也不改断语。
  function checklistHTML() {
    if (!pan || !lastAnalysis) return '';
    const y = lastAnalysis.yongshen;
    const lay = lastAnalysis.yingqiLayers || {};
    const main = (lay.main || [])[0] || '';
    const aux = (lay.auxiliary || [])[0] || '';
    const items = [];
    if (lastVerify) items.push('验证标志：' + lastVerify);
    if (main) items.push('应期：' + main + (aux ? '（辅助：' + aux + '）' : ''));
    else if (aux) items.push('应期：' + aux);
    if (y && y.line) {
      items.push('用神：' + y.type + ' ' + y.line.lq + y.line.zhi + ' 在' + LINE_NAMES[y.line.pos] +
        '，' + y.wang + (y.line.moving ? '，发动' : '，安静') + (y.line.isFu ? '，伏神' : ''));
    }
    items.push('结果：事之成败、应期是否按时——事后在「卦例库」回填，样本够了才能统计命中率');
    return '<div class="verdict" style="margin-top:8px;font-size:13px;line-height:1.8">' +
      '<b>验证清单</b><ol style="margin:6px 0 0 18px;padding:0">' +
      items.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') +
      '</ol></div>';
  }

  // AI 请求重试/超时策略：180 秒截止、指数退避、按返回类型决定是否重试。
  // Gemini 约 10–30 s；DeepSeek（含深推理模型）可达 90–180 s，需留足时间。
  // 只有过了截止时间仍无结果，才渲染「复制请求内容」降级；期间用户看到的是重试状态。
  const AI_RETRY_DEADLINE = 180000;
  const AI_RETRY_MIN_DELAY = 1200;
  const AI_RETRY_MAX_DELAY = 6000;
  const AI_RETRY_MIN_TIMEOUT = 15000;

  function sleep(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }

  function isRetriableError(res, data, kind) {
    if (kind === 'net' || kind === 'html' || kind === 'empty') return true;
    if (kind !== 'api') return false;
    // 配置/请求类错误不重试：改环境变量或重排盘才能解决。
    // UPSTREAM_RATE_LIMITED（2026-10-21 晚）：上游配额/速率用尽，重试只会同样 429，
    // 旧版按 502 处理会空转 20 轮、三分钟才降级，用户还以为「接口没就绪」。
    // 用 pick 而非 noRetry[data.error]：error 来自服务端响应，
    // noRetry['constructor'] 会因原型属性 truthy 而把本可重试的错误误判为不重试。
    const noRetry = { BAD_JSON: 1, NO_PAN: 1, BAD_PROVIDER: 1, BAD_MODEL: 1, NO_KEY: 1, ACCESS_REQUIRED: 1, UPSTREAM_RATE_LIMITED: 1, UPSTREAM_FIRST_BYTE_TIMEOUT: 1 };
    if (data && data.error && pick(noRetry, data.error)) return false;
    if (data && (data.error === 'LLM_ERROR' || data.error === 'LLM_TIMEOUT' || data.error === 'EMPTY' || data.error === 'RATE_LIMITED')) return true;
    if (res && (res.status === 429 || res.status >= 500)) return true;
    return false;
  }

  // 读取服务端透传的 SSE 流。服务端已把上游 delta.content 归一为简单
  // data: {"t":"..."} 行（reasoning_content 思考草稿在服务端剥离，不透传），
  // 客户端只需累加 t 字段。
  // 2026-10-27 起新增 data: {"r":"..."} —— 思考草稿的独立通道：只作进度显示，
  // 绝不进正文（草稿含未纠正的临时判断，混进正文会让 fact-audit 误报）。
  // 这条通道同时解决了「思考期 60~90s 界面全空、连接被中间层掐断」的观感与稳定性。
  // 流式渲染合并窗口：60ms ≈ 16 帧/秒，肉眼仍是连续的，但 innerHTML 重建次数降一个量级。
  const STREAM_RENDER_MS = 60;
  async function readStreamSSE(res, onStream, onThink) {
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '', full = '', emitted = '';
    let lastEmit = 0, flushTimer = null;
    let streamWarn = null;   // 上游 finishReason 异常时置位，供上层提示「未完篇」
    let thinkLen = 0, lastThink = 0;
    try {
      while (true) {
        const r = await reader.read();
        if (r.done) break;
        buf += dec.decode(r.value, { stream: true });
        let idx;
        while ((idx = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (!line || line.indexOf(':') === 0) continue;
          if (line.indexOf('data:') !== 0) continue;
          const data = line.slice(5).trim();
          if (!data || data === '[DONE]') continue;
          try {
            const j = JSON.parse(data);
            // 服务端终止事件（上游断连/超时/守卫撞限）：区分「正常完篇」与
            // 「中途断流」，抛出交由上层走重试，避免无声截断的半篇被当作完整答案
            if (j && j.error) {
              throw { kind: 'stream', message: j.message || j.error, code: j.error };
            }
            if (j && j.t) full += j.t;
            // 思考进度：节流 250ms 更新一次状态条，不必逐片重画
            if (j && j.r) {
              thinkLen += j.r.length;
              const nowT = Date.now();
              if (onThink && nowT - lastThink >= 250) { lastThink = nowT; onThink(thinkLen); }
            }
            // 上游非正常收尾（MAX_TOKENS / SAFETY 等）：不是网络问题，重试只会
            // 再撞同一上限，所以不 throw（不触发重试），而是记下来交给上层提示。
            // 旧版服务端不读 finishReason，这类半篇断语被当成完整答案交付。
            if (j && j.warn) {
              // 可能同时有多条（如 MODEL_MAX_TOKENS + INCOMPLETE_STRUCTURE），全部保留
              const msg = j.message || j.warn;
              streamWarn = streamWarn ? streamWarn + '；' + msg : msg;
            }
          } catch (e) {
            if (e && e.kind === 'stream') throw e;
            /* 其余无法解析的分片忽略 */
          }
        }
        // 仅在内容有增长时回调；并按 STREAM_RENDER_MS 合并渲染：
        // 旧版只做了「文本没变就不回调」，流一快仍是每 chunk 重建一次 innerHTML
        // （1017 输出更短更快，长答复可达数十帧/秒），移动端会抖且选中易丢。
        if (onStream && full && full !== emitted) {
          const now = Date.now();
          if (now - lastEmit >= STREAM_RENDER_MS) {
            if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
            lastEmit = now; emitted = full; onStream(full);
          } else if (!flushTimer) {
            flushTimer = setTimeout(function () {
              flushTimer = null;
              if (full !== emitted) { lastEmit = Date.now(); emitted = full; onStream(full); }
            }, STREAM_RENDER_MS);
          }
        }
      }
    } finally {
      if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
      // cancel() 返回 promise：流已被上游 error 时以存储错误拒绝，需就地吞掉
      try { reader.cancel().catch(function () { /* 上游已断开则忽略 */ }); } catch (e) { /* 已释放 */ }
    }
    // 收尾补发：被合并窗口压在手里的最后一小段必须落地，否则正文末尾会缺字。
    if (onStream && full && full !== emitted) { emitted = full; onStream(full); }
    // 未完篇必须让用户看见：旧版这条信息在服务端就被丢弃了，用户拿到半篇
    // 断语却以为已断完（实测 gemini-3.6-flash 稳定停在 405 tokens、
    // 正文断在句中且没有「结论：」行）。
    if (streamWarn && full) {
      full += '\n\n> ⚠ 本卦断语未完篇（' + streamWarn + '）。建议重试或换模型。';
      if (onStream) onStream(full);
    }
    return full;
  }

  // opts.gen：代数令牌，用于丢弃「用户已重新起卦/断卦」后在途旧请求的回调。
  // opts.signal：外部 AbortSignal（resetAIState 时触发），中断在途 fetch 与流式读取。
  async function callInterpret(model, history, onStatus, onStream, opts) {
    opts = opts || {};
    const gen = opts.gen;
    const outerSignal = opts.signal;
    const start = Date.now();
    const details = [];
    let lastErr = null;
    let attempt = 0;
    // 连续「上游整条流没有内容」的次数。2026-10-27：旧版对它一视同仁地重试，
    // 极端情况打满 18 次、耗 180s（AI Gateway 日志里那串 1s 请求），用户全程呆看。
    // 连续两次空稿基本可判定与该模型/该时段无关，直接收手让用户换模型。
    let emptyHits = 0;
    // 连续「断卦流中断」次数。2026-10-27：服务端在流内报错时前端会一路重试到 180s 截止，
    // 期间用户只看到「推卦中…」——正是「请求了十几次没有结果」的观感来源。
    // 流中断属于上游/链路问题，连撞三次基本可判定不是抖动，直接给结论让用户换模型。
    let streamFails = 0;
    // 排盘文本在进入重试循环前快照一次：旧版每轮 attempt 重建 buildPanText(true)，
    // 重试期间用户改事类/时间，后续 attempt 会发出与首次不同的盘面（对话历史还是旧的）。
    const panTextSnapshot = buildPanText(true);
    while (true) {
      attempt++;
      const elapsed = Date.now() - start;
      const remaining = AI_RETRY_DEADLINE - elapsed;
      if (remaining <= 0) {
        lastErr = { kind: 'html', message: '接口暂未就绪（已重试，仍无响应）', detail: details.join(' | ') };
        break;
      }
      // 外部已取消（重新起卦/重新断卦）：不再发起新 attempt
      if (outerSignal && outerSignal.aborted) throw { kind: 'aborted', message: '已取消' };
      if (onStatus) onStatus('推卦中…' + (attempt > 1 ? '（第 ' + attempt + ' 次尝试）' : ''));
      const attemptTimeout = Math.max(AI_RETRY_MIN_TIMEOUT, remaining);
      const ctrl = new AbortController();
      const timer = setTimeout(function () { ctrl.abort(); }, attemptTimeout);
      // 外部取消转发到本 attempt，使 fetch 与 SSE 流式读取一并中断
      let onOuterAbort = null;
      if (outerSignal) {
        if (outerSignal.aborted) ctrl.abort();
        else {
          onOuterAbort = function () { ctrl.abort(); };
          outerSignal.addEventListener('abort', onOuterAbort, { once: true });
        }
      }
      let res, raw, netErr;
      try {
        res = await apiFetch('/api/interpret', {
          method: 'POST',
          body: JSON.stringify({ panText: panTextSnapshot, messages: history, model: model }),
          signal: ctrl.signal
        });
        const ct = (res.headers.get('content-type') || '').toLowerCase();
        if (ct.indexOf('text/event-stream') >= 0) {
          // SSE 流式响应：边读边渲染，避免长时间无数据被浏览器/代理断开。
          // 流式期间**不能**放弃超时守卫：旧版 clearTimeout 后 readStreamSSE 自身
          // 无任何超时，上游挂起时 reader.read() 可无限期 pending——用户对着
          // 「推卦中…」干等到服务端 300s 才断开，远超自己声明的 180s 截止策略。
          // 改为把守卫重设为「距 AI_RETRY_DEADLINE 的剩余量」——注意必须
          // 在**收到响应头后**重算：remaining 是 attempt 顶部（进入 apiFetch
          // 之前）算的，未扣除建连耗时，直接复用会让总截止被超出建连耗时
          // 那么久，与「与总截止口径一致」的意图相反（2026-10-21 审计修正）。
          clearTimeout(timer);
          const streamTimeout = setTimeout(function () { ctrl.abort(); },
            Math.max(1000, AI_RETRY_DEADLINE - (Date.now() - start)));
          let text;
          try {
            // 思考进度回调：DeepSeek 的首字节能到 60~90s，期间正文一个字都没有，
            // 旧版界面只显示静止的「推卦中…」，用户以为卡死。现在把草稿字数实时显示出来。
            text = await readStreamSSE(res, onStream, function (n) {
              if (!onStatus) return;
              onStatus('模型思考中… 已输出 ' + (n > 999 ? (n / 1000).toFixed(1) + 'k' : n) + ' 字');
            });
          } finally {
            clearTimeout(streamTimeout);
          }
          if (text) return text;
          // 流结束但内容为空，按空响应重试
          details.push('第' + attempt + '次：大模型返回为空');
          lastErr = { kind: 'empty', message: '大模型返回为空' };
          const delay = Math.min(AI_RETRY_MAX_DELAY, AI_RETRY_MIN_DELAY * Math.pow(2, attempt - 1));
          if (Date.now() - start + delay >= AI_RETRY_DEADLINE) break;
          if (onStatus) onStatus('模型返回为空，' + Math.round(delay / 1000) + ' 秒后重试…');
          await sleep(delay);
          continue;
        }
        raw = await res.text();
      } catch (e) {
        netErr = e;
      } finally {
        clearTimeout(timer);
        if (onOuterAbort && outerSignal) outerSignal.removeEventListener('abort', onOuterAbort);
      }
      if (netErr) {
        // 外部取消（重新起卦/重新断卦）直接抛出，不走重试也不渲染失败框
        if (outerSignal && outerSignal.aborted) throw { kind: 'aborted', message: '已取消' };
        const isAbort = netErr.name === 'AbortError';
        // 流内错误码（服务端 data:{"error":...}）要按类型分流：配额/配置类重试毫无意义。
        // 2026-10-27 前服务端只在「响应头之前的失败」返回 JSON，这类错误天然走 API 分支；
        // 现在慢上游会先发 SSE 头，错误只能以流内事件送达，故这里必须补一份同样的分类规则。
        const sCode = (netErr && netErr.code) || '';
        const noRetryStream = { UPSTREAM_RATE_LIMITED: 1, NO_KEY: 1, BAD_MODEL: 1, ACCESS_REQUIRED: 1 };
        const sMsg = (netErr && netErr.message) || '未知原因';
        if (pick(noRetryStream, sCode)) {
          throw { kind: 'api', message: sMsg, detail: '', code: sCode };
        }
        if (sCode === 'EMPTY_UPSTREAM') {
          emptyHits++;
          if (emptyHits >= 2) {
            throw { kind: 'api', message: '大模型连续两次没有返回内容，请换一个模型或稍后再试', detail: '', code: sCode };
          }
        }
        if (netErr.kind === 'stream') {
          streamFails++;
          if (streamFails >= 3) {
            throw { kind: 'api', message: '断卦流连续三次中断（' + sMsg + '），请换一个模型或稍后再试', detail: '', code: sCode };
          }
        }
        const msg = isAbort ? '请求超时'
          : (netErr.kind === 'stream' ? ('断卦流中断：' + sMsg)
            : ('网络请求失败：' + sMsg));
        details.push('第' + attempt + '次：' + msg);
        lastErr = { kind: 'net', message: msg };
        const delay = Math.min(AI_RETRY_MAX_DELAY, AI_RETRY_MIN_DELAY * Math.pow(2, attempt - 1));
        if (Date.now() - start + delay >= AI_RETRY_DEADLINE) {
          lastErr = { kind: 'html', message: '接口暂未就绪（已重试，仍无响应）', detail: details.join(' | ') };
          break;
        }
        if (onStatus) onStatus(msg + '，' + Math.round(delay / 1000) + ' 秒后重试…');
        await sleep(delay);
        continue;
      }
      let data;
      try { data = JSON.parse(raw); }
      catch (e) {
        const snippet = raw.replace(/\s+/g, ' ').slice(0, 120);
        details.push('第' + attempt + '次：HTML 响应 ' + snippet);
        lastErr = { kind: 'html', message: '接口暂未就绪（新部署传播中，稍等片刻重试即可）', detail: snippet };
        const delay = Math.min(AI_RETRY_MAX_DELAY, AI_RETRY_MIN_DELAY * Math.pow(2, attempt - 1));
        if (Date.now() - start + delay >= AI_RETRY_DEADLINE) {
          lastErr = { kind: 'html', message: '接口暂未就绪（已重试，仍无响应）', detail: details.join(' | ') };
          break;
        }
        if (onStatus) onStatus('接口未就绪，' + Math.round(delay / 1000) + ' 秒后重试…');
        await sleep(delay);
        continue;
      }
      if (!res.ok) {
        const err = { kind: 'api', message: data.message || data.error || ('HTTP ' + res.status), detail: data.detail || '', code: data.error || '' };
        if (isRetriableError(res, data, 'api')) {
          details.push('第' + attempt + '次：' + err.message + (err.detail ? ' / ' + String(err.detail).slice(0, 80) : ''));
          lastErr = err;
          const delay = Math.min(AI_RETRY_MAX_DELAY, AI_RETRY_MIN_DELAY * Math.pow(2, attempt - 1));
          if (Date.now() - start + delay >= AI_RETRY_DEADLINE) break;
          if (onStatus) onStatus(err.message + '，' + Math.round(delay / 1000) + ' 秒后重试…');
          await sleep(delay);
          continue;
        }
        throw err;
      }
      if (!data.reply) {
        details.push('第' + attempt + '次：大模型返回为空');
        lastErr = { kind: 'empty', message: '大模型返回为空' };
        const delay = Math.min(AI_RETRY_MAX_DELAY, AI_RETRY_MIN_DELAY * Math.pow(2, attempt - 1));
        if (Date.now() - start + delay >= AI_RETRY_DEADLINE) break;
        if (onStatus) onStatus('模型返回为空，' + Math.round(delay / 1000) + ' 秒后重试…');
        await sleep(delay);
        continue;
      }
      return data.reply;
    }
    if (lastErr) {
      if (!lastErr.detail) lastErr.detail = '';
      lastErr.detail = (lastErr.detail ? lastErr.detail + ' | ' : '') + details.join(' | ');
      throw lastErr;
    }
    throw { kind: 'html', message: '接口暂未就绪（已重试，仍无响应）', detail: details.join(' | ') };
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
    const cs = $('#aiConsensus');
    if (cs) { cs.hidden = true; cs.innerHTML = ''; }
    $('#aiReply').innerHTML = selModels.map(function (m, i) {
      const cfg = MODELS.filter(function (x) { return x.id === m; })[0] || {};
      return '<div class="ai-col">' +
        '<div class="ai-col-head"><span class="ai-col-title">' + esc(cfg.label || m) + '<span class="pv-tag">' + esc(cfg.pv || '') + '</span></span></div>' +
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
      // 新一轮断卦：递增代数 + 新建 AbortController，中断上一轮在途请求
      aiGen++;
      if (aiAbort) { try { aiAbort.abort(); } catch (e) { /* 已 abort 则忽略 */ } }
      aiAbort = new AbortController();
      const myGen = aiGen;
      const mySignal = aiAbort.signal;
      aiStates = {};
      followUpNote = '';   // 新卦不继承上一卦的应期与前提
      renderCols();
      selModels.forEach(function (m) {
        const el = colBody(m);
        if (el) el.innerHTML = '<div class="loading">推卦中…</div>';
      });
      concl = {};
      await Promise.all(selModels.map(async function (m) {
        try {
          const onStatus = function (msg) {
            if (myGen !== aiGen) return;   // 已进入新一轮，丢弃旧状态回调
            const el = colBody(m);
            if (el) el.innerHTML = '<div class="loading">' + esc(msg) + '</div>';
          };
          const onStream = function (text) {
            if (myGen !== aiGen) return;
            const el = colBody(m);
            if (el) {
              el.innerHTML = '<div class="ai-block">' + mdLite(text) + '</div>';
              scrollBody(el);
            }
          };
          let reply = await callInterpret(m, [], onStatus, onStream, { gen: myGen, signal: mySignal });
          if (myGen !== aiGen) return;     // 旧代响应：不写入状态、不渲染

          /* 断语未完篇 → 自动补一次（2026-10-21）。
             首轮不再走网关缓存后，每次都是真生成，模型偶发提前收尾（实测
             deepseek 8 s / 951 字符、gemini 137 tokens），用户拿到的半篇连「结论：」
             行都没有，只能自己再点一次。这里检测到就自动重来一遍，把完整稿
             覆盖上去，用户最多多等一次生成，不用自己判断「是不是没写完」。
             2026-10-21 晚：补发改用兄弟模型（见 retryModelFor）——同模型重跑
             对 3.6 的 46% 残篇率没有改善，换 3.8 才拿得到完篇。
             只补一次：再失败就保留较长的一稿并显示提示，避免反复烧调用。

             2026-10-25 重写期渲染：补全稿 / 校正稿**不再逐帧重画可见气泡**。
             旧版把首稿用的同一个 onStream 传给重写请求，气泡从空开始重新流一遍，
             用户看到「断语先出一段碎片，收尾后又整篇重来」——像交付了两次。
             现在：当前稿原样保留（压暗），顶部一条状态条只更新已收到字数，
             重写完成后由下面那次整块渲染一次性替换。 */
          let curDraft = mdLite(reply || '');   // 每次重写前刷新为「此刻展示在气泡里的稿」
          const rewriteView = function (label, chars) {
            if (myGen !== aiGen) return;
            const el = colBody(m);
            if (!el) return;
            let bar = el.querySelector('.rw-bar');
            if (!bar) {
              el.innerHTML = '<div class="rw-bar"></div>' +
                '<div class="ai-block rw-draft">' + curDraft + '</div>';
              bar = el.querySelector('.rw-bar');
            }
            if (bar) {
              bar.textContent = '⟳ ' + label + (chars ? '（已收到 ' + chars + ' 字）' : '');
            }
            scrollBody(el);
          };
          const rwStatus = function (label) {
            return function () { rewriteView(label, 0); };
          };
          const rwStream = function (label) {
            return function (text) { rewriteView(label, text ? text.length : 0); };
          };

          let retriedWith = '';
          if (reply && reply.length > 30 && !/结[论局]\s*[：:]/.test(reply)) {
            const alt = retryModelFor(m);
            const label = alt !== m ? '断语未写完，改用 ' + alt + ' 重新生成' : '断语未写完，正在重新生成';
            curDraft = mdLite(reply);   // 残篇也要留着现形，用户才知道「往哪儿补」
            const retry = await callInterpret(alt, [], rwStatus(label), rwStream(label), { gen: myGen, signal: mySignal });
            if (myGen !== aiGen) return;
            const good = !!retry && (/结[论局]\s*[：:]/.test(retry) || retry.length > reply.length);
            if (good) {
              reply = retry;
              // 只有真的换上、且模型不同才标注，避免「补全」二字在默认路径上刷屏
              if (alt !== m) retriedWith = alt;
            }
          }

          /* 盘面事实冲突 → 把冲突点回灌给模型，只重写一次。
             旧版只在断语下方提示，用户拿到的仍是写错的正文；重写一次能消掉
             大半「世应写反／卦名写错」且不会无限循环（仅一次机会）。 */
          let corrected = false;
          if (HAS_ABSORB) {
            try {
              const fa = C.auditFactClaims(reply, pan);
              if (fa && !fa.accepted && fa.errors.length) {
                const list = fa.errors.slice(0, 6).map(function (e) {
                  return (e.at ? e.at + '：' : e.type + '：') + '断语作「' + e.claimed + '」，卦盘实为「' + e.actual + '」';
                }).join('；');
                const label = '发现 ' + fa.errors.length + ' 处与卦盘不符，按盘面校正中';
                curDraft = mdLite(reply);   // 展示的就是这一稿（可能已是补全稿）
                reply = await callInterpret(m, [
                  { role: 'assistant', content: reply },
                  { role: 'user', content: '上一稿有 ' + fa.errors.length + ' 处与卦盘不符：' + list +
                    '。请严格对照盘面全文重写，保持原有结构，不得保留上述错误表述，也不要解释修改过程。' }
                ], rwStatus(label), rwStream(label), { gen: myGen, signal: mySignal });
                corrected = true;
              }
            } catch (e) { /* 审计或重写失败：保留首稿，不打断 */ }
          }
          if (myGen !== aiGen) return;

          const cc = parseConclusion(reply);
          if (cc.verify) lastVerify = cc.verify;
          // 输出前一致性校验（M21 · 应期同域）：模型给的「应期」粒度不得细于事项跨度。
          // 这一步是确定性的——引擎已判出跨度，模型写日级应期就是自相矛盾，
          // 与其让用户事后发现，不如此刻把冲突与撤回模板一并摆出来。
          let yqCheck = null, pj = null;
          if (HAS_PREMISE) {
            try {
              pj = C.premise.judge(currentQuestion(), $('#useSelect').value);
              yqCheck = C.premise.checkYingqi(cc.yingqi, pj);
              cc.spanUnit = pj.effUnit;
              cc.premiseJudge = pj;
            } catch (e) { yqCheck = null; }
          }
          concl[m] = cc;
          aiStates[m] = { history: [{ role: 'assistant', content: reply }] };
          const bodyEl = colBody(m);
          if (bodyEl) {
            // 前提完整性徽标：完整→灰；缺失/前提未定→黄（不是错误，是「这份断语在哪种前提下成立」）。
            let premiseLine = '';
            if (cc.premise) {
              const okP = /^\s*完整/.test(cc.premise);
              premiseLine = '<div class="' + (okP ? 'muted' : 'warn') + '" style="margin-top:4px;font-size:12px">前提 ' +
                esc(cc.premise) + '</div>';
            } else if (pj && pj.high.length) {
              // 模型漏报前提完整性，而引擎判定有高风险缺项：这是契约未遵守，须显式提示。
              premiseLine = '<div class="warn" style="margin-top:4px;font-size:12px">前提 未申报（引擎预检：' +
                esc(pj.high.map(function (x) { return x.label; }).join('、')) + '属高风险缺项）</div>';
            }
            let yqLine = '';
            if (yqCheck && !yqCheck.ok) {
              const hard = yqCheck.level === 'violation';
              const why = yqCheck.code === 'YINGQI_TOO_FINE'
                ? ('应期粒度细于事项跨度（' + pj.effLabel + '）')
                : ('应期粒度与事项跨度不符（' + pj.effLabel + '）');
              // 撤回模板只在硬冲突时给：「原应期作废」是很重的话，软提示滥用会让它失去分量。
              const tpl = hard && HAS_PREMISE && C.premise.withdraw
                ? C.premise.withdraw(cc.yingqi, why, pj.effLabel) : '';
              yqLine = '<div class="' + (hard ? 'warn' : 'muted') + '" style="margin-top:4px;font-size:12px">' +
                (hard ? '⚠ ' : '· ') + esc(yqCheck.msg) +
                (tpl ? '<div style="margin-top:2px">' + esc(tpl) + '</div>' : '') + '</div>';
            }
            const card = cc.trend
              ? '<div class="verdict" style="font-size:13px;margin-bottom:6px">结论 <b>' + esc(cc.trend) + '</b>' +
                (cc.yingqi ? ' ｜ 应期 ' + esc(cc.yingqi) : '') +
                (cc.yongshen ? ' ｜ 用神 ' + esc(cc.yongshen) : '') +
                premiseLine + yqLine +
                (cc.verify ? '<div style="margin-top:4px">验证 <b>' + esc(cc.verify) + '</b></div>'
                  : '<div class="muted" style="margin-top:4px;font-size:12px">此卦未给出可核对标志，事后无法回填</div>') +
                '</div>'
              : '';
            bodyEl.innerHTML = card + '<div class="ai-block">' + mdLite(reply) + '</div>' + auditHTML(reply) + checklistHTML() +
              (corrected ? '<div class="muted" style="margin-top:6px;font-size:12px">已按盘面校正 1 次</div>' : '') +
              (retriedWith ? '<div class="muted" style="margin-top:6px;font-size:12px">首稿未完篇，本稿由 ' + esc(retriedWith) + ' 补全</div>' : '');
            // 复制的是模型原文（正文末尾本含「结论/应期」四行），不拼前端解析出的卡片，避免重复
            attachCopyBtn(colHeadOf(m), reply);
            scrollBody(bodyEl);
          }
        } catch (e) {
          if (e && e.kind === 'aborted') return;   // 被新一轮取消，静默退出
          if (myGen !== aiGen) return;
          const el = colBody(m);
          if (el) renderFailBox(el, m, [], e);
        }
      }));
      renderConsensus(concl);
      $('#chatBox').hidden = !Object.keys(aiStates).length;
      autoSaveCast();
    } finally {
      btn.disabled = false; btn.textContent = '重新断卦';
    }
  };

  let chatBusy = false;
  // 追问消息块 id 唯一序号：旧版每次追问都用同一个 chatload-<hash>，
  // 而完成时只改 innerHTML 不移除 id，第二次起 getElementById 只会命中第一个，
  // 后续追问全部渲染到第一轮的消息块里。加序号保证每轮独立。
  let chatSeq = 0;
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
      // 追问沿用当前代数：若在途时用户点[重新断卦]（代数递增），
      // 旧追问的响应会被下方代数比对丢弃。
      const myGen = aiGen;
      // 每轮追问为每个模型分配独立 id，避免旧版共用一个 id 时
      // getElementById 只命中第一个消息块（后续追问全部串到第一轮）。
      const chatIds = {};
      active.forEach(function (m) {
        aiStates[m].history.push({ role: 'user', content: q });
        const el = colBody(m);
        if (!el) return;
        const chatId = 'chatload-' + midSafe(m) + '-' + (++chatSeq);
        chatIds[m] = chatId;
        el.insertAdjacentHTML('beforeend',
          '<div class="msg user"><b>问：</b>' + mdLite(q) + '</div><div class="msg ai" id="' + chatId + '"><span class="loading">推敲中…</span></div>');
        scrollBody(el);
      });
      // 同盘追问的前提变动提示（R5）：用户补充的信息可能把时间跨度改掉
      //（如补一句「是明年考」）。旧版全程不提示，模型会静默把原应期改写成新的日级日期，
      // 用户以为断的是同一件事。这里把「原应期 + 跨度变化」摆到它面前，逼它走撤回模板。
      followUpNote = '';
      if (HAS_PREMISE && C.premise.followUpHint) {
        const prev = concl[active[0]];
        if (prev && prev.yingqi) {
          try {
            const hint = C.premise.followUpHint(prev, currentQuestion() + ' ' + q);
            if (hint) followUpNote = '【同盘追问 · 前提变动】' + hint;
          } catch (e) { /* 预检失败不影响追问主流程 */ }
        }
      }
      await Promise.all(active.map(async function (m) {
        const loadEl = document.getElementById(chatIds[m]);
        // 本次追问已入栈，须整段送出：旧版 slice(0,-1) 把刚入栈的问题切掉，大模型收不到追问
        const historySnapshot = aiStates[m].history.slice();
        try {
          const reply = await callInterpret(m, historySnapshot, function (msg) {
            if (loadEl) loadEl.innerHTML = '<span class="loading">' + esc(msg) + '</span>';
          }, function (text) {
            if (loadEl) loadEl.innerHTML = mdLite(text);
            scrollBody(colBody(m));
          }, { gen: aiGen, signal: aiAbort ? aiAbort.signal : null });
          // 追问在途时用户点[重新断卦]：代数已变，丢弃旧响应，
          // 否则旧卦的 assistant 回复会被追加进新卦 history，下一轮追问
          // 会把两个卦象的盘面文本混在一趟上下文里发给模型。
          if (aiGen !== myGen) return;
          aiStates[m].history.push({ role: 'assistant', content: reply });
          if (loadEl) {
            loadEl.innerHTML = mdLite(reply) + auditHTML(reply);
            attachCopyBtn(loadEl, reply);
          }
          scrollBody(colBody(m));
        } catch (e) {
          if (e && e.kind === 'aborted') return;
          if (aiGen !== myGen) return;
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
  // isComposing：IME 组字确认时 Enter 同样触发 keydown，旧版会把残缺的候选词
  // 当即发送——问题进入 aiStates[m].history 无法收回，input.value 被清空丢字。
  $('#chatInput').onkeydown = function (e) { if (e.key === 'Enter' && !e.isComposing) sendChat(); };

  // 判据快照：把断卦时刻的用神/粗判/应期窗口/置信度/区间宽度固化成 JSON，
  // 随 recordPayload 与 panText 同批入库。字段来源与缺失规则见 docs/proposal-baseline-column.md §三。
  // 缺失一律 null（不用空串/0）；无任何判据可存时整体返回 null（列保持 NULL）。
  function baselineSnapshot() {
    const a = lastAnalysis;
    if (!a) return null;
    const w = a.yingqiWindow || null;
    const y = a.yongshen;
    const snap = {
      yongshen: (y && y.line) ? (y.type + ' ' + y.line.lq + y.line.zhi) : null,
      trend: a.trend || null,
      window: null,
      confidence: w ? w.confidence : null,          // blocked 时照写（'低'），与 renderYingqi 显示一致
      spread: (w && w.spread != null) ? w.spread : null
    };
    if (w) {
      snap.window = (w.status === 'blocked')
        ? { status: 'blocked', blockedBy: w.blockedBy || '', text: w.text || '' }
        : { status: 'ok', lo: w.lo, hi: w.hi, dayLo: w.dayLo, dayHi: w.dayHi,
            dateLo: w.dateLo, dateHi: w.dateHi, text: w.text };
    }
    if (!snap.yongshen && !snap.trend && !snap.window) return null;
    return snap;
  }

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
      baseline: baselineSnapshot(),
      messages: aiStates   // { modelId: [{role, content}] }
    };
  }

  let autoSavePromise = null;
  async function autoSaveCast() {
    if (!pan) return;
    // 串行化：旧版 autoSaveCast 与 [存入卦例库] 都不 await，用户在其在途时点手动保存，
    // 两个 POST 都带 id:null → 服务端各生成一个 UUID → 卦例库出现两条重复记录，
    // 且后返回的把 castId 改成另一条的 id，后续自动保存更新的是另一条。
    const run = (autoSavePromise || Promise.resolve()).then(async function () {
      try {
        // silent：未登录时不弹口令框，静默跳过
        const res = await apiFetch('/api/records', { method: 'POST', body: JSON.stringify(recordPayload()) }, true);
        const data = await res.json();
        if (res.ok && data.id) { castId = data.id; $('#btnSave').textContent = '已入卦例库 ✓'; }
      } catch (e) { /* 静默：数据库未绑定或未登录时不打扰断卦 */ }
    });
    autoSavePromise = run.catch(function () {});
    return run;
  }

  $('#btnSave').onclick = async function () {
    if (!pan) return;
    const btn = $('#btnSave'); btn.disabled = true;
    try {
      // 先等挂起的自动保存落定，避免与手动保存并发写出两条记录（见 autoSaveCast 注释）
      if (autoSavePromise) { try { await autoSavePromise; } catch (e) { /* 自动保存失败不阻断手动保存 */ } }
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
    const logged = !!readCode();
    btn.textContent = logged ? '已登录 · 退出' : '口令登录';
    if (tip) tip.textContent = logged ? '已登录（本次会话有效），断卦后自动入卦例库' : '卦例库需口令，浏览与装入均需登录';
  }
  const _btnLogin = $('#btnLogin');
  if (_btnLogin) _btnLogin.onclick = async function () {
    if (readCode()) {
      writeCode('');
      renderLoginBtn();
      return;
    }
    const code = prompt('请输入卦例库口令：');
    if (!code) return;
    writeCode(code);
    // 验证探针：只校验口令不落库
    try {
      const res = await fetch('/api/records?verify=1', { method: 'POST', headers: apiHeaders(), body: '{}' });
      if (res.status === 401) {
        writeCode('');
        alert('口令错误');
      } else if (res.status === 429) {
        alert('口令错误次数过多，请稍后再试');
      }
    } catch (e) { /* 网络异常时保留输入，实际写入时再校验 */ }
    renderLoginBtn();
  };

  // ---------- 结果回执与命中率统计（M16） ----------
  // 排盘与断卦都不增加卦象与所占之事间的互信息（数据处理不等式），
  // 唯一能估它下界的工程路径是攒「卦象—结果」成对样本。此处只做忠实记录与汇总，
  // 样本不足时不宣称任何预测效力（见 README M16）。
  const OC_RESULT = { success: '事已成', fail: '事败', partial: '部分应验', unclear: '成败未明' };
  const OC_YINGQI = { on_time: '应期准', missed: '应期不准', pending: '应期未至', unclear: '应期未明' };
  // 应验窗口分桶（M17）：3 / 7 / 30 / 90 日以上。
  // 分桶不是分类癖：短线应期靠日辰冲动、值日、出空；长线靠月建旺衰、旬空填实、伏神出现。
  // 两者机制不同，混池求出的「准确率」既不能反映短线也不能反映长线，故统计口径一律分行报。
  const OC_WINDOW = { d3: '3 日内', d7: '7 日内', d30: '30 日内', d90: '90 日以上' };
  const OC_WINDOW_ORDER = ['d3', 'd7', 'd30', 'd90'];
  function parseOutcome(raw) {
    if (!raw) return null;
    let o = raw;
    if (typeof raw === 'string') { try { o = JSON.parse(raw); } catch (e) { return null; } }
    if (!o || typeof o !== 'object') return null;
    // pick 防原型链：outcome 来自 D1 历史数据，result 为 'toString' / 'constructor'
    // 时 OC_RESULT[o.result] 会取到原型属性（truthy）而通过校验，
    // 随后把函数源码 esc() 之后渲染进徽章。
    if (!pick(OC_RESULT, o.result) && !pick(OC_YINGQI, o.yingqi)) return null;
    return o;
  }
  function outcomeBadge(raw) {
    const o = parseOutcome(raw);
    if (!o) return '';
    const cls = o.result === 'success' ? ' oc-success' : o.result === 'fail' ? ' oc-fail' : o.result === 'partial' ? ' oc-partial' : '';
    const parts = [];
    if (pick(OC_RESULT, o.result)) parts.push(OC_RESULT[o.result]);
    if (pick(OC_YINGQI, o.yingqi)) parts.push(OC_YINGQI[o.yingqi]);
    return '<span class="oc-badge' + cls + '" title="结果回执">' + esc(parts.join(' · ')) + '</span>';
  }
  // 判据快照防御解析（M17-A）：与 parseOutcome 同款——字符串先 JSON.parse，
  // 失败或非对象一律 null；三主字段全空同样按「无快照」处理（详情页不渲染对照区）。
  function parseBaseline(raw) {
    if (!raw) return null;
    let b = raw;
    if (typeof raw === 'string') { try { b = JSON.parse(raw); } catch (e) { return null; } }
    if (!b || typeof b !== 'object' || Array.isArray(b)) return null;
    if (!b.yongshen && !b.trend && !b.window) return null;
    return b;
  }
  // 「判据对照」块：左=断卦时存的判据快照，右=事后据实回填的事实。只读并排，无输入无按钮。
  // 文案红线（docs/proposal-baseline-column.md §5.3）：不出现准确率/命中率类词；不渲染
  // ✓/✗ 与「与事实一致/不一致」的机器结论；事实侧不用 oc-success/oc-fail 彩色徽标——
  // 那两色在本页语义是「事之成败」，出现在对照区会被读成「判对了/判错了」。
  function baselineCmpHTML(raw, oc) {
    const bl = parseBaseline(raw);
    if (!bl) return '<div class="muted" style="margin-top:12px;font-size:12px">此例无当时判据快照（保存于判据快照上线前）。</div>';
    const w = (bl.window && typeof bl.window === 'object' && !Array.isArray(bl.window)) ? bl.window : null;
    // 应期行判据侧：window.text 原文展示（去「应期：」前缀与 renderYingqi 一致），不从
    // lo/hi 重拼；blocked 的拒答文案本身即判据，照常展示并配置信徽标（低）。
    let yqLeft = '—';
    if (w && w.text) {
      yqLeft = esc(String(w.text).replace(/^应期：/, '')) +
        (bl.confidence
          ? '　<span class="oc-badge" title="盘面要素的自洽程度，不是命中概率">置信' +
            esc(bl.confidence === '中' ? '中等' : bl.confidence) + '</span>'
          : '');
    }
    const trendLeft = pick(TREND_LABEL, bl.trend) || '—';
    const trendRight = (oc && pick(OC_RESULT, oc.result)) || '—';
    const yqRight = oc
      ? ([pick(OC_YINGQI, oc.yingqi), pick(OC_WINDOW, oc.window)].filter(Boolean).join(' · ') || '—')
      : '—';
    return '<div class="cmp-box"><b>判据对照</b>　<span class="muted" style="font-size:12px">左：断卦时存的判据快照　右：事后据实回填的事实</span>' +
      '<div class="cmp-grid">' +
      '<div class="muted">事之走向（当时粗判）</div><div class="muted">事之成败（事后）</div>' +
      '<div>' + esc(trendLeft) + '</div><div>' + esc(trendRight) + '</div>' +
      '<div class="muted">应期（当时判据）</div><div class="muted">应期（事后）</div>' +
      '<div>' + yqLeft + '</div><div>' + esc(yqRight) + '</div>' +
      '<div class="muted">用神（当时所取）</div><div class="muted"></div>' +
      '<div>' + (bl.yongshen ? esc(bl.yongshen) : '—') + '</div><div>—</div>' +
      '</div>' +
      '<div class="muted" style="margin-top:4px;font-size:12px">置信度只表示盘面要素的自洽程度，不是命中概率。对照仅为决策留痕，不做对错判定。</div></div>';
  }
  // 命中率汇总：按「应验窗口」分桶报，**绝不混池**。
  // 每桶内部：事之成败（成/部分/败，判定明确者为分母）＋ 应期验证（按时/未按时）。
  // unclear / pending 属「尚无定论」，不进任何分母；未标窗口的样本单列，不计入桶。
  function renderLibStats(recs) {
    const box = $('#libStats');
    if (!box) return;
    const filled = recs.map(function (r) { return parseOutcome(r.outcome); }).filter(Boolean);
    if (!filled.length) {
      box.innerHTML = recs.length
        ? '<div class="muted">尚无结果回执。点开卦例详情可回填「事之成败 / 应期是否按时应验 / 应验窗口」，攒够样本后可估命中率。</div>'
        : '';
      return;
    }
    const pct = function (a, b) { return b ? '（' + Math.round(a * 100 / b) + '%）' : ''; };

    const rowHTML = function (label, list) {
      if (!list.length) return '';
      const cnt = function (k) { return list.filter(function (o) { return o.result === k; }).length; };
      const ycnt = function (k) { return list.filter(function (o) { return o.yingqi === k; }).length; };
      const decided = cnt('success') + cnt('fail') + cnt('partial');
      const ydecided = ycnt('on_time') + ycnt('missed');
      return '<div class="muted" style="margin-top:4px"><b>' + esc(label) + '</b>（n=' + list.length + '）　' +
        '成 ' + cnt('success') + pct(cnt('success'), decided) +
        ' · 部分 ' + cnt('partial') + ' · 败 ' + cnt('fail') + pct(cnt('fail'), decided) +
        '　｜　应期按时 ' + ycnt('on_time') + '/' + ydecided +
        (ycnt('pending') ? '（另 ' + ycnt('pending') + ' 例应期未至）' : '') +
        '</div>';
    };

    let rows = '';
    OC_WINDOW_ORDER.forEach(function (k) {
      rows += rowHTML(OC_WINDOW[k], filled.filter(function (o) { return o.window === k; }));
    });
    const noWin = filled.filter(function (o) { return !pick(OC_WINDOW, o.window); });

    box.innerHTML = '<div class="verdict" style="padding:10px 14px"><b>命中率统计（按应验窗口分桶）</b>　已回填 ' +
      filled.length + ' / ' + recs.length + ' 例' +
      (rows || '<div class="muted" style="margin-top:4px">尚未标注任何应验窗口。</div>') +
      (noWin.length
        ? '<div class="muted" style="margin-top:4px">未标应验窗口 ' + noWin.length + ' 例（不计入任何桶）：回执表单里选「应验窗口」后才会进分桶统计。</div>'
        : '') +
      '<div class="muted" style="margin-top:6px">分桶之间不可相加——3 日样本走日辰冲动／值日／出空，90 日样本走月建旺衰／填实／伏神，' +
      '混成一个「准确率」既不反映短线也不反映长线。样本尚少时以上只是忠实计数，不构成预测效力的证据。</div></div>';
  }

  // ---------- 回访提醒（M18·任务⑦）：惰性回访，打开卦例库时拉取到期任务 ----------
  // 文案红线：只说「已到回访期，请回填结果与应验情况」；预判桶位带「当时判据预计」前缀；
  // 不出现「准确率/命中率/说对说错」类词；预判绝不预填回填表单。
  function renderDueTasks(data) {
    const box = $('#libDue');
    if (!box) return;
    const tasks = (data && data.tasks) || [];
    if (!tasks.length) { box.innerHTML = ''; return; }
    const rows = tasks.map(function (t) {
      const label = t.question ? esc(t.question) + ' · ' + esc(t.hex || '') : '原卦例已删除（id ' + esc(t.cast_id) + '）';
      return '<div class="lib-item" data-cast="' + escAttr(t.cast_id) + '"><span>' + label +
        '<span class="muted">　·　' + esc(t.due_at) + ' 已到回访期，请回填结果与应验情况</span>' +
        (t.note ? '<br><span class="muted" style="font-size:12px">' + esc(t.note) + '</span>' : '') + '</span>' +
        '<span class="lib-side">' +
        (t.question ? '<button class="btn" data-due-go="' + escAttr(t.cast_id) + '">去回填</button>' : '') +
        '<button class="btn ghost" data-due-dismiss="' + escAttr(t.cast_id) + '">不再提醒</button>' +
        '</span></div>';
    }).join('');
    box.innerHTML = '<div class="verdict" style="padding:10px 14px"><b>回访提醒</b>　' + tasks.length + ' 条已到回访期' +
      '<div style="margin-top:6px">' + rows + '</div>' +
      '<div class="muted" style="margin-top:6px;font-size:12px">回访只提醒「该回头看这条卦了」；回填与否、回填内容一律据实，以结果回执为唯一事实源。</div></div>';
  }

  async function loadDueTasks() {
    try {
      const res = await apiFetch('/api/readings', {});
      if (!res.ok) { renderDueTasks({ tasks: [] }); return; }
      renderDueTasks(await res.json());
    } catch (e) { /* 回访提醒是辅助功能，失败静默不打断卦例库主流程 */ }
  }

  async function dismissDueTask(castId) {
    try {
      const res = await apiFetch('/api/readings', {
        method: 'POST', body: JSON.stringify({ cast_id: castId, action: 'dismissed' })
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.message || '操作失败');
      await loadDueTasks();
    } catch (e) { alert('操作失败：' + e.message); }
  }

  // 列表分页（L2）：服务端 limit 默认 100/上限 200，前端按页追加。
  // 旧版硬编码 LIMIT 100，第 101 条之后只能靠 id 直访，列表里永久不可见。
  const LIB_PAGE = 100;
  let libRecs = [];     // 已载入的记录（统计口径 = 已载入样本，随"加载更多"一起增长）
  let libLoaded = 0;    // 已渲染条数 = 下一页 offset

  function libItemHTML(r) {
    return '<div class="lib-item" data-id="' + escAttr(r.id) + '"><span>' + esc(r.question || '（未注明所测）') + ' · ' + esc(r.hex) + '</span>' +
      '<span class="lib-side">' + outcomeBadge(r.outcome) + '<span class="muted">' + esc((r.created_at || '').slice(0, 10)) + '</span>' +
      '<button class="lib-del" data-del="' + escAttr(r.id) + '" title="删除此卦例">×</button></span></div>';
  }

  async function loadLibPage(offset, append) {
    const list = $('#libList');
    if (!append) { list.innerHTML = '<div class="muted">载入中…</div>'; libRecs = []; libLoaded = 0; }
    const res = await apiFetch('/api/records?limit=' + LIB_PAGE + '&offset=' + offset, {});
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || '读取失败');
    const oldMore = list.querySelector('[data-lib-more]');
    if (oldMore) oldMore.parentNode.removeChild(oldMore);
    if (!append) list.innerHTML = '';
    if (!data.records.length) {
      if (!append) { list.innerHTML = '<div class="muted">尚无卦例。</div>'; renderLibStats([]); }
      return;
    }
    list.insertAdjacentHTML('beforeend', data.records.map(libItemHTML).join(''));
    libRecs = append ? libRecs.concat(data.records) : data.records.slice();
    libLoaded = libRecs.length;
    renderLibStats(libRecs);
    if (data.hasMore) {
      list.insertAdjacentHTML('beforeend',
        '<div class="btn-row" style="margin-top:8px"><button class="btn" data-lib-more>加载更多</button>' +
        '<span class="muted" style="margin-left:8px">已载入 ' + libLoaded + ' 例</span></div>');
    }
  }

  async function delCast(id) {
    if (!confirm('确定删除此卦例？不可恢复。')) return;
    try {
      const res = await apiFetch('/api/records?id=' + encodeURIComponent(id), { method: 'DELETE' });
      const d = await res.json();
      if (!res.ok) throw new Error(d.message || '删除失败');
      const item = document.querySelector('.lib-item[data-id="' + id + '"]'); // id 已过 ^[A-Za-z0-9_-]{1,64}$ 白名单
      if (item) item.remove();
      $('#libDetail').innerHTML = '';
      libRecs = libRecs.filter(function (x) { return x.id !== id; });
      libLoaded = libRecs.length;
      renderLibStats(libRecs);
      // 删空当前页则退一页重拉（顺带把"加载更多"换成"尚无卦例"或下一页数据）
      if (!libRecs.length) return loadLibPage(0, false);
      if (!$('.lib-item')) $('#libList').innerHTML = '<div class="muted">尚无卦例。</div>';
    } catch (err) { alert('删除失败：' + err.message); }
  }

  // 事件委托：分页后节点是追加进来的，用一次性委托避免每页重复绑定
  const _libList = $('#libList');
  if (_libList) _libList.addEventListener('click', function (e) {
    const t = e.target;
    if (!t || !t.closest) return;
    const go = t.closest('[data-due-go]');
    if (go) { loadCast(go.dataset.dueGo); return; }
    const dis = t.closest('[data-due-dismiss]');
    if (dis) { dismissDueTask(dis.dataset.dueDismiss); return; }
    const del = t.closest('.lib-del');
    if (del) { e.stopPropagation(); delCast(del.dataset.del); return; }
    const more = t.closest('[data-lib-more]');
    if (more) { more.disabled = true; loadLibPage(libLoaded, true).catch(function (err) { alert('读取失败：' + err.message); more.disabled = false; }); return; }
    const item = t.closest('.lib-item');
    if (item) loadCast(item.dataset.id);
  });

  $('#btnLib').onclick = async function () {
    try {
      await loadLibPage(0, false);
      loadDueTasks();   // 回访提醒与列表并行拉取，失败静默（辅助功能不打断主流程）
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

  // 卦例库详情加载代际：每条列表项点击即发一次请求，旧版无序号/取消，
  // 先点的慢请求后返回会把旧详情整体覆盖到新详情上（#libDetail 被整块重写）。
  let castToken = 0;
  async function loadCast(id) {
    const myToken = ++castToken;
    try {
      const res = await apiFetch('/api/records?id=' + encodeURIComponent(id), {});
      const data = await res.json();
      if (!res.ok) { if (myToken === castToken) libDetailError('读取失败：' + (data.message || '')); return; }
      const r = data.record;
      if (!r) { if (myToken === castToken) libDetailError('读取失败：卦例不存在'); return; }
      let msgs = {}; try { msgs = JSON.parse(r.messages || '{}'); } catch (e) {}
      // 兼容旧格式（单模型数组）
      if (Array.isArray(msgs)) msgs = msgs.length ? { '（旧版记录）': msgs } : {};
      // 断语正文按渲染顺序入队，供下方 innerHTML 落地后逐条绑定复制按钮
      // （历史记录里每条「断」各一份，不分模型合并，免得复制串行）
      const copyQueue = [];
      let colHTML = Object.keys(msgs).map(function (m) {
        const cfg = MODELS.filter(function (x) { return x.id === m; })[0] || { label: m, pv: '' };
        // 兼容两种结构：{模型: [消息...]}（旧）与 {模型: {history: [消息...]}}（现行 aiStates 格式）
        const arr = Array.isArray(msgs[m]) ? msgs[m] : ((msgs[m] && msgs[m].history) || []);
        return '<div class="ai-col">' +
          '<div class="ai-col-head"><span class="ai-col-title">' + esc(cfg.label || m) + '<span class="pv-tag">' + esc(cfg.pv || '') + '</span></span></div>' +
          arr.map(function (msg) {
            const isUser = msg.role === 'user';
            if (!isUser) copyQueue.push(msg.content);
            return '<div class="msg ' + (isUser ? 'user' : 'ai') + '"><b>' +
              (isUser ? '问' : '断') + '：</b>' + mdLite(msg.content) + '</div>';
          }).join('') + '</div>';
      }).join('');
      if (!colHTML) colHTML = '<div class="muted">该卦例无对话记录。</div>';
      // 结果回执（M16）：展示当前值 + 回填表单。应期是最佳验证切口——
      // 天然带时间戳，不需主观标注「准不准」，只记「那天发生了没有」。
      const oc = parseOutcome(r.outcome);
      const ocNow = oc
        ? [pick(OC_RESULT, oc.result), pick(OC_YINGQI, oc.yingqi), pick(OC_WINDOW, oc.window)].filter(Boolean).join(' · ') +
          (oc.note ? '　备注：' + oc.note : '') +
          (oc.updated_at ? '　（记于 ' + String(oc.updated_at).slice(0, 10) + '）' : '')
        : '尚未回填';
      // 判据对照（M17-A）：断卦时存的快照 vs 事后回填的事实，插在回执区上方；
      // 无快照（旧行/解析失败/全空）时函数自身降级为一行 muted 说明
      const cmpHTML = baselineCmpHTML(r.baseline, oc);
      // 代际校验：在途期间用户已点开另一条，丢弃本次响应，不覆盖新详情
      if (myToken !== castToken) return;
      $('#libDetail').innerHTML = '<div class="ai-block"><b>' + esc(r.hex) + '</b>　<span class="muted">' +
        esc(r.datetime || '') + '　' + esc(r.pillars || '') + '</span>' +
        '<pre class="pan-text">' + esc(r.pan_text || '') + '</pre>' +
        '<div class="ai-cols">' + colHTML + '</div>' +
        cmpHTML +
        '<div class="oc-box"><b>结果回执</b>　<span class="muted" id="ocNow">' + esc(ocNow) + '</span>' +
        '<div class="muted" style="margin-top:4px;font-size:12px">事后据实回填，供命中率统计；如实记录，败例同样宝贵。</div>' +
        '<div class="oc-row">' +
        '<select id="ocResult"><option value="">事之成败…</option><option value="success">事已成</option>' +
        '<option value="fail">事败</option><option value="partial">部分应验</option><option value="unclear">成败未明</option></select>' +
        '<select id="ocYingqi"><option value="">应期…</option><option value="on_time">应期准（按时应验）</option>' +
        '<option value="missed">应期不准</option><option value="pending">应期未至</option><option value="unclear">应期未明</option></select>' +
        '<select id="ocWindow" title="结果在多久内出现？决定该样本进哪个统计桶（分桶之间不可相加）">' +
        '<option value="">应验窗口…</option><option value="d3">3 日内</option><option value="d7">7 日内</option>' +
        '<option value="d30">30 日内</option><option value="d90">90 日以上</option></select>' +
        '<input id="ocNote" maxlength="200" placeholder="备注（≤200 字，可留空）">' +
        '<button class="btn primary" id="btnOcSave">保存回执</button>' +
        (oc ? '<button class="btn ghost" id="btnOcClear">清除回执</button>' : '') +
        '</div><div class="muted" id="ocMsg" style="margin-top:6px;font-size:12px"></div></div>' +
        '</div>';
      // 每条「断」挂一个复制按钮：DOM 顺序与 copyQueue 顺序一致
      const aiNodes = $('#libDetail').querySelectorAll('.msg.ai');
      for (let i = 0; i < aiNodes.length; i++) attachCopyBtn(aiNodes[i], copyQueue[i]);
      if (oc) {
        if (oc.result) $('#ocResult').value = oc.result;
        if (oc.yingqi) $('#ocYingqi').value = oc.yingqi;
        if (oc.window) $('#ocWindow').value = oc.window;
        if (oc.note) $('#ocNote').value = oc.note;
      }
      const saveOutcome = async function (outcome) {
        const msg = $('#ocMsg');
        const btn = $('#btnOcSave'); if (btn) btn.disabled = true;
        try {
          const res = await apiFetch('/api/records?outcome=1', {
            method: 'POST', body: JSON.stringify({ id: r.id, outcome: outcome })
          });
          const d = await res.json();
          if (!res.ok) throw new Error(d.message || '保存失败');
          msg.textContent = outcome === null ? '回执已清除。' : '回执已保存。';
          // 刷新列表徽标与命中率统计（详情区保持不动）
          $('#btnLib').onclick();
          // 重载详情以刷新「当前值」行。需校验代际：用户在这 300ms 内点开另一条时
          // castToken 已变，旧卦例详情随后覆盖新打开的会造成错乱。
          setTimeout(function () { if (castToken === myToken) loadCast(r.id); }, 300);
        } catch (e) {
          msg.textContent = '保存失败：' + e.message;
        } finally { if (btn) btn.disabled = false; }
      };
      $('#btnOcSave').onclick = function () {
        const outcome = {
          result: $('#ocResult').value, yingqi: $('#ocYingqi').value,
          window: $('#ocWindow').value, note: $('#ocNote').value
        };
        if (!outcome.result && !outcome.yingqi) { $('#ocMsg').textContent = '请至少选择「事之成败」或「应期」之一。'; return; }
        saveOutcome(outcome);
      };
      const btnClear = $('#btnOcClear');
      if (btnClear) btnClear.onclick = function () {
        if (confirm('确定清除此卦例的结果回执？')) saveOutcome(null);
      };
      $('#libDetail').scrollIntoView({ behavior: 'smooth' });
    } catch (e) {
      // 部署传播期 / 网络抖动 / 后端 500 返回 HTML → res.json() 在此抛出
      if (myToken !== castToken) return;   // 已切到另一条，不覆盖新详情
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
    if (el) el.onkeydown = function (e) { if (e.key === 'Enter' && !e.isComposing) castByName(); };
  });

  // ---------- 按分享链接还原盘面 ----------
  // 一律进补录模式：现场模式会在首次摇卦时把占时锁到「此刻」，从而覆盖链接里的占时。
  // 还原走 dateOfWall（挂 __wall 锚点），与 fourPillars 的取时口径同源——
  // 若按 epoch 毫秒反解，UTC+8 以外的人会读出不同年月柱。
  function restoreFromShare() {
    if (!HAS_SHARE) return false;
    let code = '';
    try { code = new URLSearchParams(location.search).get('s') || ''; } catch (e) { return false; }
    if (!code) return false;
    const hint = $('#shareHint');
    const d = C.decodeCast(code);
    if (!d.ok) {
      if (hint) hint.innerHTML = '<span class="warn">分享参数无法解析（' + esc(d.reason) + '），已按空白起卦。</span>';
      return false;
    }
    timeMode = 'backfill';
    timeLocked = false;
    lockedDate = null;
    selectedDate = C.dateOfWall(d.wall);
    records = d.vals.map(function (v) {
      const coins = coinsFromVal(v);
      return {
        coins: coins,
        backs: coins.filter(function (c) { return c === '背'; }).length,
        val: v, mode: 'share'
      };
    });
    resetTossState();
    // 末爻置为「已落」以待呈现：否则 renderTossHint 会落到「手动录入 · 后果自负」
    // 那条分支，与「盘面由链接还原」的事实不符。
    const lastRec = records[records.length - 1];
    if (lastRec) revealed = { coins: lastRec.coins.slice(), val: lastRec.val };
    if (d.use) {
      const sel = $('#useSelect');
      sel.value = (d.use === '__custom__' && !d.question) ? '' : d.use;
      const uc = $('#useCustom');
      if (d.use === '__custom__' && d.question && uc) { uc.value = d.question; uc.hidden = false; }
    }
    renderTime(); renderCoins(); renderTossHint(); renderStack();
    computePan();
    if (hint) {
      hint.innerHTML = '已按分享链接还原盘面（' + esc(pan ? pan.benName : '') +
        '）· 断语不在链接里，需重新断卦。';
    }
    return true;
  }

  renderModelChips();
  loadModels();
  renderLoginBtn();
  renderTime();
  renderCoins();
  renderTossHint();
  renderStack();
  restoreFromShare();
})();
