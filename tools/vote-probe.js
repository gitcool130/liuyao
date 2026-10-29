/**
 * Workers AI 三问探针（2026-10-29）
 * 目的：确认「一张真盘 → clef-flash 给概率」这条链路可用，并量出 neurons 成本。
 * 跑法：CF_AC=... CF_TOKEN=... node tools/vote-probe.js
 */
const C = require('../core.js');

const AC = process.env.CF_AC;
const TOKEN = process.env.CF_TOKEN;
if (!AC || !TOKEN) { console.error('需要 CF_AC 与 CF_TOKEN 环境变量'); process.exit(1); }

const REST = 'https://api.cloudflare.com/client/v4/accounts/' + AC + '/ai/run/';

async function run(model, body) {
  const t0 = Date.now();
  const r = await fetch(REST + model, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const txt = await r.text();
  let j = null; try { j = JSON.parse(txt); } catch (e) { /* 非 JSON 原样带出 */ }
  return { status: r.status, ms: Date.now() - t0, json: j, raw: txt };
}

// 1) 造一张真盘：2026-10-29 15:00，六爻全动
const pan = C.paipan([1, 9, 0, 1, 6, 0], new Date(2026, 9, 29, 15, 0));
const an = C.analyze(pan, '妻财');

function lineStr(l) {
  const yao = l.yang ? '阳' : '阴';
  const mark = l.moving ? '动→' + (l.bian ? l.bian.gan + l.bian.zhi : '') : '静';
  return l.pos + '爻 ' + l.gan + l.zhi + ' ' + l.lq + '（' + yao + '·' + mark + '）';
}

const state = [
  '月建 ' + pan.pillars.monthGZ + '　日辰 ' + pan.pillars.dayGZ + '　旬空 ' + (pan.kong || []).join('、'),
  '本卦 ' + pan.benName + (pan.hasBian ? ' 之 ' + pan.bianName : '（静卦）'),
  '宫 ' + pan.gong + '（' + pan.gongWx + '）　世' + (pan.shi + 1) + '爻　应' + (pan.ying + 1) + '爻',
  pan.lines.map(lineStr).join('\n'),
  '引擎取用神：' + (an.yongshen ? an.yongshen.type + ' ' + an.yongshen.line.lq + an.yongshen.line.zhi : '无'),
  '引擎粗判：' + an.trend,
  '引擎应期：' + (an.yingqiWindow && an.yingqiWindow.text ? an.yingqiWindow.text : '未给')
].join('\n');

console.log('===== 盘面 state（' + state.length + ' 字） =====');
console.log(state);
console.log();

(async () => {
  // 2) clef-flash：三问一次问完
  const clef = await run('@cf/cloudflare/clef-flash', {
    state: state,
    questions: {
      用神: {
        type: 'choice',
        instructions: '此卦问求财，用神应取哪一六亲？',
        criteria: {
          妻财: '求财以妻财为用',
          官鬼: '官鬼可代表财物之主管或阻碍',
          兄弟: '兄弟主劫财',
          父母: '父母主文书房屋',
          子孙: '子孙为财之源'
        }
      },
      旺衰: {
        type: 'choice',
        instructions: '用神当前旺衰程度',
        criteria: { 旺: '得月建或日辰生扶且无重克', 平: '生克相抵', 弱: '受克无救或休囚无生' }
      },
      可成: { type: 'noul', instructions: '此卦所求之事最终能否成？给出成的概率' }
    }
  });
  console.log('clef-flash  ' + clef.status + '  ' + clef.ms + 'ms');
  console.log(JSON.stringify(clef.json, null, 1).slice(0, 1400));
  console.log();

  // 3) glm-4.7-flash：严格 JSON，max_tokens 给足（它先产 reasoning）
  const glm = await run('@cf/zai-org/glm-4.7-flash', {
    messages: [
      { role: 'system', content: '你是六爻排盘判读器。只输出一行 JSON，不要解释、不要 markdown 代码块。' },
      { role: 'user', content: state + '\n\n请输出 JSON：{"用神":"六亲名","旺衰":"旺|平|弱","可成":0到1的小数,"应期":"一句话"}' }
    ],
    max_tokens: 400,
    temperature: 0.1
  });
  const u = glm.json && glm.json.result && glm.json.result.usage;
  console.log('glm-4.7-flash  ' + glm.status + '  ' + glm.ms + 'ms  neurons=' + (u ? u.neurons : '?'));
  const msg = glm.json && glm.json.result && glm.json.result.choices && glm.json.result.choices[0].message;
  console.log('content: ' + JSON.stringify(msg ? msg.content : null).slice(0, 400));
  console.log('finish: ' + (glm.json && glm.json.result && glm.json.result.choices[0].finish_reason));
})();
