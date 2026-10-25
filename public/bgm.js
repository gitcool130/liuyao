/* bgm.js — 生成式古琴背景音（纯 Web Audio 合成，零音频文件、零外部依赖）
 *
 * 原理：Karplus-Strong 拨弦物理建模（噪声激励 + 延时反馈低通，音色近似丝弦拨奏），
 * D 宫五声音阶按「固定动机 + 级进变奏」成句，句间留白，卷积混响营造空间感。
 * 默认开启；浏览器自动播放限制下，于页面首次手势时启动。状态存 localStorage(ly_bgm)。
 *
 * 2026-10-25 重做（用户反馈：手机听不到 / 太难听），五条根因逐条对应：
 *   ① **音区**：旧音阶落在 73–247 Hz。手机小喇叭（几毫米振膜）在这个频段几乎
 *      没有有效输出，增益开大也只是让功放空转——这是「手机上没声、电脑上有」的
 *      首要原因。新音阶 D4–B5（293–988 Hz），旋律活动区限在 D4–E5，正落在
 *      手机外放效率最高的区段。
 *   ② **响度**：旧版单音增益 0.05–0.10、总线目标 0.6，叠上 lowpass 后实际很轻。
 *      改为单音 0.18–0.30、总线 0.9，串一颗 DynamicsCompressor 吃掉叠音峰值。
 *   ③ **音色**：旧版总线 lowpass 1500 Hz——基频被削、只剩余音糊在一起，这是
 *      「难听」的主因之一。改 6500 Hz，并加 100 Hz highpass 去掉听不见却
 *      占动态余量的低频轰鸣。
 *   ④ **旋律**：旧版是纯随机漫步（相邻音程任意、每句 3–6 音、句后留白 5–10 s），
 *      耳朵抓不到动机，听感就是零散拨弦。改为固定动机 + 五声音阶级进变奏，
 *      4 拍成句、句间留白 2.6–4.2 s，另加极轻的低音持续音与起音上滑（按音）。
 *   ⑤ **移动端起播**：旧版只挂 pointerdown，且 kick 一触发就摘监听。手机首次
 *      触摸常落在滚动上，一旦那次没 resume 成功就再没机会起播。改为
 *      pointerdown/touchstart/click/keydown 四路 + 静音 buffer 预热 +
 *      resume() 后回查 ctx.state，未 running 就重新挂监听。
 */
(function () {
  const btn = document.getElementById('bgmBtn');
  if (!btn || !(window.AudioContext || window.webkitAudioContext)) { if (btn) btn.hidden = true; return; }

  let ctx = null, bus = null, master = null;
  let playing = false, timer = null;
  // 隐私模式 / 配额满时 localStorage 会抛异常，与 app.js 的 lsSet/lsRemove
  // 同口径做容错：读失败用默认值（开启），写失败静默（2026-10-21 审计修正）。
  let enabled = true;
  try { enabled = localStorage.getItem('ly_bgm') !== 'off'; } catch (e) { /* 用默认值 */ }

  // D 宫五声音阶（D E F# A B），从 D4 起跨两个八度。序号即级数，0=D4 … 9=B5。
  // 取这个音区是为了手机外放：300 Hz 以下小喇叭基本放不出来（见文件头 ①）。
  const SCALE = [
    293.66, 329.63, 369.99, 440.00, 493.88,
    587.33, 659.26, 739.99, 880.00, 987.77
  ];
  const TOP = 6;        // 旋律上限 E5：再高在小喇叭上会发尖
  const BEAT = 1.05;    // 一拍约 0.57 s（≈57 BPM）；古琴的「散」靠留白，不靠拖速度

  // 固定动机（级数偏移）。随机漫步听起来零散，动机重复 + 变奏才成「曲」。
  const MOTIFS = [
    [0, 1, 2, 1],
    [0, 2, 3, 2],
    [2, 3, 4, 3],
    [0, 2, 1, 3],
    [3, 2, 1, 0],
    [1, 2, 3, 4, 3],
    [0, 1, 2, 3]
  ];

  function impulse(dur, decay) {
    const sr = ctx.sampleRate, len = Math.round(sr * dur);
    const buf = ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
    }
    return buf;
  }

  function initCtx() {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0;
    // 压缩器放在总线上：单音增益调大后叠音会顶到 0 dBFS，靠它兜住峰值，
    // 听感上还顺带把长音托起来（弱音更清楚），比单纯拉大 master 好。
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 12;
    comp.ratio.value = 3.5;
    comp.attack.value = 0.004;
    comp.release.value = 0.30;
    master.connect(comp);
    comp.connect(ctx.destination);

    bus = ctx.createGain();
    const dry = ctx.createGain(); dry.gain.value = 0.75;
    const conv = ctx.createConvolver(); conv.buffer = impulse(2.4, 2.6);
    const wet = ctx.createGain(); wet.gain.value = 0.40;
    // 总线 EQ：先掐掉 100 Hz 以下的轰鸣（手机放不出、耳机里只是糊），
    // 再给足高频——旧版 1500 Hz 的 lowpass 是把琴音压成闷响的主因。
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 100;
    hp.Q.value = 0.7;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 6500;
    tone.Q.value = 0.4;
    bus.connect(hp);
    hp.connect(tone);
    tone.connect(dry); dry.connect(master);
    tone.connect(conv); conv.connect(wet); wet.connect(master);
  }

  // Karplus-Strong 拨弦：生成一整个音符的缓冲
  function pluckBuffer(freq, dur, bright) {
    const sr = ctx.sampleRate;
    const N = Math.max(2, Math.round(sr / freq));
    const len = Math.round(sr * dur);
    const buf = ctx.createBuffer(1, len, sr);
    const out = buf.getChannelData(0);
    const line = new Float32Array(N);
    for (let i = 0; i < N; i++) line[i] = Math.random() * 2 - 1;
    // 激励噪声多轮平滑：去掉起音的"扎"，拨弦触感更钝、更棉
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 1; i < N; i++) line[i] = (line[i] + line[i - 1]) * 0.5;
    }
    // 衰减系数随频率变化：越低越绵长，越高越收敛（高频不刺耳）。
    // 音区已上移到 293–988 Hz，映射区间同步改成 280–980。
    const t = Math.min(1, Math.max(0, (freq - 280) / 700));
    const damp = 0.9985 - t * 0.005 + bright * 0.0008;
    let idx = 0;
    for (let i = 0; i < len; i++) {
      const cur = line[idx];
      const nxt = line[(idx + 1) % N];
      line[idx] = damp * (cur * (0.5 - bright * 0.1) + nxt * (0.5 + bright * 0.1));
      out[i] = cur;
      idx = (idx + 1) % N;
    }
    return buf;
  }

  // 活跃音源登记表：stop() 需要真正停掉它们，否则已排程音符会在 gain 回升后
  // 「幽灵般」重新变得可闻（见 stop() 注释）。
  const liveSrcs = new Set();

  function pluck(freq, when, dur, gain, bright, slur) {
    const src = ctx.createBufferSource();
    src.buffer = pluckBuffer(freq, dur, bright);
    const g = ctx.createGain();
    // 起音柔化（10ms 淡入）避免爆音；**同时补 release 淡出**——
    // Karplus-Strong 低频音衰减极慢（73/82Hz 的 T60 约 20s+），而缓冲只有
    // 2.6–4.5s，旧版只做起音包络，末尾以显著振幅戛然而止产生阶跃 discontinuity，
    // 安静环境下可闻为轻微「嗒」声（实测最低两个音级末尾 50ms RMS 达 6.4–11.4%）。
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(gain, when + 0.010);
    g.gain.setValueAtTime(gain, when + Math.max(0.05, dur - 0.45));
    g.gain.linearRampToValueAtTime(0, when + dur);
    // 起音上滑（「按音」味）：起手略低，几十毫秒内滑到本位音。
    // 只在句首音用——每个音都滑会显得油滑，古琴是「偶尔一按」。
    if (slur) {
      try {
        src.playbackRate.setValueAtTime(0.94, when);
        src.playbackRate.linearRampToValueAtTime(1, when + slur);
      } catch (e) { /* 个别实现不支持自动化：平出即可 */ }
    }
    src.connect(g); g.connect(bus);
    liveSrcs.add(src);
    src.onended = function () {
      liveSrcs.delete(src);
      try { g.disconnect(); } catch (e) { /* 已断开则忽略 */ }
    };
    src.start(when);
  }

  function rand(a, b) { return a + Math.random() * (b - a); }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  // 一个乐句：固定动机成句，音区压在 D4–E5，句后留白 2.6–4.2 秒
  function phrase() {
    if (!playing) return;
    // 后台不排句：visibilitychange 已 suspend，ctx.currentTime 冻结，
    // 继续每 1.2s 自旋一次只是空转（旧版靠下面那行 state 判断自旋自保，仍会留下轮询链）。
    // 恢复可见时由 visibilitychange 重新起句，故此处直接断链、置空 timer。
    if (document.hidden) { timer = null; return; }
    // 后台挂起期间 currentTime 冻结，避免在冻结时间上叠加调度，待恢复后再排句
    if (ctx.state !== 'running') { timer = setTimeout(phrase, 1200); return; }

    const motif = pick(MOTIFS);
    const base = Math.floor(Math.random() * 2);      // 动机整体落位：D4 或 E4 起
    let t = ctx.currentTime + 0.06;

    for (let i = 0; i < motif.length; i++) {
      const deg = Math.max(0, Math.min(TOP, base + motif[i]));
      const f = SCALE[deg];
      // 句首音一半概率带起音上滑；低音区余韵更长（同一条弦，长则厚）
      const slur = (i === 0 && Math.random() < 0.55) ? rand(0.08, 0.16) : 0;
      const dur = rand(2.2, 3.2) * (deg <= 2 ? 1.15 : 1);
      const gain = rand(0.18, 0.28) * (i === 0 ? 1.1 : 1);
      pluck(f, t, dur, gain, rand(-0.35, 0.35), slur);
      // 10% 泛音（更轻，似有似无）
      if (Math.random() < 0.10) pluck(f * 2, t + rand(0.02, 0.05), 1.2, gain * 0.18, -0.1, 0);
      // 12% 双音（下方四度衬一音，似按音应和）
      if (Math.random() < 0.12 && deg >= 3) pluck(SCALE[deg - 3], t + 0.03, dur * 0.8, gain * 0.42, -0.5, 0);
      t += pick([1, 1, 1.5, 0.75, 0.5]) * BEAT * rand(0.92, 1.08);
    }

    // 低音持续音（35% 概率，很轻）：耳机里补一层底盘；外放几乎听不到，但也不会变糊
    if (Math.random() < 0.35) pluck(146.83, ctx.currentTime + 0.02, rand(5, 7), 0.10, -0.8, 0);

    timer = setTimeout(phrase, (t - ctx.currentTime) * 1000 + rand(2600, 4200));
  }

  // 预热：iOS/Safari 必须在手势里创建并 resume 上下文；部分 webview（微信、QQ 内置）
  // 还要求真的播出过一帧静音，之后才允许出声。这条 1 帧静音 buffer 就是那个「真的播」。
  function prime() {
    if (!ctx) initCtx();
    let p = null;
    try { p = ctx.resume ? ctx.resume() : null; } catch (e) { p = null; }
    try {
      const b = ctx.createBuffer(1, 1, 22050);
      const s = ctx.createBufferSource();
      s.buffer = b;
      s.connect(ctx.destination);
      s.start(0);
    } catch (e) { /* 预热失败不致命 */ }
    return p || Promise.resolve();
  }

  // 返回 Promise<boolean>：是否真的进入了播放态。
  // 移动端 resume() 可能被拒（页面还没被认定为「有用户手势」），
  // 必须在 resolve 之后回查 ctx.state，不能假定调用即成功。
  // starting 兼作并发闸：手机上 touchstart 与 pointerdown 会同帧先后触发，
  // 若两次都跑进来，会排两条相对的乐句链，听感是音符成对重叠。
  let starting = null;
  function start() {
    if (starting) return starting;
    // initCtx / resume / 静音预热必须在**手势调用栈里同步发起**：iOS 只认
    // 「事件处理器内创建并 resume」的上下文，把它们塞进 then() 的微任务里
    // 在部分版本会被判成非用户手势，之后一直 suspended（表现为按钮点了没声）。
    if (!ctx) initCtx();
    const p = prime();
    starting = Promise.resolve(p).then(function () {
      if (ctx.state !== 'running') {
        playing = false;
        btn.classList.remove('on');
        btn.title = '琴音 · 点击播放（若无声，请检查手机静音键与媒体音量）';
        return false;
      }
      playing = true;
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setValueAtTime(master.gain.value, ctx.currentTime);
      master.gain.linearRampToValueAtTime(0.9, ctx.currentTime + 2.5);
      clearTimeout(timer);
      phrase();
      btn.classList.add('on');
      btn.title = '琴音 · 点击静音';
      return true;
    }).then(function (ok) { starting = null; return ok; },
      function () { starting = null; return false; });
    return starting;
  }

  function stop() {
    playing = false;
    clearTimeout(timer);
    // 必须真正停掉已排程的音源：phrase() 一次性把整句音符排到 AudioContext
    // 绝对时间线（最末音起点 + dur 最长约 13s），旧版只把 master gain 在
    // 1.5s 内拉低而不调 src.stop()——停止后 13s 内再次播放时 gain 回升，
    // 上一句已排程音符会按原绝对时间点重新变得可闻，听到上一乐句片段
    // 「幽灵般」插进来。
    liveSrcs.forEach(function (src) {
      try { src.stop(); } catch (e) { /* 已结束则忽略 */ }
      try { src.disconnect(); } catch (e) { /* 已断开则忽略 */ }
    });
    liveSrcs.clear();
    if (ctx) {
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setValueAtTime(master.gain.value, ctx.currentTime);
      master.gain.linearRampToValueAtTime(0, ctx.currentTime + 1.2);
    }
    btn.classList.remove('on');
    btn.title = '琴音 · 点击播放';
  }

  btn.onclick = function () {
    enabled = !enabled;
    try { localStorage.setItem('ly_bgm', enabled ? 'on' : 'off'); } catch (e) { /* 隐私模式等：忽略持久化 */ }
    if (enabled) start(); else stop();
  };

  // 浏览器禁止自动播放有声内容：默认开启时，等首次手势再启动。
  // 四路手势并用：手机上「第一次触摸」常被滚动/长按吃掉，只挂一路会永久错过。
  const GESTURES = ['pointerdown', 'touchstart', 'click', 'keydown'];
  let armed = false;
  function disarm() {
    if (!armed) return;
    armed = false;
    GESTURES.forEach(function (t) { document.removeEventListener(t, kick, true); });
  }
  function arm() {
    if (armed) return;
    armed = true;
    GESTURES.forEach(function (t) { document.addEventListener(t, kick, true); });
  }
  function kick(e) {
    // 手势启动必须让位于按钮自身的显式切换：pointerdown 先于 click 且冒泡到
    // document，若访客第一个交互就是点琴按钮，kick 的 start() 会与随后
    // btn.onclick 的 enabled=!enabled → stop() 在同一帧内抵消，
    // 并把 localStorage 永久写成 'off'（用户感知：按钮点了没反应）。
    if (e && e.target && e.target.closest && e.target.closest('#bgmBtn')) return;
    if (!enabled || playing || starting) { disarm(); return; }
    Promise.resolve(start()).then(function (ok) {
      // 没起来（常见：手势被浏览器判为非激活、或 webview 首次触摸受限）
      // 就重新挂回监听，别像旧版那样一次失败后再无机会。
      if (ok) disarm(); else arm();
    });
  }
  if (enabled) arm();

  // 切后台时暂停，回前台恢复。
  // 必须同时撤掉 pending 的乐句定时器，否则 phrase() 在 ctx 非 running 时每 1.2s
  // 自旋重排，后台挂着就是一条纯空转的轮询链（浏览器虽会把后台定时器节流到分钟级，
  // 但这里的设计意图是"暂停"，不是"低频轮询"）。
  // 恢复时不直接调 phrase()：resume() 是异步的，此刻 state 仍可能是 'suspended'，
  // 直接调会白走一次 1.2s 自旋；延后一拍再起句，并先清掉可能残留的定时器防双链。
  document.addEventListener('visibilitychange', function () {
    if (!ctx) return;
    if (document.hidden) {
      if (!playing) return;
      clearTimeout(timer); timer = null;
      ctx.suspend();
      return;
    }
    if (!playing) return;
    ctx.resume();
    clearTimeout(timer);
    timer = setTimeout(phrase, 1200);
  });
})();
