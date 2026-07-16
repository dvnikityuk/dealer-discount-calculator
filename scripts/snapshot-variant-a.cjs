// Snapshot the scales tab via headless chromium
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1.5 });
  const page = await ctx.newPage();
  // Wait for the app to be ready
  await page.goto('http://localhost:3000/', { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1500);

  // Click on the "Шкалы" tab — try various selectors
  const tabSelectors = [
    'button:has-text("Шкалы")',
    '[role="tab"]:has-text("Шкалы")',
    'text=Шкалы',
  ];
  for (const sel of tabSelectors) {
    try {
      await page.click(sel, { timeout: 2000 });
      console.log('Clicked:', sel);
      break;
    } catch (e) { /* try next */ }
  }
  await page.waitForTimeout(1500);

  await page.screenshot({ path: '/home/z/my-project/download/variant-a-implemented.png', fullPage: true });
  console.log('OK: /home/z/my-project/download/variant-a-implemented.png');

  await browser.close();
})();
