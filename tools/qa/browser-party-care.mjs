// Optional real Chromium QA for party rest, recovery, casualty removal and save continuation.
// Set KINGDOM_QA_MODULES and KINGDOM_BROWSER, then run:
// node tools/qa/browser-party-care.mjs /tmp/kingdom-party-care-qa
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { once } from 'node:events';

const root = fileURLToPath(new URL('../../', import.meta.url));
const output = path.resolve(process.argv[2] ?? '/tmp/kingdom-party-care-qa');
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
  const focus = async (id = 'party-1') => click(`[data-select-party="${id}"]`);
  const relocate = (s, id, location) => { const p = s.parties[id]; p.location = location; p.unitIds.forEach(id => { s.units[id].location = location; }); s.world.tiles[location].terrainId = 'plains'; };
  const hp = (s, id, amount) => Object.assign(s.units[id], { hp: amount, currentHp: amount, status: amount ? 'active' : 'shattered' });
  assert.equal((await save()).partyRecoveryVersion, 1); assert.equal(await page.locator('#rest-party').isDisabled(), true); assert.match(await page.locator('#rest-preview').innerText(), /負傷者がいません/);
  checks.push('new games enable care and explain why an uninjured party cannot rest');
  await select('#game-mode', 'ranged-duel'); await click('#reset'); const initial = await save(), base = structuredClone(initial);
  relocate(base, 'party-1', '0,0,0'); relocate(base, 'party-2', '6,-6,0'); hp(base, 'unit-1', 41); hp(base, 'unit-2', 95); hp(base, 'unit-3', 0);
  await load(base); await focus(); assert.match(await page.locator('#rest-preview').innerText(), /unit-1: \+30 → HP 71/); assert.match(await page.locator('#rest-preview').innerText(), /unit-2: \+5 → HP 100/); assert.equal(await page.locator('#remove-casualties').isEnabled(), true); assert.deepEqual(await save(), base);
  await page.locator('#party-care').scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(output, 'care-preview-wide.png') });
  await click('#rest-party'); const pending = await save(); assert.equal(pending.units['unit-1'].hp, 41); assert.deepEqual(pending.rng, base.rng); assert.equal(pending.parties['party-1'].reactionCharges, 0); assert.equal(await page.locator('#rest-party').isDisabled(), true); assert.equal(await page.locator('#remove-casualties').isDisabled(), true); assert.match(await page.locator('#rest-preview').innerText(), /休養中/);
  await load(pending); assert.equal(await page.locator('#party-care').isVisible(), false); await focus(); assert.deepEqual(await save(), pending);
  checks.push('city rest preview is state-free, caps healing, reserves actions without immediate HP gain, and survives reload');

  const corrupt = structuredClone(pending); corrupt.parties['party-1'].reactionCharges = 1; await load(corrupt); assert.match(await page.locator('#message').innerText(), /restOrder/); assert.deepEqual(await save(), pending); assert.equal(await page.locator('[data-select-party="party-1"]').getAttribute('aria-pressed'), 'true');
  await click('#end-turn'); const handoff = await save(); assert.equal(handoff.units['unit-1'].hp, 41); await click('#end-turn'); const recovered = await save(); assert.equal(recovered.units['unit-1'].hp, 71); assert.equal(recovered.units['unit-2'].hp, 100); assert.equal(recovered.units['unit-3'].hp, 0); assert.equal(recovered.parties['party-1'].restOrder, undefined); assert.match(await page.locator('#party-care-log').innerText(), /休養完了/);
  await load(pending); await click('#end-turn'); await click('#end-turn'); assert.deepEqual(await save(), recovered);
  checks.push('corrupt rest order rejects atomically; hotseat handoff does not heal and the full-round recovery replays identically');

  const field = structuredClone(base); relocate(field, 'party-1', '-3,3,0'); await load(field); await focus(); assert.match(await page.locator('#rest-preview').innerText(), /unit-1: \+20 → HP 61/); await click('#rest-party'); await click('#end-turn'); await click('#end-turn'); assert.equal((await save()).units['unit-1'].hp, 61);
  const unsafe = structuredClone(base); relocate(unsafe, 'party-2', '1,-1,0'); await load(unsafe); await focus(); assert.equal(await page.locator('#rest-party').isDisabled(), true); assert.equal(await page.locator('#remove-casualties').isDisabled(), true); assert.match(await page.locator('#rest-preview').innerText(), /敵軍/);
  checks.push('field recovery uses 20 HP and adjacent enemies disable rest and casualty removal with a reason');

  const ranged = structuredClone(base); relocate(ranged, 'party-2', '2,-2,0'); await load(ranged); await focus(); await click('#rest-party'); await click('#end-turn'); await select('#combat-target', 'party-1'); await select('#attack-type', 'ranged'); await click('#attack-party'); const hit = await save(); assert.equal(hit.parties['party-1'].restOrder, undefined); assert.ok(hit.eventLog.some(e => e.type === 'PartyRestCancelled')); await click('#end-turn'); assert.equal((await save()).units['unit-1'].hp, hit.units['unit-1'].hp); assert.match(await page.locator('#party-care-log').innerText(), /休養中止: 戦闘で被害/);
  checks.push('real ranged attack interrupts pending rest; cancellation and unrecovered HP appear after returning to the party');

  await load(base); await focus(); await click('#remove-casualties'); const removed = await save(); assert.equal(removed.parties['party-1'].unitIds.length, 4); assert.equal(removed.units['unit-3'].partyId, null); assert.equal(removed.units['unit-3'].hp, 0); assert.equal(removed.parties['party-1'].formation['middle-center'], undefined); assert.match(await page.locator('#party-care-log').innerText(), /戦闘不能者の離脱: unit-3/);
  assert.match(await page.locator('[data-select-unit="unit-3"]').innerText(), /戦闘不能の記録/); await click('[data-select-unit="unit-3"]'); assert.match(await page.locator('#unit-content').innerText(), /離脱済み/); assert.equal(await page.locator('#deploy-unit').isDisabled(), true); assert.equal(await page.locator('[data-form-unit="unit-3"]').count(), 0);
  await click('[data-buy="warrior"]'); let purchased = await save(); const recruit = Object.values(purchased.units).find(u => u.ownerId === 'kingdom-1' && u.partyId === null && u.currentHp > 0); assert.ok(recruit);
  await focus(); await page.locator(`[data-reinforce-unit="${recruit.id}"]`).evaluate(el => { el.checked = true; el.dispatchEvent(new Event('change', { bubbles: true })); }); assert.equal(await page.locator('#reinforce-party').isDisabled(), true);
  await click('#end-turn'); await click('#end-turn'); await page.locator(`[data-reinforce-unit="${recruit.id}"]`).evaluate(el => { el.checked = true; el.dispatchEvent(new Event('change', { bubbles: true })); }); assert.equal(await page.locator('#reinforce-party').isEnabled(), true); await click('#reinforce-party'); const reinforced = await save(); assert.equal(reinforced.parties['party-1'].unitIds.length, 5); assert.equal(reinforced.units[recruit.id].partyId, 'party-1'); assert.equal(reinforced.units['unit-3'].partyId, null); await load(reinforced); assert.deepEqual(await save(), reinforced);
  checks.push('casualty removal retains inspectable records, disables resurrection, and permits purchased reinforcements only on the next round');

  const fallen = structuredClone(base); hp(fallen, 'unit-1', 0); fallen.units['unit-4'].commandContribution = 100; await load(fallen); await focus(); await click('#remove-casualties'); const leader = await save(); assert.equal(leader.parties['party-1'].leaderUnitId, 'unit-4'); assert.deepEqual(leader.parties['party-1'].guardOrders, {}); assert.match(await page.locator('#unit-content').innerText(), /unit-4/);
  checks.push('removing a fallen leader repairs selection, succession, formation and guards in the actual UI');

  await select('#game-mode', 'ai-reinforcements'); await click('#reset'); const aiBase = await save(); hp(aiBase, 'unit-6', 40); hp(aiBase, 'unit-8', 0); await load(aiBase); await click('#end-turn'); const beforeAi = await save(); await page.clock.runFor(180); const aiRemoved = await save(); assert.equal(aiRemoved.commandLog.at(-1).type, 'RemoveCasualties'); assert.match(await page.locator('#ai-activity').innerText(), /戦闘不能者の離脱/); await load(beforeAi); await page.clock.runFor(180); assert.deepEqual(await save(), aiRemoved);
  await page.clock.runFor(10000); assert.equal((await save()).currentTurn, 2); await click('#end-turn'); const beforeRest = await save(); await page.clock.runFor(180); const aiRest = await save(); assert.equal(aiRest.commandLog.at(-1).type, 'RestParty'); assert.match(await page.locator('#ai-activity').innerText(), /休養/); await load(beforeRest); await page.clock.runFor(180); assert.deepEqual(await save(), aiRest); await page.clock.runFor(10000); assert.equal((await save()).units['unit-6'].hp, 60);
  checks.push('AI removes casualties then rests through visible commands and reproduces both decisions from saved boundaries');

  const legacy = structuredClone(base); delete legacy.partyRecoveryVersion; await load(legacy); await focus(); assert.match(await page.locator('#party-care').innerText(), /旧対局/); assert.equal(await page.locator('#rest-party').count(), 0); assert.deepEqual(await save(), legacy);
  checks.push('historical saves retain their version and show an explanation instead of new care controls');

  await load(base); await focus(); await page.setViewportSize({ width: 390, height: 844 }); await page.locator('#party-care').scrollIntoViewIfNeeded(); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)); await page.screenshot({ path: path.join(output, 'care-preview-mobile.png') }); await click('#rest-party'); await page.locator('#party-care').scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(output, 'care-pending-mobile.png') });
  checks.push('390px recovery forecast, actions, pending state and logs render without horizontal overflow');
  assert.deepEqual(errors, []); assert.deepEqual(failures, []);
  const report = { verifiedAt: new Date().toISOString(), browser: await browser.version(), checks, pageErrors: errors, httpFailures: failures };
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2));
} finally { if (browser) await browser.close(); server.close(); }
