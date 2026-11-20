// Smoke test: every SVG in test/corpus/ builds, and every part it produces has volume.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { build } from '../dist/index.js';

const root = new URL('corpus/', import.meta.url);
const files = fs.readdirSync(root, { recursive: true }).filter((f) => f.endsWith('.svg')).sort();

test('corpus is present', () => assert.ok(files.length >= 27, `found ${files.length} SVGs`));

for (const file of files) {
  test(`corpus: ${file}`, async () => {
    const r = await build(fs.readFileSync(new URL(file, root), 'utf8'));
    assert.ok(r.layers.length > 0, 'no parts');
    for (const l of r.layers) assert.ok(l.volume > 0 && Number.isFinite(l.volume), `${l.name}: volume ${l.volume}`);
    assert.ok(r.size.every((v) => v > 0 && Number.isFinite(v)), `size ${r.size}`);
  });
}
