/* ============================================================
 * 卦例同步：纯逻辑层 (core/sync.js)
 *
 * 目的：把「个人卦例库」在多台机器之间同步（OneDrive 文件夹 / WebDAV）。
 *
 * ## 为什么不是「整库覆盖」
 * 两台机器各自改过，覆盖就一定丢数据。这里照 LightRead（D:\AI\lr\LightRead
 * 的 services/sync）那套「状态型同步」做：
 *
 *   ① 每台设备只写**自己**的那个文件（远端 devices/<deviceId>.json），
 *      绝不写别人的 —— WebDAV 没有可靠的锁，只写自己的就不会互相踩。
 *   ② 每个文件里装的是「这台设备眼里的完整状态」。
 *   ③ 合并 = 把所有设备的文件按记录 id 取并集，同 id 取 updated_at 更新的那份。
 *      操作满足交换律 / 结合律 / 幂等：同步多少次、以什么顺序，结果都一样。
 *
 * ## 删除怎么办（关键）
 * 硬删除没法传播：A 机删了、B 机还有，B 一上传就把它复活了。
 * 所以删除要留**墓碑**（只记 id + 删除时间，不占空间），
 * 合并时「墓碑时间 > 记录更新时间」即视为删除。本地列表照样看不到它。
 *
 * ## 时间基准
 * 一律用记录的 updated_at（本地层每次写都刷新）。没有 updated_at 的老记录
 * 退回 created_at，再没有就当作很旧（epoch），这样总会被新版本盖掉。
 * ============================================================ */
(function (root) {
  'use strict';

  const FORMAT = 'lianzhai-liuyao-sync';
  const VERSION = 1;
  /** 单条记录上限，防远端被塞个大文件进来把内存吃爆 */
  const MAX_RECORD_CHARS = 400 * 1024;
  /** 单个设备文档上限（一条卦例几十 KB，几百条也就几 MB） */
  const MAX_DOC_CHARS = 24 * 1024 * 1024;

  /* ---------- 时间 ---------- */

  function stampOf(rec) {
    if (!rec || typeof rec !== 'object') return 0;
    const t = Date.parse(String(rec.updated_at || rec.created_at || ''));
    return isFinite(t) ? t : 0;
  }

  function timeOf(v) {
    if (!v) return 0;
    const t = Date.parse(String(v));
    return isFinite(t) ? t : 0;
  }

  /* id 必须与本地接口层 / 服务端的白名单一致（^[A-Za-z0-9_-]{1,64}$）。
   * 只查长度不够：带空格、感叹号的 id 能混进合并结果，落地时会被本地层
   * 整条丢掉——表现是「同步说成功，但这条卦例不见了」，最难查的一种。 */
  const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

  function isRecord(r) {
    return !!r && typeof r === 'object' && !Array.isArray(r) &&
      typeof r.id === 'string' && ID_RE.test(r.id);
  }

  /* ---------- 单台设备的文档 ---------- */

  /* 本地数组 → 设备文档（records 用 id 索引，方便合并时按 id 查）
   *
   * machine：机器标识（桌面壳给「机器名|用户名」的短哈希）。
   * 为什么要它：设备号存在 data\同步状态.json 里，用户把整个程序目录拷到
   * 另一台机器时，这个文件跟着走 —— 两台机器就成了「同一个设备」，
   * 写同一个文件、互相整份覆盖（2026-11-20 王哥实测栽过）。
   * 机器标识是**跟着机器走、不跟目录走**的，能识别出这种撞号。 */
  function toDoc(deviceId, records, tombstones, machine) {
    const recs = {};
    (records || []).forEach(function (r) {
      if (!isRecord(r)) return;
      let copy = r;
      // 超大记录跳过：宁可不同步，也不要让整份文档写失败/撑爆远端
      try {
        if (JSON.stringify(r).length > MAX_RECORD_CHARS) {
          console.warn('[sync] 跳过超大卦例 ' + r.id);
          return;
        }
      } catch (e) { return; }
      recs[r.id] = copy;
    });
    return {
      format: FORMAT,
      version: VERSION,
      deviceId: deviceId,
      machine: machine || '',
      savedAt: new Date().toISOString(),
      records: recs,
      tombstones: Object.assign({}, tombstones || {})
    };
  }

  /* 校验远端拿到的文档：不是我们的格式就拒掉，别把别人的 JSON 合进来 */
  function isDoc(v) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
    if (v.format !== FORMAT) return false;
    if (typeof v.deviceId !== 'string' || !v.deviceId) return false;
    if (!v.records || typeof v.records !== 'object' || Array.isArray(v.records)) return false;
    return true;
  }

  /* ---------- 合并 ---------- */

  /* docs: [{deviceId, records, tombstones}, ...] → { records: [..], tombstones: {..}, stats }
   *
   * 合并规则（逐 id）：
   *   - 记录取 updated_at 最新的那份；
   *   - 墓碑取最晚的删除时间；
   *   - 若最晚墓碑 > 最新记录的更新时间 → 该 id 删除（墓碑留下继续传播）；
   *   - 若记录比墓碑新（删除后在别处又改过 / 重新导入同 id）→ 保留记录、丢掉墓碑。
   * 纯函数，不改入参。 */
  function mergeDocs(docs) {
    const best = {};      // id → record
    const tomb = {};      // id → ISO string
    const seen = {};      // id → 来自哪些设备（便于报「新增几条」）
    let docCount = 0;

    (docs || []).forEach(function (d) {
      if (!isDoc(d)) return;
      docCount++;
      const recs = d.records || {};
      Object.keys(recs).forEach(function (id) {
        const r = recs[id];
        if (!isRecord(r)) return;
        if (!seen[id]) seen[id] = true;
        const cur = best[id];
        if (!cur || stampOf(r) > stampOf(cur)) best[id] = r;
      });
      const tb = d.tombstones || {};
      Object.keys(tb).forEach(function (id) {
        const at = typeof tb[id] === 'string' ? tb[id] : '';
        if (!at) return;
        if (!tomb[id] || timeOf(at) > timeOf(tomb[id])) tomb[id] = at;
      });
    });

    const out = [];
    const outTomb = {};
    const ids = Object.keys(Object.assign({}, best, tomb));

    ids.forEach(function (id) {
      const r = best[id] || null;
      const tAt = tomb[id] || '';
      if (tAt && (!r || timeOf(tAt) >= stampOf(r))) {
        /* 删除胜出：留墓碑继续传播，不带内容 */
        outTomb[id] = tAt;
        return;
      }
      if (r) {
        out.push(r);
        // 记录比墓碑新 → 墓碑作废（否则下次又被删掉，来回打摆子）
        if (tAt) return;
      }
    });

    // 稳定的输出顺序：新→旧；同一时间按 id 排，保证两台机器合并结果逐字一致
    out.sort(function (a, b) {
      const d = stampOf(b) - stampOf(a);
      if (d) return d;
      return String(a.id) < String(b.id) ? -1 : (String(a.id) > String(b.id) ? 1 : 0);
    });

    return {
      records: out,
      tombstones: outTomb,
      stats: { docs: docCount, records: out.length, tombstones: Object.keys(outTomb).length }
    };
  }

  /* 把「本地现在的状态」并成一份本文档：本地记录 + 本地墓碑 + 远端已有内容
   * 用来回答「这次同步实际改了什么」。 */
  function diffSummary(beforeIds, afterIds) {
    const b = {}, a = {};
    (beforeIds || []).forEach(function (id) { b[id] = 1; });
    (afterIds || []).forEach(function (id) { a[id] = 1; });
    let added = 0, removed = 0, same = 0;
    Object.keys(a).forEach(function (id) { if (b[id]) same++; else added++; });
    Object.keys(b).forEach(function (id) { if (!a[id]) removed++; });
    return { added: added, removed: removed, same: same };
  }

  const api = {
    FORMAT: FORMAT,
    VERSION: VERSION,
    MAX_RECORD_CHARS: MAX_RECORD_CHARS,
    MAX_DOC_CHARS: MAX_DOC_CHARS,
    stampOf: stampOf,
    timeOf: timeOf,
    isRecord: isRecord,
    isDoc: isDoc,
    toDoc: toDoc,
    mergeDocs: mergeDocs,
    diffSummary: diffSummary
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.LY = root.LY || {};
  root.LY.sync = api;
})(typeof window !== 'undefined' ? window : globalThis);
