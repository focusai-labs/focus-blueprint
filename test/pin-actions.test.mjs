// C14 and A10: every GitHub Action is pinned to a full commit SHA, with the tag kept as a comment.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { ROOT, PLUGIN } from './helpers.mjs';

test('every uses: line in the templates and in the repo workflows is a 40-character SHA with a # vN comment', () => {
  const dirs = [path.join(PLUGIN, 'templates', 'github'), path.join(ROOT, '.github', 'workflows')];
  let count = 0;
  for (const d of dirs) {
    for (const f of fs.readdirSync(d).filter((n) => /\.ya?ml$/.test(n))) {
      for (const line of fs.readFileSync(path.join(d, f), 'utf8').split('\n')) {
        if (!/^\s*-?\s*uses:/.test(line)) continue;
        count++;
        assert.match(line, /uses:\s+[\w.-]+\/[\w./-]+@[0-9a-f]{40}\s+#\s+v\d+/, `${f}: ${line}`);
      }
    }
  }
  assert.ok(count >= 6);
});
