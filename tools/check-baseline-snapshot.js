/**
 * baselineSnapshot 兜底验证（2026-10-29）
 *
 * 背景：线上 20 卦 baseline 全为 NULL，readings 0 行。旧版 baselineSnapshot()
 * 直接读 lastAnalysis，一旦它为空（先摇卦后选事类 / 自定义推不出关键词），
 * 判据整条丢失，回访闭环从源头断掉，且界面无任何提示。
 *
 * 本脚本不复制业务逻辑：从 public/app.js 里把 analysisForSave / baselineSnapshot
 * 两段源码原样切出来，配真实 core.js 执行，验证三种输入下的输出。
 * 跑法：node tools/check-baseline-snapshot.js
 */
const fs = require('fs');
const path = require('path');
const C = require('../core.js');

const APP = path.join(__dirname, '..', 'public', 'app.js');
const src = fs.readFileSync(APP, 'utf8');

const START = '  function analysisForSave(';
const END = '  function recordPayload(';
const i0 = src.indexOf(START);
const i1 = src.indexOf(END, i0);
if (i0 < 0 || i1 < 0) {
  console.error('切取失败：app.js 结构已变，请同步更新本脚本的锚点');
  process.exit(1);
}
const code = src.slice(i0, i1);
if (code.indexOf('function baselineSnapshot(') < 0) {
  console.error('切取范围未包含 baselineSnapshot，锚点需调整');
  process.exit(1);
}

let pass = 0, fail = 0;
function eq(name, actual, expected) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a === b) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + '\n      实际 ' + a + '\n      期望 ' + b); }
}

// 真盘：六爻全动，2026-10-29 15:00
const pan = C.paipan([1, 9, 0, 1, 6, 0], new Date(2026, 9, 29, 15, 0));

// 把两段源码装进工厂，$ / C / pan / lastAnalysis / currentQuestion 全部注入
function makeScope(opts) {
  const factory = new Function(
    '$', 'C', 'pan', 'lastAnalysis', 'currentQuestion',
    code + '\n  return { analysisForSave: analysisForSave, baselineSnapshot: baselineSnapshot };'
  );
  return factory(
    function (sel) { return { value: opts.select, hidden: true, focus: function () {} }; },
    C, opts.pan, opts.lastAnalysis, function () { return opts.question || ''; }
  );
}

console.log('\n① 正常路径：lastAnalysis 已存在 → 原样使用，不重算');
{
  const preset = C.analyze(pan, '妻财');
  const s = makeScope({ select: '妻财', pan: pan, lastAnalysis: preset, question: '' });
  const snap = s.baselineSnapshot();
  eq('快照非空', !!snap, true);
  eq('用神按 engine 口径写入', typeof snap.yongshen === 'string' && snap.yongshen.length > 0, true);
  eq('走向取引擎结论', snap.trend, preset.trend);
  eq('应期窗口 status=ok', snap.window && snap.window.status, 'ok');
  eq('窗口 hi 为正整数（回访派生的前提）', typeof snap.window.hi === 'number' && snap.window.hi >= 0, true);
}

console.log('\n② 兜底路径：lastAnalysis 为空、但盘与事类都在 → 现场重算，判据不丢');
{
  const s = makeScope({ select: '妻财', pan: pan, lastAnalysis: null, question: '' });
  const a = s.analysisForSave();
  const snap = s.baselineSnapshot();
  eq('analysisForSave 重算出了分析', !!a, true);
  eq('快照非空（旧版此处为 null）', !!snap, true);
  const ref = C.analyze(pan, '妻财');
  const refYong = (ref.yongshen && ref.yongshen.line)
    ? (ref.yongshen.type + ' ' + ref.yongshen.line.lq + ref.yongshen.line.zhi) : null;
  eq('用神串与正常路径同一构造口径', snap.yongshen, refYong);
  eq('趋势为引擎结论', snap.trend, ref.trend);
  eq('带应期窗口', !!snap.window, true);
}

console.log('\n③ 自定义事由可推关键词（"求财"）→ 仍能出判据');
{
  const s = makeScope({ select: '__custom__', pan: pan, lastAnalysis: null, question: '这周求财能否到手' });
  const a = s.analysisForSave();
  const snap = s.baselineSnapshot();
  eq('analysisForSave 推出用神', !!(a && a.yongshen), true);
  eq('快照非空', !!snap, true);
  if (snap) console.log('      用神 = ' + snap.yongshen + ' ｜ 趋势 = ' + snap.trend);
}

console.log('\n④ 无判据可存：未选事类 → 返回 null（不伪造判据）');
{
  const s = makeScope({ select: '', pan: pan, lastAnalysis: null, question: '' });
  eq('analysisForSave 返回 null', s.analysisForSave(), null);
  eq('baselineSnapshot 返回 null', s.baselineSnapshot(), null);
}

console.log('\n⑤ 未排盘时不得凭空空算');
{
  const s = makeScope({ select: '妻财', pan: null, lastAnalysis: null, question: '' });
  eq('无盘 → null', s.baselineSnapshot(), null);
}

console.log('\n结果：PASS ' + pass + '　FAIL ' + fail + '\n');
process.exit(fail ? 1 : 0);
