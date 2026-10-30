// Optional real Chromium QA for active city fire, protection, AI and saved charges.
// Set KINGDOM_QA_MODULES and KINGDOM_BROWSER, then run:
// node tools/qa/browser-city-bombardment.mjs /tmp/kingdom-city-bombardment-qa
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { once } from 'node:events';

const root = fileURLToPath(new URL('../../', import.meta.url));
const output = path.resolve(process.argv[2] ?? '/tmp/kingdom-city-bombardment-qa');
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
  await page.clock.install(); await page.clock.pauseAt(new Date());
  const click = selector => page.locator(selector).evaluate(element => element.click());
  const save = async () => { await click('#save'); return page.evaluate(() => JSON.parse(localStorage.getItem('kingdom-m1-save'))); };
  const load = async value => { await page.evaluate(s => localStorage.setItem('kingdom-m1-save', JSON.stringify(s)), value); await click('#load'); };
  const select = async (selector, value) => page.locator(selector).evaluate((el, value) => { el.value = value; el.dispatchEvent(new Event('change', { bubbles: true })); }, value);
  const relocate = (value, id, location) => { const p = value.parties[id]; p.location = location; p.unitIds.forEach(id => { value.units[id].location = location; }); value.world.tiles[location].terrainId = 'plains'; };
  const target = () => select('#bombard-target', 'party-2');
  assert.equal(await page.locator('#city-bombardment').isVisible(), false);
  await select('#game-mode', 'ai-conquest'); await click('#reset'); const initial = await save();
  assert.equal(initial.cityDefenseVersion, 3); assert.equal(initial.cities['city-1'].defense.bombardmentsRemaining, 1);
  assert.match(await page.locator('#bombard-status').innerText(), /城壁/); assert.equal(await page.locator('#bombard-party').isDisabled(), true);
  const base = structuredClone(initial); base.kingdoms['kingdom-1'].stockpiles.gold = 120; base.kingdoms['kingdom-2'].controllerType = 'human';
  relocate(base, 'party-2', '2,-2,0'); await load(base); await click('[data-buy="walls"]'); const armed = await save();
  assert.equal(armed.cities['city-1'].defense.wallHp, 60); await target();
  assert.equal(await page.locator('#bombard-party').isEnabled(), true); assert.match(await page.locator('#bombard-preview').innerText(), /肩代わり/);
  assert.deepEqual(await save(), armed);
  checks.push('new v3 starts without walls; real purchase enables range-two fire and preview is read-only');

  await click('#bombard-party'); const fired = await save();
  assert.equal(fired.cities['city-1'].defense.bombardmentsRemaining, 0); assert.equal(fired.cities['city-1'].defense.counterattacksRemaining, 1);
  assert.deepEqual(fired.parties['party-1'], armed.parties['party-1']); assert.equal(await page.locator('#bombard-party').isDisabled(), true);
  assert.match(await page.locator('#combat-log').innerText(), /都市砲撃/); assert.match(await page.locator('#bombard-log').innerText(), /HP/);
  await click('#bombard-party'); assert.deepEqual(await save(), fired); await load(fired); await target(); assert.equal(await page.locator('#bombard-party').isDisabled(), true);
  assert.deepEqual(await save(), fired);
  checks.push('fire spends only its city charge, labels damage correctly and cannot be repeated after loading');

  await click('#end-turn'); let handoff = await save(); assert.equal(handoff.currentTurn, fired.currentTurn); assert.equal(handoff.cities['city-1'].defense.bombardmentsRemaining, 0);
  await click('#end-turn'); let renewed = await save(); assert.equal(renewed.currentTurn, fired.currentTurn + 1); assert.equal(renewed.cities['city-1'].defense.bombardmentsRemaining, 1);
  await target(); assert.equal(await page.locator('#bombard-party').isEnabled(), true);
  checks.push('human handoff does not refresh fire; the full-round boundary refreshes it once');

  for (const [change, reason] of [[s => { s.cities['city-1'].defense.wallHp = 0; }, /城壁/], [s => { s.cities['city-1'].defense.hp = 0; }, /都市耐久/], [s => relocate(s, 'party-2', '3,-3,0'), /射程外/]]) {
    const value = structuredClone(armed); change(value); await load(value); await target(); assert.equal(await page.locator('#bombard-party').isDisabled(), true);
    assert.match(await page.locator('#bombard-status').innerText(), reason); await click('#bombard-party'); assert.deepEqual(await save(), value);
  }
  checks.push('destroyed walls, ruined city and out-of-range targets explain refusal and do not mutate state');

  const intercept = structuredClone(armed), p = intercept.parties['party-2']; p.guardOrders[p.unitIds[1]].mode = 'intercept';
  await load(intercept); await target(); assert.match(await page.locator('#bombard-preview').innerText(), /割り込み/);
  await click('#bombard-party'); const protectedHit = await save(); assert.equal(protectedHit.parties['party-2'].reactionCharges, 0);
  assert.equal(protectedHit.units[p.unitIds[0]].currentHp, 100); assert.ok(protectedHit.units[p.unitIds[1]].currentHp < 100);
  checks.push('intercept forecast matches actual HP, protection log and defender reaction consumption');

  const lethal = structuredClone(armed), victim = lethal.parties['party-2']; victim.guardOrders = {};
  victim.unitIds.forEach(id => Object.assign(lethal.units[id], { hp: id === victim.leaderUnitId ? 1 : 0, currentHp: id === victim.leaderUnitId ? 1 : 0, status: id === victim.leaderUnitId ? 'active' : 'shattered' }));
  await load(lethal); await target(); assert.match(await page.locator('#bombard-preview').innerText(), /敗北する見込み/);
  await click('#bombard-party'); const defeated = await save(); assert.equal(defeated.parties['party-2'].status, 'defeated'); assert.equal(defeated.gameResult, null);
  assert.match(await page.locator('#bombard-log').innerText(), /部隊敗北/); assert.equal(await page.locator('#bombard-party').isDisabled(), true);
  await load(defeated); assert.deepEqual(await save(), defeated);
  checks.push('lethal fire retains defeated records, clears unavailable targets and does not invent city-control victory');

  const invalid = structuredClone(armed); invalid.cities['city-1'].defense.bombardmentsRemaining = 2;
  await load(invalid); assert.match(await page.locator('#message').innerText(), /セーブデータが不正/); assert.deepEqual(await save(), defeated);
  for (const version of [1, 2]) {
    const legacy = structuredClone(armed); legacy.cityDefenseVersion = version;
    for (const city of Object.values(legacy.cities)) { delete city.defense.bombardmentsRemaining; if (version === 1) delete city.defense.counterattacksRemaining; }
    await load(legacy); assert.equal(await page.locator('#bombard-party').isDisabled(), true); assert.match(await page.locator('#bombard-rules').innerText(), /旧保存/); assert.deepEqual(await save(), legacy);
  }
  checks.push('corrupt charges reject without replacement; v1 and v2 saves retain rules and explain unavailable city fire');

  const ai = structuredClone(armed); ai.kingdoms['kingdom-2'].controllerType = 'ai';
  ai.cities['city-2'].buildings.push('walls'); ai.cities['city-2'].defense.wallHp = 60;
  relocate(ai, 'party-1', '3,-3,0'); relocate(ai, 'party-2', '6,-6,0');
  await load(ai); await click('#end-turn'); const aiPending = await save();
  assert.equal(await page.locator('#bombard-party').isDisabled(), true);
  await page.clock.runFor(180); const aiShot = await save(); assert.equal(aiShot.commandLog.at(-1).type, 'BombardParty');
  assert.match(await page.locator('#ai-activity').innerText(), /都市砲撃/);
  await load(aiPending); await page.clock.runFor(180); assert.deepEqual(await save(), aiShot);
  await page.clock.runFor(10000); assert.equal((await save()).activePlayerId, 'kingdom-1');
  checks.push('AI fires through BombardParty, resumes the exact pending shot after reload and completes its bounded turn');

  // Build a legitimate additional-city fixture with the game setup API.
  const multi = await page.evaluate(async value => {
    const { addCity } = await import('/src/core/game-state.js'); value.world.tiles['0,4,-4'].terrainId = 'plains';
    addCity(value, { id: 'city-3', ownerId: 'kingdom-1', name: '第二砲台都', centerHex: '0,4,-4' });
    value.cities['city-3'].buildings.push('walls'); value.cities['city-3'].defense.wallHp = 60;
    const p = value.parties['party-2']; p.location = '0,2,-2'; p.unitIds.forEach(id => { value.units[id].location = p.location; }); value.world.tiles[p.location].terrainId = 'plains'; return value;
  }, armed);
  await load(multi); await target(); await click('#bombard-party'); let oneCity = await save(); assert.equal(oneCity.cities['city-3'].defense.bombardmentsRemaining, 1);
  await select('#city-select', 'city-3'); assert.match(await page.locator('#bombard-city').innerText(), /第二砲台都/); assert.equal(await page.locator('#bombard-party').isEnabled(), true);
  await click('#bombard-party'); let bothCities = await save(); assert.equal(bothCities.cities['city-3'].defense.bombardmentsRemaining, 0); assert.equal(bothCities.cities['city-1'].defense.bombardmentsRemaining, 0);
  checks.push('changing selected cities switches source and keeps each fire charge independent');

  const finalRound = structuredClone(armed); finalRound.currentTurn = finalRound.scenarioObjective.turnLimit; finalRound.lastProcessedTurn = finalRound.currentTurn;
  await load(finalRound); await click('#end-turn'); await click('#end-turn'); const ended = await save(); assert.ok(ended.gameResult);
  assert.equal(await page.locator('#bombard-party').isDisabled(), true); assert.match(await page.locator('#bombard-status').innerText(), /現在は/);
  await click('#bombard-party'); assert.deepEqual(await save(), ended);
  checks.push('finished games disable city fire while preserving log inspection and saving');

  await load(armed); await target(); await page.locator('#city-bombardment').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(output, 'bombardment-wide.png') });
  await page.locator('#city-bombardment').screenshot({ path: path.join(output, 'bombardment-panel.png') });
  await page.setViewportSize({ width: 390, height: 844 }); await page.locator('#city-bombardment').scrollIntoViewIfNeeded();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: path.join(output, 'bombardment-mobile.png') });
  await page.locator('#bombard-party').focus(); await page.keyboard.press('Enter'); assert.equal((await save()).cities['city-1'].defense.bombardmentsRemaining, 0);
  checks.push('desktop and 390px previews fit without horizontal overflow and keyboard fire works');
  assert.deepEqual(errors, []); assert.deepEqual(failures, []);
  const report = { verifiedAt: new Date().toISOString(), browser: await browser.version(), checks, pageErrors: errors, httpFailures: failures };
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2));
} catch (error) {
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), checks, pageErrors: errors, httpFailures: failures, error: String(error.stack ?? error) }, null, 2) + '\n');
  throw error;
} finally { if (browser) await browser.close(); server.close(); }
