// Snapshot the scales tab with a Заруб dealer selected (worst case: 12-col service scale)
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1200 }, deviceScaleFactor: 1.5 });
  const page = await ctx.newPage();
  await page.goto('http://localhost:3000/', { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1500);

  // Click on the "Шкалы" tab
  await page.click('button:has-text("Шкалы")', { timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(800);

  // Open the dealer selector — the SelectTrigger is the only dark-bg combobox
  const trigger = await page.$('.bg-slate-900[role="combobox"], button.bg-slate-900');
  if (trigger) {
    await trigger.click();
    console.log('Opened dealer selector');
  } else {
    // Fallback: click any combobox
    await page.click('[role="combobox"]', { timeout: 3000 }).catch(() => {});
  }
  await page.waitForTimeout(600);
  // List all options to console for debugging
  const opts = await page.$$eval('[role="option"]', els => els.map(e => e.textContent || ''));
  console.log('Options:', opts.slice(0, 25));
  // Click option containing "ABS" or "ASIAN" or "Заруб"
  let opt = await page.$('[role="option"]:has-text("ABS")');
  if (!opt) opt = await page.$('[role="option"]:has-text("ASIAN")');
  if (!opt) opt = await page.$('[role="option"]:has-text("Lucky")');
  if (!opt) opt = await page.$('[role="option"]:has-text("Заруб")');
  if (opt) {
    await opt.click();
    console.log('Selected Заруб dealer');
  } else {
    console.log('Could not find Заруб option');
  }
  await page.waitForTimeout(1500);

  await page.screenshot({ path: '/home/z/my-project/download/variant-a-zarub.png', fullPage: true });
  console.log('OK: zarub screenshot saved');

  await browser.close();
})();
