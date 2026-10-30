// Optional real Chromium QA for city capture, ownership, AI, conquest outcomes and cityless restoration.
// Set KINGDOM_QA_MODULES and KINGDOM_BROWSER, then run:
// node tools/qa/browser-conquest.mjs /tmp/kingdom-conquest-qa
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { once } from 'node:events';

const root = fileURLToPath(new URL('../../', import.meta.url));
const output = path.resolve(process.argv[2] ?? '/tmp/kingdom-conquest-qa');
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
  // This regression suite exercises historical conquest; browser-siege covers new games.
  const fresh = async () => { await page.selectOption('#game-mode', 'ai-conquest'); await page.click('#reset'); const value = await save(); delete value.cityDefenseVersion; Object.values(value.cities).forEach(city => { delete city.defense; }); await load(value); return save(); };
  const tileClick = async tile => {
    await page.locator('#map').scrollIntoViewIfNeeded();
    const point = await page.locator('#map').evaluate((canvas, tile) => {
      const rect = canvas.getBoundingClientRect(), { size, center } = canvas._layout;
      return { x: rect.left + center.x + size * Math.sqrt(3) * (tile.q + tile.r / 2), y: rect.top + center.y + size * 1.5 * tile.r };
    }, tile);
    await page.mouse.click(point.x, point.y);
  };
  const relocate = (state, id, location) => { const p = state.parties[id]; p.location = location; p.unitIds.forEach(id => { state.units[id].location = location; }); state.world.tiles[location].terrainId = 'plains'; };
  let state = await fresh(), initial = structuredClone(state);
  assert.equal(state.scenarioObjective.type, 'control-cities'); assert.match(await page.locator('#scenario-detail').innerText(), /全都市.*都市があれば継続/);
  assert.equal(await page.locator('#capture-panel').isVisible(), true); assert.equal(await page.locator('#capture-city').isDisabled(), true);
  checks.push('explicit conquest mode explains city survival and shows occupation controls');

  // Keep a second enemy city so the ownership transfer can be played past capture.
  state = await page.evaluate(async value => {
    const { addCity } = await import('./src/core/game-state.js');
    value.world.tiles['-4,4,0'].terrainId = 'plains'; addCity(value, { ownerId: 'kingdom-2', id: 'city-3', name: '余都', centerHex: '-4,4,0' });
    value.cities['city-2'].production = { currentItemId: 'archer', queue: ['warrior'], progressByItem: { archer: 10 } };
    value.cities['city-2'].buildings = ['monument']; return value;
  }, state);
  relocate(state, 'party-1', '3,-3,0'); relocate(state, 'party-2', '-6,6,0');
  await load(state); await page.click('[data-select-party="party-1"]'); await tileClick(state.world.tiles['4,-4,0']);
  assert.equal(await page.locator('#capture-city').isDisabled(), true); assert.match(await page.locator('#capture-status').innerText(), /中心へ/);
  assert.deepEqual(await save(), state); await page.click('#map-move'); const moved = await save();
  assert.equal(moved.parties['party-1'].location, '4,-4,0'); assert.equal(await page.locator('#capture-city').isEnabled(), true);
  await page.locator('#capture-panel').scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(output, 'before-capture-wide.png') });
  await page.click('#capture-city'); const captured = await save();
  assert.equal(captured.gameResult, null); assert.equal(captured.cities['city-2'].ownerId, 'kingdom-1');
  assert.equal(await page.locator('#city-select').inputValue(), 'city-2'); assert.equal(await page.locator('#city-name').innerText(), '黄昏都');
  assert.deepEqual(captured.cities['city-2'].production, { currentItemId: null, queue: [], progressByItem: {} });
  assert.deepEqual(captured.cities['city-2'].buildings, ['monument']); assert.deepEqual(captured.rng, moved.rng);
  assert.deepEqual(captured.kingdoms['kingdom-1'].stockpiles, moved.kingdoms['kingdom-1'].stockpiles);
  assert.equal(captured.parties['party-1'].activationState, 'ended'); assert.ok(Object.values(captured.cities['city-2'].yieldSummary).every(value => value === 0));
  checks.push('actual map movement then CaptureCity transfers ownership, selects the city, cancels production and grants no income');
  await page.click('[data-produce="warrior"]'); const producing = await save(); assert.equal(producing.cities['city-2'].production.currentItemId, 'warrior');
  await page.click('#load'); assert.deepEqual(await save(), producing); assert.equal(await page.locator('#game-mode').inputValue(), 'ai-conquest');
  await page.selectOption('#city-select', 'city-2');
  const corrupt = structuredClone(producing); corrupt.world.tiles['4,-4,0'].ownerId = 'kingdom-2';
  await load(corrupt); assert.match(await page.locator('#message').innerText(), /セーブデータが不正/); assert.deepEqual(await save(), producing);
  assert.equal(await page.locator('#city-select').inputValue(), 'city-2');
  checks.push('captured-city production and save/load work; partial territory transfer rejects atomically');

  await page.clock.install(); await page.clock.pauseAt(new Date());
  const click = selector => page.locator(selector).evaluate(element => element.click());
  const snap = async () => { await click('#save'); return page.evaluate(() => JSON.parse(localStorage.getItem('kingdom-m1-save'))); };
  const restore = async value => { await page.evaluate(s => localStorage.setItem('kingdom-m1-save', JSON.stringify(s)), value); await click('#load'); };
  await click('#end-turn'); assert.equal(await page.locator('#capture-city').isDisabled(), true); await page.clock.runFor(6000); state = await snap();
  assert.equal(state.currentTurn, 2); assert.equal(state.activePlayerId, 'kingdom-1'); assert.ok(state.cities['city-2'].production.progressByItem.warrior > 0);
  assert.equal(state.kingdoms['kingdom-1'].stockpiles.gold - producing.kingdoms['kingdom-1'].stockpiles.gold, state.cities['city-1'].yieldSummary.gold + state.cities['city-2'].yieldSummary.gold);
  assert.equal(state.eventLog.filter(e => e.type === 'YieldCollected' && e.cityId === 'city-2' && e.turn === 2).length, 1);
  checks.push('captured city collects once for its new owner and starts new production at the next full round');

  const guarded = structuredClone(initial); relocate(guarded, 'party-1', '3,-3,0'); relocate(guarded, 'party-2', '4,-4,0');
  await restore(guarded); await click('[data-select-party="party-1"]');
  // Select the garrison through the combat panel; the center cannot be entered.
  await page.selectOption('#combat-target', 'party-2'); assert.equal(await page.locator('#map-move').isDisabled(), true); assert.equal(await page.locator('#capture-city').isDisabled(), true);
  const weak = structuredClone(guarded); weak.parties['party-2'].guardOrders = {};
  weak.parties['party-2'].unitIds.forEach((id, i) => Object.assign(weak.units[id], { hp: i ? 0 : 1, currentHp: i ? 0 : 1, status: i ? 'shattered' : 'active' }));
  await restore(weak); await click('[data-select-party="party-1"]'); await page.selectOption('#combat-target', 'party-2'); await page.selectOption('#attack-type', 'ranged'); await click('#attack-party');
  state = await snap(); assert.equal(state.parties['party-2'].status, 'defeated'); assert.equal(state.gameResult, null); assert.equal(await page.locator('#end-turn').isEnabled(), true);
  checks.push('garrison blocks entry; defeating the last army does not end a city-survival scenario');

  const winning = structuredClone(initial); relocate(winning, 'party-1', '4,-4,0'); await restore(winning); await click('[data-select-party="party-1"]'); await click('#capture-city');
  const victory = await snap(); assert.equal(victory.gameResult.reason, 'cities-controlled'); assert.equal(await page.locator('#scenario-title').innerText(), '勝利'); assert.equal(victory.parties['party-2'].status, 'active');
  assert.equal(await page.locator('#capture-city').isDisabled(), true); assert.equal(await page.locator('#end-turn').isDisabled(), true);
  await restore(victory); assert.deepEqual(await snap(), victory); await page.clock.runFor(1000); assert.deepEqual(await snap(), victory);
  checks.push('last-city capture wins with surviving enemy armies and locks actions across reload');

  const losing = structuredClone(initial); relocate(losing, 'party-2', '0,0,0'); await restore(losing); await click('#end-turn'); await page.clock.runFor(180);
  const defeat = await snap(); assert.equal(defeat.gameResult.winnerId, 'kingdom-2'); assert.equal(await page.locator('#scenario-title').innerText(), '敗北');
  assert.equal(await page.locator('#city-name').innerText(), '所有都市なし'); assert.equal(await page.locator('#city-select option').count(), 0);
  assert.equal(await page.locator('#focus-city').isDisabled(), true); assert.equal(await page.locator('[data-buy="warrior"]').isDisabled(), true);
  assert.match(await page.locator('#ai-activity').innerText(), /都市占領 1回/); await click('[data-select-party="party-1"]');
  assert.match(await page.locator('#cell-content').innerText(), /所有都市がない/);
  await restore(defeat); assert.deepEqual(await snap(), defeat); await page.clock.runFor(1000); assert.deepEqual(await snap(), defeat);
  const forged = structuredClone(defeat); forged.gameResult.winnerId = 'kingdom-1'; await restore(forged); assert.match(await page.locator('#message').innerText(), /scenario/); assert.deepEqual(await snap(), defeat);
  checks.push('AI capture produces human cityless defeat; city/map panels, read-only inspection, save/load and forged-result rejection remain usable');
  await page.setViewportSize({ width: 390, height: 844 }); await page.locator('#city-panel').scrollIntoViewIfNeeded();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)); await page.screenshot({ path: path.join(output, 'cityless-mobile.png') });
  await restore(winning); await click('[data-select-party="party-1"]'); await page.locator('#capture-panel').scrollIntoViewIfNeeded();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)); await page.screenshot({ path: path.join(output, 'capture-mobile.png') });
  checks.push('390px capture and cityless panels render without horizontal overflow');

  const approaching = structuredClone(initial); relocate(approaching, 'party-1', '-6,6,0'); relocate(approaching, 'party-2', '2,-2,0'); approaching.world.tiles['0,0,0'].terrainId = 'plains';
  await restore(approaching); await click('#end-turn'); await page.clock.runFor(180); const mid = await snap(); assert.equal(mid.commandLog.at(-1).type, 'MoveParty');
  await page.clock.runFor(180); const continued = await snap(); assert.equal(continued.commandLog.at(-1).type, 'CaptureCity');
  await restore(mid); await page.clock.runFor(180); assert.deepEqual(await snap(), continued);
  checks.push('AI path to an unguarded city and mid-move save resume produce identical capture and victory');
  await page.selectOption('#game-mode', 'ai-reinforcements'); await click('#reset'); assert.equal(await page.locator('#capture-panel').isVisible(), false);
  assert.equal((await snap()).scenarioObjective.type, 'eliminate-parties');
  checks.push('existing reinforcement mode retains army-elimination victory and hides capture controls');
  assert.deepEqual(errors, []); assert.deepEqual(failures, []);
  const report = { verifiedAt: new Date().toISOString(), browser: await browser.version(), checks, pageErrors: errors, httpFailures: failures };
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2));
} finally { if (browser) await browser.close(); server.close(); }
