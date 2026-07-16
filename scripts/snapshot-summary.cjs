// Snapshot the summary tab
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1.5 });
  const page = await ctx.newPage();
  await page.goto('http://localhost:3000/', { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1500);
  // Summary is the default tab — just screenshot
  await page.screenshot({ path: '/home/z/my-project/download/summary-after-fix.png', fullPage: true });
  console.log('OK: summary screenshot saved');
  await browser.close();
})();
