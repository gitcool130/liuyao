/* 本地复刻 public/app.js 的 buildPanText(true)，生成与线上一致的盘面文本 */
const C = require('../core.js');

const LINE_NAMES = ['初爻', '二爻', '三爻', '四爻', '五爻', '上爻'];
const TREND_TEXT = { ji: '吉', xiong: '凶', ping: '平', dai: '待审' };

function panText(vals, at, question, target) {
  const pan = C.paipan(vals, at);
  const a = C.analyze(pan, target);
  const pil = pan.pillars;
  const q = question || '';
  let txt = '【六爻排盘】\n';
  const pad = n => String(n).padStart(2, '0');
  txt += '时间：' + at.getFullYear() + '-' + pad(at.getMonth() + 1) + '-' + pad(at.getDate()) + ' ' +
    pad(at.getHours()) + ':' + pad(at.getMinutes()) + '（北京时间；' + pil.yearGZ + '年 ' + pil.monthGZ +
    '月 ' + pil.dayGZ + '日 ' + pil.hourGZ + '时，旬空' + pil.kongStr + '）\n';
  if (q) txt += '所测：' + q + '\n';
  txt += '本卦：' + pan.benName + '（' + pan.palace + '宫·' + pan.palaceWx + '）' +
    (pan.hasBian ? ' 之 ' + pan.bianName + '（' + pan.bianPalace + '宫）' : '（静卦）') + '\n';
  if (a.yongshen) {
    const y = a.yongshen, yl = y.line;
    txt += '用神：' + y.type + ' ' + yl.lq + yl.zhi + '（' + LINE_NAMES[yl.pos] + '，' + yl.wx + '，' +
      y.wang + '，' + (yl.moving ? '发动' : '安静') + (yl.isFu ? '，伏神' : '') + '）\n';
  }
  const gx = (typeof C.ruleGuaXing === 'function' ? C.ruleGuaXing(pan) : []).map(j => j.rule);
  if (gx.length) txt += '卦型：' + gx.join('、') + '\n';
  txt += '六神　伏神　本卦　　　世应　变爻\n';
  for (let i = 5; i >= 0; i--) {
    const L = pan.lines[i];
    const sym = L.yang ? '━━━' : '─ ─';
    const mark = L.old === 9 ? '○' : L.old === 6 ? '✕' : ' ';
    txt += (L.beast + '　　').slice(0, 4) + ' ' +
      (L.fu ? L.fu.lq + L.fu.zhi : '　　') + '　' +
      L.lq + L.gan + L.zhi + sym + mark + '　' +
      (L.shi ? '世' : L.ying ? '应' : '　') + '　' +
      (L.moving && L.bian ? L.bian.lq + L.bian.gan + L.bian.zhi : '') + '\n';
  }
  if (a.bullets && a.bullets.length) {
    txt += '\n【旺衰粗判（规则链 · 非评分制）】\n';
    a.bullets.forEach(b => { txt += '- ' + String(b).replace(/<[^>]+>/g, '') + '\n'; });
  }
  if (a.trend) {
    txt += '\n【引擎判定（确定性 · 非推断）】' + a.trend + '\n';
    txt += '- 由规则链 aggregateTrend 依本仓已定流派口径算出，与上「旺衰粗判」同源；正文「结论」行须与之同向。\n';
    txt += '- 若认定该判定有误，须先引古法原文说明理由，并在结论行后括注「（与引擎分歧：引擎判' +
      a.trend + '，此处判X）」，不得静默给出相反结论。\n';
  }
  txt += '\n【契约】「卦象」「卦型」「旺衰粗判」三节为确定性结果：六亲、纳甲、世应、动爻、旬空、月破、卦型' +
    '不得改写或重新推算。吉凶、应期与取象可作传统推断，但每一条都须与上述盘面事实一致。\n';
  return { text: txt, pan, a };
}

module.exports = { panText, TREND_TEXT };

if (require.main === module) {
  const r = panText([0, 6, 6, 0, 6, 0], new Date(2026, 9, 21, 12, 1), '此liuyao预测项目准确度如何，是否堪用（界面取用：父母·考试文书）', '父母');
  console.log(r.text);
  console.log('---trend:', r.a.trend, 'len:', r.text.length);
}
