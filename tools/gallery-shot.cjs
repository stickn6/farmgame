// Screenshot the model gallery:  node tools/gallery-shot.cjs "coop,cow,crop:wheat:3:0" out.png [angle] [w] [h]
// Keys can also be a preset: "set:debris". Env: PORT, CELL (tile spacing), PITCH, DIST.
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
  const sel = keys.startsWith('set:') ? `set=${keys.slice(4)}` : `keys=${encodeURIComponent(keys)}`;
  const extra = ['pitch', 'dist'].filter((k) => process.env[k.toUpperCase()]).map((k) => `&${k}=${process.env[k.toUpperCase()]}`).join('');
  await page.goto(`http://localhost:${port}/gallery.html?${sel}&angle=${angle}&cell=${process.env.CELL || 5}${extra}`);
  await page.waitForFunction(() => window.galleryReady, null, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await page.screenshot({ path: out });
  console.log(errs.length ? errs.join('\n') : 'no errors');
  await browser.close();
})();
