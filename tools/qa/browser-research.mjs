// Optional real Chromium QA for research selection, allocation, unlocks and saved continuation.
// Set KINGDOM_QA_MODULES and KINGDOM_BROWSER, then run:
// node tools/qa/browser-research.mjs /tmp/kingdom-research-qa
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { once } from 'node:events';

const root = fileURLToPath(new URL('../../', import.meta.url));
const output = path.resolve(process.argv[2] ?? '/tmp/kingdom-research-qa');
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
  const load = async (value, valid = true) => { await page.evaluate(s => localStorage.setItem('kingdom-m1-save', JSON.stringify(s)), value); await click('#load'); if (valid) assert.match(await page.locator('#message').innerText(), /セーブをロードしました/); };
  const select = async (selector, value) => page.locator(selector).evaluate((el, value) => { el.value = value; el.dispatchEvent(new Event('change', { bubbles: true })); }, value);
  const choose = async id => { await select('#research-target', id); await click('#research-select'); };
  const initial = await save(); assert.equal(initial.researchVersion, 1);
  assert.equal(await page.locator('#research-panel').isVisible(), true);
  for (const id of ['library', 'granary', 'workshop']) assert.equal(await page.locator(`[data-buy="${id}"]`).isDisabled(), true);
  for (const id of ['warrior', 'archer', 'ballista', 'settler']) assert.equal(await page.locator(`[data-produce="${id}"]`).isEnabled(), true);
  assert.equal(await page.locator('#research-target option[value="engineering"]').evaluate(el => el.disabled), true);
  await select('#research-target', 'agriculture'); assert.deepEqual(await save(), initial);
  await select('#research-target', 'writing'); await page.locator('#research-select').focus(); await page.keyboard.press('Enter');
  const chosen = await save(); assert.equal(chosen.kingdoms['kingdom-1'].research.currentTechnologyId, 'writing');
  assert.deepEqual(chosen.kingdoms['kingdom-1'].progress, initial.kingdoms['kingdom-1'].progress); assert.deepEqual(chosen.rng, initial.rng);
  assert.deepEqual(chosen.kingdoms['kingdom-1'].research.progressByTechnology, {});
  checks.push('new game exposes research, locks only new buildings, and keyboard selection spends no science or actions');

  await click('#end-turn'); const progressed = await save(); const k = progressed.kingdoms['kingdom-1'];
  assert.equal(k.research.progressByTechnology.writing, k.progress.science); assert.match(await page.locator('#research-status').innerText(), /文字/);
  await load(progressed); assert.deepEqual(await save(), progressed);
  await click('#end-turn'); const continuation = await save(); await load(progressed); await click('#end-turn'); assert.deepEqual(await save(), continuation);
  checks.push('round start allocates science once, displays progress and replays identically after save/load');

  await load(progressed); await choose('agriculture'); await click('#end-turn'); const switched = await save();
  assert.equal(switched.kingdoms['kingdom-1'].research.progressByTechnology.writing, k.research.progressByTechnology.writing);
  assert.ok(switched.kingdoms['kingdom-1'].research.progressByTechnology.agriculture > 0);
  await click('#research-pause'); const paused = await save(); await click('#end-turn'); const banked = await save();
  assert.deepEqual(banked.kingdoms['kingdom-1'].research, paused.kingdoms['kingdom-1'].research);
  assert.ok(banked.kingdoms['kingdom-1'].progress.science > paused.kingdoms['kingdom-1'].progress.science);
  await choose('writing'); await click('#end-turn'); const resumed = await save(); const r = resumed.kingdoms['kingdom-1'];
  assert.equal(r.research.progressByTechnology.writing + r.research.progressByTechnology.agriculture, r.progress.science);
  checks.push('switch, pause and resume retain topic-specific work and spend only unassigned science');

  const near = structuredClone(chosen); near.kingdoms['kingdom-1'].progress.science = 11; near.kingdoms['kingdom-1'].stockpiles.gold = 200;
  await load(near); await click('#end-turn'); const unlocked = await save();
  assert.deepEqual(unlocked.kingdoms['kingdom-1'].research.completedTechnologyIds, ['writing']);
  assert.match(await page.locator('#message').innerText(), /研究完了.*文字/);
  assert.equal(await page.locator('[data-buy="library"]').isEnabled(), true); assert.equal(await page.locator('[data-buy="workshop"]').isDisabled(), true);
  assert.equal(await page.locator('#research-target option[value="engineering"]').evaluate(el => el.disabled), false);
  assert.equal(unlocked.cities['city-1'].buildings.includes('library'), false);
  const science = unlocked.kingdoms['kingdom-1'].progress.science;
  await click('[data-buy="library"]'); const bought = await save();
  assert.equal(bought.kingdoms['kingdom-1'].stockpiles.gold, unlocked.kingdoms['kingdom-1'].stockpiles.gold - 80);
  assert.equal(bought.kingdoms['kingdom-1'].progress.science, science); assert.deepEqual(bought.cities['city-1'].yieldSummary, unlocked.cities['city-1'].yieldSummary);
  await click('#end-turn'); const income = await save();
  assert.equal(income.cities['city-1'].lastYieldBreakdown.buildings.find(b => b.buildingId === 'library').yields.science, 2);
  assert.match(await page.locator('#buildings').innerText(), /図書館建設済み/);
  checks.push('completion unlocks library and engineering; paid construction yields its science bonus only on later collection');

  await load(unlocked); await click('#production-queue-edit');
  assert.equal(await page.locator('#production-queue-item option[value="library"]').evaluate(el => el.disabled), false);
  assert.equal(await page.locator('#production-queue-item option[value="granary"]').evaluate(el => el.disabled), true);
  await select('#production-queue-item', 'library'); await click('#production-queue-add'); await click('#production-queue-apply');
  const ordered = await save(); assert.equal(ordered.cities['city-1'].production.currentItemId, 'library');
  await click('[data-buy="library"]'); assert.equal((await save()).cities['city-1'].production.currentItemId, null);
  checks.push('production queue enforces research unlocks and purchase removes a reserved building without duplicate completion');

  const overflow = structuredClone(chosen); overflow.kingdoms['kingdom-1'].progress.science = 50;
  await load(overflow); await click('#end-turn'); const first = await save();
  assert.deepEqual(first.kingdoms['kingdom-1'].research.completedTechnologyIds, ['writing']);
  await choose('engineering'); const beforeSecond = await save(); assert.deepEqual(beforeSecond.kingdoms['kingdom-1'].research.completedTechnologyIds, ['writing']);
  await click('#end-turn'); const second = await save(); assert.deepEqual(second.kingdoms['kingdom-1'].research.completedTechnologyIds, ['writing', 'engineering']);
  assert.ok(second.kingdoms['kingdom-1'].progress.science > 50); assert.equal(await page.locator('[data-buy="workshop"]').isEnabled(), true);
  checks.push('excess science remains banked and subsequent research cannot complete by repeated selection in the same turn');

  await select('#game-mode', 'two-cities'); await click('#reset'); await choose('agriculture'); const two = await save();
  await select('#city-select', 'city-2'); assert.deepEqual(await save(), two); assert.match(await page.locator('#research-status').innerText(), /農業/);
  await click('#end-turn'); const both = await save(); assert.equal(both.kingdoms['kingdom-1'].research.progressByTechnology.agriculture, both.kingdoms['kingdom-1'].progress.science);
  checks.push('research is kingdom-wide across city selection and sums multi-city income once');

  await select('#game-mode', 'duel'); await click('#reset'); await choose('writing'); await click('#end-turn');
  assert.match(await page.locator('#research-status').innerText(), /研究対象なし/); await choose('agriculture'); await click('#end-turn');
  const hotseat = await save(); assert.match(await page.locator('#research-status').innerText(), /文字/);
  assert.ok(hotseat.kingdoms['kingdom-1'].research.progressByTechnology.writing > 0);
  assert.ok(hotseat.kingdoms['kingdom-2'].research.progressByTechnology.agriculture > 0);
  checks.push('human hotseat shows only the active kingdom research and allocates at the shared round boundary');

  await select('#game-mode', 'ai-skirmish'); await click('#reset'); await click('#end-turn'); const aiPending = await save();
  assert.equal(await page.locator('#research-select').isDisabled(), true); assert.equal(await page.locator('#research-target').isDisabled(), true);
  await click('#research-select'); assert.deepEqual(await save(), aiPending);
  await page.clock.runFor(10000); const aiDone = await save();
  assert.equal(aiDone.commandLog.filter(c => c.playerId === 'kingdom-2' && c.type === 'SelectResearch').length, 1);
  await load(aiPending); await page.clock.runFor(10000); assert.deepEqual(await save(), aiDone);
  checks.push('AI selects through the shared Command, locks human controls and resumes deterministically from an AI-turn save');

  const legacy = structuredClone(initial); delete legacy.researchVersion; Object.values(legacy.kingdoms).forEach(k => { delete k.research; });
  await load(legacy); assert.match(await page.locator('#research-panel').innerText(), /旧セーブ/); assert.equal(await page.locator('#research-select').count(), 0);
  assert.equal(await page.locator('[data-buy="library"]').isVisible(), false); assert.deepEqual(await save(), legacy);
  await load(progressed); const corrupt = structuredClone(progressed); corrupt.kingdoms['kingdom-1'].research.completedTechnologyIds = ['engineering'];
  await load(corrupt, false); assert.match(await page.locator('#message').innerText(), /セーブデータが不正/); assert.deepEqual(await save(), progressed);
  checks.push('legacy rules are explicit and unchanged; corrupt research saves are rejected without replacing current play');

  const zero = structuredClone(chosen); zero.kingdoms['kingdom-1'].progress.science = 0; zero.cities['city-1'].yieldSummary.science = 0; zero.cities['city-1'].yieldModifiers.science = -100;
  await load(zero); assert.match(await page.locator('#research-status').innerText(), /科学産出0/);
  await select('#game-mode', 'ai-conquest'); await click('#reset'); const final = await save();
  final.currentTurn = final.scenarioObjective.turnLimit; final.lastProcessedTurn = final.currentTurn; final.kingdoms['kingdom-1'].progress.science = 100;
  final.kingdoms['kingdom-1'].research.currentTechnologyId = 'writing'; await load(final); await click('#end-turn'); await page.clock.runFor(10000);
  assert.ok((await save()).gameResult); assert.equal(await page.locator('#research-select').isDisabled(), true);
  assert.equal((await save()).kingdoms['kingdom-1'].research.completedTechnologyIds.length, 0);
  checks.push('zero-income estimate is explicit; game over locks research before the next collection');

  await load(unlocked); await select('#research-target', 'engineering');
  await page.locator('#research-panel').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(output, 'research-wide.png') });
  await page.locator('#research-panel').screenshot({ path: path.join(output, 'research-panel.png') });
  await page.setViewportSize({ width: 390, height: 844 }); await page.locator('#research-panel').scrollIntoViewIfNeeded();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: path.join(output, 'research-mobile.png') });
  checks.push('research list, prerequisites, unlocks and keyboard controls render at 1440px and 390px without horizontal overflow');
  assert.deepEqual(errors, []); assert.deepEqual(failures, []);
  const report = { verifiedAt: new Date().toISOString(), browser: await browser.version(), checks, pageErrors: errors, httpFailures: failures };
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2));
} catch (error) {
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), checks, pageErrors: errors, httpFailures: failures, error: String(error.stack ?? error) }, null, 2) + '\n');
  throw error;
} finally { if (browser) await browser.close(); server.close(); }
