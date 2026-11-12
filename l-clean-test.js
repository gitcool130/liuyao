const { chromium } = require('playwright-core');
const fs = require('fs');
(async () => {
  const b = await chromium.connectOverCDP('http://127.0.0.1:9222');
  let page = null;
  for (const c of b.contexts()) for (const pg of c.pages()) if (/liuyao\.local/.test(pg.url())) page = pg;
  const out = await page.evaluate(async () => {
    const all = await (await fetch('/api/records?limit=200')).json();
    const del = (all.records || []).filter(r => r.question === '文件存储联调');
    for (const r of del) {
      await fetch('/api/records?id=' + encodeURIComponent(r.id), { method: 'DELETE' });
    }
    const after = await (await fetch('/api/records?limit=200')).json();
    return { removed: del.length, left: after.records.map(r => r.question + ' | ' + r.hex) };
  });
  console.log('删掉测试记录:', out.removed, '| 剩下:', out.left);
  await b.close();
  const f = 'D://greensoft//莲斋六爻排盘//data//卦例库.json';
  const arr = JSON.parse(fs.readFileSync(f, 'utf8'));
  console.log('文件现在是', arr.length, '条：', arr.map(r => r.question || '(无题)'));
})();
