// Optional isolated UI harness. It executes the real UI and renders the real Canvas
// with happy-dom + @napi-rs/canvas. It is NOT a browser/CSS/audio listening test.
// npm install --prefix /tmp/kingdom-qa happy-dom @napi-rs/canvas
// KINGDOM_QA_MODULES=/tmp/kingdom-qa/node_modules node tools/qa/ui-smoke.mjs /tmp/kingdom-qa-output
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const packageRequire = process.env.KINGDOM_QA_MODULES ? createRequire(path.join(process.env.KINGDOM_QA_MODULES, 'package.json')) : require;
const { Window } = await import(pathToFileURL(packageRequire.resolve('happy-dom')));
let raster;
try { raster = packageRequire('@napi-rs/canvas'); } catch { raster = require('@napi-rs/canvas'); }
const { createCanvas, loadImage } = raster;
const root = fileURLToPath(new URL('../../', import.meta.url));
const output = path.resolve(process.argv[2] ?? '/tmp/kingdom-ui-smoke');
await fs.mkdir(output, { recursive: true });
const window = new Window({ url: 'http://localhost/kingdom/', settings: { disableCSSFileLoading: true, disableJavaScriptFileLoading: true } });
window.document.write(await fs.readFile(path.join(root, 'index.html'), 'utf8'));
const document = window.document, canvas = document.querySelector('#map'), surface = createCanvas(760, 480), context = surface.getContext('2d');
let width = 760, height = 480;
const images = new WeakMap(), failures = new Set(process.env.KINGDOM_QA_MISSING ? [process.env.KINGDOM_QA_MISSING] : []);
const drawImage = context.drawImage.bind(context);
context.drawImage = (node, ...args) => drawImage(images.get(node) ?? node, ...args);
canvas.getContext = () => context;
canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width, height, right: width, bottom: height });
for (const prop of ['width', 'height']) Object.defineProperty(canvas, prop, { get: () => surface[prop], set: (value) => { surface[prop] = value; } });
function Image() {
  const node = document.createElement('img');
  Object.defineProperty(node, 'src', { set: (url) => {
    node.setAttribute('src', url);
    if ([...failures].some((failure) => url.includes(failure))) { queueMicrotask(() => node.onerror?.()); return; }
    loadImage(fileURLToPath(url)).then((image) => {
      images.set(node, image);
      Object.defineProperties(node, { naturalWidth: { value: image.width }, naturalHeight: { value: image.height } });
      node.onload?.();
    }).catch((error) => node.onerror?.(error));
  }, get: () => node.getAttribute('src') });
  return node;
}
const audioNodes = [];
class AudioContext {
  state = 'running'; destination = {};
  async resume() { this.state = 'running'; }
  createGain() { return { gain: { value: 1 }, connect() {}, disconnect() {} }; }
  async decodeAudioData(bytes) { return { duration: bytes.byteLength / 176400 }; }
  createBufferSource() {
    const node = { connect() {}, disconnect() {}, start() { this.started = true; }, stop() { this.stopped = true; this.onended?.(); } };
    audioNodes.push(node); return node;
  }
}
Object.assign(globalThis, { window, document, Image, AudioContext,
  requestAnimationFrame: (fn) => setTimeout(fn, 0), cancelAnimationFrame: clearTimeout,
  fetch: async (url) => { const bytes = await fs.readFile(new URL(url)); return { ok: true, json: async () => JSON.parse(bytes.toString()), arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }; } });
const { GameAudio } = await import('../../src/ui/audio.js');
const originalPlay = GameAudio.prototype.play, sounds = [];
GameAudio.prototype.play = function (id) { sounds.push(id); return originalPlay.call(this, id); };
await import('../../src/ui/main.js');
const settle = async () => { for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 15)); };
const click = async (selector) => { document.querySelector(selector).click(); await settle(); };
const text = (selector) => document.querySelector(selector).textContent;
const snapshot = async (name) => fs.writeFile(path.join(output, name + '.png'), surface.toBuffer('image/png'));
const saveState = async () => { await click('#save'); return JSON.parse(window.localStorage.getItem('kingdom-m1-save')); };
await settle();
assert.equal(text('#turn'), '1'); assert.equal(audioNodes.length, 0, 'no autoplay');
assert.equal(document.querySelectorAll('#resources .asset-icon').length, 5);
if (!failures.size) assert.equal(text('#asset-status'), '');
await snapshot('01-map');
await click('#audio-toggle'); assert.equal(document.querySelector('#audio-toggle').getAttribute('aria-pressed'), 'true');
assert.equal(audioNodes.filter((node) => node.loop && !node.stopped).length, 1);
await click('[data-buy="warrior"]'); assert.equal(sounds.at(-1), 'se-purchase');
await click('[data-buy="monument"]'); assert.equal(sounds.at(-1), 'se-ui-error');
await click('#form-party'); assert.equal(text('#map-mode'), '部隊移動'); assert.ok(text('#party-status').includes('party-1'));
await snapshot('02-party-at-city');
const before = await saveState(); assert.equal(sounds.at(-1), 'se-save');
const { validatePartyPath } = await import('../../src/systems/movement-system.js');
const tile = Object.values(before.world.tiles).find((tile) => validatePartyPath(before, before.parties['party-1'], [tile.key]).ok);
assert.ok(tile);
function clickTile(tile) {
  const { size, center } = canvas._layout;
  canvas.dispatchEvent(new window.MouseEvent('click', { clientX: center.x + size * Math.sqrt(3) * (tile.q + tile.r / 2), clientY: center.y + size * 1.5 * tile.r, bubbles: true }));
}
clickTile(tile); await settle(); assert.equal(sounds.at(-1), 'se-party-move');
const after = await saveState(); assert.equal(after.parties['party-1'].location, tile.key);
await snapshot('03-party-moved');
await click('#deselect-party'); assert.equal(text('#map-mode'), '領土購入'); assert.equal(sounds.at(-1), 'se-ui-cancel');
clickTile(tile); await settle(); assert.equal(sounds.at(-1), 'se-ui-select');
window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await settle(); assert.equal(text('#map-mode'), '領土購入');
const { getTerritoryCandidates } = await import('../../src/systems/territory-system.js');
const candidate = getTerritoryCandidates(after, after.cities['city-1']).find((candidate) => candidate.key !== tile.key);
clickTile(candidate); await settle(); assert.equal(sounds.at(-1), 'se-purchase');
await click('#load'); assert.equal(sounds.at(-1), 'se-load'); assert.equal(text('#map-mode'), '領土購入');
assert.equal((await saveState()).world.tiles[candidate.key].ownerId, null, 'restore does not replay purchase');
await click('[data-produce="monument"]');
for (let i = 0; i < 20 && !text('#buildings').includes('モニュメント'); i++) await click('#end-turn');
assert.ok(text('#buildings').includes('モニュメント')); assert.ok(sounds.includes('se-production-complete'));
await snapshot('04-city-monument');
// Bad save must not replace the currently playable state.
const valid = await saveState(); window.localStorage.setItem('kingdom-m1-save', '{'); await click('#load');
assert.equal(sounds.at(-1), 'se-ui-error'); assert.deepEqual(await saveState(), valid);
// A stored preference updates from the UI, and reset clears any stale selection.
const volume = document.querySelector('#volume'); volume.value = '30'; volume.dispatchEvent(new window.Event('input'));
assert.equal(JSON.parse(window.localStorage.getItem('kingdom-audio-v1')).volume, 0.3);
await click('#audio-toggle'); assert.ok(audioNodes.every((node) => node.stopped));
await click('#reset'); assert.equal(text('#turn'), '1'); assert.equal(text('#map-mode'), '領土購入'); assert.equal(document.querySelector('#deselect-party').disabled, true);
// Render the same map at minimum scrollable width. This is not CSS layout QA.
width = 530; window.dispatchEvent(new window.Event('resize')); await snapshot('05-minimum-map');
if (failures.size) assert.ok(text('#asset-status').includes('簡易表示'));
const report = { date: '2026-10-17', harness: 'happy-dom + native Canvas', realBrowser: false, cssLayoutVerified: false, humanListening: false,
  checks: ['no autoplay', '17 image load/fallback', 'resource icons', 'purchase/reject sounds', 'party creation/selection/movement', 'city-party overlap', 'deselect/Esc', 'tile purchase after deselect', 'save/load sounds and selection reset', 'production completion and monument', 'broken-save rollback', 'volume persistence', 'mute stops sources', 'new game selection reset', 'minimum map canvas'],
  soundRoutes: [...new Set(sounds)], missingAssets: [...failures], result: 'passed' };
await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
GameAudio.prototype.play = originalPlay;
await window.happyDOM.abort();
process.exit(0);
