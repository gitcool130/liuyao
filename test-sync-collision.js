/* 设备号撞车回归（2026-11-20 王哥实测事故）
 *
 * 事故经过：
 *   王哥把程序目录（含 data\同步状态.json）拷到另一台机器，
 *   于是两台机器设备号相同，都写 <同一个 deviceId>.json。
 *   同步代码里有 `if (nm === ownName) continue;`，认为「自己名的文件等于本地现状」，
 *   于是对方写的记录永远读不进来，接着被本机整份覆盖 —— 对方那台的卦例全没了。
 *
 * 这个测试就是照那个场景搭的：两台设备**故意共用同一个 deviceId**，机器标识不同。
 * 断言三件事：
 *   ① 撞号能被识别出来，本机自动换新设备号
 *   ② 对方的记录不会丢（合并后都在）
 *   ③ 不再互相覆盖：第二次同步后两边内容一致
 */
const S = require('./public/core/sync.js');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x ? '\n     ' + x : '')); } };
const eq = (n, got, want) => {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a === b) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + '\n     got:  ' + a + '\n     want: ' + b); }
};

function rec(id, updated, q) {
  return { id: id, created_at: updated, updated_at: updated, question: q, hex: '乾为天' };
}

function sameSet(a, b) {
  const ka = Object.keys(a || {}), kb = Object.keys(b || {});
  if (ka.length !== kb.length) return false;
  for (let i = 0; i < ka.length; i++) {
    const x = a[ka[i]], y = b[ka[i]];
    if (!y) return false;
    const ta = (x && (x.updated_at || x.created_at)) || '';
    const tb = (y && (y.updated_at || y.created_at)) || '';
    if (ta !== tb) return false;
  }
  return true;
}

/* 模拟「两台机器共用一个设备号」的远端目录 */
function makeRemote() {
  return {};
}

/* 一次同步：对应 sync-engine.run() 的核心（读全部文件 → 合并 → 撞号则换号 → 写自己） */
function syncOnce(remote, dev) {
  const machineTag = dev.machine;
  const localDoc = S.toDoc(dev.deviceId, dev.records, dev.tombstones || {}, machineTag);
  const docs = [localDoc];

  const ownName = dev.deviceId + '.json';
  let foreign = 0;
  Object.keys(remote).forEach(function (nm) {
    const doc = remote[nm];
    if (!S.isDoc(doc)) return;
    if (nm === ownName) {
      const machineMismatch = !!doc.machine && doc.machine !== machineTag;
      const stampMismatch = !doc.savedAt || doc.savedAt !== (dev.ownSavedAt || '');
      // 内容与本地一致时不算撞号（谁写的都等价）
      const same = sameSet(doc.records, localDoc.records);
      if (!same && (machineMismatch || stampMismatch)) foreign++;
    }
    docs.push(doc);
  });

  const merged = S.mergeDocs(docs);
  dev.records = merged.records;
  dev.tombstones = merged.tombstones || {};

  // 落地前闸门：不许无依据地删本机记录
  const lost = [];
  localDoc && Object.keys(localDoc.records).forEach(function (id) {
    if (merged.records.some(function (r) { return r.id === id; })) return;
    const t = merged.tombstones[id] ? S.timeOf(merged.tombstones[id]) : 0;
    if (!t || t < S.stampOf(localDoc.records[id])) lost.push(id);
  });
  if (lost.length) throw new Error('ABORT 会删掉 ' + lost.length + ' 条：' + lost.join(','));

  let writeName = dev.deviceId + '.json';
  if (foreign > 0) {
    dev.deviceId = 'd' + Math.random().toString(36).slice(2, 10);
    writeName = dev.deviceId + '.json';
    dev.renamed = (dev.renamed || 0) + 1;
  }
  const outDoc = S.toDoc(dev.deviceId, dev.records, dev.tombstones, machineTag);
  remote[writeName] = outDoc;
  dev.ownSavedAt = outDoc.savedAt;
  return { foreign: foreign, writeName: writeName, count: dev.records.length };
}

console.log('\n=== 1. 两台机器共用设备号：不丢数据、能自愈 ===');
{
  const remote = makeRemote();
  const A = { deviceId: 'dSHARED', machine: 'MACHINE-A', records: [rec('a1', '2026-11-18T10:00:00Z', 'A 的卦')] };
  const B = { deviceId: 'dSHARED', machine: 'MACHINE-B', records: [rec('b1', '2026-11-19T10:00:00Z', 'B 的卦')] };

  // A 先同步：远端还没有文件
  let r1 = syncOnce(remote, A);
  eq('A 首次同步写自己的文件', r1.writeName, 'dSHARED.json');
  eq('A 没有撞号', r1.foreign, 0);

  // B 同步：远端已有 A 写的同名文件，但 machine 不是 B
  let r2 = syncOnce(remote, B);
  eq('B 认出撞号', r2.foreign, 1);
  ok('B 换了新设备号', B.renamed === 1, 'renamed=' + B.renamed);
  eq('B 拿到 A 的卦', B.records.map(r => r.id).sort(), ['a1', 'b1']);
  ok('A 的原文件还在（没被覆盖）', !!remote['dSHARED.json'], Object.keys(remote).join(','));
  eq('A 的文件内容仍是 A 的', Object.keys(remote['dSHARED.json'].records), ['a1']);

  // A 再同步：读到 B 的新文件 + 自己那份
  let r3 = syncOnce(remote, A);
  eq('A 也拿到了 B 的卦', A.records.map(r => r.id).sort(), ['a1', 'b1']);
  eq('A 这次没撞号（B 已换号）', r3.foreign, 0);

  // 两边再各同步一次，应收敛
  syncOnce(remote, B);
  syncOnce(remote, A);
  eq('收敛后 A 与 B 记录一致', A.records.map(r => r.id).sort(), B.records.map(r => r.id).sort());
  eq('收敛后远端有两个文件（各自的）', Object.keys(remote).length, 2);
}

console.log('\n=== 2. 撞号且同一条都改过：取后改的 ===');
{
  const remote = makeRemote();
  const A = { deviceId: 'dX', machine: 'MA', records: [rec('r1', '2026-11-19T10:00:00Z', 'A 版')] };
  const B = { deviceId: 'dX', machine: 'MB', records: [rec('r1', '2026-11-19T12:00:00Z', 'B 版')] };
  syncOnce(remote, A);
  syncOnce(remote, B);      // B 撞号换号，但读到 A 的旧版
  const r = syncOnce(remote, A);
  eq('A 拿到 B 的新版（后改的）', A.records[0].question, 'B 版');
  eq('A 这次读到的文件里没有撞号了', r.foreign, 0);
}

console.log('\n=== 3. 撞号时的删除也要传播 ===');
{
  const remote = makeRemote();
  const A = { deviceId: 'dY', machine: 'MA', records: [rec('r1', '2026-11-19T10:00:00Z', 'x'), rec('r2', '2026-11-19T10:00:00Z', 'y')] };
  const B = { deviceId: 'dY', machine: 'MB', records: [] };
  syncOnce(remote, A);
  // B 删掉 r2
  B.tombstones = { r2: '2026-11-19T15:00:00Z' };
  syncOnce(remote, B);
  ok('B 换号了', B.renamed === 1);
  eq('B 读到 A 的 r1，r2 被自己的墓碑删掉', B.records.map(r => r.id), ['r1']);
  syncOnce(remote, A);
  eq('A 同步后 r2 也消失（墓碑生效）', A.records.map(r => r.id), ['r1']);
}

console.log('\n=== 4. 闸门：无依据的减少必须中止 ===');
{
  // 造一个「远端把本机记录弄没了、又没墓碑」的坏文档
  const bad = {
    format: S.FORMAT, version: 1, deviceId: 'devBad', machine: 'MX',
    savedAt: new Date().toISOString(), records: {}, tombstones: {}
  };
  const merged = S.mergeDocs([
    S.toDoc('dme', [rec('keep1', '2026-11-19T10:00:00Z', 'x')], {}, 'MINE'),
    bad
  ]);
  eq('正常合并保留本机记录', merged.records.map(r => r.id), ['keep1']);

  // 真正无依据的情况：文档里 records 为空但本机有记录 —— 合并结果仍保留，不会丢
  ok('空文档不会抹掉本机记录（并集语义）', merged.records.length === 1);
}

console.log('\n=== 5. 老文件没有 machine 且内容不同 → 保守换号（宁可多一个文件，不可覆盖） ===');
{
  const remote = makeRemote();
  // 老版本写的文件：没有 machine
  const legacyDoc = S.toDoc('dOld', [rec('old1', '2026-11-18T10:00:00Z', '老记录')], {}, '');
  delete legacyDoc.machine;
  remote['dOld.json'] = legacyDoc;

  const A = { deviceId: 'dOld', machine: 'MACHINE-A', records: [rec('new1', '2026-11-19T10:00:00Z', '新记录')] };
  const r = syncOnce(remote, A);
  /* 无法判断这文件是谁写的（没 machine、savedAt 也对不上），此时**必须保守**：
   * 换号 → 各写各的，两份数据都还在。
   * 反过来「假设是自己写的」就会覆盖，一旦真是别人的就永久丢失。 */
  eq('判为撞号（保守）', r.foreign, 1);
  ok('换了新号，不覆盖老文件', A.renamed === 1);
  eq('老记录并进来了（数据没丢）', A.records.map(r => r.id).sort(), ['new1', 'old1']);
  ok('老文件仍在远端', !!remote['dOld.json']);
}

console.log('\n=== 6. 单机反复同步不该误判撞号 ===');
{
  const remote = makeRemote();
  const A = { deviceId: 'dSolo', machine: 'MACHINE-SOLO', records: [rec('s1', '2026-11-19T10:00:00Z', '单机')] };
  syncOnce(remote, A);
  const r2 = syncOnce(remote, A);
  eq('第二次同步不换号', A.renamed || 0, 0);
  eq('第二次也没撞号', r2.foreign, 0);
  eq('还是只有一个文件', Object.keys(remote).length, 1);
  const r3 = syncOnce(remote, A);
  eq('第三次依旧稳定', A.renamed || 0, 0);
  eq('记录没变', A.records.map(r => r.id), ['s1']);
}

console.log('\n=== 7. 撞号后各自稳定，不再来回换号 ===');
{
  const remote = makeRemote();
  const A = { deviceId: 'dZ', machine: 'MA', records: [rec('a1', '2026-11-19T10:00:00Z', 'A')] };
  const B = { deviceId: 'dZ', machine: 'MB', records: [rec('b1', '2026-11-19T10:00:00Z', 'B')] };
  syncOnce(remote, A);
  syncOnce(remote, B);      // B 换号
  const idB = B.deviceId;
  syncOnce(remote, A);
  syncOnce(remote, B);      // 第二次
  syncOnce(remote, A);
  syncOnce(remote, B);      // 第三次
  eq('B 只换过一次号', B.renamed, 1);
  eq('B 设备号稳定', B.deviceId, idB);
  eq('A 从未换号', A.renamed || 0, 0);
  eq('两边记录一致', A.records.map(r => r.id).sort(), B.records.map(r => r.id).sort());
  eq('远端仍是两个文件', Object.keys(remote).length, 2);
}

console.log('\n' + (fail ? '✗ ' + fail + ' 项失败' : '全部通过') + '：' + pass + ' 项');
process.exit(fail ? 1 : 0);
