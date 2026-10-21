/* 线上采样探针：POST /api/interpret 流式取回，记录正文长度 / warn / 是否完篇 / 耗时
 * 用法：node tools/probe.js --model=gemini-3.6-flash --n=5 [--pan=kun|jiaren] [--parallel=2]
 * 输出：每次一行 JSON（stdout），末行汇总
 */
const { panText } = require('./mkpan.js');

const BASE = process.env.PROBE_BASE || 'https://liuyao.dhxlsfn.dpdns.org/api/interpret';

const PANS = {
  kun: () => panText([0, 6, 6, 0, 6, 0], new Date(2026, 9, 21, 12, 1),
    '此liuyao预测项目准确度如何，是否堪用（界面取用：父母·考试文书）', '父母').text,
  jiaren: () => panText([1, 0, 1, 0, 1, 9], new Date(2026, 9, 21, 13, 10),
    '此liuyao预测项目准确度如何，是否堪用（界面取用：父母·考试文书）', '父母').text,
};

function parseArgs(argv) {
  const o = { model: 'gemini-3.6-flash', n: 3, pan: 'kun', parallel: 2, outdir: '' };
  argv.forEach(a => {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) o[m[1]] = m[2];
  });
  o.n = Number(o.n); o.parallel = Number(o.parallel);
  return o;
}

async function once(model, text, tag, outdir) {
  const t0 = Date.now();
  const rec = { tag, model, t0: new Date(t0).toISOString(), outdir: outdir };
  let res;
  try {
    res = await fetch(BASE, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ panText: text, messages: [], model }),
      signal: AbortSignal.timeout(180000),
    });
  } catch (e) {
    return Object.assign(rec, { ok: false, err: 'fetch:' + e.message, ms: Date.now() - t0 });
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return Object.assign(rec, { ok: false, err: 'HTTP ' + res.status + ' ' + body.slice(0, 200), ms: Date.now() - t0 });
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '', full = '', warns = [], errs = [], nEvents = 0, ttfb = 0, maxGap = 0, lastAt = Date.now();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!ttfb) ttfb = Date.now() - t0;
      const now = Date.now();
      maxGap = Math.max(maxGap, now - lastAt);
      lastAt = now;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const dataLines = block.split('\n').filter(l => l.startsWith('data:'));
        for (const line of dataLines) {
          const raw = line.slice(5).trim();
          if (!raw || raw === '[DONE]') continue;
          let d;
          try { d = JSON.parse(raw); } catch { continue; }
          nEvents++;
          if (typeof d.t === 'string' && d.t) full += d.t;
          if (d.warn) warns.push(d.warn);
          if (d.error) errs.push(d.error);
        }
      }
    }
  } catch (e) {
    rec.streamErr = e.message;
  }
  rec.ok = true;
  rec.ms = Date.now() - t0;
  rec.ttfb = ttfb || null;
  rec.maxGap = maxGap;
  rec.chars = full.length;
  rec.hasConclusion = /结论\s*[:：]/.test(full);
  rec.hasYingqi = /应期\s*[:：]/.test(full);
  rec.warns = warns;
  rec.errs = errs;
  rec.events = nEvents;
  rec.tail = full.slice(-60).replace(/\n/g, '\\n');
  rec.head = full.slice(0, 40).replace(/\n/g, '\\n');
  if (rec.outdir) {
    const fs = require('fs');
    const p = require('path').join(rec.outdir, tag.replace('#', '-') + '-' + model + '.txt');
    try { fs.writeFileSync(p, full); rec.saved = p; } catch (e) { rec.saveErr = e.message; }
  }
  delete rec.outdir;
  return rec;
}

(async () => {
  const o = parseArgs(process.argv.slice(2));
  const text = (PANS[o.pan] || PANS.kun)();
  if (!text) throw new Error('unknown pan ' + o.pan);
  console.log(JSON.stringify({ note: 'panLen', pan: o.pan, len: text.length }));
  const recs = [];
  let idx = 0;
  async function worker(w) {
    for (;;) {
      const i = idx++;
      if (i >= o.n) return;
      const rec = await once(o.model, text, o.pan + '#' + (i + 1), o.outdir);
      recs.push(rec);
      console.log(JSON.stringify(rec));
    }
  }
  await Promise.all(Array.from({ length: Math.min(o.parallel, o.n) }, (_, w) => worker(w)));
  const ok = recs.filter(r => r.ok);
  const sum = {
    model: o.model, pan: o.pan, runs: recs.length, ok: ok.length,
    chars: ok.map(r => r.chars),
    incomplete: ok.filter(r => !r.hasConclusion).length,
    warned: ok.filter(r => r.warns.length).length,
    ms: ok.map(r => r.ms),
  };
  console.log('SUMMARY ' + JSON.stringify(sum));
})();
