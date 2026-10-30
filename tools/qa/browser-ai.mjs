// Optional real Chromium QA for AI turns, cancellation, scenario results and restoration.
// Set KINGDOM_QA_MODULES and KINGDOM_BROWSER, then run:
// node tools/qa/browser-ai.mjs /tmp/kingdom-ai-qa
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { once } from 'node:events';

const root = fileURLToPath(new URL('../../', import.meta.url));
const output = path.resolve(process.argv[2] ?? '/tmp/kingdom-ai-qa');
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
  // Freeze scheduled turns so lock/cancel/resume assertions have no timing races.
  await page.clock.install(); await page.clock.pauseAt(new Date());
  const click = selector => page.locator(selector).evaluate(button => button.click());
  const snapshot = async () => { await click('#save'); return page.evaluate(() => JSON.parse(localStorage.getItem('kingdom-m1-save'))); };
  const restore = async value => { await page.evaluate(s => localStorage.setItem('kingdom-m1-save', JSON.stringify(s)), value); await click('#load'); };
  const fresh = async () => { await page.selectOption('#game-mode', 'ai-skirmish'); await click('#reset'); return snapshot(); };
  const relocate = (state, id, location) => { const p = state.parties[id]; p.location = location; p.unitIds.forEach(id => { state.units[id].location = location; }); state.world.tiles[location].terrainId = 'plains'; };
  const weaken = (state, id) => { const p = state.parties[id]; p.guardOrders = {}; p.unitIds.forEach((id, i) => Object.assign(state.units[id], { hp: i ? 0 : 1, currentHp: i ? 0 : 1, status: i ? 'shattered' : 'active' })); };
  const assertLocked = async () => {
    assert.equal(await page.locator('#end-turn').isDisabled(), true);
    assert.equal(await page.locator('[data-buy="warrior"]').isDisabled(), true);
    assert.equal(await page.locator('[data-produce="warrior"]').isDisabled(), true);
    assert.equal(await page.locator('#map-move').isDisabled(), true);
    if (await page.locator('#set-guard').count()) assert.equal(await page.locator('#set-guard').isDisabled(), true);
    if (await page.locator('#attack-party').count()) assert.equal(await page.locator('#attack-party').isDisabled(), true);
  };
  let state = await fresh();
  assert.equal(state.scenarioId, 'ai-skirmish'); assert.equal(await page.locator('#scenario-title').innerText(), 'AIとの遭遇戦');
  assert.equal(await page.locator('#city-name').innerText(), '暁都');
  await click('#end-turn'); const midAi = await snapshot();
  assert.equal(midAi.activePlayerId, 'kingdom-2'); assert.equal(await page.locator('#scenario-title').innerText(), 'AIが行動中');
  assert.equal(await page.locator('#city-name').innerText(), '暁都'); await assertLocked();
  // Inspect the enemy without changing viewpoint or enabling commands.
  await page.selectOption('#combat-target', 'party-2'); await assertLocked();
  await page.clock.runFor(1000); state = await snapshot();
  assert.equal(state.activePlayerId, 'kingdom-1'); assert.equal(state.currentTurn, 2);
  assert.deepEqual(state.commandLog.slice(-3).map(c => c.type), ['MoveParty', 'AttackParty', 'EndTurn']);
  assert.equal(await page.locator('#end-turn').isEnabled(), true);
  assert.match(await page.locator('#combat-log').innerText(), /HP/);
  checks.push('human turn -> AI move/attack/end -> human; own-city viewpoint and mutation controls stay correct');
  await restore(midAi); assert.equal(await page.locator('#game-mode').inputValue(), 'ai-skirmish'); await assertLocked();
  await page.clock.runFor(1000); assert.deepEqual(await snapshot(), state);
  checks.push('mid-AI save resumes identically, including command IDs and RNG');
  await restore(midAi); await page.selectOption('#game-mode', 'single'); await click('#reset');
  const resetState = await snapshot(); await page.clock.runFor(1000); assert.deepEqual(await snapshot(), resetState);
  assert.equal(await page.locator('#scenario-status').isVisible(), false);
  await restore(midAi); await restore(resetState); await page.clock.runFor(1000); assert.deepEqual(await snapshot(), resetState);
  checks.push('reset and load cancel old scheduled AI commands');

  // Victory is produced by a real attack from a valid pre-combat save.
  state = await fresh(); relocate(state, 'party-2', '2,-2,0'); weaken(state, 'party-2');
  await restore(state); await click('[data-select-party="party-1"]'); await page.selectOption('#combat-target', 'party-2');
  await page.selectOption('#attack-type', 'ranged'); await click('#attack-party');
  const victory = await snapshot(); assert.equal(victory.gameResult.winnerId, 'kingdom-1'); assert.equal(await page.locator('#scenario-title').innerText(), '勝利');
  await assertLocked(); await page.clock.runFor(1000); assert.deepEqual(await snapshot(), victory);
  await restore(victory); assert.equal(await page.locator('#scenario-title').innerText(), '勝利'); await assertLocked();
  const corrupt = structuredClone(victory); corrupt.gameResult.winnerId = 'kingdom-2'; await restore(corrupt);
  assert.match(await page.locator('#message').innerText(), /scenario/); assert.deepEqual(await snapshot(), victory);
  await page.locator('#scenario-status').scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(output, 'victory.png') });
  checks.push('victory from actual attack; finished-state lock/save/load and forged winner rejection');

  state = await fresh(); relocate(state, 'party-2', '2,-2,0'); weaken(state, 'party-1');
  await restore(state); await click('#end-turn'); await page.clock.runFor(1000);
  const defeat = await snapshot(); assert.equal(defeat.gameResult.winnerId, 'kingdom-2');
  assert.equal(await page.locator('#scenario-title').innerText(), '敗北'); await assertLocked();
  assert.equal(defeat.commandLog.at(-1).type, 'AttackParty'); assert.equal(defeat.currentTurn, 1);
  await restore(defeat); assert.equal(await page.locator('#scenario-title').innerText(), '敗北');
  checks.push('AI victory shows human defeat and stops before EndTurn');

  state = await fresh(); state.scenarioObjective.turnLimit = 1;
  await restore(state); await click('#end-turn'); await page.clock.runFor(1000); state = await snapshot();
  assert.equal(state.gameResult.outcome, 'draw'); assert.equal(state.gameResult.reason, 'turn-limit');
  assert.equal(state.currentTurn, 1); assert.equal(await page.locator('#scenario-title').innerText(), '引き分け'); await assertLocked();
  await restore(state); assert.equal(await page.locator('#scenario-title').innerText(), '引き分け');
  checks.push('round deadline produces and restores a draw without extra income');
  await page.setViewportSize({ width: 390, height: 844 }); await page.clock.runFor(100);
  await page.locator('#scenario-status').scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(output, 'mobile-result.png') });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  checks.push('390px result screen has no horizontal overflow');

  await page.selectOption('#game-mode', 'duel'); await click('#reset'); await click('#end-turn'); state = await snapshot();
  assert.equal(state.activePlayerId, 'kingdom-2'); assert.equal(await page.locator('#city-name').innerText(), '黄昏都');
  assert.equal(await page.locator('#end-turn').isEnabled(), true); await page.clock.runFor(1000); assert.deepEqual(await snapshot(), state);
  checks.push('legacy hotseat still switches human viewpoint without auto-playing');
  await page.setViewportSize({ width: 1440, height: 1050 });
  const freshReinforcements = async () => { await page.selectOption('#game-mode', 'ai-reinforcements'); await click('#reset'); return snapshot(); };
  state = await freshReinforcements();
  assert.equal(state.kingdoms['kingdom-2'].aiPolicy, 'reinforcements');
  assert.equal(await page.locator('#scenario-title').innerText(), 'AIとの増援戦');
  await click('#end-turn'); await assertLocked(); await page.clock.runFor(2000); state = await snapshot();
  assert.equal(state.cities['city-2'].production.currentItemId, 'warrior');
  assert.equal(state.cities['city-1'].production.currentItemId, null);
  assert.match(await page.locator('#ai-activity').innerText(), /生産設定 1回/);
  checks.push('reinforcement mode selects enemy-city production and explains AI actions without changing the human city');
  await click('#end-turn'); await page.clock.runFor(2000); state = await snapshot();
  const purchase = state.commandLog.find(c => c.playerId === 'kingdom-2' && c.type === 'PurchaseCityItem');
  const creation = state.commandLog.find(c => c.playerId === 'kingdom-2' && c.type === 'CreateParty');
  assert.ok(purchase); assert.ok(creation); assert.equal(purchase.payload.cityId, 'city-2');
  const newParty = state.units[creation.payload.unitIds[0]].partyId;
  assert.ok(state.commandLog.some(c => c.type === 'MoveParty' && c.payload.partyId === newParty));
  assert.ok(state.commandLog.some(c => c.type === 'AttackParty' && c.payload.attackerPartyId === newParty));
  assert.ok(state.kingdoms['kingdom-2'].stockpiles.gold >= 24);
  assert.equal(await page.locator('#city-name').innerText(), '暁都');
  assert.match(await page.locator('#ai-activity').innerText(), /購入 1回.*増援編成 1回/);
  assert.equal(await page.locator(`#combat-target option[value="${newParty}"]`).count(), 1);
  checks.push('AI clears its city, buys within budget, forms reinforcements and moves/attacks with them');
  const checkpoint = state;
  await click('#end-turn'); await page.clock.runFor(180); const inProgress = await snapshot();
  await page.clock.runFor(2000); const resumed = await snapshot();
  await restore(inProgress); assert.equal(await page.locator('#game-mode').inputValue(), 'ai-reinforcements');
  await page.clock.runFor(2000); assert.deepEqual(await snapshot(), resumed);
  const corruptPolicy = structuredClone(checkpoint); delete corruptPolicy.kingdoms['kingdom-2'].aiPolicy;
  await restore(corruptPolicy); assert.match(await page.locator('#message').innerText(), /aiPolicy/); assert.deepEqual(await snapshot(), resumed);
  checks.push('reinforcement policy and mid-turn progress restore identically; missing policy rejects without replacing state');
  let productionDeployed = false;
  for (let i = 0; i < 8; i++) {
    state = await snapshot();
    productionDeployed = state.eventLog.some(e => e.type === 'ItemCompleted' && e.cityId === 'city-2' && e.source === 'production' && state.units[e.entityId].partyId);
    if (productionDeployed || state.gameResult) break;
    await click('#end-turn'); await page.clock.runFor(3000);
  }
  assert.equal(productionDeployed, true);
  checks.push('turn-start production supplies troops that the AI deploys on a later turn');
  await page.locator('#scenario-status').scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(output, 'reinforcements-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 }); await page.clock.runFor(100);
  await page.locator('#scenario-status').scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(output, 'reinforcements-mobile.png') });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.equal(await page.locator('#ai-activity').isVisible(), true);
  checks.push('390px reinforcement status and activity summary render without overflow');

  assert.deepEqual(errors, []); assert.deepEqual(failures, []);
  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ date: new Date().toISOString(), browser: browser.version(), realBrowser: true, result: 'passed', checks, errors, failures }, null, 2));
  console.log(JSON.stringify({ checks: checks.length, errors, failures, output }, null, 2));
} finally { await browser?.close(); server.close(); }
