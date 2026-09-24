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

  function pluck(freq, when, dur, gain, bright) {
    const src = ctx.createBufferSource();
    src.buffer = pluckBuffer(freq, dur, bright);
    const g = ctx.createGain();
    // 轻微起音柔化，避免爆音
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(gain, when + 0.012);
    src.connect(g); g.connect(bus);
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
    const kick = function () {
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
