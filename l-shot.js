const { chromium } = require('playwright-core');
const EXE = 'C:/Users/ABC/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe';
(async () => {
  const b = await chromium.launch({ executablePath: EXE, headless: true });
  const page = await b.newPage({ viewport: { width: 1536, height: 864 } });
  await page.goto('http://127.0.0.1:8932/index.html?local=1', { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'C:/Users/ABC/AppData/Local/Temp/home_fit.png' });
  console.log('ok');
  await b.close();
})();
