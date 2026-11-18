/* ============================================================
 * 卦例同步引擎 (core/sync-engine.js)
 *
 * 依赖 core/sync.js 的纯合并逻辑，负责：
 *   ① 记住本机设备号（deviceId）与删除墓碑（tombstones）
 *   ② 拉远端所有设备文档 → 合并 → 落地本地 → 把自己的那份写回
 *   ③ 两种后端：OneDrive 文件夹（本机路径，客户端自动上传）、WebDAV（壳发 HTTP）
 *
 * ## 为什么 OneDrive 不用 WebDAV
 * OneDrive 早就没有公开的 WebDAV 端点了（早年 SkyDrive 有，2016 年前后关掉），
 * 现在只能靠官方同步客户端。所以这里走「直接把文件写进你本机的 OneDrive 文件夹」，
 * 由客户端负责上传/下载 —— 效果与同步客户端里其它文件一样，且不需要任何令牌。
 *
 * ## 为什么 WebDAV 要放在外壳里做
 * 浏览器里发不了 WebDAV 的 PROPFIND（跨域预检必然失败），也带不了 Basic 认证
 * 的自定义头。所以由 .NET 外壳代发请求，页面只跟壳对话（同 OCR 那套）。
 * ============================================================ */
(function (root) {
  'use strict';
  const W = root;

  const CFG_KEY = 'ly_sync_cfg_v1';     // 后端配置（WebDAV 密码也在本机）
  const META_KEY = 'ly_sync_meta_v1';   // deviceId + tombstones
  const META_FILE = '同步状态.json';     // 桌面壳里优先落文件（清浏览器缓存也不丢）

  function nowIso() { return new Date().toISOString(); }

  function S() {
    const s = W.LY && W.LY.sync;
    if (!s) throw new Error('缺 core/sync.js');
    return s;
  }

  /* ---------- 配置 ---------- */

  const DEFAULT_CFG = {
    backend: '',          // '' | 'onedrive' | 'webdav'
    davUrl: '',           // 例：https://dav.jianguoyun.com/dav/莲斋六爻排盘
    davUser: '',
    davPass: '',
    auto: false,          // 打开程序时自动同步一次
    lastAt: '',
    lastResult: ''
  };

  function loadCfg() {
    try {
      const raw = JSON.parse(localStorage.getItem(CFG_KEY) || '{}');
      return Object.assign({}, DEFAULT_CFG, raw && typeof raw === 'object' ? raw : {});
    } catch (e) { return Object.assign({}, DEFAULT_CFG); }
  }

  function saveCfg(cfg) {
    const clean = Object.assign({}, DEFAULT_CFG, cfg || {});
    try { localStorage.setItem(CFG_KEY, JSON.stringify(clean)); } catch (e) { }
    return clean;
  }

  /* ---------- 设备号与墓碑 ---------- */

  function newDeviceId() {
    // 短、可读、够用：od- 前缀表示「谁都能认出来这是个设备号」
    return 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  let _meta = null;

  async function readMeta() {
    if (_meta) return _meta;
    let meta = null;
    const FS = W.LY_FS;
    if (FS && FS.available) {
      try {
        const txt = await FS.read(META_FILE);
        if (txt) meta = JSON.parse(txt);
      } catch (e) { }
    }
    if (!meta) {
      try { meta = JSON.parse(localStorage.getItem(META_KEY) || 'null'); } catch (e) { }
    }
    if (!meta || typeof meta !== 'object') meta = {};
    if (typeof meta.deviceId !== 'string' || !meta.deviceId) meta.deviceId = newDeviceId();
    if (!meta.tombstones || typeof meta.tombstones !== 'object' || Array.isArray(meta.tombstones)) meta.tombstones = {};
    _meta = meta;
    await writeMeta(meta);
    return meta;
  }

  async function writeMeta(meta) {
    _meta = meta;
    const txt = JSON.stringify(meta, null, 1);
    const FS = W.LY_FS;
    if (FS && FS.available) {
      try { await FS.write(META_FILE, txt); } catch (e) { }
    }
    try { localStorage.setItem(META_KEY, txt); } catch (e) { }
  }

  /* 记一条删除墓碑。应用删卦例时调用；留墓碑才不会被别的设备「复活」。 */
  async function noteDeleted(id) {
    if (!id) return;
    const meta = await readMeta();
    meta.tombstones[id] = nowIso();
    // 顺手清掉自己的副本里同 id 的记录（调用方通常已经删了，这里兜底）
    await writeMeta(meta);
  }

  /** 删掉的记录如果在合并后又出现，说明有设备比墓碑新，要把墓碑作废 */
  async function pruneTombstones(records) {
    const meta = await readMeta();
    const S2 = S();
    let changed = false;
    const alive = {};
    (records || []).forEach(function (r) { if (r && r.id) alive[r.id] = S2.stampOf(r); });
    Object.keys(meta.tombstones).forEach(function (id) {
      const tAt = S2.timeOf(meta.tombstones[id]);
      if (alive[id] === undefined) return;              // 记录不在，墓碑留着继续传播
      if (alive[id] >= tAt) { delete meta.tombstones[id]; changed = true; }  // 比墓碑新 → 复活
    });
    if (changed) await writeMeta(meta);
    return meta;
  }

  /* ---------- 本地读写（经本地接口层，与页面同一条路） ---------- */

  async function readLocalRecords() {
    const res = await W.fetch('/api/records?limit=200&offset=0', {});
    if (!res.ok) throw new Error('读本地卦例失败（HTTP ' + res.status + '）');
    const d = await res.json();
    let all = Array.isArray(d.records) ? d.records.slice() : [];
    let offset = all.length;
    // 超过一页就继续拉（同步要全量）
    while (d.hasMore && all.length < 5000) {
      const r2 = await W.fetch('/api/records?limit=200&offset=' + offset, {});
      if (!r2.ok) break;
      const d2 = await r2.json();
      const page = Array.isArray(d2.records) ? d2.records : [];
      if (!page.length) break;
      all = all.concat(page);
      offset += page.length;
      if (!d2.hasMore) break;
    }
    return all;
  }

  /* 落地：整体替换本地库。逐条 POST 会改写 updated_at，那样合并结果就变形了，
   * 所以走一条专用的「整库落地」通道（local-api 里 ?replace=1）。 */
  async function writeLocalRecords(records) {
    const res = await W.fetch('/api/records?replace=1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ records: records || [] })
    });
    if (!res.ok) {
      const d = await res.json().catch(function () { return {}; });
      throw new Error(d.message || ('写入本地失败 HTTP ' + res.status));
    }
  }

  /* ---------- 后端：OneDrive 文件夹（壳代写） ---------- */

  function needShell(what) {
    const FS = W.LY_FS;
    if (!FS || !FS.available) {
      throw new Error(what + '需要桌面版（浏览器里没有本机文件与 WebDAV 能力）');
    }
    return FS;
  }

  const onedrive = {
    id: 'onedrive',
    label: 'OneDrive 文件夹',
    ready: function () { return !!(W.LY_FS && W.LY_FS.available && W.LY_FS.odSync); },
    dir: async function () {
      const FS = needShell('OneDrive 同步');
      return FS.odSync('dir', '', '');
    },
    list: async function () {
      const FS = needShell('OneDrive 同步');
      const txt = await FS.odSync('list', '', '');
      return String(txt || '').split('\u0001').filter(Boolean);
    },
    read: async function (name) {
      const FS = needShell('OneDrive 同步');
      const txt = await FS.odSync('read', name, '');
      if (!txt) return null;
      try { return JSON.parse(txt); } catch (e) { return null; }
    },
    write: async function (name, doc) {
      const FS = needShell('OneDrive 同步');
      await FS.odSync('write', name, JSON.stringify(doc));
      return true;
    }
  };

  /* ---------- 后端：WebDAV（壳代发请求） ---------- */

  const webdav = {
    id: 'webdav',
    label: 'WebDAV',
    ready: function () { return !!(W.LY_FS && W.LY_FS.available && W.LY_FS.dav); },
    cfg: function () { return loadCfg(); },
    call: async function (method, file, body) {
      const FS = needShell('WebDAV 同步');
      const c = loadCfg();
      if (!c.davUrl) throw new Error('还没填 WebDAV 地址');
      // 协议：name 传动作，payload 传 url / 用户 / 密码 / 正文（分四行）
      const payload = [c.davUrl, c.davUser || '', c.davPass || '', body == null ? '' : String(body)].join('\n');
      const out = await FS.dav(method + ' ' + (file || ''), '', payload);
      return out;
    },
    list: async function () {
      const xml = await this.call('LIST', '');
      const names = [];
      const re = /<(?:[A-Za-z_][\w.-]*:)?href(?:\s[^>]*)?>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?href\s*>/gi;
      let m;
      while ((m = re.exec(String(xml || '')))) {
        let href = String(m[1] || '').trim();
        try { href = decodeURIComponent(href); } catch (e) { }
        if (!href || href.charAt(href.length - 1) === '/') continue;
        const base = href.split('?')[0].split('/').pop() || '';
        if (!/\.json$/i.test(base)) continue;
        names.push(base);
      }
      return Array.from(new Set(names));
    },
    read: async function (name) {
      const txt = await this.call('READ', name);
      if (!txt) return null;
      try { return JSON.parse(txt); } catch (e) { return null; }
    },
    write: async function (name, doc) {
      await this.call('WRITE', name, JSON.stringify(doc));
      return true;
    }
  };

  function backend(id) {
    if (id === 'onedrive') return onedrive;
    if (id === 'webdav') return webdav;
    return null;
  }

  /* ---------- 一次同步 ---------- */

  /* opts: { backend: 'onedrive'|'webdav', dryRun } */
  async function run(opts) {
    const S2 = S();
    const cfg = loadCfg();
    const id = (opts && opts.backend) || cfg.backend;
    const be = backend(id);
    if (!be) throw new Error('还没选同步方式（OneDrive 或 WebDAV）');
    if (!be.ready()) throw new Error(be.label + ' 需要桌面版程序');

    const meta = await readMeta();
    const local = await readLocalRecords();

    /* 本地也算一份文档：否则首次同步时远端还没有本机的文件，本地卦例会「消失」。 */
    const localDoc = S2.toDoc(meta.deviceId, local, meta.tombstones);
    const docs = [localDoc];

    const names = await be.list();
    const ownName = meta.deviceId + '.json';
    for (let i = 0; i < names.length; i++) {
      const nm = names[i];
      if (nm === ownName) continue;         // 自己那份已经用本地现状代替（更新）
      let doc = null;
      try { doc = await be.read(nm); } catch (e) { continue; }
      if (S2.isDoc(doc)) docs.push(doc);
    }

    const merged = S2.mergeDocs(docs);
    const beforeIds = local.map(function (r) { return r.id; });
    const afterIds = merged.records.map(function (r) { return r.id; });
    const diff = S2.diffSummary(beforeIds, afterIds);

    if (opts && opts.dryRun) {
      return { ok: true, dryRun: true, stats: merged.stats, diff: diff, devices: docs.length, dir: await be.dir ? '' : '' };
    }

    // ① 落地本地（整库替换，保持 updated_at 原样）
    await writeLocalRecords(merged.records);

    // ② 墓碑以合并结果为准（记录比墓碑新的那些清掉）
    const m2 = await readMeta();
    m2.tombstones = merged.tombstones || {};
    await writeMeta(m2);
    await pruneTombstones(merged.records);

    // ③ 写自己那份（只写自己的，绝不碰别人的文件）
    const ownDoc = S2.toDoc(meta.deviceId, merged.records, (await readMeta()).tombstones);
    await be.write(ownName, ownDoc);

    const c2 = loadCfg();
    c2.lastAt = nowIso();
    c2.lastResult = '成功 · 本机 ' + merged.records.length + ' 条（新增 ' + diff.added + '，移除 ' + diff.removed + '）';
    saveCfg(c2);

    return {
      ok: true,
      stats: merged.stats,
      diff: diff,
      devices: docs.length,
      localCount: merged.records.length
    };
  }

  const api = {
    loadCfg: loadCfg,
    saveCfg: saveCfg,
    readMeta: readMeta,
    writeMeta: writeMeta,
    noteDeleted: noteDeleted,
    pruneTombstones: pruneTombstones,
    readLocalRecords: readLocalRecords,
    writeLocalRecords: writeLocalRecords,
    deviceId: async function () { return (await readMeta()).deviceId; },
    tombstones: async function () { return (await readMeta()).tombstones; },
    backend: backend,
    backends: [onedrive, webdav],
    run: run
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  W.LY = W.LY || {};
  W.LY.syncEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
