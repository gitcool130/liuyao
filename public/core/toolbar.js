/* ============================================================
 * 右侧导航 + 单页切换 (core/toolbar.js)
 *
 * 王哥的改法：把功能按钮从页顶一行改成「右侧竖排」，点哪个只显示那一页，
 * 无关内容全部收起；「首页排盘」在最上面，点了回到排盘主页。
 *
 *   首页排盘   → 主页（占时 / 起卦 / 卦象 / 分析）
 *   古籍卦例   #gujiCard
 *   个人卦例   #libCard
 *   画板涂鸦   #boardCard
 *   模型试断   #aiCard      （排盘后才有内容）
 *   接口设置   #localApiCard
 *
 * 各卡片仍由原模块创建与驱动，本文件只做「搬家 + 显隐」，不碰内部逻辑。
 * 用外层 pane 包裹而不是直接改 card.hidden：app.js 会自己切 #aiCard /
 * #panCard 的 hidden，直接改会互相打架。
 * ============================================================ */
(function (root) {
  'use strict';
  const W = root;
  // 只在本机模式（桌面壳 / ?local=1）收界面：线上部署保持仓库原有版式，
  // 否则会把 #aiCard 搬进面板，仓库自带的 UI 冒烟（盲摆/追问历史）就点不到了。
  if (!W.LY_LOCAL_MODE) return;

  const HOME = { key: 'home', label: '首页排盘' };
  const PANELS = [
    { key: 'guji', sel: '#gujiCard', label: '古籍卦例' },
    { key: 'lib', sel: '#libCard', label: '个人卦例' },
    { key: 'board', sel: '#boardCard', label: '画板涂鸦' },
    { key: 'ai', sel: '#aiCard', label: '模型试断', needPan: true },
    { key: 'api', sel: '#localApiCard', label: '接口设置' }
  ];
  let cur = 'home';

  function build() {
    if (document.getElementById('sideRail')) return;
    const wrap = document.querySelector('.wrap');
    const header = document.querySelector('header');
    if (!wrap || !header) return;

    const exist = PANELS.filter(function (p) { return document.querySelector(p.sel); });
    if (!exist.length) return;

    /* ---- 1) 面板容器（放在 header 之后，主页内容之前） ---- */
    const card = document.createElement('section');
    card.className = 'card';
    card.id = 'toolCard';
    card.hidden = true;                       // 默认看首页
    card.innerHTML = '<div id="toolBody"></div>';
    header.parentNode.insertBefore(card, header.nextSibling);

    const body = card.querySelector('#toolBody');
    exist.forEach(function (p) {
      const src = document.querySelector(p.sel);
      if (!src) return;
      const pane = document.createElement('div');
      pane.className = 'tb-pane';
      pane.setAttribute('data-k', p.key);
      pane.hidden = true;
      // 断卦卡片在排盘前是 hidden 的：给一句人话，不要留一张空壳
      if (p.needPan) {
        const tip = document.createElement('div');
        tip.className = 'tb-empty';
        tip.textContent = '先完成排盘：回「首页排盘」起好六爻，这里才会出现断卦入口。';
        pane.appendChild(tip);
      }
      pane.appendChild(src);
      body.appendChild(pane);
    });

    /* ---- 2) 主页内容包一层，方便整块隐藏 ---- */
    let mainView = document.getElementById('mainView');
    if (!mainView) {
      mainView = document.createElement('div');
      mainView.id = 'mainView';
      card.parentNode.insertBefore(mainView, card.nextSibling);
      Array.prototype.slice.call(wrap.children).forEach(function (el) {
        if (el === header || el === card || el === mainView) return;
        mainView.appendChild(el);
      });
    }

    /* ---- 3) 右侧竖排按钮 ---- */
    const rail = document.createElement('div');
    rail.id = 'sideRail';
    rail.innerHTML = [HOME].concat(exist).map(function (p) {
      return '<button class="tb-btn' + (p.key === 'home' ? ' on' : '') + '" data-k="' + p.key + '">' +
        p.label + '</button>';
    }).join('');
    document.body.appendChild(rail);
    document.body.classList.add('has-rail');
    rail.querySelectorAll('.tb-btn').forEach(function (btn) {
      btn.onclick = function () { activate(btn.getAttribute('data-k')); };
    });

    // 本机模式下卦例库不需要口令，把原提示改掉
    const tip = document.getElementById('loginTip');
    if (tip) tip.textContent = '本机卦例库：无需口令';

    // 卡片自身的 hidden 会变（排盘后 #aiCard 才显示），据此刷新「空壳提示」
    const mo = new MutationObserver(function () { syncEmpty(); });
    exist.forEach(function (p) {
      const el = document.querySelector(p.sel);
      if (el) mo.observe(el, { attributes: true, attributeFilter: ['hidden'] });
    });

    // 从古籍库「装入排盘」后回首页，把视线还给盘面
    document.addEventListener('click', function (e) {
      if (e.target && e.target.id === 'btnGujiLoad') setTimeout(goHome, 80);
    }, true);
  }

  function activate(key) {
    if (key === 'home' || !key) { goHome(); return; }
    cur = key;
    const card = document.getElementById('toolCard');
    const main = document.getElementById('mainView');
    if (card) card.hidden = false;
    if (main) main.hidden = true;
    document.querySelectorAll('#toolBody .tb-pane').forEach(function (pane) {
      pane.hidden = pane.getAttribute('data-k') !== key;
    });
    markRail(key);
    syncEmpty();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function goHome() {
    cur = 'home';
    const card = document.getElementById('toolCard');
    const main = document.getElementById('mainView');
    if (main) main.hidden = false;
    if (card) card.hidden = true;
    markRail('home');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function markRail(key) {
    document.querySelectorAll('#sideRail .tb-btn').forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-k') === key);
    });
  }

  function syncEmpty() {
    document.querySelectorAll('#toolBody .tb-pane').forEach(function (pane) {
      const cardEl = pane.querySelector('section.card');
      pane.setAttribute('data-empty', cardEl && cardEl.hidden ? '1' : '0');
    });
  }

  /* 外部（卦例库 / 古籍库的「导入画板」）一键调出某个面板 */
  W.__lyOpenPane = function (key) { activate(key); return true; };
  W.__lyGoHome = goHome;

  const css = document.createElement('style');
  css.textContent =
    /* 右侧竖排导航 */
    '#sideRail{position:fixed;right:10px;top:88px;z-index:800;display:flex;flex-direction:column;gap:8px;' +
    'padding:10px 8px;background:rgba(255,253,248,.94);border:1px solid var(--line);border-radius:12px;' +
    'box-shadow:0 6px 18px rgba(80,60,30,.08)}' +
    '.tb-btn{font-family:inherit;font-size:13.5px;letter-spacing:1px;padding:9px 10px;min-width:88px;' +
    'border:1px solid var(--line);border-radius:8px;background:#fffdf8;color:var(--ink);cursor:pointer;' +
    'transition:all .15s;white-space:nowrap;text-align:center}' +
    '.tb-btn:hover{border-color:var(--gold);color:var(--cinnabar-dark)}' +
    '.tb-btn.on{background:var(--cinnabar);border-color:var(--cinnabar);color:#fff}' +
    'body.has-rail .wrap{padding-right:126px}' +
    '#toolCard{padding:0;border:0;box-shadow:none;background:transparent;margin:0}' +
    '#toolBody{margin-top:0}' +
    '.tb-pane > .card{margin:0}' +
    '.tb-pane > .card > h2{display:none}' +
    '.tb-empty{display:none;padding:10px 12px;border:1px dashed var(--line);border-radius:8px;' +
    'background:#fbf8f1;font-size:13px;color:var(--ink-light)}' +
    '.tb-pane[data-empty="1"] > .tb-empty{display:block}' +
    '.tb-pane[data-empty="1"] > .card{display:none}' +
    /* 宽屏：占时与起卦并排，一屏放得下，不用拉竖条 */
    '@media(min-width:1180px){' +
    '#mainView{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:14px;align-items:start}' +
    '#mainView > header{grid-column:1 / -1}' +
    '#mainView > #gzCard,#mainView > #cast4Card,#mainView > #panCard,' +
    '#mainView > #analysisCard,#mainView > #aiCard{grid-column:1 / -1}' +
    '#mainView > .card{margin:0}' +
    '}' +
    '@media(max-width:820px){#sideRail{top:auto;bottom:10px;right:10px;flex-direction:row;overflow-x:auto;' +
    'max-width:calc(100vw - 20px)}.tb-btn{min-width:auto;font-size:12.5px;padding:8px 10px}' +
    'body.has-rail .wrap{padding-right:0;padding-bottom:64px}}';
  document.head.appendChild(css);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();

  W.LY_TOOLBAR = { activate: activate, home: goHome, collapse: goHome };
})(typeof window !== 'undefined' ? window : globalThis);
