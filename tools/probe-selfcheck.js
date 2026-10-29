/* ============================================================
 * 自洽性探针 (tools/probe-selfcheck.js)
 *
 * 不调用任何大模型。只做一件事：用**独立实现**的规则，去核对
 * 规则引擎自己的输出。目的是回答一个问题——
 *
 *   「盘面事实层到底需不需要三个模型投票来交叉验证？」
 *
 * 如果引擎在几千个随机样本上都不自相矛盾，那么 fact-audit 这类
 * 确定性校验已经覆盖了「规则错」这一类问题，模型投票能提供的
 * 增量只剩「模型有没有照 prompt 说话」，那不需要第三票也能测。
 *
 * 运行：node tools/probe-selfcheck.js [样本数]
 * ============================================================ */
const C = require('../core.js');

const N = parseInt(process.argv[2] || '3000', 10);

/* ---------- 独立实现的五行生克（刻意不复用被测代码） ---------- */
const SHENG = { 木: '火', 火: '土', 土: '金', 金: '水', 水: '木' };
const KE    = { 木: '土', 土: '水', 水: '火', 火: '金', 金: '木' };

function liuqin(palaceWx, lineWx) {
  if (palaceWx === lineWx) return '兄弟';
  if (SHENG[palaceWx] === lineWx) return '子孙';
  if (SHENG[lineWx] === palaceWx) return '父母';
  if (KE[palaceWx] === lineWx) return '妻财';
  if (KE[lineWx] === palaceWx) return '官鬼';
  return '?';
}

/* 旬空：日柱干支序号所在旬的余两支（独立按公式推，不读 pil.kong） */
function kongOf(ganIdx, zhiIdx) {
  const a = (zhiIdx - ganIdx + 10) % 12;
  return [a, (a + 1) % 12];
}

/* ---------- 可复现随机 ---------- */
let seed = 20261029;
function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
function pick(arr) { return arr[Math.floor(rnd() * arr.length)]; }

const TOSS = [1, 0, 9, 6];
const TARGETS = ['妻财', '官鬼', '父母', '子孙', '兄弟', 'shi'];
const LQ_SET = ['父母', '兄弟', '子孙', '妻财', '官鬼'];

/* ---------- 断言收集 ---------- */
const cat = {};
function hit(name, detail) {
  cat[name] = cat[name] || { n: 0, samples: [] };
  cat[name].n++;
  if (cat[name].samples.length < 2) cat[name].samples.push(detail);
}

let ok = 0, total = 0;
function check(name, cond, detail) {
  total++;
  if (cond) ok++;
  else hit(name, detail);
}

/* ---------- 主循环 ---------- */
const t0 = Date.now();
for (let i = 0; i < N; i++) {
  const toss = [0, 0, 0, 0, 0, 0].map(() => pick(TOSS));
  const dt = new Date(2020 + Math.floor(rnd() * 10),
                      Math.floor(rnd() * 12),
                      1 + Math.floor(rnd() * 28),
                      Math.floor(rnd() * 24),
                      Math.floor(rnd() * 60));

  const pan = C.paipan(toss, dt);
  const tag = pan.benName + '[' + toss.join('') + '] ' + dt.toISOString().slice(0, 16);

  /* 1. 世应必须相隔三位 */
  check('世应相隔三位', pan.ying === (pan.shi + 3) % 6, tag + ' shi=' + pan.shi + ' ying=' + pan.ying);

  /* 2. 每爻六亲 = 卦宫五行 对 爻支五行（独立算） */
  pan.lines.forEach(function (l) {
    const want = liuqin(pan.palaceWx, l.wx);
    check('六亲同源', l.lq === want, tag + ' 第' + (l.pos + 1) + '爻 ' + l.zhi + l.wx +
      ' 宫=' + pan.palaceWx + ' 实得=' + l.lq + ' 应为=' + want);
    check('六亲合法', LQ_SET.indexOf(l.lq) >= 0, tag + ' ' + l.lq);
    /* 伏神六亲同样校验 */
    if (l.fu) {
      const wf = liuqin(pan.palaceWx, l.fu.wx);
      check('伏神六亲同源', l.fu.lq === wf, tag + ' 伏' + l.fu.zhi + l.fu.wx +
        ' 实得=' + l.fu.lq + ' 应为=' + wf);
    }
  });

  /* 3. 旬空 = 日柱所在旬余两支 */
  const k = kongOf(pan.pillars.dayGan, pan.pillars.dayZhi);
  check('旬空推导', JSON.stringify(pan.pillars.kong) === JSON.stringify(k),
    tag + ' ' + pan.pillars.dayGZ + ' 实得=' + JSON.stringify(pan.pillars.kong) +
    ' 应为=' + JSON.stringify(k));

  /* 4. 变爻只发生在动爻位 */
  pan.moving.forEach(function (mv, idx) {
    const want = mv ? 1 - pan.benBits[idx] : pan.benBits[idx];
    check('变卦位对应', pan.bianBits[idx] === want,
      tag + ' 第' + (idx + 1) + '爻 moving=' + mv);
  });
  check('有动则有变', pan.hasBian === pan.moving.some(Boolean), tag);
  check('静卦无变卦名', pan.hasBian || pan.bianName === null, tag + ' bianName=' + pan.bianName);

  /* 5. 动爻须带变出 */
  pan.lines.forEach(function (l) {
    if (l.moving) check('动爻有变出', !!l.bian && !!l.bian.zhi, tag + ' 第' + (l.pos + 1) + '爻');
  });

  /* 5b. 变卦纳甲交叉验证：把动爻「定格」成静爻重排一次，得到的盘即变卦，
   *     其逐爻干支须与原盘 lines[i].bian 完全一致。
   *     （只比 gan/zhi：变卦六亲仍以本卦宫为「我」，lq 不可比） */
  if (pan.hasBian) {
    /* 老阳 9 定格为少阴 0，老阴 6 定格为少阳 1 —— 方向不能反 */
    const frozen = toss.map(function (v) { return v === 9 ? 0 : (v === 6 ? 1 : v); });
    const bianPan = C.paipan(frozen, dt);
    check('变卦名交叉验证', bianPan.benName === pan.bianName,
      tag + ' 定格重排=' + bianPan.benName + ' 实得变卦=' + pan.bianName);
    pan.lines.forEach(function (l, idx) {
      if (!l.bian) return;
      const b = bianPan.lines[idx];
      check('变卦纳甲一致', l.bian.gan === b.gan && l.bian.zhi === b.zhi,
        tag + ' 第' + (idx + 1) + '爻 变出=' + l.bian.gan + l.bian.zhi + ' 定格重排=' + b.gan + b.zhi);
    });
  }

  /* 6. 六神：自日干起，逐爻顺排 */
  const start = C.beastStart(pan.pillars.dayGan);
  pan.lines.forEach(function (l, idx) {
    const want = C.BEASTS[(start + idx) % 6];
    check('六神顺排', l.beast === want, tag + ' 第' + (idx + 1) + '爻 实得=' + l.beast + ' 应为=' + want);
  });

  /* 7. 卦名与爻位互查 */
  check('本卦名对应', pan.benName === C.hexName(pan.benBits), tag + ' ' + pan.benName);
  if (pan.hasBian) check('变卦名对应', pan.bianName === C.hexName(pan.bianBits), tag + ' ' + pan.bianName);

  /* 8. 取用神：取到的那个必须真是该六亲，且必须真在盘上 */
  TARGETS.forEach(function (t) {
    const a = C.analyze(pan, t);
    const y = a.yongshen;
    if (!y || !y.primary) return;              // 无可用神是合法结果（有 note 说明）
    const p = y.primary;
    if (t !== 'shi') {
      check('用神六亲吻合', p.lq === t, tag + ' target=' + t + ' 取到=' + p.lq + p.zhi);
    } else {
      check('世爻用神在位', p.pos === pan.shi, tag + ' shi=' + pan.shi + ' 取到pos=' + p.pos);
    }
    /* 用神必须能在盘中定位（本卦六爻，或伏神） */
    const onPan = pan.lines.some(function (l) {
      return l.pos === p.pos && (l === p || (l.fu && l.fu === p));
    }) || pan.lines.some(function (l) { return l.fu && l.fu.zhi === p.zhi && l.fu.lq === p.lq; });
    check('用神可定位', onPan, tag + ' target=' + t + ' pos=' + p.pos + ' ' + p.lq + p.zhi);
  });
}
const dtMs = Date.now() - t0;

/* ---------- 输出 ---------- */
console.log('样本 ' + N + ' 卦  断言 ' + total + ' 条  通过 ' + ok +
            '  失败 ' + (total - ok) + '  用时 ' + dtMs + 'ms\n');

const names = Object.keys(cat);
if (!names.length) {
  console.log('全部通过：规则层在 ' + N + ' 个随机盘上未发现任何自相矛盾。');
} else {
  console.log('失败分类：');
  names.forEach(function (n) {
    console.log('  ✗ ' + n + '  ×' + cat[n].n);
    cat[n].samples.forEach(function (s) { console.log('      ' + s); });
  });
}

/* 附：用神覆盖率分布，看似无用其实是「模型有多少次真的要自己拿主意」的分母 */
const cover = {};
seed = 20261029;
for (let i = 0; i < 400; i++) {
  const toss = [0, 0, 0, 0, 0, 0].map(() => pick(TOSS));
  const pan = C.paipan(toss, new Date(2026, 9, 29, 15, 0));
  TARGETS.forEach(function (t) {
    const a = C.analyze(pan, t);
    const src = (a.yongshen && a.yongshen.source) || '无';
    cover[src] = (cover[src] || 0) + 1;
  });
}
console.log('\n用神来源分布（400 卦 × 6 类问事 = 2400 次取用）：');
Object.keys(cover).sort(function (a, b) { return cover[b] - cover[a]; })
  .forEach(function (k) { console.log('  ' + k + '：' + cover[k]); });

process.exit(names.length ? 1 : 0);
