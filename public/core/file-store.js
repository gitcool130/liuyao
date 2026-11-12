/* ============================================================
 * 文件通道 (core/file-store.js)
 *
 * 桌面壳里，卦例库不再只躺 WebView2 的 localStorage（那个 leveldb 文件
 * 既看不懂也拷不动），而是落成软件目录下的 JSON：
 *
 *     D:\greensoft\莲斋六爻排盘\data\卦例库.json
 *
 * 页面通过 window.chrome.webview 与壳通信；协议刻意用「换行分段」而不是
 * JSON——壳是 .NET Framework 4.x，没有内置 JSON 解析，手搓解析容易出错。
 *
 *   页面 → 壳： op \n id \n name \n payload
 *   壳 → 页面： id \n ok|err \n payload
 *
 * 没有壳（用浏览器打开 / 线上部署）时 available = false，调用方退回 localStorage。
 * ============================================================ */
(function (root) {
  'use strict';
  const W = root;
  const wv = (W.chrome && W.chrome.webview) ? W.chrome.webview : null;
  const pending = {};
  let seq = 0;

  if (wv && wv.addEventListener) {
    wv.addEventListener('message', function (ev) {
      const s = ev && ev.data;
      if (typeof s !== 'string') return;
      const i1 = s.indexOf('\n');
      if (i1 < 0) return;
      const id = s.slice(0, i1);
      const rest = s.slice(i1 + 1);
      const i2 = rest.indexOf('\n');
      const status = i2 < 0 ? rest : rest.slice(0, i2);
      const body = i2 < 0 ? '' : rest.slice(i2 + 1);
      const cb = pending[id];
      if (!cb) return;
      delete pending[id];
      if (status === 'ok') cb.resolve(body);
      else cb.reject(new Error(body || '壳返回错误'));
    });
  }

  function call(op, name, payload, timeout) {
    return new Promise(function (resolve, reject) {
      if (!wv || !wv.postMessage) { reject(new Error('NO_BRIDGE')); return; }
      const id = 'r' + (++seq) + '_' + Date.now().toString(36);
      pending[id] = { resolve: resolve, reject: reject };
      try {
        wv.postMessage(op + '\n' + id + '\n' + (name || '') + '\n' + (payload == null ? '' : String(payload)));
      } catch (e) {
        delete pending[id];
        reject(e);
        return;
      }
      // 写大文件可能慢一点，读文件不该等太久；超时宁可报错也不要静默
      setTimeout(function () {
        if (pending[id]) { delete pending[id]; reject(new Error('文件通道超时（' + op + '）')); }
      }, timeout || 10000);
    });
  }

  W.LY_FS = {
    available: !!(wv && wv.postMessage),
    info: function () { return call('info'); },
    read: function (name) { return call('read', name); },
    write: function (name, text) { return call('write', name, text, 30000); },
    list: function () { return call('list'); },
    open: function () { return call('open'); }
  };
})(typeof window !== 'undefined' ? window : globalThis);
