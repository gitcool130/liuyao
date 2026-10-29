/**
 * Workers AI 候选模型对比（2026-10-29）
 * 同一张盘、同一问题，比「能不能稳定吐出干净 JSON」以及耗时/neurons。
 * 跑法：CF_AC=... CF_TOKEN=... node tools/model-compare.js
 */
const C = require('../core.js');
const AC = process.env.CF_AC, TOKEN = process.env.CF_TOKEN;
const REST = 'https://api.cloudflare.com/client/v4/accounts/' + AC + '/ai/run/';

const pan = C.paipan([1, 9, 0, 1, 6, 0], new Date(2026, 9, 29, 15, 0));
const an = C.analyze(pan, '妻财');
const state = [
  pan.pillars.yearGZ + '年 ' + pan.pillars.monthGZ + '月 ' + pan.pillars.dayGZ + '日 ' + pan.pillars.hourGZ + '时　旬空 ' + pan.pillars.kongStr,
  '本卦 ' + pan.benName + (pan.hasBian ? ' 之 ' + pan.bianName : '（静卦）'),
  '宫 ' + pan.palace + '（' + pan.palaceWx + '）　世' + (pan.shi + 1) + '爻　应' + (pan.ying + 1) + '爻',
  pan.lines.map(l => (l.pos + 1) + '爻 ' + l.gan + l.zhi + ' ' + l.lq + (l.moving ? ' 动→' + l.bian.gan + l.bian.zhi : ' 静')).join('\n'),
  '引擎取用神 ' + an.yongshen.type + ' ' + an.yongshen.line.zhi + '　粗判 ' + an.trend
].join('\n');

const ASK = state + '\n\n问：求财能否到手？只输出一行 JSON：{"用神":"六亲","旺衰":"旺|平|弱","可成":0到1,"应期":"一句话"}';

const MODELS = [
  { id: '@cf/cloudflare/clef', label: 'clef 27B (决策)', kind: 'clef' },
  { id: '@cf/cloudflare/clef-omni', label: 'clef-omni 30B MoE', kind: 'clef' },
  { id: '@cf/qwen/qwen3-30b-a3b-fp8', label: 'qwen3-30b /no_think', kind: 'chat', msg: ASK + ' /no_think' },
  { id: '@cf/google/gemma-4-26b-a4b-it', label: 'gemma-4-26b', kind: 'chat', msg: ASK },
  { id: '@cf/openai/gpt-oss-120b', label: 'gpt-oss-120b', kind: 'chat', msg: ASK, extra: { reasoning_effort: 'low' } }
];

const QUESTIONS = {
  用神: { type: 'choice', instructions: '此卦问求财，用神取哪一六亲？',
    criteria: { 妻财: '求财以妻财为用', 官鬼: '主管或阻碍', 兄弟: '劫财', 父母: '文书房屋', 子孙: '财之源' } },
  旺衰: { type: 'choice', instructions: '用神旺衰',
    criteria: { 旺: '得月建或日辰生扶无重克', 平: '生克相抵', 弱: '受克无救或休囚无生' } },
  可成: { type: 'noul', instructions: '所求之事最终能否成，给成的概率' }
};

async function call(m) {
  const body = m.kind === 'clef'
    ? { state: state, questions: QUESTIONS }
    : Object.assign({ messages: [{ role: 'user', content: m.msg }], max_tokens: 320, temperature: 0.1 }, m.extra || {});
  const t0 = Date.now();
  try {
    const r = await fetch(REST + m.id, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const txt = await r.text();
    let j = null; try { j = JSON.parse(txt); } catch (e) { /* ignore */ }
    return { m: m, status: r.status, ms: Date.now() - t0, j: j, txt: txt };
  } catch (e) {
    return { m: m, status: 0, ms: Date.now() - t0, err: String(e) };
  }
}

function digest(r) {
  if (r.err) return 'ERR ' + r.err;
  if (r.status !== 200) return 'HTTP ' + r.status + ' ' + (r.txt || '').slice(0, 160);
  const res = r.j && r.j.result;
  if (!res) return '无 result 字段';
  const u = res.usage || {};
  const neuron = u.neurons != null ? u.neurons : '?';
  if (res.answers) {
    const parts = Object.keys(res.answers).map(function (k) {
      const a = res.answers[k];
      if (a.type === 'choice') return k + '=' + a.choice + '(' + Math.round((a.confidence || 0) * 100) + '%)';
      if (a.type === 'noul') return k + '=' + a.noul;
      return k + '=' + JSON.stringify(a).slice(0, 40);
    });
    return 'tok ' + (u.input_tokens || 0) + ' | ' + parts.join('　');
  }
  const ch = res.choices && res.choices[0];
  const msg = ch && ch.message || {};
  const c = msg.content;
  return 'finish=' + (ch && ch.finish_reason) + ' tok ' + (u.prompt_tokens || 0) + '+' + (u.completion_tokens || 0) +
    ' neurons ' + neuron + '\n     content=' + JSON.stringify(String(c == null ? null : c)).slice(0, 220);
}

(async function () {
  console.log('盘面 ' + pan.benName + ' | ' + state.length + ' 字\n');
  const out = await Promise.all(MODELS.map(call));
  out.sort(function (a, b) { return a.ms - b.ms; });
  for (const r of out) {
    console.log('── ' + r.m.label.padEnd(22) + ' ' + String(r.ms + 'ms').padStart(7) + '  ' + digest(r));
  }
})();
