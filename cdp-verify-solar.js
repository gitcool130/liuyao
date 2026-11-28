/* 真机验证：新 exe 里「截图导入 → 盘面显示阳历」这条链是否通了
 *
 * 用法（必须与启动 exe 写在同一条命令里，进程会在工具调用间隙被回收）：
 *   node cdp-verify-solar.js <fixture文件> [port]
 *
 * 思路：Playwright 连不上内嵌 WebView2，直接用 CDP 协议（内置 WebSocket）
 *   ① 从 http://127.0.0.1:<port>/json/list 取 page 的 webSocketDebuggerUrl
 *   ② Runtime.evaluate 调 window.__lyOcrText(识别文本) → 解析并出预览条
 *   ③ 点 #btnOcrLoad 装入排盘
 *   ④ 读 #classicText 的前几行，看有没有「阳历：…」
 */
const fs = require('fs');
const http = require('http');

const FIX = process.argv[2];
const PORT = process.argv[3] || '9223';

function getJson(path) {
  return new Promise(function (resolve, reject) {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: path, timeout: 4000 }, function (res) {
      let buf = '';
      res.on('data', function (d) { buf += d; });
      res.on('end', function () {
        try { resolve(JSON.parse(buf)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.on('timeout', function () { req.destroy(new Error('timeout')); });
  });
}

/* 等 CDP 端口起来：exe 启动到 WebView2 就绪有 1~4 秒 */
async function waitPage() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await getJson('/json/list');
      const page = list.filter(function (t) { return t.type === 'page' && t.webSocketDebuggerUrl; })[0];
      if (page) return page;
    } catch (e) { /* 还没起来 */ }
    await new Promise(function (r) { setTimeout(r, 500); });
  }
  throw new Error('CDP 没起来（' + PORT + '）');
}

(async function () {
  const raw = fs.readFileSync(FIX, 'utf8')
    .split('\n').filter(function (l) { return /^\d+\t\d+\t/.test(l); }).join('\n');
  if (!raw) throw new Error('fixture 里没有带坐标的行：' + FIX);

  const page = await waitPage();
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let seq = 0;
  const waiting = new Map();

  ws.addEventListener('message', function (ev) {
    let msg;
    try { msg = JSON.parse(ev.data); } catch (e) { return; }
    const cb = waiting.get(msg.id);
    if (cb) { waiting.delete(msg.id); cb(msg); }
  });

  function send(method, params) {
    return new Promise(function (resolve, reject) {
      const id = ++seq;
      waiting.set(id, function (msg) {
        if (msg.error) reject(new Error(method + ' → ' + JSON.stringify(msg.error)));
        else resolve(msg.result);
      });
      ws.send(JSON.stringify({ id: id, method: method, params: params || {} }));
      setTimeout(function () {
        if (waiting.has(id)) { waiting.delete(id); reject(new Error(method + ' 超时')); }
      }, 20000);
    });
  }

  async function evalJs(expr) {
    const r = await send('Runtime.evaluate', {
      expression: expr, awaitPromise: true, returnByValue: true
    });
    if (r.exceptionDetails) {
      throw new Error('页面里报错：' + JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails));
    }
    return r.result && r.result.value;
  }

  await new Promise(function (resolve, reject) {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', function (e) { reject(new Error('WS 握手失败')); });
  });

  await send('Runtime.enable');

  /* 等页面脚本就绪（__lyOcrText 由 app.js 挂在 window 上） */
  let ready = false;
  for (let i = 0; i < 40; i++) {
    ready = await evalJs('typeof window.__lyOcrText === "function"');
    if (ready) break;
    await new Promise(function (r) { setTimeout(r, 500); });
  }
  if (!ready) throw new Error('页面里没有 __lyOcrText——app.js 没加载完？');

  /* 版本标记：新 exe 才有的 solarText 相关函数藏在闭包里，
   * 但「阳历」两字会出现在盘面上，装完直接读文本即可证明 */
  const parsed = await evalJs('(function(){var r=LY.ocrPaipan.parse(' + JSON.stringify(raw) + ');' +
    'return {solar:r.solar, ben:r.benName, bian:r.bianName, day:r.pillars.dayGZ};})()');
  console.log('解析：' + JSON.stringify(parsed));

  await evalJs('window.__lyOcrText(' + JSON.stringify(raw) + ', "CDP真机验证")');
  await new Promise(function (r) { setTimeout(r, 800); });

  const prev = await evalJs('(function(){var b=document.getElementById("ocrPreview");' +
    'return b?{shown:!b.hidden,text:b.innerText}:null;})()');
  console.log('预览条显示：' + (prev && prev.shown));
  if (prev && prev.text) {
    console.log('预览条含阳历：' + (prev.text.indexOf('阳历') >= 0));
  }

  const clicked = await evalJs('(function(){var b=document.getElementById("btnOcrLoad");' +
    'if(!b){return "no-button";} if(b.disabled){return "disabled";} b.click(); return "clicked";})()');
  console.log('装入按钮：' + clicked);
  await new Promise(function (r) { setTimeout(r, 1500); });

  const pan = await evalJs('(function(){' +
    'var pre=document.getElementById("classicText");' +
    'var lines=(pre?pre.textContent:"").split("\\n");' +
    'return {first:lines.slice(0,4), ' +
    'solarLine:lines.filter(function(l){return l.indexOf("阳历")>=0;})[0]||"", ' +
    'gzLine:lines.filter(function(l){return l.indexOf("干支")>=0;})[0]||"", ' +
    'timeInfo:(document.getElementById("timeInfo")||{}).innerText||"", ' +
    'gzHidden:(document.getElementById("gzCard")||{}).hidden};})()');

  console.log('--- 古籍版式前 4 行 ---');
  (pan.first || []).forEach(function (l, i) { console.log('  [' + i + '] ' + l); });
  console.log('干支行：' + pan.gzLine);
  console.log('阳历行：' + pan.solarLine);
  console.log('占时卡片：' + String(pan.timeInfo).replace(/\n/g, ' | '));
  console.log('干支面板展开：' + (pan.gzHidden === false));

  const passSolar = !!pan.solarLine && /阳历：\d{4}年\d{1,2}月\d{1,2}日 \d{2}:\d{2}/.test(pan.solarLine);
  const passTime = String(pan.timeInfo).indexOf('阳历') >= 0;
  const passGz = !!pan.gzLine && pan.gzLine.indexOf('干支') >= 0;
  console.log('\n结果：');
  console.log('  古籍版式有「阳历：年月日 时:分」→ ' + (passSolar ? 'PASS' : 'FAIL'));
  console.log('  占时卡片也显示阳历 → ' + (passTime ? 'PASS' : 'FAIL'));
  console.log('  干支行仍在（没有把四柱挤掉）→ ' + (passGz ? 'PASS' : 'FAIL'));

  ws.close();
  process.exit(passSolar && passTime && passGz ? 0 : 1);
})().catch(function (e) {
  console.error('FAIL: ' + (e && e.message ? e.message : e));
  process.exit(2);
});