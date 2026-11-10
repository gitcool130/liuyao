/* ============================================================
 * 工具栏 (core/toolbar.js)
 *
 * 把散落在页面各处的四块功能收成一行按钮，默认全收起——启动界面只留
 * 标题 / 四个按钮 / 占时 / 起卦。
 *
 *   古籍卦例库   #gujiCard      （仅本地模式有）
 *   AI 接口设置  #localApiCard  （仅本地模式有）
 *   大模型断卦   #aiCard        （排盘后才有内容）
 *   卦例库       #libCard
 *
 * 各卡片仍由原模块创建与驱动，本文件只做「搬家 + 显隐」，不碰它们的内部逻辑。
 * 用「外层 pane 包裹」而不是直接改 card.hidden：app.js 会自己切换
 * #aiCard / #panCard 的 hidden，直接改会互相打架。
 * ============================================================ */
(function (root) {
  'use strict';
  const W = root;
  // 只在本机模式（桌面壳 / ?local=1）收界面：线上部署保持仓库原有版式，
  // 否则会把 #aiCard 搬进折叠面板，仓库自带的 UI 冒烟（盲摆/追问历史）就点不到了。
  if (!W.LY_LOCAL_MODE) return;
  const PANELS = [
    { key: 'guji', sel: '#gujiCard', label: '古籍卦例库' },
    { key: 'api', sel: '#localApiCard', label: 'AI 接口设置' },
    { key: 'ai', sel: '#aiCard', label: '大模型断卦', needPan: true },
    { key: 'lib', sel: '#libCard', label: '卦例库' }
  ];
  let cur = '';

  function build() {
    if (document.getElementById('toolCard')) return;
    const wrap = document.querySelector('.wrap');
    const header = document.querySelector('header');
    if (!wrap || !header) return;

    const exist = PANELS.filter(function (p) { return document.querySelector(p.sel); });
    if (!exist.length) return;

    const card = document.createElement('section');
    card.className = 'card';
    card.id = 'toolCard';
    card.innerHTML =
      '<div class="tb-bar">' +
      exist.map(function (p) {
        return '<button class="tb-btn" data-k="' + p.key + '">' + p.label + '</button>';
      }).join('') +
      '</div>' +
      '<div id="toolBody" hidden></div>';

    // 插在 header 之后、占时之前
    header.parentNode.insertBefore(card, header.nextSibling);

    const body = card.querySelector('#toolBody');
    exist.forEach(function (p) {
      const src = document.querySelector(p.sel);
      const pane = document.createElement('div');
      pane.className = 'tb-pane';
      pane.setAttribute('data-k', p.key);
      pane.hidden = true;
      // 断卦卡片在排盘前是 hidden 的：给一句人话，不要留一张空壳
      if (p.needPan) {
        const tip = document.createElement('div');
        tip.className = 'tb-empty';
        tip.textContent = '先完成排盘：在上方「占时」里选口径、起好六爻，这里才会出现断卦入口。';
        pane.appendChild(tip);
      }
      pane.appendChild(src);
      body.appendChild(pane);
    });

    // 本机模式下卦例库不需要口令，把原提示改掉
    if (W.LY_LOCAL_MODE) {
      const tip = document.getElementById('loginTip');
      if (tip) tip.textContent = '本机卦例库：无需口令';
    }

    card.querySelectorAll('.tb-btn').forEach(function (btn) {
      btn.onclick = function () { toggle(btn.getAttribute('data-k')); };
    });

    // 卡片自身的 hidden 会变（排盘后 #aiCard 才显示），据此刷新「空壳提示」
    const mo = new MutationObserver(function () { syncEmpty(); });
    exist.forEach(function (p) {
      const el = document.querySelector(p.sel);
      if (el) mo.observe(el, { attributes: true, attributeFilter: ['hidden'] });
    });

    // 从古籍库「装入排盘」后自动收起，把视线还给盘面
    document.addEventListener('click', function (e) {
      if (e.target && e.target.id === 'btnGujiLoad') setTimeout(collapse, 60);
    }, true);
  }

  function syncEmpty() {
    document.querySelectorAll('#toolBody .tb-pane').forEach(function (pane) {
      const cardEl = pane.querySelector('section.card');
      pane.setAttribute('data-empty', cardEl && cardEl.hidden ? '1' : '0');
    });
  }

  function toggle(key) {
    if (cur === key) { collapse(); return; }
    cur = key;
    document.getElementById('toolBody').hidden = false;
    document.querySelectorAll('#toolBody .tb-pane').forEach(function (pane) {
      pane.hidden = pane.getAttribute('data-k') !== key;
    });
    document.querySelectorAll('#toolCard .tb-btn').forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-k') === key);
    });
    syncEmpty();
    // 展开后把面板顶端带到视野里（按钮行才不会被顶出屏幕）
    const card = document.getElementById('toolCard');
    if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function collapse() {
    cur = '';
    const body = document.getElementById('toolBody');
    if (body) body.hidden = true;
    document.querySelectorAll('#toolCard .tb-btn').forEach(function (b) { b.classList.remove('on'); });
  }

  const css = document.createElement('style');
  css.textContent =
    '#toolCard{padding:14px 18px}' +
    '#toolCard .tb-bar{display:flex;gap:8px;flex-wrap:wrap}' +
    '.tb-btn{font-family:inherit;font-size:14px;letter-spacing:1px;padding:8px 16px;border:1px solid var(--line);' +
    'border-radius:999px;background:#fffdf8;color:var(--ink);cursor:pointer;transition:all .15s}' +
    '.tb-btn:hover{border-color:var(--gold);color:var(--cinnabar-dark)}' +
    '.tb-btn.on{background:var(--cinnabar);border-color:var(--cinnabar);color:#fff}' +
    '#toolBody{margin-top:14px}' +
    '.tb-pane > .card{margin:0;padding:0;border:0;box-shadow:none;background:transparent}' +
    '.tb-pane > .card > h2{display:none}' +
    '.tb-empty{display:none;padding:10px 12px;border:1px dashed var(--line);border-radius:8px;' +
    'background:#fbf8f1;font-size:13px;color:var(--ink-light)}' +
    '.tb-pane[data-empty="1"] > .tb-empty{display:block}' +
    '.tb-pane[data-empty="1"] > .card{display:none}' +
    '@media(max-width:640px){.tb-btn{font-size:13px;padding:7px 12px}}';
  document.head.appendChild(css);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();

  W.LY_TOOLBAR = { toggle: toggle, collapse: collapse };
})(typeof window !== 'undefined' ? window : globalThis);
