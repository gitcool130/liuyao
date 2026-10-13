/* bgm.js — 生成式古琴背景音（纯 Web Audio 合成，零音频文件、零外部依赖）
 *
 * 原理：Karplus-Strong 拨弦物理建模（噪声激励 + 延时反馈低通，音色近似丝弦拨奏），
 * 五声音阶（D 宫，羽调倾向）随机漫步成句，乐句间留白，卷积混响营造空间感。
 * 默认开启；浏览器自动播放限制下，于页面首次点击/触摸时启动。状态存 localStorage(ly_bgm)。
 */
(function () {
  const btn = document.getElementById('bgmBtn');
  if (!btn || !(window.AudioContext || window.webkitAudioContext)) { if (btn) btn.hidden = true; return; }

  let ctx = null, bus = null, master = null;
  let playing = false, timer = null;
  let enabled = localStorage.getItem('ly_bgm') !== 'off';

  // D 宫五声音阶：D E F# A B（羽调色彩），跨两个八度余
  const SCALE = [
    73.42, 82.41, 92.50, 110.00, 123.47,
    146.83, 164.81, 185.00, 220.00, 246.94,
    293.66, 329.63, 370.00, 440.00, 493.88
  ];
  let pos = 8; // 从 A3 附近起句

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
    master.connect(ctx.destination);

    bus = ctx.createGain();
    const dry = ctx.createGain(); dry.gain.value = 0.6;
    const conv = ctx.createConvolver(); conv.buffer = impulse(2.8, 3.2);
    const wet = ctx.createGain(); wet.gain.value = 0.55;
    // 总线低通：压掉高频毛刺，音色更温润
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 1500;
    tone.Q.value = 0.4;
    bus.connect(tone);
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
    // 衰减系数随频率变化：越低越绵长，越高越收敛（高频不刺耳）
    const t = Math.min(1, Math.max(0, (freq - 70) / 430)); // 0=最低音 1=最高音
    const damp = 0.997 - t * 0.007 + bright * 0.001;
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

  function pluck(freq, when, dur, gain, bright) {
    const src = ctx.createBufferSource();
    src.buffer = pluckBuffer(freq, dur, bright);
    const g = ctx.createGain();
    // 起音柔化（12ms 淡入）避免爆音；**同时补 release 淡出**——
    // Karplus-Strong 低频音衰减极慢（73/82Hz 的 T60 约 20s+），而缓冲只有
    // 2.6–4.5s，旧版只做起音包络，末尾以显著振幅戛然而止产生阶跃 discontinuity，
    // 安静环境下可闻为轻微「嗒」声（实测最低两个音级末尾 50ms RMS 达 6.4–11.4%）。
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(gain, when + 0.012);
    g.gain.setValueAtTime(gain, when + dur - 0.35);
    g.gain.linearRampToValueAtTime(0, when + dur);
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

  // 一个乐句：3~6 音，级进为主；音区压在中低音域；句后留白 5~10 秒
  function phrase() {
    if (!playing) return;
    // 后台挂起期间 currentTime 冻结，避免在冻结时间上叠加调度，待恢复后再排句
    if (ctx.state !== 'running') { timer = setTimeout(phrase, 1200); return; }
    const notes = 3 + Math.floor(Math.random() * 4);
    let t = ctx.currentTime + 0.05;
    for (let n = 0; n < notes; n++) {
      // 随机漫步：小步为主，略偏下行（低音更沉稳）
      const step = pick([-3, -2, -2, -1, -1, -1, -1, 0, 1, 1, 2]);
      pos = Math.max(1, Math.min(SCALE.length - 5, pos + step)); // 避开最高三音
      const f = SCALE[pos];
      const dur = rand(2.6, 4.5);
      const gain = rand(0.05, 0.10);
      const bright = rand(-0.7, 0.3); // 整体偏暗
      pluck(f, t, dur, gain, bright);
      // 8% 泛音（更轻，似有似无）
      if (Math.random() < 0.08) pluck(f * 2, t + rand(0.02, 0.06), 1.4, gain * 0.22, -0.2);
      // 10% 双音（低声部衬一音，似按音应和）
      if (Math.random() < 0.10 && pos > 3) pluck(SCALE[pos - 3], t + 0.02, dur * 0.9, gain * 0.5, -0.6);
      t += rand(0.5, 1.7);
    }
    timer = setTimeout(phrase, (t - ctx.currentTime) * 1000 + rand(5000, 10000));
  }

  function start() {
    if (!ctx) initCtx();
    if (ctx.state === 'suspended') ctx.resume();
    playing = true;
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.setValueAtTime(master.gain.value, ctx.currentTime);
    master.gain.linearRampToValueAtTime(0.6, ctx.currentTime + 3);
    clearTimeout(timer);
    phrase();
    btn.classList.add('on');
    btn.title = '琴音 · 点击静音';
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
      master.gain.linearRampToValueAtTime(0, ctx.currentTime + 1.5);
    }
    btn.classList.remove('on');
    btn.title = '琴音 · 点击播放';
  }

  btn.onclick = function () {
    enabled = !enabled;
    localStorage.setItem('ly_bgm', enabled ? 'on' : 'off');
    if (enabled) start(); else stop();
  };

  // 浏览器禁止自动播放有声内容：默认开启时，等首次手势再启动
  if (enabled) {
    const kick = function (e) {
      // 手势启动必须让位于按钮自身的显式切换：pointerdown 先于 click 且冒泡到
      // document，若访客第一个交互就是点琴按钮，kick 的 start() 会与随后
      // btn.onclick 的 enabled=!enabled → stop() 在同一帧内抵消，
      // 并把 localStorage 永久写成 'off'（用户感知：按钮点了没反应）。
      if (e && e.target && e.target.closest && e.target.closest('#bgmBtn')) return;
      document.removeEventListener('pointerdown', kick);
      if (enabled && !playing) start();
    };
    document.addEventListener('pointerdown', kick);
  }

  // 切后台时暂停，回前台恢复
  document.addEventListener('visibilitychange', function () {
    if (!ctx) return;
    if (document.hidden && playing) ctx.suspend();
    else if (!document.hidden && playing) ctx.resume();
  });
})();
