// Optional real Chromium QA for party reinforcement, splitting, merging, restoration and AI.
// Set KINGDOM_QA_MODULES and KINGDOM_BROWSER, then run:
// node tools/qa/browser-reorganization.mjs /tmp/kingdom-reorganization-qa
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { once } from 'node:events';

const root = fileURLToPath(new URL('../../', import.meta.url));
const output = path.resolve(process.argv[2] ?? '/tmp/kingdom-reorganization-qa');
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
  const fresh = async () => { await page.selectOption('#game-mode', 'single'); await page.click('#reset'); return save(); };
  let state = await fresh();
  assert.equal(await page.locator('#party-reorganization').isVisible(), true);
  assert.equal(await page.locator('#reinforce-party').isDisabled(), true);
  await page.click('[data-buy="warrior"]'); state = await save();
  const waiting = Object.values(state.units).find(unit => unit.partyId === null);
  await page.check(`[data-reinforce-unit="${waiting.id}"]`); assert.deepEqual(await save(), state);
  assert.equal(await page.locator('#reinforce-party').isEnabled(), true);
  await page.click('#reinforce-party'); const reinforced = await save();
  assert.equal(reinforced.parties['party-1'].unitIds.length, 2); assert.equal(reinforced.units[waiting.id].partyId, 'party-1');
  assert.equal(reinforced.parties['party-1'].reactionCharges, 0); assert.equal(reinforced.parties['party-1'].attacksRemaining, 0);
  assert.equal(await page.locator('#reinforce-party').isDisabled(), true); assert.match(await page.locator('#party-detail').innerText(), /移動力 0\/2/);
  checks.push('purchase -> choose waiting unit without mutation -> reinforce existing party; action and reaction are spent');
  await page.check(`[data-split-unit="${waiting.id}"]`);
  const destination = Object.values(state.world.tiles).filter(tile => Math.max(Math.abs(tile.q), Math.abs(tile.r), Math.abs(tile.s)) === 1 && tile.terrainId !== 'void')[0];
  const key = `${destination.q},${destination.r},${destination.s}`;
  await page.selectOption('#split-destination', key); assert.equal(await page.locator('#split-party').isDisabled(), true);
  await page.click('#end-turn'); state = await save(); assert.equal(await page.locator('#split-party').isEnabled(), true);
  assert.equal(await page.locator('#merge-parties').isDisabled(), true);
  await page.locator('#party-reorganization').scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(output, 'reorganization-wide.png') });
  await page.click('#split-party'); const split = await save(), childId = `party-${state.nextIds.party}`;
  assert.equal(split.parties[childId].location, key); assert.equal(split.units[waiting.id].partyId, childId);
  assert.equal(split.parties['party-1'].activationState, 'ended'); assert.equal(split.parties[childId].activationState, 'ended');
  assert.equal(await page.locator(`[data-select-party="${childId}"]`).getAttribute('aria-pressed'), 'true');
  assert.deepEqual(split.rng, state.rng); assert.equal(split.units[waiting.id].currentHp, state.units[waiting.id].currentHp);
  checks.push('split preview focuses adjacent terrain; ended parties reject, then next turn splits and selects the new party');
  await page.selectOption('#merge-target', 'party-1'); assert.equal(await page.locator('#merge-parties').isDisabled(), true);
  await page.click('#end-turn'); assert.equal(await page.locator('#merge-parties').isEnabled(), true);
  await page.click('#merge-parties'); const merged = await save();
  assert.equal(merged.parties[childId], undefined); assert.equal(merged.parties['party-1'].unitIds.length, 2);
  assert.equal(merged.units[waiting.id].location, '0,0,0'); assert.equal(merged.parties['party-1'].activationState, 'ended');
  assert.equal(await page.locator(`[data-select-party="${childId}"]`).count(), 0);
  assert.equal(await page.locator('[data-select-party="party-1"]').getAttribute('aria-pressed'), 'true');
  checks.push('merge preserves recipient ID, removes donor marker and roster entry, and selects the ended recipient');
  await page.click('#load'); assert.deepEqual(await save(), merged); assert.equal(await page.locator('#party-reorganization').isVisible(), false);
  await page.click('[data-select-party="party-1"]');
  const corrupt = structuredClone(merged); corrupt.units[waiting.id].partyId = childId;
  await load(corrupt); assert.match(await page.locator('#message').innerText(), /partyId/); assert.deepEqual(await save(), merged);
  assert.equal(await page.locator('[data-select-party="party-1"]').getAttribute('aria-pressed'), 'true');
  checks.push('successful load clears draft selections; dangling donor references reject without replacing state or selection');

  await load(split); await page.click('[data-select-party="party-1"]'); await page.click('#end-turn');
  await page.selectOption('#merge-target', childId); await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#party-reorganization').scrollIntoViewIfNeeded();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: path.join(output, 'reorganization-mobile.png') });
  await page.click('#merge-parties'); assert.equal((await save()).parties['party-1'], undefined);
  checks.push('390px controls have no horizontal overflow and can merge in the opposite direction');

  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.selectOption('#game-mode', 'duel'); await page.click('#reset');
  await page.check('[data-split-unit="unit-1"]'); await page.selectOption('#split-destination', '0,0,0');
  assert.equal(await page.locator('#split-party').isEnabled(), true); await page.click('#split-party');
  await page.click('#end-turn'); assert.match(await page.locator('#active-kingdom').innerText(), /夕映/);
  assert.equal(await page.locator('[data-split-unit="unit-1"]').count(), 0);
  checks.push('hotseat handover clears the prior kingdom draft and exposes only the current kingdom members');

  // A valid saved partial AI force exercises the newly connected common commands.
  await page.clock.install(); await page.clock.pauseAt(new Date());
  const click = selector => page.locator(selector).evaluate(element => element.click());
  const snap = async () => { await click('#save'); return page.evaluate(() => JSON.parse(localStorage.getItem('kingdom-m1-save'))); };
  const restore = async value => { await page.evaluate(s => localStorage.setItem('kingdom-m1-save', JSON.stringify(s)), value); await click('#load'); };
  const aiFixture = await page.evaluate(async () => {
    const { createAiReinforcementGameState } = await import('./src/core/scenarios.js');
    const { HumanController } = await import('./src/core/human-controller.js'); const { RuleSystem } = await import('./src/core/rule-system.js');
    const human = new HumanController('kingdom-1'); let state = createAiReinforcementGameState(); state = RuleSystem.execute(state, human.startTurn(state)).state;
    const party = state.parties['party-2']; party.guardOrders = {};
    for (const id of party.unitIds.splice(3)) { state.units[id].partyId = null; state.units[id].location = '4,-4,0'; }
    party.formation = Object.fromEntries(Object.entries(party.formation).filter(([, id]) => party.unitIds.includes(id)));
    party.location = '4,-4,0'; party.unitIds.forEach(id => { state.units[id].location = party.location; });
    return state;
  });
  await restore(aiFixture); await click('[data-select-party="party-1"]');
  await click('#end-turn'); const mid = await snap();
  for (const id of ['reinforce-party', 'split-party', 'merge-parties']) assert.equal(await page.locator(`#${id}`).isDisabled(), true);
  await page.clock.runFor(180); const afterReinforce = await snap();
  assert.equal(afterReinforce.commandLog.at(-1).type, 'ReinforceParty'); assert.equal(afterReinforce.parties['party-2'].unitIds.length, 5);
  assert.match(await page.locator('#ai-activity').innerText(), /補充 1回/);
  await restore(mid); await page.clock.runFor(180); assert.deepEqual(await snap(), afterReinforce);
  checks.push('AI uses ReinforceParty, reports the action and resumes identically; human reorganization is locked during AI turns');

  const mergeFixture = await page.evaluate(async () => {
    const { createAiReinforcementGameState } = await import('./src/core/scenarios.js');
    const { createParty } = await import('./src/models/party.js');
    const { HumanController } = await import('./src/core/human-controller.js'); const { RuleSystem } = await import('./src/core/rule-system.js');
    const human = new HumanController('kingdom-1'); let s = createAiReinforcementGameState(); s = RuleSystem.execute(s, human.startTurn(s)).state;
    const original = s.parties['party-2'], ids = original.unitIds.splice(3), id = `party-${s.nextIds.party++}`;
    original.guardOrders = {}; original.formation = Object.fromEntries(Object.entries(original.formation).filter(([, unit]) => original.unitIds.includes(unit)));
    s.parties[id] = createParty(id, 'kingdom-2', ids, '5,-4,-1');
    for (const [partyId, location] of [['party-1', '-4,4,0'], ['party-2', '4,-3,-1'], [id, '5,-4,-1']]) {
      const p = s.parties[partyId]; p.location = location; s.world.tiles[location].terrainId = 'plains';
      p.unitIds.forEach(unit => { s.units[unit].partyId = p.id; s.units[unit].location = location; });
    }
    return s;
  });
  await restore(mergeFixture); await click('#end-turn'); await page.clock.runFor(180); const afterMerge = await snap();
  assert.equal(afterMerge.commandLog.at(-1).type, 'MergeParties'); assert.equal(afterMerge.parties['party-3'], undefined);
  assert.match(await page.locator('#ai-activity').innerText(), /合流 1回/);
  checks.push('AI consolidates small adjacent parties through MergeParties and reports it in the activity summary');
  assert.deepEqual(errors, []); assert.deepEqual(failures, []);
  const report = { verifiedAt: new Date().toISOString(), browser: await browser.version(), checks, pageErrors: errors, httpFailures: failures };
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2));
} finally { if (browser) await browser.close(); server.close(); }
