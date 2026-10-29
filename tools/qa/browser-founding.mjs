// Optional real Chromium QA for Settler production, movement, founding and restoration.
// Set KINGDOM_QA_MODULES and KINGDOM_BROWSER, then run:
// node tools/qa/browser-founding.mjs /tmp/kingdom-founding-qa
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { once } from 'node:events';

const root = fileURLToPath(new URL('../../', import.meta.url));
const output = path.resolve(process.argv[2] ?? '/tmp/kingdom-founding-qa');
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
try {
  browser = await chromium.launch({ headless: true, ...(process.env.KINGDOM_BROWSER ? { executablePath: process.env.KINGDOM_BROWSER } : {}) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } }), page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() >= 400 && !response.url().endsWith('favicon.ico')) failures.push(response.url()); });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => document.querySelector('#resources img'));
  const save = async () => { await page.click('#save'); return page.evaluate(() => JSON.parse(localStorage.getItem('kingdom-m1-save'))); };
  const load = async value => { await page.evaluate(s => localStorage.setItem('kingdom-m1-save', JSON.stringify(s)), value); await page.click('#load'); };
  const fresh = async () => { await page.selectOption('#game-mode', 'settlement'); await page.click('#reset'); return save(); };
  const tileClick = async tile => {
    await page.locator('#map').scrollIntoViewIfNeeded();
    const point = await page.locator('#map').evaluate((canvas, tile) => {
      const rect = canvas.getBoundingClientRect(), { size, center } = canvas._layout;
      return { x: rect.left + center.x + size * Math.sqrt(3) * (tile.q + tile.r / 2), y: rect.top + center.y + size * 1.5 * tile.r };
    }, tile);
    await page.mouse.click(point.x, point.y);
  };
  let state = await fresh();
  assert.equal(state.scenarioId, 'settlement'); assert.equal(await page.locator('#founding-panel').isVisible(), true);
  assert.equal(await page.locator('#found-city').isDisabled(), true); assert.match(await page.locator('#founding-status').innerText(), /未所有/);
  assert.equal(await page.locator('#founding-settler').inputValue(), 'unit-2');
  const move = async key => { await tileClick(state.world.tiles[key]); await page.click('#map-move'); state = await save(); assert.equal(state.parties['party-1'].location, key); };
  await move('2,0,-2'); await page.click('#end-turn'); state = await save();
  assert.equal(await page.locator('#found-city').isDisabled(), true); assert.match(await page.locator('#founding-status').innerText(), /4ヘクス/);
  await move('4,0,-4'); assert.equal(await page.locator('#found-city').isDisabled(), true); assert.match(await page.locator('#founding-status').innerText(), /移動力/);
  await page.click('#end-turn'); state = await save(); assert.equal(await page.locator('#found-city').isDisabled(), false);
  await page.selectOption('#founding-settler', 'unit-2'); assert.deepEqual(await save(), state);
  checks.push('scenario, read-only settler selection, movement, city spacing and exhausted-action feedback');
  await page.locator('#founding-panel').scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(output, 'before-founding.png') });
  const before = state;
  await page.click('#found-city'); state = await save();
  assert.equal(await page.locator('#city-select').inputValue(), 'city-2');
  assert.equal(await page.locator('#city-name').innerText(), '開拓都市2'); assert.equal(await page.locator('#population').innerText(), '人口 1');
  assert.deepEqual(state.kingdoms['kingdom-1'].stockpiles, before.kingdoms['kingdom-1'].stockpiles);
  assert.deepEqual(state.rng, before.rng); assert.equal(state.units['unit-2'], undefined);
  assert.deepEqual(state.parties['party-1'].unitIds, ['unit-1']); assert.equal(state.parties['party-1'].activationState, 'ended');
  assert.equal(await page.locator('#founding-panel').isVisible(), false); assert.equal(await page.locator('#city-select option').count(), 2);
  assert.ok(Object.values(state.cities['city-2'].yieldSummary).every(value => value === 0));
  assert.equal(await page.locator('[data-select-unit="unit-2"]').count(), 0);
  checks.push('founding consumes one settler, keeps escort, grants no immediate resources and selects the new city');
  await page.click('[data-produce="settler"]'); state = await save();
  assert.equal(state.cities['city-2'].production.currentItemId, 'settler'); assert.equal(state.cities['city-1'].production.currentItemId, null);
  const preIncome = state;
  await page.click('#end-turn'); state = await save();
  assert.equal(state.kingdoms['kingdom-1'].stockpiles.gold - preIncome.kingdoms['kingdom-1'].stockpiles.gold, Object.values(state.cities).reduce((sum, city) => sum + city.yieldSummary.gold, 0));
  assert.ok(state.cities['city-2'].production.progressByItem.settler > 0);
  for (let i = 0; i < 15 && !Object.values(state.units).some(unit => unit.typeId === 'settler'); i++) { await page.click('#end-turn'); state = await save(); }
  const produced = Object.values(state.units).find(unit => unit.typeId === 'settler');
  assert.ok(produced); assert.equal(produced.location, '4,0,-4');
  checks.push('new city collects once per turn and produces a new settler at its own center');
  await page.click('#load'); assert.deepEqual(await save(), state); assert.equal(await page.locator('#game-mode').inputValue(), 'settlement');
  await page.selectOption('#city-select', 'city-2');
  for (let i = 0; i < 12 && state.kingdoms['kingdom-1'].stockpiles.gold < 120; i++) { await page.click('#end-turn'); state = await save(); }
  const beforePurchase = state;
  await page.click('[data-buy="settler"]'); state = await save();
  assert.equal(state.kingdoms['kingdom-1'].stockpiles.gold, beforePurchase.kingdoms['kingdom-1'].stockpiles.gold - 120);
  assert.equal(state.units[`unit-${beforePurchase.nextIds.unit}`].location, '4,0,-4');
  checks.push('save/load preserves scenario and city IDs; purchase uses the selected city and full cost');
  const corrupt = structuredClone(state); corrupt.nextIds.city = 1;
  await load(corrupt); assert.match(await page.locator('#message').innerText(), /nextIds.city/);
  assert.equal(await page.locator('#city-select').inputValue(), 'city-2'); assert.deepEqual(await save(), state);
  checks.push('colliding city ID rejects load without replacing the current game or city selection');

  // A saved solo expedition exercises removal of the selected Unit AND Party.
  let solo = await fresh();
  delete solo.units['unit-1']; solo.kingdoms['kingdom-1'].unitIds = ['unit-2'];
  Object.assign(solo.parties['party-1'], { unitIds: ['unit-2'], leaderUnitId: 'unit-2', formation: { 'front-center': 'unit-2' }, location: '4,0,-4' });
  solo.units['unit-2'].location = '4,0,-4';
  await load(solo); await page.click('[data-select-party="party-1"]'); await page.click('#found-city'); state = await save();
  assert.deepEqual(state.parties, {}); assert.deepEqual(state.units, {}); assert.equal(await page.locator('#city-select').inputValue(), 'city-2');
  assert.equal(await page.locator('#founding-panel').isVisible(), false); assert.match(await page.locator('#party-status').innerText(), /選択してください/);
  await page.click('#load'); assert.deepEqual(await save(), state); await page.click('#end-turn');
  assert.equal((await save()).cities['city-2'].population, 1); checks.push('solo settlement removes stale UI selections and remains playable after reload');
  await page.selectOption('#city-select', 'city-2');
  await page.locator('#city-panel').scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(output, 'founded-city-wide.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#city-panel').scrollIntoViewIfNeeded();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'mobile has no horizontal overflow');
  await page.screenshot({ path: path.join(output, 'founded-city-mobile.png') });
  checks.push('1440px and 390px city views render without horizontal overflow');
  assert.deepEqual(errors, []); assert.deepEqual(failures, []);
  const report = { verifiedAt: new Date().toISOString(), browser: await browser.version(), checks, pageErrors: errors, httpFailures: failures };
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally { if (browser) await browser.close(); server.close(); }
