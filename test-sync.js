/* 卦例同步：合并逻辑单测（纯函数，不需要浏览器）
 *
 * 重点验四件事：
 *   ① 按 updated_at 后写胜
 *   ② 删除靠墓碑传播，软删不会复活
 *   ③ 合并满足交换律 / 结合律 / 幂等（这就是「同步多少次结果都一样」的保证）
 *   ④ 脏数据（别的 JSON、超大记录、坏 id）不会污染合并结果
 */
const S = require('./public/core/sync.js');

let pass = 0, fail = 0;
function eq(name, got, want) {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a === b) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + '\n     got: ' + a + '\n    want: ' + b); }
}
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '\n     ' + extra : '')); }
}

function rec(id, updated, extra) {
  return Object.assign({ id: id, updated_at: updated, question: 'q-' + id, hex: '乾为天' }, extra || {});
}
function doc(deviceId, records, tombstones) {
  return S.toDoc(deviceId, records, tombstones || {});
}

console.log('\n=== 1. 基本合并：后写胜 ===');
{
  const a = doc('devA', [rec('r1', '2026-11-18T10:00:00Z', { question: 'A 的版本' })]);
  const b = doc('devB', [rec('r1', '2026-11-18T12:00:00Z', { question: 'B 的版本' })]);
  const m = S.mergeDocs([a, b]);
  eq('取更新时间更晚的那份', m.records.length, 1);
  eq('内容是 B 的', m.records[0].question, 'B 的版本');
  eq('无墓碑', m.tombstones, {});
}

console.log('\n=== 2. 两台设备各自的新记录都要在 ===');
{
  const a = doc('devA', [rec('r1', '2026-11-18T10:00:00Z'), rec('r2', '2026-11-18T10:05:00Z')]);
  const b = doc('devB', [rec('r3', '2026-11-18T11:00:00Z')]);
  const m = S.mergeDocs([a, b]);
  eq('三条并集', m.records.length, 3);
  // 输出按时间新→旧，且同时间按 id 稳定排
  eq('排序新→旧', m.records.map(r => r.id), ['r3', 'r2', 'r1']);
}

console.log('\n=== 3. 删除靠墓碑传播 ===');
{
  // B 机删了 r1，留墓碑；A 机还留着 r1
  const a = doc('devA', [rec('r1', '2026-11-18T10:00:00Z')], {});
  const b = doc('devB', [], { r1: '2026-11-18T13:00:00Z' });
  const m = S.mergeDocs([a, b]);
  eq('墓碑更新的那条不出现', m.records.length, 0);
  eq('墓碑保留（继续传播给第三台）', Object.keys(m.tombstones), ['r1']);
}

console.log('\n=== 4. 删除后又在别处改过 → 记录胜出，墓碑作废 ===');
{
  // r1 在 13:00 被删，但 14:00 又在 A 机改了（说明用户后悔/重新导入）
  const a = doc('devA', [rec('r1', '2026-11-18T14:00:00Z', { question: '改过' })], {});
  const b = doc('devB', [], { r1: '2026-11-18T13:00:00Z' });
  const m = S.mergeDocs([a, b]);
  eq('记录回来', m.records.length, 1);
  eq('墓碑被清掉（否则下次又被删）', Object.keys(m.tombstones).length, 0);
}

console.log('\n=== 5. 交换律：顺序不影响结果 ===');
{
  const a = doc('devA', [rec('r1', '2026-11-18T10:00:00Z'), rec('r2', '2026-11-18T09:00:00Z')], { r3: '2026-11-18T08:00:00Z' });
  const b = doc('devB', [rec('r2', '2026-11-18T11:00:00Z'), rec('r4', '2026-11-18T07:00:00Z')], {});
  // r4 的记录是 07:00，墓碑故意设成 08:00（更晚）才算真删除
  const c = doc('devC', [rec('r1', '2026-11-18T12:00:00Z')], { r4: '2026-11-18T08:00:00Z' });
  const m1 = S.mergeDocs([a, b, c]);
  const m2 = S.mergeDocs([c, a, b]);
  const m3 = S.mergeDocs([b, c, a]);
  eq('ABC 与 CAB 结果一致', m1.records, m2.records);
  eq('ABC 与 BCA 结果一致', m1.records, m3.records);
  eq('墓碑也一致', m1.tombstones, m2.tombstones);
  // r3 只有 A 有墓碑、无人有记录 → 删除；r4 有记录+墓碑且记录更旧 → 删除
  eq('结果只剩 r1 r2', m1.records.map(r => r.id), ['r1', 'r2']);
  ok('r1 取最新（C 的 12:00）', m1.records[0].question === 'q-r1');
}

console.log('\n=== 6. 幂等：合并结果再合一次不变 ===');
{
  const a = doc('devA', [rec('r1', '2026-11-18T10:00:00Z')], {});
  const b = doc('devB', [rec('r2', '2026-11-18T11:00:00Z')], { r9: '2026-11-18T09:00:00Z' });
  const m1 = S.mergeDocs([a, b]);
  // 用合并结果造一份新文档，再合
  const m2 = S.mergeDocs([S.toDoc('devX', m1.records, m1.tombstones)]);
  eq('第二次结果与第一次一致', m2.records, m1.records);
  eq('墓碑也一致', m2.tombstones, m1.tombstones);
}

console.log('\n=== 7. 结合律：分组合并等价于一起合并 ===');
{
  const a = doc('devA', [rec('r1', '2026-11-18T10:00:00Z')], {});
  const b = doc('devB', [rec('r1', '2026-11-18T12:00:00Z')], {});
  const c = doc('devC', [rec('r2', '2026-11-18T11:00:00Z')], {});
  const all = S.mergeDocs([a, b, c]);
  const ab = S.mergeDocs([a, b]);
  const abThenC = S.mergeDocs([S.toDoc('devX', ab.records, ab.tombstones), c]);
  eq('(a·b)·c == a·b·c', abThenC.records, all.records);
}

console.log('\n=== 8. 脏数据不污染 ===');
{
  const good = doc('devA', [rec('r1', '2026-11-18T10:00:00Z')], {});
  const other = { hello: 'world' };                       // 别的程序的 JSON
  const noFmt = { deviceId: 'x', records: {} };           // 缺 format
  const badRecs = { format: S.FORMAT, version: 1, deviceId: 'devZ', records: [] };  // records 是数组
  const m = S.mergeDocs([good, other, noFmt, badRecs]);
  eq('只认自己的格式', m.records.length, 1);
  eq('只算一份有效文档', m.stats.docs, 1);

  // 坏记录（无 id / id 超长）跳过
  const longId = 'x'.repeat(80);
  const messy = {
    format: S.FORMAT, version: 1, deviceId: 'devM',
    records: {
      'r2': { id: 'r2', updated_at: '2026-11-18T09:00:00Z', question: '正常的' },
      'bad id!!': { id: 'bad id!!', updated_at: '2026-11-18T09:00:00Z' },
      'noid': { updated_at: '2026-11-18T09:00:00Z' }
    }
  };
  messy.records[longId] = { id: longId, updated_at: '2026-11-18T09:00:00Z' };
  const m2 = S.mergeDocs([messy]);
  eq('非法 id 被丢弃', m2.records.map(r => r.id), ['r2']);
}

console.log('\n=== 9. 时间戳缺失时按最旧算 ===');
{
  const a = doc('devA', [{ id: 'r1', question: '无时间' }]);
  const b = doc('devB', [rec('r1', '2000-01-01T00:00:00Z', { question: '有时间' })]);
  const m = S.mergeDocs([a, b]);
  eq('有时间的胜出', m.records[0].question, '有时间');
  eq('stampOf 缺失返回 0', S.stampOf({ id: 'z' }), 0);
  eq('created_at 兜底', S.stampOf({ id: 'z', created_at: '2026-11-18T00:00:00Z' }), Date.parse('2026-11-18T00:00:00Z'));
}

console.log('\n=== 10. 差异统计 ===');
{
  const d = S.diffSummary(['a', 'b', 'c'], ['b', 'c', 'd']);
  eq('新增 1', d.added, 1);
  eq('移除 1', d.removed, 1);
  eq('保留 2', d.same, 2);
}

console.log('\n=== 11. 超大记录不写进文档 ===');
{
  const big = rec('big1', '2026-11-18T10:00:00Z', { blob: 'x'.repeat(S.MAX_RECORD_CHARS + 10) });
  const small = rec('s1', '2026-11-18T10:00:00Z');
  const d = doc('devA', [big, small]);
  eq('超大那条被跳过', Object.keys(d.records), ['s1']);
}

console.log('\n=== 12. 空输入 ===');
{
  eq('空数组', S.mergeDocs([]).records, []);
  eq('null 不炸', S.mergeDocs(null).records, []);
  eq('空文档合并不炸', S.mergeDocs([doc('d', [])]).records, []);
}

console.log('\n' + (fail ? '✗ ' + fail + ' 项失败' : '全部通过') + '：' + pass + ' 项');
process.exit(fail ? 1 : 0);
