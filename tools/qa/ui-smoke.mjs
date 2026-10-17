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
const minimap = document.querySelector('#minimap'), miniSurface = createCanvas(168, 148);
minimap.getContext = () => miniSurface.getContext('2d');
minimap.getBoundingClientRect = () => ({ left: 0, top: 0, width: 168, height: 148, right: 168, bottom: 148 });
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
  createBuffer(channels, length, sampleRate) { return { duration: length / sampleRate, copyToChannel() {} }; }
  createBufferSource() {
    const node = { connect() {}, disconnect() {}, start() { this.started = true; }, stop() { this.stopped = true; this.onended?.(); } };
    audioNodes.push(node); return node;
  }
}
Object.assign(globalThis, { window, document, Image, AudioContext,
  requestAnimationFrame: (fn) => setTimeout(fn, 0), cancelAnimationFrame: clearTimeout,
  fetch: async (url) => {
    if (process.env.KINGDOM_QA_AUDIO_FAILURE && /\.(wav|ogg)$/.test(String(url))) return { ok: false, status: 404 };
    const bytes = await fs.readFile(new URL(url)); return { ok: true, json: async () => JSON.parse(bytes.toString()), arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
  } });
const { GameAudio } = await import('../../src/ui/audio.js');
const originalPlay = GameAudio.prototype.play, sounds = [];
GameAudio.prototype.play = function (id) { sounds.push(id); return originalPlay.call(this, id); };
await import('../../src/ui/main.js');
const settle = async () => { for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 15)); };
const click = async (selector) => { document.querySelector(selector).click(); await settle(); };
const text = (selector) => document.querySelector(selector).textContent;
const snapshot = async (name) => fs.writeFile(path.join(output, name + '.png'), surface.toBuffer('image/png'));
const saveState = async () => { await click('#save'); return JSON.parse(window.localStorage.getItem('kingdom-m1-save')); };
function clickTile(tile, type = 'click') {
  const { size, center } = canvas._layout;
  canvas.dispatchEvent(new window.MouseEvent(type, { clientX: center.x + size * Math.sqrt(3) * (tile.q + tile.r / 2), clientY: center.y + size * 1.5 * tile.r, bubbles: true, cancelable: true }));
}
const { getReachablePartyPaths } = await import('../../src/systems/movement-system.js');
const { getTerritoryCandidates } = await import('../../src/systems/territory-system.js');
await settle();
assert.equal(text('#turn'), '1'); assert.equal(audioNodes.length, 0, 'no autoplay');
assert.equal(document.querySelectorAll('#resources .asset-icon').length, 5);
let state = await saveState();
assert.equal(Object.keys(state.world.tiles).length, 331); assert.deepEqual(state.parties['party-1'].unitIds, ['unit-1']);
assert.ok(text('#unit-content').includes('unit-1')); assert.equal(document.querySelectorAll('.formation-slot').length, 9);
if (!failures.size) assert.equal(text('#asset-status'), '');
await snapshot('01-wide-map');
await click('#audio-toggle'); await click('#audio-retry');
assert.equal(audioNodes.filter((node) => node.loop && !node.stopped).length, 1);
if (process.env.KINGDOM_QA_AUDIO_FAILURE) assert.ok(text('#audio-status').includes('内蔵の音符'));
await click('[data-buy="warrior"]'); assert.equal(sounds.at(-1), 'se-purchase');
await click('[data-buy="monument"]'); assert.equal(sounds.at(-1), 'se-ui-error');
assert.ok(document.querySelector('[data-select-unit="unit-2"]'));
// Clicking the waiting marker opens the actual Unit without moving or purchasing.
const cityCenter = canvas._layout.center;
canvas.dispatchEvent(new window.MouseEvent('click', { clientX: cityCenter.x + 18, clientY: cityCenter.y + 12, bubbles: true })); await settle();
assert.ok(text('#unit-content').includes('unit-2')); assert.equal(document.querySelector('#deploy-unit').disabled, true, 'city already contains a party');
await snapshot('02-city-and-waiting-unit');
await click('[data-select-party="party-1"]');
state = await saveState();
const routeEntry = [...getReachablePartyPaths(state, state.parties['party-1'])].find(([, route]) => route.path.length === 2);
assert.ok(routeEntry, 'two-step route exists');
const [destination, route] = routeEntry;
clickTile(state.world.tiles[destination]); await settle();
assert.deepEqual(await saveState(), state, 'inspecting a destination never changes the game');
assert.ok(text('#cell-content').includes(`移動力 ${route.cost}`));
await click('#move-party'); assert.equal(sounds.at(-1), 'se-party-move');
state = await saveState();
assert.equal(state.parties['party-1'].location, destination); assert.equal(state.units['unit-1'].location, destination);
assert.deepEqual(state.commandLog.at(-1).payload.path, route.path);
const beforeReject = state;
clickTile(state.world.tiles['8,-8,0'], 'contextmenu'); await settle();
assert.deepEqual(await saveState(), beforeReject, 'out-of-budget orders are rejected');
await click('#end-turn'); state = await saveState();
assert.equal(state.parties['party-1'].movementRemaining, 2);
const next = [...getReachablePartyPaths(state, state.parties['party-1'])].find(([key, route]) => key !== '0,0,0' && route.path.length === 1);
clickTile(state.world.tiles[next[0]], 'contextmenu'); await settle();
assert.equal((await saveState()).parties['party-1'].location, next[0], 'right-click issues the same validated movement command');
await snapshot('03-party-moved');
// Explicit purchase only, independent of which party is selected.
state = await saveState();
const candidate = getTerritoryCandidates(state, state.cities['city-1']).find((tile) => !Object.values(state.parties).some((p) => p.location === tile.key));
await click('#focus-city'); clickTile(candidate); await settle();
assert.deepEqual(await saveState(), state, 'cell inspection must not spend gold');
await click('#purchase-tile'); assert.equal(sounds.at(-1), 'se-purchase');
assert.equal((await saveState()).world.tiles[candidate.key].ownerId, 'kingdom-1');
// Deploy a chosen waiting Unit, then move it away so another party can be formed.
await click('[data-select-unit="unit-2"]'); await click('#deploy-unit');
state = await saveState(); assert.deepEqual(state.parties['party-2'].unitIds, ['unit-2']);
const depart = [...getReachablePartyPaths(state, state.parties['party-2'])][0];
clickTile(state.world.tiles[depart[0]]); await settle(); await click('#move-party');
// Produce six waiting Units through the actual UI and select only two for a party.
for (let unit = 0; unit < 6; unit++) {
  const count = (await saveState()).kingdoms['kingdom-1'].unitIds.length;
  await click('[data-produce="warrior"]');
  for (let turns = 0; turns < 12 && (await saveState()).kingdoms['kingdom-1'].unitIds.length === count; turns++) await click('#end-turn');
  assert.equal((await saveState()).kingdoms['kingdom-1'].unitIds.length, count + 1);
}
await click('#focus-city'); await click('#select-waiting');
assert.equal(document.querySelectorAll('[data-form-unit]:checked').length, 5);
assert.equal(document.querySelector('[data-form-unit="unit-8"]').disabled, true);
for (const checkbox of [...document.querySelectorAll('[data-form-unit]:checked')]) { checkbox.click(); await settle(); }
await click('[data-form-unit="unit-3"]'); await click('[data-form-unit="unit-5"]'); await click('#form-party');
state = await saveState(); assert.deepEqual(state.parties['party-3'].unitIds, ['unit-3', 'unit-5']); assert.equal(state.units['unit-4'].partyId, null);
await click('[data-slot="front-left"]'); assert.ok(text('#unit-content').includes('unit-3')); await click('[data-slot="front-left"]'); assert.equal(sounds.at(-1), 'se-ui-cancel');
await click('[data-slot="front-left"]'); await click('[data-slot="rear-center"]');
await click('[data-slot="rear-center"]'); await click('[data-slot="front-center"]');
state = await saveState(); assert.deepEqual(state.parties['party-3'].formation, { 'front-center': 'unit-3', 'rear-center': 'unit-5' }); assert.equal(state.parties['party-3'].leaderUnitId, 'unit-3');
// Camera gestures never issue game commands or accidentally select a dragged-over tile.
const beforeCamera = state, beforeCell = text('#cell-content');
await click('#zoom-in'); assert.equal(text('#map-zoom'), '200%');
canvas.dispatchEvent(new window.PointerEvent('pointerdown', { pointerId: 1, isPrimary: true, button: 0, clientX: 200, clientY: 200 }));
canvas.dispatchEvent(new window.PointerEvent('pointermove', { pointerId: 1, isPrimary: true, buttons: 1, clientX: 30, clientY: 50 }));
canvas.dispatchEvent(new window.PointerEvent('pointerup', { pointerId: 1, isPrimary: true, button: 0, clientX: 30, clientY: 50 }));
canvas.dispatchEvent(new window.MouseEvent('click', { clientX: 30, clientY: 50 })); await settle();
assert.equal(text('#cell-content'), beforeCell); assert.deepEqual(await saveState(), beforeCamera);
clickTile(state.world.tiles['2,-1,-1']); await settle(); assert.ok(text('#cell-content').includes('(2, -1, -1)'), 'picking works after pan and zoom');
const centerBeforeMini = { ...canvas._layout.center };
minimap.dispatchEvent(new window.MouseEvent('click', { clientX: 140, clientY: 30 })); await settle();
assert.notDeepEqual(canvas._layout.center, centerBeforeMini);
canvas.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true })); await settle();
await click('#focus-city'); await click('#zoom-out'); assert.equal(text('#map-zoom'), '100%');
await click('#next-party'); assert.ok(text('#party-status').includes('部隊 1'));
window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await settle(); assert.equal(text('#map-mode'), 'セル確認');
await click('#load'); assert.equal(text('#map-mode'), 'セル確認'); assert.deepEqual(await saveState(), beforeCamera);
await click('[data-produce="monument"]');
for (let i = 0; i < 20 && !text('#buildings').includes('モニュメント'); i++) await click('#end-turn');
assert.ok(text('#buildings').includes('モニュメント')); assert.ok(sounds.includes('se-production-complete')); await snapshot('04-city-monument');
const valid = await saveState(); window.localStorage.setItem('kingdom-m1-save', '{'); await click('#load'); assert.equal(sounds.at(-1), 'se-ui-error'); assert.deepEqual(await saveState(), valid);
// A 37-cell save loads as-is; the new radius and starting warrior apply only to a new game.
const { createInitialGameState } = await import('../../src/core/game-state.js');
const old = createInitialGameState(117, { radius: 3 }); window.localStorage.setItem('kingdom-m1-save', JSON.stringify(old)); await click('#load');
assert.deepEqual(await saveState(), old); assert.ok(text('#seed').includes('37セル'));
const volume = document.querySelector('#volume'); volume.value = '30'; volume.dispatchEvent(new window.Event('input')); assert.equal(JSON.parse(window.localStorage.getItem('kingdom-audio-v1')).volume, 0.3);
await click('#audio-toggle'); assert.ok(audioNodes.every((node) => node.stopped));
await click('#reset'); assert.equal(text('#turn'), '1'); assert.ok(text('#seed').includes('331セル')); assert.ok(text('#unit-content').includes('unit-1'));
width = 330; height = 460; window.dispatchEvent(new window.Event('resize')); await snapshot('05-narrow-map');
if (failures.size) assert.ok(text('#asset-status').includes('簡易表示'));
const report = { date: '2026-10-17', harness: 'happy-dom + native Canvas', realBrowser: false, cssLayoutVerified: false, humanListening: false,
  checks: ['331-cell map and starting party', 'unassigned unit map selection', 'cell/unit inspection without mutation', 'two-step route preview and movement cost', 'right-click movement and rejected orders', 'explicit tile purchase', 'unit deployment and occupancy refusal', 'custom two-of-six formation and five-unit cap', 'formation move/swap/cancel and unit details', 'drag suppresses click', 'picking after pan and zoom', 'minimap and keyboard navigation', 'focus city and cycle party', 'save/load selection reset', '37-cell save preserved', 'bad-save rollback', 'new game has controllable unit', 'narrow map Canvas', 'audio retry/mute/preferences', 'production and audio routes'],
  soundRoutes: [...new Set(sounds)], missingAssets: [...failures], audioFilesUnavailable: Boolean(process.env.KINGDOM_QA_AUDIO_FAILURE), result: 'passed' };
await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
GameAudio.prototype.play = originalPlay; await window.happyDOM.abort(); process.exit(0);
