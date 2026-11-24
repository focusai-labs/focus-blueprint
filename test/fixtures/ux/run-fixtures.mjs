// Dev tool (not a node --test file): runs ux-check.browser.js over the UX fixtures
// and saves results/{pass,fail-all}.{desktop,phone}.json.
// Playwright is loaded from PLAYWRIGHT_PATH (default: the focus-slides skill's copy).
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const script = readFileSync(join(here, '../../../plugins/focus-blueprint/scripts/ux-check.browser.js'), 'utf8');
const pwPath = process.env.PLAYWRIGHT_PATH || join(homedir(), '.claude/skills/focus-slides/node_modules/playwright');
const { chromium } = createRequire(import.meta.url)(pwPath);
const viewports = { desktop: { width: 1280, height: 800 }, phone: { width: 390, height: 844 } };
mkdirSync(join(here, 'results'), { recursive: true });

const browser = await chromium.launch();
for (const name of ['pass', 'fail-all', 'width-pass', 'width-fail']) {
  for (const [vp, viewport] of Object.entries(viewports)) {
    if (name.startsWith('width-') && vp !== 'desktop') continue;
    const ctx = await browser.newContext({ viewport });
    const page = await ctx.newPage();
    await page.goto(pathToFileURL(join(here, `${name}.html`)).href);
    // same as browser_evaluate: the file text is the function, it gets called
    const out = await page.evaluate(`(${script})()`);
    out.url = `file://<fixtures>/${name}.html`; // keep results machine-independent
    writeFileSync(join(here, 'results', `${name}.${vp}.json`), JSON.stringify(out, null, 2) + '\n');
    console.log(name, vp, out.results.filter((r) => r.level === 'pass').length, 'pass', out.results.filter((r) => r.level === 'skip').length, 'skip', out.results.filter((r) => !r.pass).map((r) => r.id).join(','));
    await ctx.close();
  }
}
await browser.close();
