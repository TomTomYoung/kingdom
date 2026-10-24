// Optional real Chromium QA. Install Playwright separately, then set
// KINGDOM_QA_MODULES to its node_modules and KINGDOM_BROWSER to Chromium if needed.
// node tools/qa/browser-smoke.mjs /tmp/kingdom-browser
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createInitialGameState } from '../../src/core/game-state.js';
import { getReachablePartyPaths } from '../../src/systems/movement-system.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const output = path.resolve(process.argv[2] ?? '/tmp/kingdom-browser');
await fs.mkdir(output, { recursive: true });
const modules = process.env.KINGDOM_QA_MODULES ?? process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES;
const require = createRequire(modules ? path.join(modules, 'package.json') : import.meta.url);
const { chromium } = require('playwright');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.wav': 'audio/wav', '.ogg': 'audio/ogg' };
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const target = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!target.startsWith(root)) throw new Error('outside root');
    const bytes = await fs.readFile(target);
    response.writeHead(200, { 'Content-Type': mime[path.extname(target)] ?? 'application/octet-stream' }); response.end(bytes);
  } catch { response.writeHead(404); response.end(); }
});
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const url = `http://127.0.0.1:${server.address().port}`;
let browser;
const results = [];
try {
  browser = await chromium.launch({ headless: true, ...(process.env.KINGDOM_BROWSER ? { executablePath: process.env.KINGDOM_BROWSER } : {}) });
  for (const missingAudio of [false, true]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
    const page = await context.newPage(), errors = [], failedRequests = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('response', (response) => { if (response.status() >= 400 && !response.url().endsWith('favicon.ico')) failedRequests.push(response.url()); });
    if (missingAudio) await page.route(/\.(wav|ogg)$/, (route) => route.fulfill({ status: 404, body: '' }));
    // Observe native audio nodes without replacing decoding, playback, or Worker synthesis.
    await page.addInitScript(() => {
      window.qaAudioSources = []; window.qaDecodeErrors = [];
      const decode = AudioContext.prototype.decodeAudioData;
      AudioContext.prototype.decodeAudioData = async function (...args) {
        try { return await decode.apply(this, args); }
        catch (error) { window.qaDecodeErrors.push(error.message); throw error; }
      };
      const original = AudioContext.prototype.createBufferSource;
      AudioContext.prototype.createBufferSource = function (...args) {
        const source = original.apply(this, args); window.qaAudioSources.push(source);
        source.addEventListener('ended', () => { source.qaEnded = true; });
        const start = source.start.bind(source), stop = source.stop.bind(source);
        source.start = (...params) => { source.qaStarted = true; return start(...params); };
        source.stop = (...params) => { source.qaStopped = true; return stop(...params); };
        return source;
      };
    });
    await page.goto(url);
    await page.waitForFunction(() => document.querySelector('#resources img'));
    await page.waitForFunction(() => [...document.images].every((image) => image.complete));
    const save = async () => { await page.click('#save'); return page.evaluate(() => JSON.parse(localStorage.getItem('kingdom-m1-save'))); };
    const load = async (value) => { await page.evaluate((s) => localStorage.setItem('kingdom-m1-save', JSON.stringify(s)), value); await page.click('#load'); };
    const tileClick = async (tile, button = 'left') => {
      await page.locator('#map').scrollIntoViewIfNeeded();
      const point = await page.locator('#map').evaluate((canvas, tile) => {
        const rect = canvas.getBoundingClientRect(), { size, center } = canvas._layout;
        return { x: rect.left + center.x + size * Math.sqrt(3) * (tile.q + tile.r / 2), y: rect.top + center.y + size * 1.5 * tile.r };
      }, tile);
      await page.mouse.click(point.x, point.y, { button });
    };
    let state = await save();
    assert.equal(Object.keys(state.world.tiles).length, 331);
    assert.equal(state.units['unit-1'].partyId, 'party-1');
    assert.equal(await page.evaluate(() => window.qaAudioSources.length), 0, 'no autoplay');
    assert.equal(await page.locator('.formation-slot').count(), 9);
    assert.equal(await page.locator('#asset-status').innerText(), '');
    await page.click('#audio-toggle');
    const musicReady = () => page.waitForFunction(() => window.qaAudioSources.filter((s) => s.loop && s.qaStarted && !s.qaStopped && !s.qaEnded && s.buffer?.duration > 0 && s.context.state === 'running').length === 1);
    await musicReady();
    await page.click('#audio-retry'); await musicReady();
    if (missingAudio) assert.match(await page.locator('#audio-status').innerText(), /内蔵の音符/);
    else {
      assert.equal(await page.locator('#audio-status').innerText(), '', 'healthy files must decode without falling back');
      assert.deepEqual(await page.evaluate(() => window.qaDecodeErrors), []);
    }
    await page.click('[data-buy="warrior"]');
    assert.equal(await page.locator('[data-select-unit="unit-2"]').count(), 1);
    await page.click('[data-select-party="party-1"]');
    state = await save();
    const [destination, route] = [...getReachablePartyPaths(state, state.parties['party-1'])].find(([, r]) => r.path.length === 2);
    await tileClick(state.world.tiles[destination]);
    assert.deepEqual(await save(), state, 'inspection has no game side effects');
    await page.click('#map-move');
    state = await save(); assert.equal(state.parties['party-1'].location, destination);
    assert.deepEqual(state.commandLog.at(-1).payload.path, route.path);
    await page.click('[data-select-unit="unit-2"]'); await page.click('#deploy-unit');
    state = await save(); assert.deepEqual(state.parties['party-2'].unitIds, ['unit-2']);
    await page.click('[data-slot="front-left"]'); await page.click('[data-slot="rear-center"]');
    state = await save(); assert.deepEqual(state.parties['party-2'].formation, { 'rear-center': 'unit-2' });
    await page.click('#end-turn'); state = await save();
    const depart = [...getReachablePartyPaths(state, state.parties['party-2'])][0];
    await page.click('[data-select-party="party-2"]'); await tileClick(state.world.tiles[depart[0]], 'right');
    state = await save(); assert.equal(state.parties['party-2'].location, depart[0]);
    await page.click('#zoom-in'); assert.equal(await page.locator('#map-zoom').innerText(), '200%');
    await page.locator('#map').scrollIntoViewIfNeeded();
    const beforeDrag = await page.locator('#cell-content').innerText(), box = await page.locator('#map').boundingBox();
    await page.mouse.move(box.x + 250, box.y + 200); await page.mouse.down(); await page.mouse.move(box.x + 150, box.y + 100, { steps: 5 }); await page.mouse.up();
    assert.equal(await page.locator('#cell-content').innerText(), beforeDrag);
    const center = await page.locator('#map').evaluate((canvas) => canvas._layout.center);
    await page.locator('#minimap').click({ position: { x: 20, y: 20 } });
    assert.notDeepEqual(await page.locator('#map').evaluate((canvas) => canvas._layout.center), center);
    await page.click('#focus-city'); await page.click('#zoom-out');
    await page.click('#load'); assert.deepEqual(await save(), state);
    await page.click('[data-select-party="party-2"]'); await page.click('#zoom-in');
    const selection = await page.locator('#unit-content').innerText();
    const broken = structuredClone(state); broken.units['unit-2'].partyId = 'missing';
    await load(broken);
    assert.match(await page.locator('#message').innerText(), /セーブデータが不正/);
    assert.equal(await page.locator('#unit-content').innerText(), selection);
    assert.equal(await page.locator('#map-zoom').innerText(), '200%');
    assert.deepEqual(await save(), state, 'invalid load keeps current game');
    await page.click('#end-turn'); assert.equal((await save()).currentTurn, state.currentTurn + 1, 'game remains playable');
    const old = createInitialGameState(117, { radius: 3 }); await load(old);
    assert.deepEqual(await save(), old); assert.match(await page.locator('#seed').innerText(), /37セル/);
    await page.click('#reset'); assert.match(await page.locator('#seed').innerText(), /331セル/);
    // Reach battle through the ordinary setup and controls, with no fixture injection.
    await page.selectOption('#game-mode', 'duel'); await page.click('#reset');
    state = await save(); assert.equal(state.turnOrder.length, 2); assert.equal(Object.keys(state.units).length, 6);
    await tileClick(state.world.tiles[state.parties['party-2'].location]);
    assert.match(await page.locator('#party-status').innerText(), /部隊 1/, 'enemy selection keeps the attacker');
    assert.match(await page.locator('#unit-content').innerText(), /unit-4/);
    assert.deepEqual(await save(), state, 'enemy preview does not consume RNG or change the game');
    assert.match(await page.locator('#combat-forecast').innerText(), /護衛/);
    await page.waitForFunction(() => window.qaAudioSources.filter(s => s.loop && s.qaStarted && !s.qaStopped && !s.qaEnded && Math.abs(s.buffer?.duration - 13.3333333) < .02).length === 1);
    await page.selectOption('#guard-unit', 'unit-2'); await page.selectOption('#guard-mode', 'intercept'); await page.click('#set-guard');
    assert.equal((await save()).parties['party-1'].guardOrders['unit-2'].mode, 'intercept');
    await page.click('#attack-party'); state = await save();
    assert.ok(state.units['unit-4'].currentHp < 100 && state.units['unit-5'].currentHp < 100);
    assert.equal(state.units['unit-1'].currentHp, 100); assert.ok(state.units['unit-2'].currentHp < 100);
    assert.equal(state.parties['party-1'].reactionCharges, 0);
    assert.equal(await page.locator('#attack-party').isDisabled(), true);
    assert.match(await page.locator('#combat-log').innerText(), /肩代わり/); assert.match(await page.locator('#combat-log').innerText(), /割り込み/);
    await page.locator('#combat-panel').screenshot({ path: path.join(output, missingAudio ? 'battle-fallback.png' : 'battle.png') });
    await page.click('#end-turn');
    assert.match(await page.locator('#active-kingdom').innerText(), /夕映王国/); assert.equal(await page.locator('#city-name').innerText(), '黄昏都');
    await page.click('[data-buy="warrior"]'); state = await save();
    assert.equal(state.units['unit-7'].ownerId, 'kingdom-2'); assert.equal(state.units['unit-7'].location, '4,-4,0');
    await page.selectOption('#combat-target', 'party-1'); await page.selectOption('#attack-type', 'ranged');
    assert.equal(await page.locator('#attack-party').isDisabled(), true); assert.deepEqual(await save(), state);
    await page.selectOption('#attack-type', 'melee'); await page.click('#attack-party'); state = await save();
    await page.click('#load'); assert.deepEqual(await save(), state); assert.match(await page.locator('#active-kingdom').innerText(), /夕映王国/);
    await page.click('[data-select-party="party-2"]');
    for (let action = 0; action < 40 && !Object.values(state.parties).some(p => p.status === 'defeated'); action++) {
      const own = Object.values(state.parties).find(p => p.ownerId === state.activePlayerId), enemy = Object.values(state.parties).find(p => p.ownerId !== state.activePlayerId);
      if (own.attacksRemaining > 0 && own.activationState !== 'ended') { await page.selectOption('#combat-target', enemy.id); await page.click('#attack-party'); }
      else await page.click('#end-turn');
      state = await save();
    }
    assert.ok(Object.values(state.parties).some(p => p.status === 'defeated'), 'battle reaches defeat through normal attacks');
    assert.ok(state.eventLog.some(e => e.type === 'PartyLeaderChanged'), 'leadership succession is reachable');
    assert.equal(Object.keys(state.parties['party-1'].formation).length, 3, 'casualties do not rearrange the formation');
    await page.click('#load'); assert.deepEqual(await save(), state, 'defeat and reactions survive loading');
    const defeated = Object.values(state.parties).find(p => p.status === 'defeated');
    const winner = Object.values(state.parties).find(p => p.status === 'active');
    for (let turn = 0; turn < 4 && (state.activePlayerId !== winner.ownerId || state.parties[winner.id].movementRemaining === 0 || state.parties[winner.id].activationState === 'ended'); turn++) {
      await page.click('#end-turn'); state = await save();
    }
    assert.equal(state.activePlayerId, winner.ownerId);
    await page.click(`[data-select-party="${winner.id}"]`);
    const record = structuredClone({ party: state.parties[defeated.id], units: defeated.unitIds.map(id => state.units[id]) });
    await tileClick(state.world.tiles[defeated.location]);
    assert.match(await page.locator('#cell-content').innerText(), /敗北記録（占有なし）/);
    assert.match(await page.locator('#cell-content').innerText(), /駐留部隊 0/);
    assert.equal(await page.locator('#map-move').isDisabled(), false, 'defeated tile is reachable');
    await page.click('#map-move'); state = await save();
    assert.equal(state.parties[winner.id].location, defeated.location);
    assert.deepEqual({ party: state.parties[defeated.id], units: defeated.unitIds.map(id => state.units[id]) }, record, 'movement preserves the defeat record');
    assert.match(await page.locator('#cell-content').innerText(), /駐留部隊 1/);
    await page.locator('#cell-content').screenshot({ path: path.join(output, missingAudio ? 'defeated-cell-fallback.png' : 'defeated-cell.png') });
    await page.click('#load'); assert.deepEqual(await save(), state, 'active party and defeat record can share a tile after loading');
    // Return to a fresh battle for the desktop/mobile layout screenshots.
    await page.click('#reset'); await page.selectOption('#combat-target', 'party-2');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForFunction(() => [0.1910430839, 0.5576643991].every(duration => window.qaAudioSources.some(source => source.qaStarted && Math.abs(source.buffer?.duration - duration) < .001)));
    await page.screenshot({ path: path.join(output, missingAudio ? 'desktop-audio-fallback.png' : 'desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => window.scrollTo(0, 0));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal overflow at 390px');
    await page.screenshot({ path: path.join(output, missingAudio ? 'mobile-audio-fallback.png' : 'mobile.png'), fullPage: true });
    await page.click('#audio-toggle');
    assert.equal(await page.evaluate(() => window.qaAudioSources.filter((s) => s.qaStarted && !s.qaStopped && !s.qaEnded).length), 0);
    assert.deepEqual(errors, []);
    if (!missingAudio) assert.deepEqual(failedRequests, []);
    if (missingAudio) assert.ok(failedRequests.length > 0, '404 test must actually request audio files');
    results.push({ missingAudio, errors, expectedAudio404s: missingAudio ? failedRequests.length : 0, result: 'passed' });
    await context.close();
  }
  const report = { date: new Date().toISOString(), browser: await browser.version(), realBrowser: true, humanListening: false,
    checks: ['331-cell map', 'waiting unit and party selection', 'two-cell route and right-click movement', '3x3 formation edit', 'drag suppresses click', 'zoom and minimap', 'save/load', 'invalid load preserves game, selection and zoom', '37-cell save compatibility', 'new game', '390px layout', 'native audio decoding/playback nodes', '404 Worker synthesis', 'retry without overlapping BGM', 'mute stops sources', 'two-kingdom hotseat setup and city ownership', 'enemy selection retains attacker', 'RNG-free forecast', 'Guard/Intercept and counter', 'battle music and SE', 'action exhaustion', 'invalid ranged attack disabled', 'leadership succession and defeat', 'combat save/load', 'defeated tile movement preserves casualty records', 'active and defeated co-location save/load'], results };
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
} finally { await browser?.close(); server.close(); }
