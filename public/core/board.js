/* ============================================================
 * 画板 (core/board.js)
 *
 * 工具照参考图铺全：鼠标 / 画笔 / 文字 / 矩形 / 圆形 / 画线 / 圆弧形 / 箭头 / 橡皮擦，
 * 8 色 + 实心色块 + 外框(描边↔填充) + 粗细 + 后退/前进/清空 + 截屏批注 + 收起。
 *
 * 实现要点：
 *  · 形状类工具拖动时用「起点快照 + 每帧重画」做预览，松手才落定，
 *    不会在画布上留下毛刺，也不需要第二块 overlay canvas。
 *  · 撤销用双栈：back 存历史、fwd 存被撤销的，前进才能还原。
 *  · 截屏批注：Win+Shift+S 截图后 Ctrl+V 直接贴进来（按钮里也会读剪贴板）；
 *    另有「载入卦象」把当前盘面按古籍版式画成底图、「插入图片」贴本地图片。
 *  · 只在「本机模式」挂载（线上部署不带这块）。
 * ============================================================ */
(function (root) {
  'use strict';
  const W = root;
  if (!W.LY_LOCAL_MODE) return;

  const PAPER = '#fffdf8';
  const COLORS = ['#c62828', '#f29900', '#f9c21b', '#34a853', '#00b09a',
    '#1a73e8', '#8e24aa', '#9aa0a6'];
  const TOOLS = [
    { k: 'pointer', n: '鼠标' }, { k: 'pen', n: '画笔' }, { k: 'text', n: '文字' },
    { k: 'rect', n: '矩形' }, { k: 'circle', n: '圆形' }, { k: 'line', n: '画线' },
    { k: 'arc', n: '圆弧形' }, { k: 'arrow', n: '箭头' }, { k: 'eraser', n: '橡皮擦' }
  ];
  const MAX_UNDO = 30;

  const st = {
    tool: 'pen', color: COLORS[0], width: 4, fill: false,
    back: [], fwd: [], drawing: false, start: null, base: null
  };

  function build() {
    if (document.getElementById('boardCard')) return;
    const anchor = document.getElementById('gujiCard') || document.getElementById('panCard');
    const sec = document.createElement('section');
    sec.className = 'card';
    sec.id = 'boardCard';
    sec.innerHTML =
      '<div class="bd-bar">' +
      '<span class="bd-tools">' +
      TOOLS.map(function (t) {
        return '<button class="bd-tool' + (t.k === 'pen' ? ' on' : '') + '" data-tool="' + t.k + '">' + t.n + '</button>';
      }).join('') +
      '</span>' +
      '<span class="bd-sep"></span>' +
      '<span class="bd-colors">' +
      COLORS.map(function (c, i) {
        return '<button class="bd-color' + (i === 0 ? ' on' : '') + '" data-c="' + c + '" style="background:' + c + '"></button>';
      }).join('') +
      '<button class="bd-color bd-fillchip" title="实心填充" style="background:' + COLORS[0] + '"></button>' +
      '</span>' +
      '<button class="bd-frame" id="bdFrame" title="当前：描边。点一下改填充">外框</button>' +
      '<span class="bd-sep"></span>' +
      '<label class="bd-width">粗细<input id="bdWidth" type="range" min="1" max="24" value="4"><b id="bdWidthVal">4</b></label>' +
      '<span class="bd-sep"></span>' +
      '<button class="bd-mini" id="bdUndo" title="后退（Ctrl+Z）">后退</button>' +
      '<button class="bd-mini" id="bdRedo" title="前进（Ctrl+Y）">前进</button>' +
      '<button class="bd-mini" id="bdClear" title="只清笔迹，保留卦象底图">清空</button>' +
      '<button class="bd-mini bd-red" id="bdReset" title="笔迹与卦象底图一起清掉">重置</button>' +
      '</div>' +
      '<div class="bd-bar bd-bar2">' +
      '<button class="bd-mini bd-green" id="bdShot" title="Win+Shift+S 截图后点这里（或直接 Ctrl+V）">截屏批注</button>' +
      '<button class="bd-mini bd-green" id="bdPan">载入卦象</button>' +
      '<button class="bd-mini" id="bdImage">插入图片</button>' +
      '<button class="bd-mini" id="bdSave" title="把画布（含底图与批注）存成 PNG">截图</button>' +
      '<button class="bd-mini" id="bdCollapse">收起</button>' +
      '<span class="muted" id="bdTip" style="margin-left:6px;font-size:12px"></span>' +
      '</div>' +
      '<div class="bd-textrow">' +
      '<textarea id="bdPanText" placeholder="把卦象文本粘到这里（古籍版式、六爻助手复制出来的都行），再点右边「按文本画出」。也可用来改卦再画。"></textarea>' +
      '<span class="bd-textbtns">' +
      '<button class="bd-mini bd-green" id="bdDrawText">按文本画出</button>' +
      '<button class="bd-mini" id="bdCopyText" title="把文本框内容复制走">复制文本</button>' +
      '</span></div>' +
      '<div class="bd-wrap"><canvas id="bdCanvas"></canvas></div>';
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(sec, anchor);
    else document.querySelector('.wrap').appendChild(sec);

    const cv = sec.querySelector('#bdCanvas');
    const ctx = cv.getContext('2d');
    let dpr = 1;

    const tip = function (m) { const t = sec.querySelector('#bdTip'); if (t) t.textContent = m || ''; };
    function blank(w, h) { ctx.fillStyle = PAPER; ctx.fillRect(0, 0, w, h); }

    function fit() {
      const wrap = sec.querySelector('.bd-wrap');
      const w = Math.max(280, Math.floor(wrap.clientWidth));
      const h = Math.max(260, Math.min(640, Math.floor(w * 0.6)));
      const keep = (cv.width && cv.height) ? ctx.getImageData(0, 0, cv.width, cv.height) : null;
      dpr = Math.min(2, W.devicePixelRatio || 1);
      cv.width = Math.floor(w * dpr);
      cv.height = Math.floor(h * dpr);
      cv.style.width = w + 'px';
      cv.style.height = h + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      blank(w, h);
      if (keep) {
        try {
          const tmp = document.createElement('canvas');
          tmp.width = keep.width; tmp.height = keep.height;
          tmp.getContext('2d').putImageData(keep, 0, 0);
          ctx.drawImage(tmp, 0, 0, w, h);
        } catch (e) { }
      }
      st.back = []; st.fwd = [];
    }

    function snap() {
      try {
        st.back.push(ctx.getImageData(0, 0, cv.width, cv.height));
        if (st.back.length > MAX_UNDO) st.back.shift();
        st.fwd.length = 0;
      } catch (e) { }
    }

    function pos(e) {
      const r = cv.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    function drawArrow(a, b, w, color) {
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len, uy = dy / len;
      const head = Math.max(10, w * 3.2);
      const bx = b.x - ux * head * 0.9, by = b.y - uy * head * 0.9;
      ctx.strokeStyle = color; ctx.lineWidth = w;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(bx, by); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x - ux * head - uy * head * 0.55, b.y - uy * head + ux * head * 0.55);
      ctx.lineTo(b.x - ux * head + uy * head * 0.55, b.y - uy * head - ux * head * 0.55);
      ctx.closePath();
      ctx.fillStyle = color; ctx.fill();
    }

    function drawShape(a, b) {
      const w = st.width, c = st.color;
      ctx.strokeStyle = c; ctx.fillStyle = c; ctx.lineWidth = w;
      const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
      const ww = Math.abs(b.x - a.x), hh = Math.abs(b.y - a.y);
      if (st.tool === 'rect') {
        if (st.fill) ctx.fillRect(x, y, ww, hh); else ctx.strokeRect(x, y, ww, hh);
      } else if (st.tool === 'circle') {
        ctx.beginPath();
        ctx.ellipse(x + ww / 2, y + hh / 2, Math.max(1, ww / 2), Math.max(1, hh / 2), 0, 0, Math.PI * 2);
        if (st.fill) ctx.fill(); else ctx.stroke();
      } else if (st.tool === 'line') {
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      } else if (st.tool === 'arc') {
        /* 圆弧：起点为圆心、拖拽距离为半径。默认画右半圆；往左拖画左半圆，
         * 往上/下拖画上半/下半圆——这样左右都能用，不再只会「向下」。 */
        const dx = b.x - a.x, dy = b.y - a.y;
        const r = Math.hypot(dx, dy) || 1;
        let s0 = -Math.PI / 2;
        if (Math.abs(dx) >= Math.abs(dy)) s0 = dx >= 0 ? -Math.PI / 2 : Math.PI / 2;   // 右 / 左
        else s0 = dy >= 0 ? 0 : Math.PI;                                                // 下 / 上
        ctx.beginPath();
        ctx.arc(a.x, a.y, r, s0, s0 + Math.PI, false);
        if (st.fill) { ctx.closePath(); ctx.fill(); } else ctx.stroke();
      } else if (st.tool === 'arrow') {
        drawArrow(a, b, w, c);
      }
    }

    /* ---------- 指针交互 ---------- */
    cv.addEventListener('pointerdown', function (e) {
      const p = pos(e);
      if (st.tool === 'pointer') return;
      try { cv.setPointerCapture(e.pointerId); } catch (err) { /* 合成事件没有真实指针，忽略 */ }
      if (st.tool === 'text') {
        const txt = W.prompt ? W.prompt('输入要写的字：', '') : '';
        if (txt) {
          snap();
          const fs = Math.max(12, st.width * 4);
          ctx.font = fs + 'px "Noto Serif SC","Source Han Serif SC","SimSun",serif';
          ctx.textBaseline = 'top';
          ctx.fillStyle = st.color;
          ctx.fillText(txt, p.x, p.y);
          tip('已写入文字');
        }
        return;
      }
      snap();
      st.drawing = true;
      st.start = p;
      st.base = null;
      if (st.tool === 'pen' || st.tool === 'eraser') {
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineWidth = st.width;
        ctx.strokeStyle = (st.tool === 'eraser') ? PAPER : st.color;
        ctx.lineTo(p.x + 0.01, p.y + 0.01);
        ctx.stroke();
      } else {
        try { st.base = ctx.getImageData(0, 0, cv.width, cv.height); } catch (err) { }
      }
    });

    cv.addEventListener('pointermove', function (e) {
      if (!st.drawing) return;
      const p = pos(e);
      if (st.tool === 'pen' || st.tool === 'eraser') {
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
      } else if (st.base) {
        ctx.putImageData(st.base, 0, 0);     // 每帧回到起点重画，避免留痕
        drawShape(st.start, p);
      }
    });

    function endDrag(e) {
      if (!st.drawing) return;
      const p = pos(e);
      if (st.base && st.tool !== 'pen' && st.tool !== 'eraser') {
        ctx.putImageData(st.base, 0, 0);
        drawShape(st.start, p);
      }
      st.drawing = false; st.start = null; st.base = null;
    }
    cv.addEventListener('pointerup', endDrag);
    cv.addEventListener('pointercancel', endDrag);

    /* ---------- 工具条 ---------- */
    sec.querySelectorAll('.bd-tool').forEach(function (b) {
      b.onclick = function () {
        st.tool = b.getAttribute('data-tool');
        sec.querySelectorAll('.bd-tool').forEach(function (x) { x.classList.toggle('on', x === b); });
        cv.style.cursor = (st.tool === 'pointer') ? 'default' : (st.tool === 'text' ? 'text' : 'crosshair');
        tip('');
      };
    });
    sec.querySelectorAll('.bd-color[data-c]').forEach(function (b) {
      b.onclick = function () {
        st.color = b.getAttribute('data-c');
        sec.querySelectorAll('.bd-color[data-c]').forEach(function (x) { x.classList.toggle('on', x === b); });
        const chip = sec.querySelector('.bd-fillchip');
        if (chip) chip.style.background = st.color;
      };
    });
    sec.querySelector('.bd-fillchip').onclick = function () {
      st.fill = true;
      this.classList.add('on');
      const fr = sec.querySelector('#bdFrame');
      fr.classList.add('on');
      fr.textContent = '填充';
    };
    sec.querySelector('#bdFrame').onclick = function () {
      st.fill = !st.fill;
      this.classList.toggle('on', st.fill);
      this.textContent = st.fill ? '填充' : '外框';
    };
    const wEl = sec.querySelector('#bdWidth'), wVal = sec.querySelector('#bdWidthVal');
    wEl.oninput = function () { st.width = parseInt(this.value, 10); wVal.textContent = this.value; };

    sec.querySelector('#bdUndo').onclick = function () {
      if (!st.back.length) { tip('没有可后退的了'); return; }
      st.fwd.push(ctx.getImageData(0, 0, cv.width, cv.height));
      ctx.putImageData(st.back.pop(), 0, 0);
      tip('');
    };
    sec.querySelector('#bdRedo').onclick = function () {
      if (!st.fwd.length) { tip('没有可前进的了'); return; }
      st.back.push(ctx.getImageData(0, 0, cv.width, cv.height));
      ctx.putImageData(st.fwd.pop(), 0, 0);
      tip('');
    };
    /* 底图（卦象文本或图片）单独记一份，清空时重新画回来——
     * 「清空」只清笔迹，不再把卦象一起抹掉（王哥要求）。 */
    let base = null;   // { type:'text', val:string } | { type:'image', val:Image }

    function paintTextBlock(txt, w, h) {
      const fs = Math.max(12, Math.min(16, Math.floor(w / 46)));
      const lh = Math.round(fs * 1.75);
      ctx.font = fs + 'px "Noto Serif SC","Source Han Serif SC","SimSun",serif';
      ctx.textBaseline = 'top';
      ctx.fillStyle = '#33302a';
      const x0 = 16;
      let y = 14;
      String(txt).split('\n').forEach(function (ln) {
        const maxCh = Math.floor((w - x0 * 2) / (fs * 1.02));
        let rest = ln;
        if (Array.from(rest).length <= maxCh) { ctx.fillText(ln, x0, y); y += lh; return; }
        while (Array.from(rest).length > 0 && y < h - lh) {
          ctx.fillText(Array.from(rest).slice(0, maxCh).join(''), x0, y);
          y += lh;
          rest = Array.from(rest).slice(maxCh).join('');
        }
      });
    }

    function paintBase() {
      const w = cv.width / dpr, h = cv.height / dpr;
      blank(w, h);
      if (!base) return;
      if (base.type === 'text') { paintTextBlock(base.val, w, h); return; }
      const im = base.val;
      const s = Math.min(w / im.width, h / im.height);
      const dw = im.width * s, dh = im.height * s;
      ctx.drawImage(im, (w - dw) / 2, (h - dh) / 2, dw, dh);
    }

    // 清空：只清笔迹，底图重画回来
    sec.querySelector('#bdClear').onclick = function () {
      snap();
      paintBase();
      tip(base ? '已清笔迹，卦象保留（可后退找回）' : '已清空（可后退找回）');
    };
    // 重置：笔迹与卦象底图一起清
    sec.querySelector('#bdReset').onclick = function () {
      snap();
      base = null;
      const ta = sec.querySelector('#bdPanText'); if (ta) ta.value = '';
      blank(cv.width / dpr, cv.height / dpr);
      tip('已全部清空（画与卦象都清了，可后退找回）');
    };

    function drawImageToCanvas(im) {
      snap();
      base = { type: 'image', val: im };
      paintBase();
    }

    /* 供外部调用：把一段卦象文本直接画到画板上（卦例库 / 古籍卦例库的「导入画板」） */
    W.__lyBoardLoadText = function (txt) {
      if (!txt) { tip('没有可导入的卦象文本'); return false; }
      const ta = sec.querySelector('#bdPanText'); if (ta) ta.value = txt;
      snap();
      base = { type: 'text', val: txt };
      paintBase();
      tip('已导入卦象，可直接圈点');
      return true;
    };

    // 载入卦象：把当前盘面按古籍版式画成底图
    sec.querySelector('#bdPan').onclick = function () {
      const txt = (typeof W.__lyPanClassic === 'function') ? W.__lyPanClassic() : '';
      if (!txt) { tip('先排一张盘，再点「载入卦象」'); return; }
      W.__lyBoardLoadText(txt);
      tip('已载入当前卦象，可直接圈点');
    };

    // 按文本框里的卦象文本画出（支持从别处复制粘贴进来）
    sec.querySelector('#bdDrawText').onclick = function () {
      const ta = sec.querySelector('#bdPanText');
      const txt = (ta && ta.value || '').trim();
      if (!txt) { tip('先在文本框里粘一段卦象'); return; }
      W.__lyBoardLoadText(txt);
    };
    sec.querySelector('#bdCopyText').onclick = function () {
      const ta = sec.querySelector('#bdPanText');
      const txt = ta ? ta.value : '';
      if (!txt) { tip('文本框是空的'); return; }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).then(function () { tip('已复制卦象文本'); })
          .catch(function () { tip('复制失败，请手动选中复制'); });
      } else { tip('此环境不能写剪贴板，请手动选中复制'); }
    };

    // 截屏批注：读剪贴板里的图片（Win+Shift+S 之后再点）
    function pasteFromClipboard() {
      if (!navigator.clipboard || !navigator.clipboard.read) {
        tip('此环境不能读剪贴板：用 Win+Shift+S 截图后按 Ctrl+V');
        return;
      }
      navigator.clipboard.read().then(function (items) {
        for (let i = 0; i < items.length; i++) {
          const it = items[i];
          if (it.types.indexOf('image/png') < 0) continue;
          return it.getType('image/png').then(function (blob) {
            const url = URL.createObjectURL(blob);
            const im = new Image();
            im.onload = function () { drawImageToCanvas(im); URL.revokeObjectURL(url); tip('已贴入截图'); };
            im.src = url;
          });
        }
        tip('剪贴板里没有图片');
      }).catch(function () { tip('读剪贴板失败：请直接按 Ctrl+V'); });
    }
    sec.querySelector('#bdShot').onclick = pasteFromClipboard;

    sec.querySelector('#bdImage').onclick = function () {
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = 'image/*';
      inp.onchange = function () {
        const f = inp.files && inp.files[0];
        if (!f) return;
        const url = URL.createObjectURL(f);
        const im = new Image();
        im.onload = function () { drawImageToCanvas(im); URL.revokeObjectURL(url); tip('已插入图片'); };
        im.src = url;
      };
      inp.click();
    };

    sec.querySelector('#bdSave').onclick = function () {
      cv.toBlob(function (blob) {
        if (!blob) { tip('导出失败'); return; }
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        const d = new Date(), p2 = function (n) { return (n < 10 ? '0' : '') + n; };
        let gua = '';
        try {
          const el = document.getElementById('gzBen');
          if (el && el.value) gua = '-' + el.value;   // 文件名带本卦名，事后好找
        } catch (err) { }
        a.download = '画板' + gua + '-' + d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()) +
          '-' + p2(d.getHours()) + p2(d.getMinutes()) + '.png';
        document.body.appendChild(a); a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 800);
        tip('已截图保存（浏览器下载目录）');
      }, 'image/png');
    };

    sec.querySelector('#bdCollapse').onclick = function () {
      if (W.LY_TOOLBAR && W.LY_TOOLBAR.collapse) W.LY_TOOLBAR.collapse();
    };

    // 快捷键：Ctrl+Z 后退、Ctrl+Y 前进、Ctrl+V 贴图（面板收起时不响应）
    document.addEventListener('keydown', function (e) {
      const pane = sec.closest('.tb-pane');
      if (pane && pane.hidden) return;
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === 'z' || e.key === 'Z') { e.preventDefault(); sec.querySelector('#bdUndo').click(); }
      else if (e.key === 'y' || e.key === 'Y') { e.preventDefault(); sec.querySelector('#bdRedo').click(); }
    });
    document.addEventListener('paste', function (e) {
      const pane = sec.closest('.tb-pane');
      if (pane && pane.hidden) return;
      const items = (e.clipboardData && e.clipboardData.items) || [];
      for (let i = 0; i < items.length; i++) {
        if (items[i].type && items[i].type.indexOf('image') === 0) {
          const blob = items[i].getAsFile();
          if (!blob) continue;
          const url = URL.createObjectURL(blob);
          const im = new Image();
          im.onload = function () { drawImageToCanvas(im); URL.revokeObjectURL(url); tip('已贴入截图'); };
          im.src = url;
          e.preventDefault();
          return;
        }
      }
    });

    /* 尺寸跟随容器：面板折叠时容器宽 0，展开后必须重新量 */
    let curW = 0;
    function maybeFit() {
      const w = sec.querySelector('.bd-wrap').clientWidth;
      if (!w) return;
      if (Math.abs(w - curW) > 40) { curW = w; fit(); }
    }
    const ro = new ResizeObserver(maybeFit);
    ro.observe(sec.querySelector('.bd-wrap'));
    setTimeout(maybeFit, 120);
    setTimeout(function () { if (!cv.width) maybeFit(); }, 400);
  }

  const css = document.createElement('style');
  css.textContent =
    '.bd-bar{display:flex;flex-wrap:wrap;align-items:center;gap:8px 10px;margin-bottom:8px}' +
    '.bd-tools{display:inline-flex;flex-wrap:wrap;border:1px solid var(--line);border-radius:6px;overflow:hidden}' +
    '.bd-tool{font-family:inherit;font-size:14px;padding:6px 12px;border:0;border-right:1px solid var(--line);background:#fff;color:var(--ink);cursor:pointer}' +
    '.bd-tool:last-child{border-right:0}' +
    '.bd-tool:hover{background:#fbf6ea}' +
    '.bd-tool.on{background:#f6e7c9;color:var(--cinnabar-dark);font-weight:600}' +
    '.bd-sep{width:1px;height:22px;background:var(--line);display:inline-block}' +
    '.bd-colors{display:inline-flex;gap:6px;align-items:center}' +
    '.bd-color{width:20px;height:20px;border-radius:50%;border:2px solid transparent;cursor:pointer}' +
    '.bd-color.on{box-shadow:0 0 0 2px #fff inset,0 0 0 1px var(--ink)}' +
    '.bd-fillchip{border-radius:4px !important}' +
    '.bd-frame,.bd-mini{font-family:inherit;font-size:13px;padding:5px 12px;border:1px solid var(--line);border-radius:6px;background:#fff;color:var(--ink);cursor:pointer}' +
    '.bd-frame.on{background:#f6e7c9;border-color:var(--gold);font-weight:600}' +
    '.bd-mini:hover,.bd-frame:hover{background:#fbf6ea}' +
    '.bd-green{color:#2f6b46;border-color:#cfe3d6;background:#f4faf6}' +
    '.bd-width{display:inline-flex;align-items:center;gap:6px;font-size:13px;color:var(--ink-light)}' +
    '.bd-width input{width:110px}' +
    '.bd-width b{display:inline-block;min-width:18px;text-align:right;color:var(--ink)}' +
    '.bd-bar2{padding-top:2px}' +
    '.bd-textrow{display:flex;gap:8px;align-items:stretch;margin-top:8px}' +
    '#bdPanText{flex:1;min-height:52px;max-height:120px;resize:vertical;font-family:inherit;font-size:12.5px;' +
    'line-height:1.6;padding:6px 8px;border:1px solid var(--line);border-radius:6px;background:#fff;color:var(--ink)}' +
    '.bd-textbtns{display:flex;flex-direction:column;gap:6px;justify-content:center}' +
    '.bd-mini.bd-red{color:#a5352c;border-color:#e6bdb7}' +
    '.bd-mini.bd-red:hover{background:#fdf1ef}' +
    '.bd-wrap{border:1px solid var(--line);border-radius:8px;background:' + PAPER + ';overflow:hidden;line-height:0;margin-top:8px}' +
    '#bdCanvas{touch-action:none;cursor:crosshair;display:block;max-width:100%}';
  document.head.appendChild(css);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
})(typeof window !== 'undefined' ? window : globalThis);
