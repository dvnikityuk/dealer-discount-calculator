const { chromium } = require('playwright');
const path = require('path');

async function snapshot(htmlFile, pngFile, width = 1400) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto('file://' + path.resolve(htmlFile));
  // Wait for fonts/layout
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(400);
  // Auto-size to content
  const height = await page.evaluate(() => document.body.scrollHeight + 48);
  await page.setViewportSize({ width, height });
  await page.waitForTimeout(200);
  await page.screenshot({ path: pngFile, fullPage: true });
  await browser.close();
  console.log(`✓ ${pngFile}`);
}

(async () => {
  const base = '/home/z/my-project/scripts/design-mockups';
  const out = '/home/z/my-project/download/design-variants';
  await snapshot(`${base}/variant-a.html`, `${out}/variant-a-compact-grid.png`);
  await snapshot(`${base}/variant-b.html`, `${out}/variant-b-stepper.png`);
  await snapshot(`${base}/variant-c.html`, `${out}/variant-c-dashboard.png`);
  console.log('Done.');
})();
