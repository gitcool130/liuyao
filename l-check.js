const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: 'C:/Users/ABC/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe', headless: true });
  const p = await b.newPage();
  await p.goto('http://127.0.0.1:8932/index.html?local=1', { waitUntil: 'networkidle' });
  console.log(JSON.stringify(await p.evaluate(() => {
    const r = document.getElementById('aiReply');
    return { len: r.innerHTML.length, text: r.textContent.slice(0, 80) };
  })));
  await b.close();
})();
