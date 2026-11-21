// Dev tool (not a node --test file): screenshots every catalog example at 390x844
// into test/fixtures/catalog/*.png and fails on any page error.
// Playwright is loaded from PLAYWRIGHT_PATH (default: the focus-slides skill's copy).
import { createRequire } from 'node:module';
import { readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const examples = join(here, '../../../plugins/focus-blueprint/data/catalog/examples');
const pwPath = process.env.PLAYWRIGHT_PATH || join(homedir(), '.claude/skills/focus-slides/node_modules/playwright');
const { chromium } = createRequire(import.meta.url)(pwPath);

const browser = await chromium.launch();
let errors = 0;
for (const f of readdirSync(examples).filter((n) => n.endsWith('.html')).sort()) {
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  page.on('pageerror', (e) => { errors++; console.error(f, 'pageerror', e.message); });
  await page.goto(pathToFileURL(join(examples, f)).href);
  await page.screenshot({ path: join(here, f.replace(/\.html$/, '.png')), fullPage: true });
  console.log('shot', f);
  await page.close();
}
await browser.close();
if (errors) process.exit(1);
