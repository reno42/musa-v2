const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
const htmlPath = process.argv[2] || './carrusel.html';
const outDir = process.argv[3] || './output';
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1080, height: 1350 });
  await page.goto('file:///' + path.resolve(htmlPath).replace(/\\/g, '/'), { waitUntil: 'networkidle', timeout: 30000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(4000);
  const count = await page.evaluate(() => document.querySelectorAll('.slide').length);
  console.log(`Slides: ${count}`);
  for (let i = 1; i <= count; i++) {
    const el = await page.$(`.slide:nth-child(${i})`);
    if (!el) continue;
    const out = path.join(outDir, `slide-${String(i).padStart(2,'0')}.png`);
    await el.screenshot({ path: out });
    console.log(`Saved: ${out}`);
  }
  await browser.close();
  console.log('Done.');
})().catch(e => { console.error(e); process.exit(1); });
