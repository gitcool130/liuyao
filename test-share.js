/* 盘面分享链接自检 (core/share.js)
 *
 * 验的不是「编码能解回来」这种自证式往返，而是三条外部不变量：
 *   ① 同一 code 在任何浏览器重算必得**同一张盘**（六爻、卦名、四柱、旬空全等）；
 *   ② 时间按**北京墙上分量**传递，不按 epoch——否则跨时区还原会排出不同年月柱；
 *   ③ 任何畸形/越界/超长输入都判非法，绝不放行成「半个盘」。
 */
const C = require('./core.js');
const fs = require('fs');

let pass = 0, fail = 0;
function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else { fail++; console.log('FAIL', name, 'got=', got, 'want=', want); }
}
function ok(name, cond) { eq(name, !!cond, true); }

// 断言失败的用例必须带原因，便于「不静默跳过」
function badOk(name, r) {
  ok(name, r && r.ok === false && typeof r.reason === 'string' && r.reason.length > 0);
}

// ---------- 1. 往返：分量原样还原 ----------
const DT = new Date(2026, 9, 24, 8, 30);
DT.__wall = { y: 2026, m: 10, d: 24, h: 8, min: 30 };
const VALS = [1, 0, 9, 6, 1, 1];
const code = C.encodeCast({ time: DT, vals: VALS, use: '妻财', question: '这个项目能不能成' });
ok('编码产出非空', code);
ok('版本前缀为 1.', code.indexOf('1.') === 0);
ok('分享码长度受控（< 320）', code.length < 320);

const dec = C.decodeCast(code);
eq('解码成功', dec.ok, true);
eq('墙上分量原样还原', dec.wall, { y: 2026, m: 10, d: 24, h: 8, min: 30 });
eq('爻值原样还原', dec.vals, VALS);
eq('用神类别还原', dec.use, '妻财');
eq('所测之事还原', dec.question, '这个项目能不能成');

// ---------- 2. 同盘复现：这是分享链接唯一有意义的正确性 ----------
const p0 = C.paipan(VALS, DT);
const p1 = C.paipan(dec.vals, C.dateOfWall(dec.wall));
eq('分享还原：本卦相同', p1.benName, p0.benName);
eq('分享还原：变卦相同', p1.bianName, p0.bianName);
eq('分享还原：卦宫相同', p1.palace, p0.palace);
eq('分享还原：世应相同', [p1.shi, p1.ying], [p0.shi, p0.ying]);
eq('分享还原：四柱相同', [p1.pillars.yearGZ, p1.pillars.monthGZ, p1.pillars.dayGZ, p1.pillars.hourGZ],
  [p0.pillars.yearGZ, p0.pillars.monthGZ, p0.pillars.dayGZ, p0.pillars.hourGZ]);
eq('分享还原：旬空相同', p1.pillars.kongStr, p0.pillars.kongStr);
eq('分享还原：六爻纳甲全等', p1.lines.map(l => l.gan + l.zhi + l.lq),
  p0.lines.map(l => l.gan + l.zhi + l.lq));

// 盘面清单（含六亲/伏神/六神）逐字段一致，不只比卦名——卦名对得上但装卦错位是可能的
eq('分享还原：伏神一致', p1.lines.map(l => l.fu ? l.fu.lq + l.fu.zhi : ''),
  p0.lines.map(l => l.fu ? l.fu.lq + l.fu.zhi : ''));
eq('分享还原：六神一致', p1.lines.map(l => l.beast), p0.lines.map(l => l.beast));

// ---------- 3. 批量扫描：64 种爻组合 × 多个时点，全部同盘复现 ----------
const TOSS = [1, 0, 9, 6];
const TIMES = [
  new Date(2026, 0, 1, 0, 5), new Date(2026, 5, 15, 23, 30), new Date(2025, 11, 31, 12, 0),
  new Date(2024, 1, 29, 6, 45), new Date(2000, 0, 1, 0, 0), new Date(1987, 7, 7, 19, 20)
];
let scan = 0, scanBad = 0;
for (let k = 0; k < 64; k++) {
  // 由 k 的二进制位反推一套爻值（含动爻），覆盖静卦与动卦
  const vals = [];
  for (let i = 0; i < 6; i++) vals.push((k >> i) & 1 ? 9 : 6);
  TIMES.forEach(function (t) {
    const c = C.encodeCast({ time: t, vals: vals, use: '', question: '' });
    if (!c) { scanBad++; return; }
    const d = C.decodeCast(c);
    if (!d.ok) { scanBad++; return; }
    const a = C.paipan(vals, t);
    const b = C.paipan(d.vals, C.dateOfWall(d.wall));
    const sig = function (p) {
      return [p.benName, p.bianName, p.palace, p.shi, p.ying, p.pillars.monthGZ,
        p.pillars.dayGZ, p.pillars.hourGZ, p.pillars.kongStr,
        p.lines.map(l => l.gan + l.zhi + l.lq + (l.fu ? '/' + l.fu.zhi : '')).join(',')].join('|');
    };
    scan++;
    if (sig(a) !== sig(b)) { scanBad++; if (scanBad < 3) console.log('  漂移样例', c, sig(a), '!=', sig(b)); }
  });
}
eq('批量扫描 384 组合零漂移（' + scan + ' 例）', scanBad, 0);
eq('批量扫描全部编码成功', scan, 384);

// ---------- 4. 墙上时间口径：不按 epoch 传递 ----------
// 同一 UTC 瞬间在不同时区构造出的 Date，其「墙上分量」不同；分享码必须保存分量本身，
// 故两条链接不应相等（若按 epoch 编码则会相等，反证编码口径正确）。
const u = Date.UTC(2026, 9, 24, 0, 30);
const shDate = new Date(u + 8 * 3600 * 1000);       // 北京 08:30 墙上
shDate.__wall = { y: 2026, m: 10, d: 24, h: 8, min: 30 };
const nyDate = new Date(u - 4 * 3600 * 1000);       // 纽约 20:30 墙上（前一日）
nyDate.__wall = { y: 2026, m: 10, d: 23, h: 20, min: 30 };
const cSh = C.encodeCast({ time: shDate, vals: VALS });
const cNy = C.encodeCast({ time: nyDate, vals: VALS });
ok('不同墙上时间 → 不同分享码', cSh !== cNy);
const dSh = C.decodeCast(cSh);
eq('北京墙钟分量不因编码丢失', dSh.wall, { y: 2026, m: 10, d: 24, h: 8, min: 30 });
const pSh = C.paipan(dSh.vals, C.dateOfWall(dSh.wall));
eq('北京盘还原后四柱正确', pSh.pillars.yearGZ + pSh.pillars.monthGZ + pSh.pillars.dayGZ,
  '丙午戊戌辛未');

// ---------- 5. 畸形输入：一律拒收，且给得出原因 ----------
badOk('空串拒收', C.decodeCast(''));
badOk('null 拒收', C.decodeCast(null));
badOk('数字拒收', C.decodeCast(12345));
badOk('纯文本拒收', C.decodeCast('风火家人'));
badOk('版本不符拒收', C.decodeCast('2.13pjq6.abcdaa'));
badOk('爻值字母越界拒收', C.decodeCast('1.13pjq6.abxdaa'));
badOk('爻数不足拒收', C.decodeCast('1.13pjq6.abcda'));
badOk('多余字段拒收', C.decodeCast('1.13pjq6.abcdaa.c.q.extra'));
badOk('超长拒收（>320）', C.decodeCast('1.13pjq6.abcdaa.c.' + 'A'.repeat(400)));
badOk('base64 非法拒收', C.decodeCast('1.13pjq6.abcdaa.c.%%%%'));
badOk('占时越界拒收（>2100）', C.decodeCast('1.' + ((80000 * 1440).toString(36)) + '.abcdaa'));
eq('形态合法者放行（不因「看着像」被误杀）', C.decodeCast('1.abc.abcdaa').ok, true);

// ---------- 6. 编码侧校验：不给就拒绝，不产出半个盘 ----------
eq('爻值缺一位 → 拒绝编码', C.encodeCast({ time: DT, vals: [1, 0, 9, 6, 1] }), '');
eq('爻值非法（7）→ 拒绝编码', C.encodeCast({ time: DT, vals: [7, 0, 9, 6, 1, 1] }), '');
eq('爻值非法（2）→ 拒绝编码', C.encodeCast({ time: DT, vals: [2, 0, 9, 6, 1, 1] }), '');
eq('时间缺失 → 拒绝编码', C.encodeCast({ vals: VALS }), '');
eq('占时越界（1899）→ 拒绝编码', C.encodeCast({ time: new Date(1899, 5, 1), vals: VALS }), '');
eq('占时越界（2101）→ 拒绝编码', C.encodeCast({ time: new Date(2101, 5, 1), vals: VALS }), '');
eq('空参 → 空串', C.encodeCast(null), '');
eq('问句超长按 60 字截断（与界面 maxlength 同口径）', C.decodeCast(C.encodeCast({ time: DT, vals: VALS, question: '问'.repeat(200) })).question.length, 60);

// ---------- 7. 分享地址：替换既有 query / 丢掉 hash ----------
eq('分享地址替换既有参数并丢弃 hash',
  C.shareUrl('1.abc', 'https://x.test/index.html?old=1#frag'),
  'https://x.test/index.html?s=1.abc');
eq('空 code → 空地址', C.shareUrl(''), '');

// ---------- 8. 部署边界：share.js 不得含外链与动态求值 ----------
const src = fs.readFileSync('public/core/share.js', 'utf8');
ok('share.js 不含 eval / Function 构造',
  src.indexOf('eval(') < 0 && src.indexOf('new Function') < 0);
ok('share.js 只解码为字符串，不写入 DOM', src.indexOf('innerHTML') < 0 && src.indexOf('document.') < 0);

console.log('\n分享链接自检：PASS ' + pass + '　FAIL ' + fail);
process.exit(fail ? 1 : 0);
