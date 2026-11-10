/* ============================================================
 * 画板 (core/board.js)
 *
 * 纯前端 canvas：画笔 / 橡皮 / 颜色 / 粗细 / 撤销 / 清空 / 存 PNG / 复制图片 /
 * 插入底图（把卦象截图贴上来圈点）。只在「本机模式」挂载——线上部署不必带这块。
 *
 * 打开方式是工具栏第 5 个按钮（见 core/toolbar.js），面板收起不清空画面：
 * 画到一半切去看卦，回来还在。
 * ============================================================ */
(function (root) {
  'use strict';
  const W = root;
  if (!W.LY_LOCAL_MODE) return;

  const COLORS = [
    { c: '#33302a', n: '墨' },
    { c: '#b3261e', n: '朱' },
    { c: '#9a7b3f', n: '金' },
    { c: '#3d7a4f', n: '绿' },
    { c: '#2b5f9e', n: '蓝' }
  ];
  const MAX_UNDO = 20;

  const st = { tool: 'pen', color: '#b3261e', width: 3, drawing: false, undo: [] };

  function build() {
    if (document.getElementById('boardCard')) return;
    const anchor = document.getElementById('gujiCard') || document.getElementById('panCard');
    const sec = document.createElement('section');
    sec.className = 'card';
    sec.id = 'boardCard';
    sec.innerHTML =
      '<h2>画板</h2>' +
      '<div class="bd-bar">' +
      '<span class="bd-seg">' +
      '<button class="bd-tool on" data-tool="pen">画笔</button>' +
      '<button class="bd-tool" data-tool="eraser">橡皮</button>' +
      '</span>' +
      '<span class="bd-colors">' +
      COLORS.map(function (o, i) {
        return '<button class="bd-color' + (i === 1 ? ' on' : '') + '" data-c="' + o.c + '" title="' + o.n + '" style="background:' + o.c + '"></button>';
      }).join('') +
      '</span>' +
      '<label class="bd-width">粗细<input id="bdWidth" type="range" min="1" max="16" value="3"><b id="bdWidthVal">3</b></label>' +
      '<span class="bd-acts">' +
      '<button class="btn ghost" id="bdUndo">撤销</button>' +
      '<button class="btn ghost" id="bdClear">清空</button>' +
      '<button class="btn ghost" id="bdImage">插入图片</button>' +
      '<button class="btn ghost" id="bdCopy">复制图片</button>' +
      '<button class="btn" id="bdSave">存 PNG</button>' +
      '</span>' +
      '</div>' +
      '<div class="bd-wrap"><canvas id="bdCanvas"></canvas></div>' +
      '<div class="muted" id="bdTip" style="margin-top:6px;font-size:12px">' +
      '在本程序里画图、圈点；画板内容切走再回来还在，但关掉程序即清空 —— 要留就「存 PNG」。</div>';
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(sec, anchor);
    else document.querySelector('.wrap').appendChild(sec);

    const cv = sec.querySelector('#bdCanvas');
    const ctx = cv.getContext('2d');
    let dpr = 1;

    function fit() {
      const wrap = sec.querySelector('.bd-wrap');
      const w = Math.max(280, Math.floor(wrap.clientWidth));
      const h = Math.max(240, Math.min(620, Math.floor(w * 0.62)));
      const img = (cv.width && cv.height) ? ctx.getImageData(0, 0, cv.width, cv.height) : null;
      dpr = Math.min(2, W.devicePixelRatio || 1);
      cv.width = Math.floor(w * dpr);
      cv.height = Math.floor(h * dpr);
      cv.style.width = w + 'px';
      cv.style.height = h + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#fffdf8';
      ctx.fillRect(0, 0, w, h);
      if (img) {                                  // 缩放窗口时尽量不丢画面
        try {
          const tmp = document.createElement('canvas');
          tmp.width = img.width; tmp.height = img.height;
          tmp.getContext('2d').putImageData(img, 0, 0);
          ctx.drawImage(tmp, 0, 0, w, h);
        } catch (e) { }
      }
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      st.undo = [];
    }

    function snapshot() {
      try {
        st.undo.push(ctx.getImageData(0, 0, cv.width, cv.height));
        if (st.undo.length > MAX_UNDO) st.undo.shift();
      } catch (e) { }
    }

    function pos(e) {
      const r = cv.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    cv.addEventListener('pointerdown', function (e) {
      cv.setPointerCapture(e.pointerId);
      snapshot();
      st.drawing = true;
      const p = pos(e);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineWidth = st.width;
      ctx.strokeStyle = (st.tool === 'eraser') ? '#fffdf8' : st.color;
      // 点一下也要留痕
      ctx.lineTo(p.x + 0.01, p.y + 0.01);
      ctx.stroke();
    });
    cv.addEventListener('pointermove', function (e) {
      if (!st.drawing) return;
      const p = pos(e);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    });
    cv.addEventListener('pointerup', function () { st.drawing = false; });
    cv.addEventListener('pointercancel', function () { st.drawing = false; });

    sec.querySelectorAll('.bd-tool').forEach(function (b) {
      b.onclick = function () {
        st.tool = b.getAttribute('data-tool');
        sec.querySelectorAll('.bd-tool').forEach(function (x) { x.classList.toggle('on', x === b); });
      };
    });
    sec.querySelectorAll('.bd-color').forEach(function (b) {
      b.onclick = function () {
        st.color = b.getAttribute('data-c');
        sec.querySelectorAll('.bd-color').forEach(function (x) { x.classList.toggle('on', x === b); });
        if (st.tool === 'eraser') {
          st.tool = 'pen';
          sec.querySelectorAll('.bd-tool').forEach(function (x) { x.classList.toggle('on', x.getAttribute('data-tool') === 'pen'); });
        }
      };
    });
    const wEl = sec.querySelector('#bdWidth'), wVal = sec.querySelector('#bdWidthVal');
    wEl.oninput = function () { st.width = parseInt(this.value, 10); wVal.textContent = this.value; };

    sec.querySelector('#bdUndo').onclick = function () {
      const img = st.undo.pop();
      if (img) ctx.putImageData(img, 0, 0);
    };
    sec.querySelector('#bdClear').onclick = function () {
      snapshot();
      const w = cv.width / dpr, h = cv.height / dpr;
      ctx.fillStyle = '#fffdf8';
      ctx.fillRect(0, 0, w, h);
    };
    sec.querySelector('#bdImage').onclick = function () {
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = 'image/*';
      inp.onchange = function () {
        const f = inp.files && inp.files[0];
        if (!f) return;
        const url = URL.createObjectURL(f);
        const im = new Image();
        im.onload = function () {
          snapshot();
          const w = cv.width / dpr, h = cv.height / dpr;
          const s = Math.min(w / im.width, h / im.height);
          const dw = im.width * s, dh = im.height * s;
          ctx.fillStyle = '#fffdf8'; ctx.fillRect(0, 0, w, h);
          ctx.drawImage(im, (w - dw) / 2, (h - dh) / 2, dw, dh);
          URL.revokeObjectURL(url);
        };
        im.src = url;
      };
      inp.click();
    };

    function tip(msg) { const t = sec.querySelector('#bdTip'); if (t) t.textContent = msg; }

    sec.querySelector('#bdSave').onclick = function () {
      cv.toBlob(function (blob) {
        if (!blob) { tip('导出失败'); return; }
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        const d = new Date(), p2 = function (n) { return (n < 10 ? '0' : '') + n; };
        a.download = '画板-' + d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()) + '-' + p2(d.getHours()) + p2(d.getMinutes()) + '.png';
        document.body.appendChild(a); a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 800);
        tip('已存 PNG（浏览器下载目录）');
      }, 'image/png');
    };
    sec.querySelector('#bdCopy').onclick = function () {
      if (!navigator.clipboard || !W.ClipboardItem) { tip('此环境不支持复制图片，请用「存 PNG」'); return; }
      cv.toBlob(function (blob) {
        if (!blob) return;
        navigator.clipboard.write([new W.ClipboardItem({ 'image/png': blob })])
          .then(function () { tip('已复制到剪贴板'); })
          .catch(function () { tip('复制失败（权限或环境限制），请用「存 PNG」'); });
      }, 'image/png');
    };

    /* 尺寸跟随容器：面板是折叠的，建立时容器宽为 0（先按最小宽度画），
     * 真正展开后容器变宽，必须重新量——否则画布永远是小号。 */
    let curW = 0;
    function maybeFit() {
      const w = sec.querySelector('.bd-wrap').clientWidth;
      if (!w) return;
      if (Math.abs(w - curW) > 40) { curW = w; fit(); }
    }
    const ro = new ResizeObserver(maybeFit);
    ro.observe(sec.querySelector('.bd-wrap'));
    setTimeout(maybeFit, 120);
  }

  const css = document.createElement('style');
  css.textContent =
    '.bd-bar{display:flex;flex-wrap:wrap;align-items:center;gap:10px 14px;margin-bottom:10px}' +
    '.bd-seg{display:inline-flex;border:1px solid var(--line);border-radius:6px;overflow:hidden}' +
    '.bd-tool{font-family:inherit;font-size:14px;padding:6px 14px;border:0;background:#fff;color:var(--ink);cursor:pointer}' +
    '.bd-tool.on{background:var(--cinnabar);color:#fff}' +
    '.bd-colors{display:inline-flex;gap:6px;align-items:center}' +
    '.bd-color{width:22px;height:22px;border-radius:50%;border:2px solid transparent;cursor:pointer}' +
    '.bd-color.on{border-color:var(--ink);box-shadow:0 0 0 2px #fff inset}' +
    '.bd-width{display:inline-flex;align-items:center;gap:6px;font-size:13px;color:var(--ink-light)}' +
    '.bd-width input{width:120px}' +
    '.bd-acts{display:inline-flex;gap:8px;flex-wrap:wrap}' +
    '.bd-acts .btn{font-size:13px;padding:5px 12px}' +
    '.bd-wrap{border:1px solid var(--line);border-radius:8px;background:#fffdf8;overflow:hidden;line-height:0}' +
    '#bdCanvas{touch-action:none;cursor:crosshair;display:block;max-width:100%}';
  document.head.appendChild(css);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
})(typeof window !== 'undefined' ? window : globalThis);
