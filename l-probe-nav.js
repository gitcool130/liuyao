/* 验：右侧导航 / 导入画板 / 清空与重置 / 文本卦象 */
const { chromium } = require('playwright-core');
const EXE = 'C:/Users/ABC/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe';
const BASE = process.argv[2] || 'http://127.0.0.1:8932';

const ink = (page) => page.evaluate(() => {
  const cv = document.getElementById('bdCanvas');
  const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] !== 255 || d[i + 1] !== 253 || d[i + 2] !== 248) n++;
  return n;
});

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await page.goto(BASE + '/index.html?local=1', { waitUntil: 'networkidle' });

  const rail = await page.$$eval('#sideRail .tb-btn', e => e.map(x => x.textContent.trim()));
  console.log('右侧按钮:', rail);
  console.log('默认 主页可见=', await page.$eval('#mainView', e => !e.hidden),
    ' 面板容器隐藏=', await page.$eval('#toolCard', e => e.hidden),
    ' 画板卡在不在主页=', await page.$eval('#mainView #boardCard', e => !!e).catch(() => 'n/a'));

  await page.$eval('#sideRail .tb-btn[data-k="guji"]', el => el.click());
  await page.waitForTimeout(500);
  console.log('点古籍: 主页隐藏=', await page.$eval('#mainView', e => e.hidden),
    ' 面板可见=', await page.$eval('#toolCard', e => !e.hidden),
    ' guji pane=', await page.$eval('.tb-pane[data-k="guji"]', e => !e.hidden),
    ' 其它 pane 全隐=', await page.$$eval('.tb-pane', ps => ps.filter(p => !p.hidden).map(p => p.getAttribute('data-k'))));

  // 古籍 → 装入排盘 应回到首页
  const books = await page.$$eval('#gujiBook option', e => e.map(x => x.textContent.trim()));
  const target = books.find(b => b.indexOf('卦例全解') >= 0) || books[0];
  await page.selectOption('#gujiBook', { label: target });
  await page.waitForTimeout(1500);
  await page.$$eval('#gujiList .guji-item', e => e[0].click());
  await page.waitForTimeout(700);
  await page.click('#btnGujiLoad');
  await page.waitForTimeout(1200);
  console.log('装入排盘后回首页=', await page.$eval('#mainView', e => !e.hidden),
    ' 盘面:', (await page.$eval('#classicText', e => e.textContent)).split('\n').slice(0, 2).join(' / '));

  // 古籍 → 导入画板
  await page.$eval('#sideRail .tb-btn[data-k="guji"]', el => el.click());
  await page.waitForTimeout(400);
  await page.$$eval('#gujiList .guji-item', e => e[0].click());
  await page.waitForTimeout(600);
  await page.click('#btnGujiBoard');
  await page.waitForTimeout(900);
  const inked1 = await ink(page);
  console.log('古籍导入画板: 画板面板=', await page.$eval('.tb-pane[data-k="board"]', e => !e.hidden),
    ' 墨迹=', inked1,
    ' 文本框首行=', (await page.$eval('#bdPanText', e => e.value)).split('\n')[0]);

  // 清空：应保留卦象
  await page.click('#bdClear');
  await page.waitForTimeout(400);
  const afterClear = await ink(page);
  console.log('清空后墨迹=', afterClear, '（>0 = 卦象还在）');
  // 重置：应清干净
  await page.click('#bdReset');
  await page.waitForTimeout(400);
  console.log('重置后墨迹=', await ink(page), ' 文本框=', JSON.stringify(await page.$eval('#bdPanText', e => e.value)));

  // 文本卦象粘贴
  const sample = '干支： 戌月  丁亥日　(旬空：午未)　占问：试贴\n艮宫：山天大畜　之　艮宫：山火贲\n六神　伏　　神　　【本　　卦】\n青龙　　　　　　　官鬼丙寅━━━';
  await page.fill('#bdPanText', sample);
  await page.click('#bdDrawText');
  await page.waitForTimeout(500);
  console.log('文本卦象画出 墨迹=', await ink(page));

  console.log('错误:', errs.length ? errs : '（无）');
  await browser.close();
})();
