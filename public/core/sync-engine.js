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

  /* ---------- 机器指纹 ----------
   *
   * 设备号（deviceId）存在 data\同步状态.json 里，是「跟目录走」的：
   * 用户把整个程序目录拷到另一台机器，设备号跟着过去 → 两台机器自称同一个设备，
   * 写同一个文件、互相整份覆盖（2026-11-20 王哥实测：另一台的卦例全被本机盖掉）。
   *
   * 机器指纹要「跟机器走」：由桌面壳给「机器名|用户名」算短哈希。
   * 撞号时靠它认出来，然后本机自动换一个新设备号，数据就不会再打架。 */
  let _machine = null;

  async function machineId() {
    if (_machine != null) return _machine;
    let raw = '';
    const FS = W.LY_FS;
    if (FS && FS.available && FS.machine) {
      try { raw = await FS.machine(); } catch (e) { }
    }
    if (!raw) {
      // 浏览器里没有壳：退回一个稳定但区分度低的值。同步本来就需要壳，
      // 走到这儿只可能是自检，给个能跑的就行。
      try { raw = 'web|' + (navigator.userAgent || ''); } catch (e) { raw = 'web'; }
    }
    _machine = String(raw);
    return _machine;
  }

  /* 短哈希：只用来区分机器，不需要抗碰撞到加密强度 */
  function shortHash(txt) {
    let h1 = 0x811c9dc5, h2 = 0x01000193;
    const s2 = String(txt || '');
    for (let i = 0; i < s2.length; i++) {
      const c = s2.charCodeAt(i);
      h1 = (h1 ^ c) * 16777619 >>> 0;
      h2 = (h2 + c * 31 + (h2 << 5)) >>> 0;
    }
    return ('0000000' + h1.toString(16)).slice(-8) + ('0000000' + h2.toString(16)).slice(-8);
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

  /* 两份记录集是否等价（按 id + updated_at）。用来判断「自己名下的文件是不是我写的」：
   * 内容与本地完全一致时，谁写的都无所谓（覆盖也等于没改），不该算撞号。 */
  function sameRecordSet(a, b) {
    const ka = Object.keys(a || {}), kb = Object.keys(b || {});
    if (ka.length !== kb.length) return false;
    for (let i = 0; i < ka.length; i++) {
      const x = a[ka[i]], y = b[ka[i]];
      if (!y) return false;
      const ta = x && (x.updated_at || x.created_at) || '';
      const tb = y && (y.updated_at || y.created_at) || '';
      if (ta !== tb) return false;
    }
    return true;
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
    const machine = await machineId();
    const machineTag = shortHash(machine);

    /* 本地也算一份文档：否则首次同步时远端还没有本机的文件，本地卦例会「消失」。 */
    const localDoc = S2.toDoc(meta.deviceId, local, meta.tombstones, machineTag);
    const docs = [localDoc];

    const names = await be.list();

    /* ⚠ 这里**读所有文件，包括"自己名"的那个**。
     * 以前是 `if (nm === ownName) continue;`，理由是「自己那份等于本地现状」。
     * 那个理由只在「设备号全局唯一」时成立。一旦用户把程序目录拷到另一台机器，
     * 两台就共用一个设备号 —— 于是对方写的记录永远读不进来，接着被这边整份覆盖，
     * 对方那台的卦例全没了（2026-11-20 王哥实测）。
     * 读自己那份没有坏处：合并是幂等的，本地文档已经代表最新状态。 */
    const ownName = meta.deviceId + '.json';
    let foreign = 0;          // 同名但来自别台机器的文件数（撞号证据）
    let docsRead = 0;
    for (let i = 0; i < names.length; i++) {
      const nm = names[i];
      let doc = null;
      try { doc = await be.read(nm); } catch (e) { continue; }
      if (!S2.isDoc(doc)) continue;
      docsRead++;
      /* 撞号判定，两条证据任一成立就算：
       *   ① 文件名是我的设备号，但里面的 machine 不是我（新版写的文件才有此字段）；
       *   ② 文件名是我的设备号，但 savedAt 与我上次写它时记下的不一致
       *      —— 说明这个文件被别人改写过了。
       *
       * ② 是为老文件兜底的：撞号事故（2026-11-20）里的文件是旧版写的、没有 machine，
       * 只靠 ① 判不出来，另一台同步时还会覆盖。savedAt 是本机写完自己记下的，
       * 对不上就一定是别人动过。
       * 自己从没同步过（meta.ownSavedAt 空）时也按 ② 处理 —— 换号无害
       * （只是多一个文件名），被覆盖才是真丢数据。 */
      if (nm === ownName) {
        const machineMismatch = !!doc.machine && doc.machine !== machineTag;
        const stampMismatch = !doc.savedAt || doc.savedAt !== (meta.ownSavedAt || '');
        /* 内容与本地完全一致 → 就是我写的（或等价），不算撞号。
         * 少了这一条，本机升级后第一次同步会把自己的旧文件误判成「别人的」，
         * 白换一次设备号（无害但多余，且会在网盘上多留一个文件）。 */
        const sameContent = sameRecordSet(doc.records, localDoc.records);
        if (!sameContent && (machineMismatch || stampMismatch)) foreign++;
      }
      docs.push(doc);
    }

    const merged = S2.mergeDocs(docs);
    const beforeIds = local.map(function (r) { return r.id; });
    const afterIds = merged.records.map(function (r) { return r.id; });
    const diff = S2.diffSummary(beforeIds, afterIds);

    if (opts && opts.dryRun) {
      return { ok: true, dryRun: true, stats: merged.stats, diff: diff, devices: docs.length, dir: await be.dir ? '' : '' };
    }

    /* ① 落地前先过一道闸：本机记录不该无故减少。
     *
     * 只有「墓碑时间 >= 记录更新时间」才会被删，所以正常同步不会凭空少记录。
     * 真出现「本地有、合并后没了、又没墓碑」的情况，说明合并逻辑或远端文件有问题，
     * 这时宁可中止并报错，也不要静默把本机数据覆盖掉——数据丢一次就找不回来了。 */
    const tomb = merged.tombstones || {};
    const lost = [];
    for (let i = 0; i < local.length; i++) {
      const r = local[i];
      if (afterIds.indexOf(r.id) >= 0) continue;
      const tAt = tomb[r.id] ? S2.timeOf(tomb[r.id]) : 0;
      if (tAt && tAt >= S2.stampOf(r)) continue;    // 有墓碑依据，正常删除
      lost.push(r.id);
    }
    if (lost.length) {
      throw new Error('同步已中止：有 ' + lost.length + ' 条本机卦例会被无依据地删掉' +
        '（' + lost.slice(0, 3).join('、') + (lost.length > 3 ? ' 等' : '') + '）。' +
        '为免丢数据，本次没有写入任何内容。请把网盘上的同步文件留着，反馈给开发者。');
    }

    // ② 落地本地（整库替换，保持 updated_at 原样）
    await writeLocalRecords(merged.records);

    // ③ 墓碑以合并结果为准（记录比墓碑新的那些清掉）
    const m2 = await readMeta();
    m2.tombstones = merged.tombstones || {};
    await writeMeta(m2);
    await pruneTombstones(merged.records);

    /* ④ 写自己那份。
     *
     * 撞号（foreign > 0 或远端自己名的文件里 machine 不是我）时：**换一个新设备号**，
     * 用自己的号写新文件，绝不覆盖对方那份。老文件原样留着——它里面是对方的记录，
     * 删了就真丢了。换个号之后两台机器各写各的，从此不再打架。 */
    const metaNow = await readMeta();
    let writeName = metaNow.deviceId + '.json';
    if (foreign > 0) {
      const oldId = metaNow.deviceId;
      metaNow.deviceId = newDeviceId();
      await writeMeta(metaNow);
      writeName = metaNow.deviceId + '.json';
      try { console.warn('[sync] 检测到设备号撞车，已换新号：' + oldId + ' → ' + metaNow.deviceId); } catch (e) { }
    }
    const ownDoc = S2.toDoc(metaNow.deviceId, merged.records, (await readMeta()).tombstones, machineTag);
    await be.write(writeName, ownDoc);

    /* 记下「我上次写这个文件时的 savedAt」。下次同步拿它对账：
     * 对不上就说明文件被别人改过（撞号），据此换号止损。 */
    const mLast = await readMeta();
    mLast.ownSavedAt = ownDoc.savedAt;
    mLast.ownFile = writeName;
    await writeMeta(mLast);

    const c2 = loadCfg();
    c2.lastAt = nowIso();
    c2.lastResult = '成功 · 本机 ' + merged.records.length + ' 条（新增 ' + diff.added + '，移除 ' + diff.removed + '）';
    saveCfg(c2);

    return {
      ok: true,
      stats: merged.stats,
      diff: diff,
      devices: docs.length,
      localCount: merged.records.length,
      /* 撞号信息交给界面显示：这是「两台机器共用了一个设备号」的证据，
       * 用户必须知道——否则他会以为同步正常，其实两边一直在互相覆盖。 */
      collision: foreign > 0,
      oldDeviceId: foreign > 0 ? meta.deviceId : '',
      newDeviceId: foreign > 0 ? metaNow.deviceId : ''
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
