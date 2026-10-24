// Optional real Chromium QA for city-specific territory, yields and controls.
// Set KINGDOM_QA_MODULES and KINGDOM_BROWSER, then run:
// node tools/qa/browser-cities.mjs /tmp/kingdom-cities-qa
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createInitialGameState } from '../../src/core/game-state.js';
import { getTerritoryCandidates, tilePurchaseCost } from '../../src/systems/territory-system.js';
import { Hex } from '../../src/world/hex.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const output = path.resolve(process.argv[2] ?? '/tmp/kingdom-cities-qa');
await fs.mkdir(output, { recursive: true });
const modules = process.env.KINGDOM_QA_MODULES ?? process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES;
const { chromium } = createRequire(modules ? path.join(modules, 'package.json') : import.meta.url)('playwright');
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
let browser;
const errors = [], failures = [], checks = [];
function distinctWork(state) {
  const used = new Set();
  for (const city of Object.values(state.cities)) for (const key of city.workedTiles) {
    assert.ok(!used.has(key), 'a tile is collected by at most one city'); used.add(key);
    assert.equal(state.world.tiles[key].territoryCityId, city.id); assert.equal(state.world.tiles[key].ownerId, city.ownerId);
  }
}
try {
  browser = await chromium.launch({ headless: true, ...(process.env.KINGDOM_BROWSER ? { executablePath: process.env.KINGDOM_BROWSER } : {}) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } }), page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() >= 400 && !response.url().endsWith('favicon.ico')) failures.push(response.url()); });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => document.querySelector('#resources img'));
  const save = async () => { await page.click('#save'); return page.evaluate(() => JSON.parse(localStorage.getItem('kingdom-m1-save'))); };
  const load = async value => { await page.evaluate(s => localStorage.setItem('kingdom-m1-save', JSON.stringify(s)), value); await page.click('#load'); };
  const fresh = async () => { await page.selectOption('#game-mode', 'two-cities'); await page.click('#reset'); return save(); };
  const tileClick = async tile => {
    await page.locator('#map').scrollIntoViewIfNeeded();
    const point = await page.locator('#map').evaluate((canvas, tile) => {
      const rect = canvas.getBoundingClientRect(), { size, center } = canvas._layout;
      return { x: rect.left + center.x + size * Math.sqrt(3) * (tile.q + tile.r / 2), y: rect.top + center.y + size * 1.5 * tile.r };
    }, tile);
    await page.mouse.click(point.x, point.y);
  };
  let state = await fresh();
  assert.equal(state.scenarioId, 'two-cities'); assert.equal(state.cityTerritoryVersion, 1);
  assert.deepEqual(state.kingdoms['kingdom-1'].cityIds, ['city-1', 'city-2']); distinctWork(state);
  assert.equal(await page.locator('#city-select option').count(), 2); checks.push('two-city setup and disjoint worked tiles');
  await page.selectOption('#city-select', 'city-2');
  assert.equal(await page.locator('#city-name').innerText(), '東都'); assert.match(await page.locator('#production-city').innerText(), /東都/);
  assert.deepEqual(await save(), state, 'city switching cannot change state, resources, IDs, logs or RNG');
  await page.locator('#city-work-panel summary').click();
  assert.deepEqual(await page.locator('[data-worked-tile]').evaluateAll(buttons => buttons.map(button => button.dataset.workedTile)), state.cities['city-2'].workedTiles);
  await page.locator('[data-worked-tile]').first().click();
  assert.match(await page.locator('#cell-content').innerText(), /所属都市\n東都/); assert.match(await page.locator('#cell-content').innerText(), /収集時の作業\n東都/);
  assert.deepEqual(await save(), state, 'work inspection is read-only'); checks.push('selection and collection details have no state or RNG effects');
  await page.click('[data-produce="monument"]');
  let produced = await save(); assert.equal(produced.cities['city-2'].production.currentItemId, 'monument'); assert.deepEqual(produced.cities['city-1'].production, state.cities['city-1'].production);
  await page.click('[data-buy="archer"]'); produced = await save();
  const bought = Object.values(produced.units).find(unit => unit.typeId === 'archer');
  assert.ok(bought); assert.equal(bought.location, '4,-4,0'); assert.equal(bought.ownerId, 'kingdom-1');
  assert.equal(produced.kingdoms['kingdom-1'].stockpiles.gold, state.kingdoms['kingdom-1'].stockpiles.gold - 72);
  await page.selectOption('#city-select', 'city-1'); await page.click('[data-produce="warrior"]');
  for (let turn = 0; turn < 12 && !produced.cities['city-2'].buildings.includes('monument'); turn++) { await page.click('#end-turn'); produced = await save(); distinctWork(produced); }
  assert.ok(produced.cities['city-2'].buildings.includes('monument')); assert.ok(!produced.cities['city-1'].buildings.includes('monument'));
  assert.ok(Object.values(produced.units).some(unit => unit.id !== 'unit-1' && unit.typeId === 'warrior' && unit.location === '0,0,0'));
  checks.push('selected-city production and purchase keep separate queues and spawn locations');

  state = await fresh();
  const firstCandidates = new Set(getTerritoryCandidates(state, state.cities['city-1']).map(tile => tile.key));
  const secondOnly = getTerritoryCandidates(state, state.cities['city-2']).filter(tile => !firstCandidates.has(tile.key)).sort((a, b) => Hex.fromKey(a.key).distance(Hex.fromKey('0,0,0')) - Hex.fromKey(b.key).distance(Hex.fromKey('0,0,0')))[0];
  assert.ok(secondOnly); await tileClick(secondOnly);
  assert.equal(await page.locator('#purchase-tile').isDisabled(), true, 'city-1 cannot use the other city boundary'); assert.deepEqual(await save(), state);
  await page.selectOption('#city-select', 'city-2'); await tileClick(secondOnly);
  const cost = tilePurchaseCost(state, state.cities['city-2'], secondOnly);
  assert.equal(await page.locator('#purchase-tile').isDisabled(), false); assert.match(await page.locator('#purchase-tile').innerText(), new RegExp(`Gold ${cost}`));
  await page.click('#purchase-tile'); let purchased = await save();
  assert.equal(purchased.world.tiles[secondOnly.key].ownerId, 'kingdom-1'); assert.equal(purchased.world.tiles[secondOnly.key].territoryCityId, 'city-2');
  assert.equal(purchased.kingdoms['kingdom-1'].stockpiles.gold, state.kingdoms['kingdom-1'].stockpiles.gold - cost);
  for (const id of ['city-1', 'city-2']) assert.equal(purchased.cities[id].localCultureProgress, state.cities[id].localCultureProgress);
  assert.match(await page.locator('#cell-content').innerText(), /所属都市\n東都/); assert.equal(await page.locator('#purchase-tile').isDisabled(), true);
  checks.push('territory candidates and cost follow selection; purchase spends shared Gold and assigns the chosen city');
  await page.click('#load'); assert.deepEqual(await save(), purchased); assert.equal(await page.locator('#game-mode').inputValue(), 'two-cities');
  assert.equal(await page.locator('#city-select').inputValue(), 'city-1', 'load restores a safe own-city selection'); checks.push('save/load preserves territory, work, economy and scenario');
  await page.selectOption('#city-select', 'city-2'); await page.click('#zoom-in');
  const broken = structuredClone(purchased); broken.world.tiles['4,-4,0'].territoryCityId = 'missing-city';
  await load(broken); assert.match(await page.locator('#message').innerText(), /セーブデータが不正/);
  assert.equal(await page.locator('#city-select').inputValue(), 'city-2'); assert.equal(await page.locator('#map-zoom').innerText(), '200%');
  assert.deepEqual(await save(), purchased); checks.push('invalid territory load preserves city selection, camera and game');
  for (const corrupt of [s => { s.cities['city-2'].lastYieldBreakdown.tiles = 3; }, s => { s.cities['city-2'].lastYieldBreakdown.tiles = [null]; }]) {
    const malformed = structuredClone(purchased); corrupt(malformed); await load(malformed);
    assert.match(await page.locator('#message').innerText(), /セーブデータが不正/);
    assert.equal(await page.locator('#city-select').inputValue(), 'city-2'); assert.equal(await page.locator('#map-zoom').innerText(), '200%');
    assert.deepEqual(await save(), purchased, 'malformed collection snapshot cannot replace the game');
  }
  checks.push('malformed collection snapshots reject atomically and retain city and zoom');
  for (const omitted of ['snapshot', 'tiles', 'buildings', 'center', 'total']) {
    const historical = structuredClone(purchased);
    if (omitted === 'snapshot') delete historical.cities['city-2'].lastYieldBreakdown;
    else delete historical.cities['city-2'].lastYieldBreakdown[omitted];
    await load(historical); assert.match(await page.locator('#message').innerText(), /セーブをロードしました/);
    await page.selectOption('#city-select', 'city-2');
    const detail = await page.locator('#city-yield-details').innerText();
    assert.match(detail, /産出内訳の記録がありません。次の収集後に表示します。/); assert.match(detail, /収集合計/);
    assert.doesNotMatch(detail, /作業タイルなし|産出補正/); assert.equal(await page.locator('[data-worked-tile]').count(), 0);
    assert.deepEqual(await save(), historical, 'missing snapshot display cannot fill data or change RNG');
    await page.click('#end-turn'); const recovered = await save(); distinctWork(recovered);
    assert.ok(Array.isArray(recovered.cities['city-2'].lastYieldBreakdown.tiles));
    assert.doesNotMatch(await page.locator('#city-yield-details').innerText(), /産出内訳の記録がありません/);
    assert.equal(await page.locator('[data-worked-tile]').count(), recovered.cities['city-2'].workedTiles.length);
  }
  checks.push('historical missing collection details display summary only and return after collection');

  state = await fresh(); state.cities['city-1'].localCultureProgress = 9; state.cities['city-2'].localCultureProgress = 0;
  await load(state); await page.click('#end-turn'); const expanded = await save(); distinctWork(expanded);
  const expansions = expanded.eventLog.slice(state.eventLog.length).filter(event => event.type === 'TerritoryExpanded');
  assert.ok(expansions.some(event => event.cityId === 'city-1' && event.source === 'culture'));
  assert.ok(expansions.every(event => event.cityId === 'city-1'));
  for (const event of expansions) assert.equal(expanded.world.tiles[event.tileKey].territoryCityId, event.cityId);
  for (const id of ['city-1', 'city-2']) assert.equal(expanded.cities[id].localCultureProgress, state.cities[id].localCultureProgress + expanded.cities[id].yieldSummary.culture - 10 * expansions.filter(event => event.cityId === id).length);
  const goldIncome = Object.values(expanded.cities).reduce((sum, city) => sum + city.yieldSummary.gold, 0);
  assert.equal(expanded.kingdoms['kingdom-1'].stockpiles.gold, state.kingdoms['kingdom-1'].stockpiles.gold + goldIncome);
  checks.push('culture expands only its earning city; each city contributes once to shared income');

  const legacy = await fresh(); delete legacy.cityTerritoryVersion; for (const tile of Object.values(legacy.world.tiles)) delete tile.territoryCityId;
  await load(legacy); const migrated = await save(); distinctWork(migrated); assert.equal(migrated.cityTerritoryVersion, 1);
  assert.deepEqual(migrated.kingdoms['kingdom-1'].stockpiles, legacy.kingdoms['kingdom-1'].stockpiles); assert.deepEqual(migrated.rng, legacy.rng); assert.equal(Object.keys(migrated.world.tiles).length, 331);
  const old = createInitialGameState(117, { radius: 3 }); delete old.cityTerritoryVersion; for (const tile of Object.values(old.world.tiles)) delete tile.territoryCityId;
  await load(old); const oldLoaded = await save(); assert.equal(Object.keys(oldLoaded.world.tiles).length, 37); assert.deepEqual(oldLoaded.units, {});
  checks.push('legacy city assignment and 37-cell migration preserve stockpiles, RNG and map size');

  await page.selectOption('#game-mode', 'ranged-duel'); await page.click('#reset'); await page.click('#end-turn');
  assert.equal(await page.locator('#city-select').inputValue(), 'city-2'); assert.equal(await page.locator('#city-select option').count(), 1); assert.equal(await page.locator('#city-name').innerText(), '黄昏都');
  await page.click('[data-buy="archer"]'); const duel = await save();
  assert.equal(duel.units['unit-11'].ownerId, 'kingdom-2'); assert.equal(duel.units['unit-11'].location, '4,-4,0'); checks.push('hotseat switches to the active kingdom city and purchases for that kingdom');

  await fresh(); await page.selectOption('#city-select', 'city-2');
  if (!(await page.locator('#city-work-panel').evaluate(element => element.open))) await page.locator('#city-work-panel summary').click();
  await page.locator('#city-panel').screenshot({ path: path.join(output, 'city-desktop.png') });
  await page.locator('.map-panel').screenshot({ path: path.join(output, 'map-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.locator('#city-panel').screenshot({ path: path.join(output, 'city-mobile.png') });
  await page.locator('.map-panel').screenshot({ path: path.join(output, 'map-mobile.png') });
  checks.push('1440px and 390px city controls, work details and map overlays');
  assert.deepEqual(errors, []); assert.deepEqual(failures, []);
  const report = { date: new Date().toISOString(), browser: await browser.version(), realBrowser: true, errors, failures, result: 'passed', checks };
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report)); await context.close();
} finally { await browser?.close(); server.close(); }
