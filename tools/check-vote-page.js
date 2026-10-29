/**
 * 投票页渲染自检（2026-10-29）
 * 不启浏览器：把 public/vote.html 的内嵌脚本原样抽出，配 DOM 桩 + 假 fetch 跑一遍，
 * 验证「带入真盘 → 请求 /api/vote → 三票落到事实层/结论层/分歧矩阵」这条链路。
 * 跑法：node tools/check-vote-page.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML = path.join(__dirname, '..', 'public', 'vote.html');
const src = fs.readFileSync(HTML, 'utf8');
const m = /<script>([\s\S]*?)<\/script>/.exec(src);
if (!m) { console.error('vote.html 里找不到内嵌脚本'); process.exit(1); }
const code = m[1];

let pass = 0, fail = 0;
function eq(name, actual, expected) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a === b) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + '\n      实际 ' + a + '\n      期望 ' + b); }
}
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '　' + extra : '')); }
}

// ---- DOM 桩 ----
const nodes = {};
function mkEl(id) {
  return {
    id: id, _html: '', hidden: false,
    set innerHTML(v) { this._html = String(v); },
    get innerHTML() { return this._html; },
    querySelectorAll() { return []; },
    onclick: null, dataset: {}, className: ''
  };
}
const document = {
  getElementById(id) { return (nodes[id] = nodes[id] || mkEl(id)); }
};

// ---- localStorage 桩：一份真盘快照 ----
const spec = {
  ts: Date.now(),
  state: '丙午年 戊戌月 丙子日 丙申时　旬空 申酉\n本卦 雷泽归妹 之 泽雷随\n宫 兑（金）　世3爻　应6爻',
  ask: '求财能否到手',
  gua: '雷泽归妹', bian: '泽雷随',
  yong: '妻财 卯', trend: '平', yingqi: '11月1日—11月3日',
  meta: [['月建', '戊戌'], ['日辰', '丙子'], ['旬空', '申酉'], ['动爻', '2爻、5爻']]
};
const store = { 'ly.vote.cast': JSON.stringify(spec) };
const localStorage = {
  getItem(k) { return k in store ? store[k] : null; },
  setItem(k, v) { store[k] = String(v); }
};

// ---- fetch 桩：形状照 /api/vote 真实返回 ----
function p(entries) { return entries; }
const VOTES = [
  { id: 'clef', label: 'clef 27B', org: 'Cloudflare', ok: true, ms: 1421,
    probs: { yong: p({ 妻财: 0.83, 官鬼: 0.08, 父母: 0.04, 兄弟: 0.03, 子孙: 0.02 }),
      wang: p({ 极弱: 0.02, 弱: 0.08, 平: 0.2, 旺: 0.5, 极旺: 0.2 }),
      cheng: { noul: 0.31 }, qi: p({ 本旬: 0.1, 下旬: 0.3, 月内: 0.5, 月外: 0.1 }) },
    answer: null, usage: { input: 526, output: 0, neurons: 0.13 } },
  { id: 'qwen', label: 'Qwen3-30B', org: '阿里', ok: true, ms: 1361,
    probs: { yong: p({ 妻财: 1, 官鬼: 0, 父母: 0, 兄弟: 0, 子孙: 0 }),
      wang: p({ 极弱: 0, 弱: 0, 平: 1, 旺: 0, 极旺: 0 }),
      cheng: { noul: 0.5 }, qi: p({ 本旬: 0, 下旬: 1, 月内: 0, 月外: 0 }) },
    answer: '{"用神":"妻财","旺衰":"平","可成":0.5,"应期":"下旬"}', basis: '用神得日辰生扶',
    usage: { input: 200, output: 38, neurons: 2.08 } },
  { id: 'gptoss', label: 'gpt-oss-120b', org: 'OpenAI 开源', ok: true, ms: 2372,
    probs: { yong: p({ 妻财: 1, 官鬼: 0, 父母: 0, 兄弟: 0, 子孙: 0 }),
      wang: p({ 极弱: 0, 弱: 0, 平: 1, 旺: 0, 极旺: 0 }),
      cheng: { noul: 0.58 }, qi: p({ 本旬: 0, 下旬: 0, 月内: 1, 月外: 0 }) },
    answer: '{"用神":"妻财","旺衰":"平","可成":0.58,"应期":"月内"}', basis: null,
    usage: { input: 261, output: 92, neurons: 14.58 } }
];
let fetchCalls = 0;
async function fetchStub(url, opts) {
  fetchCalls++;
  return { ok: true, status: 200, json: async () => ({ votes: VOTES, usage: { neurons: 16.79, models: 3 } }) };
}

const ctx = vm.createContext({
  document, localStorage, fetch: fetchStub,
  console, setTimeout, clearTimeout, Date, Math, JSON, Object, Array, String, Number, Set, isFinite
});

(async function () {
  vm.runInContext(code, ctx, { filename: 'vote.html:inline' });
  await new Promise(r => setTimeout(r, 60));

  console.log('\n① 启动即自动对账');
  eq('向 /api/vote 发过一次请求', fetchCalls, 1);
  ok('事实层有 4 行', (nodes.facts.innerHTML.match(/<tr>/g) || []).length >= 4,
    '实际 ' + (nodes.facts.innerHTML.match(/<tr>/g) || []).length);
  ok('结论层 3 张模型卡', (nodes.models.innerHTML.match(/class="m"/g) || []).length === 3,
    '实际 ' + (nodes.models.innerHTML.match(/class="m"/g) || []).length);
  ok('分歧矩阵 4 行', (nodes.matrix.innerHTML.match(/class="mrow"/g) || []).length === 4,
    '实际 ' + (nodes.matrix.innerHTML.match(/class="mrow"/g) || []).length);
  ok('散文视图 3 段', (nodes.prose.innerHTML.match(/<p>/g) || []).length === 3);

  console.log('\n② 盘面头部带出引擎口径');
  ok('显示本卦与变卦', nodes.strip.innerHTML.indexOf('雷泽归妹') >= 0 && nodes.strip.innerHTML.indexOf('泽雷随') >= 0);
  ok('显示占问', nodes.strip.innerHTML.indexOf('求财能否到手') >= 0);
  ok('有「当前盘」按钮', nodes.cases.innerHTML.indexOf('当前盘') >= 0);

  console.log('\n③ 取用神：三票都与引擎一致 → 不应报冲突');
  const factsHtml = nodes.facts.innerHTML;
  ok('取用神行无「不一致」', factsHtml.indexOf('不一致') < 0);
  ok('事实层标出引擎口径', factsHtml.indexOf('引擎 妻财 卯') >= 0);

  console.log('\n④ 可成概率分歧 0.31 / 0.50 / 0.58 → 落在「略分歧」');
  const bannerHtml = nodes.banner.innerHTML;
  ok('横幅给出概率区间', /3[0-9]%|5[0-9]%|区间|分歧|一致/.test(bannerHtml));
  ok('矩阵显示三个百分数', nodes.matrix.innerHTML.indexOf('31%') >= 0 && nodes.matrix.innerHTML.indexOf('58%') >= 0);

  console.log('\n⑤ 不扰动真实数据（live 不做 jitter）');
  const chengCells = (nodes.matrix.innerHTML.match(/\d+%/g) || []);
  ok('可成三格是 31/50/58 原值', chengCells.join(',') === '31%,50%,58%', '实得 ' + chengCells.join(','));

  console.log('\n⑥ 依据层：只陈列模型自述，不伪装成古籍引文');
  const rulesHtml = nodes.rules.innerHTML;
  ok('报出依据的票显示「所据：」', rulesHtml.indexOf('所据：用神得日辰生扶') >= 0);
  ok('未报依据的票显式标注', rulesHtml.indexOf('（未报依据）') >= 0);
  ok('依据层不出现书名号（编造引文的形态）',
    !/[《》〈〉]/.test(rulesHtml), '实得 ' + (rulesHtml.match(/[《》〈〉]/g) || []).join(''));
  const secFour = /<h2>四、([^<]+)<\/h2>/.exec(src);
  ok('区块标题已由「规则层」改为「依据层」', !!secFour && secFour[1] === '依据层',
    '实得 ' + (secFour ? secFour[1] : '(未找到)'));
  ok('页面保留「本层不提供古籍引文」的边界说明', src.indexOf('本层不提供古籍引文') >= 0);

  console.log('\n结果：PASS ' + pass + '　FAIL ' + fail + '\n');
  process.exit(fail ? 1 : 0);
})();
