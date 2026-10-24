import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { AssetStore, indexAssets } from '../src/ui/assets.js';
import { RULESET } from '../src/core/ruleset.js';
const manifest = JSON.parse(fs.readFileSync(new URL('../assets/manifest.json', import.meta.url)));

test('adopted terrain, warrior, building and resource assets have matching source/delivery hashes', () => {
  const entries = indexAssets(manifest, new URL('https://example.test/kingdom/'));
  assert.equal(entries.size, manifest.assets.length);
  for (const id of [...Object.keys(RULESET.terrain).map((id) => `terrain-${id}`), 'building-city', 'building-monument', 'unit-warrior', ...['food', 'production', 'gold', 'science', 'mana', 'religion', 'culture', 'popular-support'].map((id) => `icon-${id}`)]) assert.ok(entries.has(id), id);
  for (const entry of manifest.assets) for (const file of entry.files) {
    const bytes = fs.readFileSync(new URL(`../${file.path}`, import.meta.url));
    assert.equal(bytes.length, file.bytes, file.path);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256, file.path);
  }
  assert.ok(entries.get('terrain-plains').url.startsWith('https://example.test/kingdom/assets/'));
});

test('a missing image or manifest is recoverable and does not hide loaded images', async () => {
  const store = new AssetStore();
  const subset = { assets: manifest.assets.slice(0, 2) };
  let count = 0;
  await store.load({ fetcher: async () => ({ ok: true, json: async () => subset }), imageFactory: () => {
    const fail = count++ === 0;
    return { set src(value) { queueMicrotask(() => fail ? this.onerror() : this.onload()); } };
  } });
  assert.equal(store.failed.size, 1); assert.equal(store.images.size, 1);
  const broken = new AssetStore(); await broken.load({ fetcher: async () => { throw Error('offline'); } });
  assert.ok(broken.failed.has('manifest'));
  assert.equal(broken.draw({}, 'terrain-plains', 0, 0), false);
});

test('pixel sprites preserve aspect ratio and use integral scaling', () => {
  const store = new AssetStore(), calls = [];
  store.images.set('test', { naturalWidth: 48, naturalHeight: 24 });
  const ctx = { drawImage: (...args) => calls.push(args) };
  assert.equal(store.draw(ctx, 'test', 100.2, 100.8, 2.7), true);
  assert.equal(ctx.imageSmoothingEnabled, false);
  assert.deepEqual(calls[0].slice(1), [52, 77, 96, 48]);
});
