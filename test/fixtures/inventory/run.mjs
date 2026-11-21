// Dev tool (not a node --test file): runs inventory.browser.js over screen.html at 1280x800
// and saves result.json. Playwright is loaded from PLAYWRIGHT_PATH (default: the focus-slides skill's copy).
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const script = readFileSync(join(here, '../../../plugins/focus-blueprint/scripts/inventory.browser.js'), 'utf8');
const pwPath = process.env.PLAYWRIGHT_PATH || join(homedir(), '.claude/skills/focus-slides/node_modules/playwright');
const { chromium } = createRequire(import.meta.url)(pwPath);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
await page.goto(pathToFileURL(join(here, 'screen.html')).href);
const out = await page.evaluate(`(${script})()`);
out.url = 'file://<fixtures>/screen.html'; // keep the result machine-independent
writeFileSync(join(here, 'result.json'), JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify({ links: out.links.length, actions: out.actions.length, forms: out.forms.length, dataItems: out.dataItems.length, lists: out.lists.length, externals: out.externals.map((e) => e.kind) }));
await browser.close();
