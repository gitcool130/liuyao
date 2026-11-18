/* 卦例同步：端到端（真实浏览器 + 假的「远端目录」）
 *
 * 为什么要有这一层：合并逻辑单独测过，但「拉远端 → 合并 → 落地本地 → 写回自己的」
 * 这条链路上还有一堆会出错的地方（读本地的分页、整库落地的 updated_at、墓碑清理、
 * 设备号复用）。这里用一个内存里的假 OneDrive 目录跑完整流程。
 *
 * 要验的核心场景（多机同步最容易出的三个事故）：
 *   ① 第一次同步不能把本地卦例弄丢（远端还没本机的文件）
 *   ② B 机新增的卦例，A 机同步后能看到
 *   ③ A 机删掉的卦例，B 机同步后**不会复活**
 */
const { chromium } = require('playwright-core');

const BASE = process.argv[2] || 'http://127.0.0.1:8932';

async function launchBrowser() {
  const attempts = [];
  if (process.env.LY_CHROME) attempts.push({ executablePath: process.env.LY_CHROME, headless: true });
  attempts.push({ channel: 'msedge', headless: true });
  attempts.push({ channel: 'chrome', headless: true });
  attempts.push({ headless: true });
  let lastErr;
  for (const opt of attempts) {
    try { return await chromium.launch(opt); } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

let pass = 0, fail = 0;
const ok = (n, c, extra) => {
  if (c) { pass++; console.log('  ✓ ' + n); }
  else { fail++; console.log('  ✗ ' + n + (extra ? '\n     ' + extra : '')); }
};
const eq = (n, got, want) => {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a === b) { pass++; console.log('  ✓ ' + n); }
  else { fail++; console.log('  ✗ ' + n + '\n     got:  ' + a + '\n     want: ' + b); }
};

/* 造一台「设备」：独立的浏览器上下文 + 内存里的远端目录 + 自己的 localStorage
 * 这样两个 context 就等于两台机器，共享同一个 remote 对象（模拟 OneDrive 目录）。 */
async function makeDevice(browser, remote, label, seedRecs) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  await ctx.addInitScript(({ seed, label }) => {
    // 假的 OneDrive 目录：挂在 window 上，用 localStorage 持久化到本 context
    const KEY = '__fake_onedrive__';
    if (!localStorage.getItem(KEY)) {
      localStorage.setItem(KEY, JSON.stringify(window.__remoteSeed || {}));
    }
    const dirFiles = JSON.parse(localStorage.getItem(KEY) || '{}');

    // 先塞点本地卦例，模拟「这台机器上已经攒了一些」
    if (seed && seed.length && !localStorage.getItem('ly_records_v1')) {
      localStorage.setItem('ly_records_v1', JSON.stringify(seed));
    }

    const listeners = [];
    window.chrome = {
      webview: {
        postMessage(msg) {
          const p = String(msg).split('\n');
          const op = p[0], id = p[1], name = p[2] || '', payload = p.slice(3).join('\n');
          let body = '', status = 'ok';
          try {
            if (op === 'odsync') {
              const seg = name.split('\u0002');
              const action = seg[0], file = seg[1] || '';
              if (action === 'dir') body = 'C:\\Users\\x\\OneDrive\\莲斋六爻排盘\\sync';
              else if (action === 'list') body = Object.keys(dirFiles).join('\u0001');
              else if (action === 'read') body = dirFiles[file] || '';
              else if (action === 'write') { dirFiles[file] = payload; localStorage.setItem(KEY, JSON.stringify(dirFiles)); body = 'ok'; }
              else { status = 'err'; body = '未知动作 ' + action; }
            } else if (op === 'info') body = 'C:\\data';
            else if (op === 'read') body = files[name] || '';
            else if (op === 'write') { files[name] = payload; body = name; }
            else if (op === 'list') body = Object.keys(files).join('\u0001');
          } catch (e) { status = 'err'; body = String(e && e.message || e); }
          const files2 = {};
          setTimeout(() => listeners.forEach(f => f({ data: id + '\n' + status + '\n' + body })), 0);
        },
        addEventListener(k, f) { if (k === 'message') listeners.push(f); }
      }
    };
    var files = {};
    window.__dirFiles = dirFiles;
    window.__devLabel = label;
  }, { seed: seedRecs || null, label: label });

  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('  [pageerror] ' + e.message));
  await page.goto(BASE + '/index.html?local=1', { waitUntil: 'networkidle' });
  await page.waitForFunction('window.__lyReady === true', { timeout: 20000 });
  return { ctx, page };
}

/* 两台设备共享远端：把 A 的目录抄给 B（模拟 OneDrive 客户端同步文件） */
async function syncRemoteBetween(from, to) {
  const files = await from.page.evaluate(() => JSON.parse(localStorage.getItem('__fake_onedrive__') || '{}'));
  await to.page.evaluate((f) => {
    localStorage.setItem('__fake_onedrive__', JSON.stringify(f));
    // 让页面里的 dirFiles 也跟着换（addInitScript 里那份是闭包引用）
    const cur = window.__dirFiles;
    Object.keys(cur).forEach(k => delete cur[k]);
    Object.keys(f).forEach(k => { cur[k] = f[k]; });
  }, files);
}

function rec(id, updated, question, category) {
  return {
    id: id, created_at: updated, updated_at: updated,
    question: question, hex: '乾为天', category: category || '',
    datetime: '丙午年 己亥月 乙未日', pillars: '己亥月 乙未日',
    tosses: [{ val: 1 }, { val: 1 }, { val: 1 }, { val: 1 }, { val: 1 }, { val: 1 }],
    pan_text: '乾为天', messages: '{}'
  };
}

(async () => {
  const browser = await launchBrowser();

  console.log('\n=== 1. 两台机器各有卦例，同步后并集 ===');
  const A = await makeDevice(browser, null, 'A', [
    rec('a1', '2026-11-18T10:00:00Z', 'A 机第一条', '财运'),
    rec('a2', '2026-11-18T10:10:00Z', 'A 机第二条', '婚姻')
  ]);
  const B = await makeDevice(browser, null, 'B', [
    rec('b1', '2026-11-18T11:00:00Z', 'B 机第一条', '事业')
  ]);

  // 两台都设成 OneDrive 后端
  const setBackend = async (page) => page.evaluate(() => {
    const e = window.LY.syncEngine;
    const c = e.loadCfg();
    c.backend = 'onedrive';
    e.saveCfg(c);
    return e.deviceId();
  });
  const devA = await setBackend(A.page);
  const devB = await setBackend(B.page);
  ok('两台设备号不同', devA !== devB, devA + ' vs ' + devB);

  // A 先同步：远端还是空的，本地 2 条必须一条不少
  let rA = await A.page.evaluate(async () => {
    const r = await window.LY.syncEngine.run({ backend: 'onedrive' });
    const local = await window.LY.syncEngine.readLocalRecords();
    return { local: local.map(x => x.id).sort(), diff: r.diff, count: r.localCount };
  });
  eq('首次同步不丢本地（这是最要命的一条）', rA.local, ['a1', 'a2']);
  eq('本地条数还是 2', rA.count, 2);

  // 模拟 OneDrive 把 A 的文件同步到 B
  await syncRemoteBetween(A, B);
  let rB = await B.page.evaluate(async () => {
    const r = await window.LY.syncEngine.run({ backend: 'onedrive' });
    const local = await window.LY.syncEngine.readLocalRecords();
    return { local: local.map(x => x.id).sort(), diff: r.diff };
  });
  eq('B 拿到 A 的卦例，自己那条也在', rB.local, ['a1', 'a2', 'b1']);
  eq('B 这次新增 2 条', rB.diff.added, 2);

  // 再同步回去，A 也该有 B 的
  await syncRemoteBetween(B, A);
  const rA2 = await A.page.evaluate(async () => {
    await window.LY.syncEngine.run({ backend: 'onedrive' });
    const local = await window.LY.syncEngine.readLocalRecords();
    return local.map(x => x.id).sort();
  });
  eq('A 拿到 B 的卦例', rA2, ['a1', 'a2', 'b1']);

  console.log('\n=== 2. 分类与占问跟着同步 ===');
  const a1Cat = await A.page.evaluate(async () => {
    const l = await window.LY.syncEngine.readLocalRecords();
    const a1 = l.filter(r => r.id === 'a1')[0];
    const b1 = l.filter(r => r.id === 'b1')[0];
    return { a1: a1 && a1.category, b1: b1 && b1.category };
  });
  eq('A 机的 a1 分类没丢', a1Cat.a1, '财运');
  eq('B 机过来的 b1 分类也在', a1Cat.b1, '事业');

  console.log('\n=== 3. 删除要传播，不能复活 ===');
  // A 删掉 a2（走真实路径：先 DELETE 再记墓碑）
  await A.page.click('#sideRail .tb-btn[data-k="lib"]');
  await A.page.waitForTimeout(400);
  await A.page.evaluate(() => document.getElementById('btnLib').click());
  await A.page.waitForTimeout(1200);
  const delInfo = await A.page.evaluate(async () => {
    window.confirm = () => true;
    // 直接调接口删，模拟 delCast（含墓碑）
    await fetch('/api/records?id=a2', { method: 'DELETE' });
    await window.LY.syncEngine.noteDeleted('a2');
    return { tomb: Object.keys(await window.LY.syncEngine.tombstones()) };
  });
  ok('删除后留了墓碑', delInfo.tomb.indexOf('a2') >= 0, JSON.stringify(delInfo.tomb));

  // A 同步（把墓碑写进自己的文档）
  await A.page.evaluate(async () => { await window.LY.syncEngine.run({ backend: 'onedrive' }); });
  // 同步文件到 B，B 再同步
  await syncRemoteBetween(A, B);
  const bAfterDel = await B.page.evaluate(async () => {
    await window.LY.syncEngine.run({ backend: 'onedrive' });
    const local = await window.LY.syncEngine.readLocalRecords();
    return local.map(x => x.id).sort();
  });
  eq('B 机上的 a2 也被删掉了（墓碑生效）', bAfterDel, ['a1', 'b1']);

  // 关键：B 再把自己的文档写回去，A 同步后 a2 不能复活
  await syncRemoteBetween(B, A);
  const aFinal = await A.page.evaluate(async () => {
    await window.LY.syncEngine.run({ backend: 'onedrive' });
    const local = await window.LY.syncEngine.readLocalRecords();
    return local.map(x => x.id).sort();
  });
  eq('a2 没有复活（这是同步最经典的坑）', aFinal, ['a1', 'b1']);

  console.log('\n=== 4. 同一 id 两边都改过 → 取后改的 ===');
  await A.page.evaluate(async () => {
    const l = await window.LY.syncEngine.readLocalRecords();
    const hit = l.filter(r => r.id === 'a1')[0];
    hit.question = 'A 改的新占问';
    hit.updated_at = '2026-11-18T20:00:00Z';
    await window.LY.syncEngine.writeLocalRecords(l);
  });
  await B.page.evaluate(async () => {
    const l = await window.LY.syncEngine.readLocalRecords();
    const hit = l.filter(r => r.id === 'a1')[0];
    hit.question = 'B 改的旧占问';
    hit.updated_at = '2026-11-18T15:00:00Z';   // 更早
    await window.LY.syncEngine.writeLocalRecords(l);
  });
  await A.page.evaluate(async () => { await window.LY.syncEngine.run({ backend: 'onedrive' }); });
  await syncRemoteBetween(A, B);
  const q = await B.page.evaluate(async () => {
    await window.LY.syncEngine.run({ backend: 'onedrive' });
    const l = await window.LY.syncEngine.readLocalRecords();
    return (l.filter(r => r.id === 'a1')[0] || {}).question;
  });
  eq('更新时间更晚的那份胜出', q, 'A 改的新占问');

  console.log('\n=== 5. 反复同步不改变结果（幂等） ===');
  const before = await B.page.evaluate(async () => {
    const l = await window.LY.syncEngine.readLocalRecords();
    return l.map(r => r.id + '|' + r.updated_at + '|' + (r.question || '')).sort();
  });
  await B.page.evaluate(async () => { await window.LY.syncEngine.run({ backend: 'onedrive' }); });
  await B.page.evaluate(async () => { await window.LY.syncEngine.run({ backend: 'onedrive' }); });
  const after = await B.page.evaluate(async () => {
    const l = await window.LY.syncEngine.readLocalRecords();
    return l.map(r => r.id + '|' + r.updated_at + '|' + (r.question || '')).sort();
  });
  eq('连续同步两次，内容与时间戳都不变', after, before);

  console.log('\n=== 6. 界面：有「同步」按钮，能展开设置 ===');
  await B.page.click('#sideRail .tb-btn[data-k="lib"]');
  await B.page.waitForTimeout(400);
  ok('卦例库有「同步」按钮', await B.page.$('#btnSync') !== null);
  await B.page.click('#btnSync');
  await B.page.waitForTimeout(300);
  ok('点开后有设置面板', await B.page.$eval('#syncPanel', e => !e.hidden));
  ok('有 OneDrive / WebDAV 两个选项', (await B.page.$$('input[name="syncBackend"]')).length === 2);
  ok('OneDrive 区显示同步目录', (await B.page.$eval('#syncOdDir', e => e.textContent)).indexOf('OneDrive') >= 0,
    await B.page.$eval('#syncOdDir', e => e.textContent));
  // 切到 WebDAV：应出现地址输入
  await B.page.evaluate(() => {
    const r = document.querySelectorAll('input[name="syncBackend"]');
    r[1].checked = true;
    r[1].dispatchEvent(new Event('change', { bubbles: true }));
  });
  await B.page.waitForTimeout(300);
  ok('切到 WebDAV 后显示地址输入', await B.page.$eval('#syncDavBox', e => !e.hidden));

  await A.ctx.close();
  await B.ctx.close();
  await browser.close();

  console.log('\n' + (fail ? '✗ ' + fail + ' 项失败' : '全部通过') + '：' + pass + ' 项');
  process.exit(fail ? 1 : 0);
})().catch(e => {
  console.error('SCRIPT FAIL:', e && e.message);
  process.exit(1);
});
