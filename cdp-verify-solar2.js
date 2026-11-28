/* 真机验证 · 第二组：
 *   ① 王哥截图里那种格式（时间: 阳历2026年11月28日13时18分）能否被带进盘面
 *   ② 「阳历只作对照」这条硬约束：手改日辰后，盘面上的阳历必须消失
 *      （干支变了还印着旧阳历＝张冠李戴，比不显示更糟）
 *   ③ 没有阳历那一行的图（只给干支与卦名）不许凭空造一个日期出来
 */
const fs = require('fs');
const http = require('http');
const PORT = process.argv[2] || '9223';

function getJson(path) {
  return new Promise(function (resolve, reject) {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: path, timeout: 4000 }, function (res) {
      let b = '';
      res.on('data', function (d) { b += d; });
      res.on('end', function () { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.on('timeout', function () { req.destroy(new Error('timeout')); });
  });
}
async function waitPage() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await getJson('/json/list');
      const page = list.filter(function (t) { return t.type === 'page' && t.webSocketDebuggerUrl; })[0];
      if (page) return page;
    } catch (e) { }
    await new Promise(function (r) { setTimeout(r, 500); });
  }
  throw new Error('CDP 没起来');
}

/* 王哥 2026-11-28 那张截图的形态（纯文本，粘贴/剪贴板那条路） */
const SHOT_1128 = [
  '占问：这个月业绩能达标吗',
  '时间: 阳历2026年11月28日13时18分',
  '月日:(丙午年)己亥月乙未日(空 辰巳)',
  '震:雷水解        坤为地'
].join('\n');

/* 没有任何阳历行：只有干支与卦名 */
const NO_SOLAR = [
  '月日:(丙午年)己亥月乙未日(空 辰巳)',
  '震:雷水解        坤为地'
].join('\n');

(async function () {
  const page = await waitPage();
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let seq = 0;
  const waiting = new Map();
  ws.addEventListener('message', function (ev) {
    let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
    const cb = waiting.get(m.id); if (cb) { waiting.delete(m.id); cb(m); }
  });
  function send(method, params) {
    return new Promise(function (resolve, reject) {
      const id = ++seq;
      waiting.set(id, function (m) {
        if (m.error) reject(new Error(method + ' → ' + JSON.stringify(m.error)));
        else resolve(m.result);
      });
      ws.send(JSON.stringify({ id: id, method: method, params: params || {} }));
      setTimeout(function () { if (waiting.has(id)) { waiting.delete(id); reject(new Error(method + ' 超时')); } }, 20000);
    });
  }
  const evalJs = async function (expr) {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error('页面报错：' + JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails));
    return r.result && r.result.value;
  };
  await new Promise(function (res, rej) {
    ws.addEventListener('open', res);
    ws.addEventListener('error', function () { rej(new Error('WS 握手失败')); });
  });
  await send('Runtime.enable');
  for (let i = 0; i < 40; i++) {
    if (await evalJs('typeof window.__lyOcrText === "function"')) break;
    await new Promise(function (r) { setTimeout(r, 500); });
  }

  const results = [];
  const check = function (name, cond, extra) {
    results.push({ name: name, ok: !!cond });
    console.log('  ' + (cond ? '✓' : '✗') + ' ' + name + (extra ? '　【' + extra + '】' : ''));
  };

  async function importText(txt, label) {
    await evalJs('window.__lyOcrText(' + JSON.stringify(txt) + ', ' + JSON.stringify(label) + ')');
    await new Promise(function (r) { setTimeout(r, 700); });
    await evalJs('(function(){var b=document.getElementById("btnOcrLoad");if(b&&!b.disabled)b.click();})()');
    await new Promise(function (r) { setTimeout(r, 1400); });
    return await evalJs('(function(){' +
      'var pre=document.getElementById("classicText");' +
      'var lines=(pre?pre.textContent:"").split("\\n");' +
      'return {solarLine:lines.filter(function(l){return l.indexOf("阳历")>=0;})[0]||"",' +
      'gzLine:lines.filter(function(l){return l.indexOf("干支")>=0;})[0]||"",' +
      'q:(document.getElementById("castQuestion")||{}).value||"",' +
      'timeInfo:(document.getElementById("timeInfo")||{}).innerText||""};})()');
  }

  console.log('① 王哥截图那种格式（阳历2026年11月28日13时18分）');
  const a = await importText(SHOT_1128, 'CDP-1128');
  console.log('    阳历行：' + a.solarLine);
  console.log('    干支行：' + a.gzLine);
  console.log('    占问  ：' + a.q);
  check('盘面上带着 11月28日 13:18',
    a.solarLine.indexOf('2026年11月28日 13:18') >= 0, a.solarLine);
  check('四柱仍是干支指定（丙午年 己亥月 乙未日）',
    a.gzLine.indexOf('丙午年') >= 0 && a.gzLine.indexOf('己亥月') >= 0 && a.gzLine.indexOf('乙未日') >= 0, a.gzLine);
  check('占问没被阳历那行截断', a.q === '这个月业绩能达标吗', a.q);
  check('占时卡片也印出这个时刻', a.timeInfo.indexOf('2026年11月28日 13:18') >= 0);

  console.log('② 手改日辰后，阳历必须消失（干支变了它就不对应了）');
  /* 注意：结果页那张盘是「点排盘」时留下的快照，只改下拉不会重排（既有设计，
   * 预览与占时可跟着变）。所以这里先看预览与占时，再点一次排盘看新盘。 */
  const afterEdit = await evalJs('(function(){' +
    'var s=document.getElementById("gzDay");' +
    's.value=String((parseInt(s.value,10)+1)%60);' +
    's.dispatchEvent(new Event("change",{bubbles:true}));' +
    'return null;})()');
  await new Promise(function (r) { setTimeout(r, 900); });
  const b = await evalJs('(function(){' +
    'var pre=document.getElementById("gzPreview");' +
    'return {preview:(pre?pre.innerText:""),' +
    'timeInfo:(document.getElementById("timeInfo")||{}).innerText||""};})()');
  check('干支预览里已经没有阳历', b.preview.indexOf('阳历') < 0,
    b.preview.split('\n')[0] || '');
  check('占时卡片不再显示旧时刻', b.timeInfo.indexOf('2026年11月28日') < 0);

  /* 再点一次「排　盘」：新排出来的盘不许带着旧阳历 */
  await evalJs('(function(){var b=document.getElementById("btnGzPaipan");if(b)b.click();})()');
  await new Promise(function (r) { setTimeout(r, 1200); });
  const b2 = await evalJs('(function(){' +
    'var pre=document.getElementById("classicText");' +
    'var lines=(pre?pre.textContent:"").split("\\n");' +
    'return {solarLine:lines.filter(function(l){return l.indexOf("阳历")>=0;})[0]||"",' +
    'gzLine:lines.filter(function(l){return l.indexOf("干支")>=0;})[0]||""};})()');
  check('重新排盘后新盘上没有阳历', b2.solarLine === '', b2.solarLine || '(空)');
  check('重新排盘仍然用改过的日辰（与原盘不同）',
    !!b2.gzLine && b2.gzLine.indexOf('乙未日') < 0, b2.gzLine);

  console.log('③ 图上没有阳历那一行时，不许凭空造日期');
  const c = await importText(NO_SOLAR, 'CDP-nosolar');
  console.log('    阳历行：' + (c.solarLine || '(空，正确)'));
  check('没有阳历行', c.solarLine === '', c.solarLine || '(空)');
  check('四柱照样认得出来', c.gzLine.indexOf('乙未日') >= 0, c.gzLine);
  check('占时卡片里不出现「阳历」', c.timeInfo.indexOf('阳历') < 0);

  const fail = results.filter(function (r) { return !r.ok; }).length;
  console.log('\n结果：' + (results.length - fail) + ' 通过' + (fail ? '，' + fail + ' 失败' : ''));
  ws.close();
  process.exit(fail ? 1 : 0);
})().catch(function (e) {
  console.error('FAIL: ' + (e && e.message ? e.message : e));
  process.exit(2);
});