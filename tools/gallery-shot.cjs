// Screenshot the model gallery:  node tools/gallery-shot.cjs "coop,cow,crop:wheat:3:0" out.png [angle] [w] [h]
// Needs the dev server running (npm run dev). Prints console errors from the page.
const { chromium } = require('playwright');
(async () => {
  const [keys, out, angle = '0.6', w = '1400', hgt = '900'] = process.argv.slice(2);
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: +w, height: +hgt } });
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.text()); });
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  const port = process.env.PORT || 5173;
  await page.goto(`http://localhost:${port}/gallery.html?keys=${encodeURIComponent(keys)}&angle=${angle}&cell=${process.env.CELL || 5}`);
  await page.waitForFunction(() => window.galleryReady, null, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await page.screenshot({ path: out });
  console.log(errs.length ? errs.join('\n') : 'no errors');
  await browser.close();
})();
