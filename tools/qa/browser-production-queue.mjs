// Optional real Chromium QA for production queue editing and save continuation.
// Set KINGDOM_QA_MODULES and KINGDOM_BROWSER, then run:
// node tools/qa/browser-production-queue.mjs /tmp/kingdom-production-queue-qa
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { once } from 'node:events';

const root = fileURLToPath(new URL('../../', import.meta.url));
const output = path.resolve(process.argv[2] ?? '/tmp/kingdom-production-queue-qa');
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
  const rows = () => page.locator('[data-queue-item]').evaluateAll(nodes => nodes.map(node => node.dataset.queueItem));
  const add = async id => { await select('#production-queue-item', id); await click('#production-queue-add'); };
  const edit = () => click('#production-queue-edit');
  const initial = await save(), base = structuredClone(initial);
  base.cities['city-1'].production = { currentItemId: 'warrior', queue: ['archer', 'warrior'], progressByItem: { warrior: 7, archer: 3, monument: 9 } };
  await load(base); assert.deepEqual(await rows(), ['warrior', 'archer', 'warrior']);
  assert.match(await page.locator('#production-queue').innerText(), /保持中の進捗.*モニュメント 9\/20/);
  await edit(); await add('monument'); await click('[data-queue-index="3"] [data-queue-action="up"]');
  assert.deepEqual(await rows(), ['warrior', 'archer', 'monument', 'warrior']);
  assert.deepEqual(await save(), base); await click('#production-queue-cancel');
  assert.deepEqual(await rows(), ['warrior', 'archer', 'warrior']); assert.deepEqual(await save(), base);
  checks.push('draft add, reorder and cancel do not mutate GameState or saved production');

  await edit(); await add('monument'); await click('[data-queue-index="1"] [data-queue-action="up"]'); await click('[data-queue-index="2"] [data-queue-action="remove"]');
  await click('#production-queue-apply'); const committed = await save();
  assert.deepEqual(committed.cities['city-1'].production, { currentItemId: 'archer', queue: ['warrior', 'monument'], progressByItem: base.cities['city-1'].production.progressByItem });
  assert.deepEqual(committed.rng, base.rng); assert.deepEqual(committed.kingdoms, base.kingdoms); assert.deepEqual(committed.units, base.units);
  assert.equal(committed.commandLog.length, base.commandLog.length + 1);
  await load(committed); assert.deepEqual(await save(), committed); assert.deepEqual(await rows(), ['archer', 'warrior', 'monument']);
  checks.push('confirm uses one Command and preserves progress, resources, RNG and save round-trip');

  await click('[data-produce="ballista"]'); let quick = await save(); assert.deepEqual(quick.cities['city-1'].production.queue, ['warrior', 'monument']);
  await click('[data-produce="monument"]'); quick = await save(); assert.deepEqual(quick.cities['city-1'].production.queue, ['warrior']);
  assert.deepEqual(quick.cities['city-1'].production.progressByItem, base.cities['city-1'].production.progressByItem);
  checks.push('quick production buttons retain reservations and promote queued buildings without duplication');

  await edit(); await click('#production-queue-clear'); assert.deepEqual(await save(), quick);
  assert.match(await page.locator('#production-queue-apply').innerText(), /停止/); await click('#production-queue-apply'); const stopped = await save();
  assert.equal(stopped.cities['city-1'].production.currentItemId, null); assert.deepEqual(stopped.cities['city-1'].production.queue, []);
  await load(stopped); await click('[data-produce="warrior"]'); const resumed = await save(); assert.equal(resumed.cities['city-1'].production.progressByItem.warrior, 7);
  await click('#end-turn'); const continued = await save(); await load(resumed); await click('#end-turn'); assert.deepEqual(await save(), continued);
  checks.push('clear requires confirmation, retains work, and resume replays identically after reload');

  await load(base); await edit(); await add('monument');
  assert.equal(await page.locator('#production-queue-item option[value="monument"]').evaluate(el => el.disabled), true);
  assert.equal(await page.locator('#production-queue-item option[value="walls"]').count(), 0);
  await click('#production-queue-apply'); await click('[data-buy="monument"]');
  const purchased = await save(); assert.equal(purchased.cities['city-1'].buildings.includes('monument'), true);
  assert.deepEqual(await rows(), ['warrior', 'archer', 'warrior']); await edit();
  assert.equal(await page.locator('#production-queue-item option[value="monument"]').evaluate(el => el.disabled), true);
  checks.push('duplicate and completed buildings are disabled; purchasing one normalizes the displayed queue');

  await select('#game-mode', 'two-cities'); await click('#reset'); const two = await save();
  await edit(); await add('archer'); await select('#city-select', 'city-2');
  assert.equal(await page.locator('#production-queue-apply').count(), 0); assert.deepEqual(await save(), two);
  assert.match(await page.locator('#production-queue-notice').innerText(), /未確定/);
  await edit(); await add('archer'); await add('warrior'); await click('#production-queue-apply'); const east = await save();
  assert.deepEqual(east.cities['city-1'], two.cities['city-1']); assert.equal(east.cities['city-2'].production.currentItemId, 'archer');
  checks.push('city switching discards a draft and subsequent confirmation targets only the selected city');

  await edit(); await add('monument'); await click('#end-turn'); assert.equal(await page.locator('#production-queue-apply').count(), 0);
  await edit(); await add('monument'); await load(east); assert.equal(await page.locator('#production-queue-apply').count(), 0);
  await edit(); await add('monument'); await click('#reset'); assert.equal(await page.locator('#production-queue-apply').count(), 0);
  checks.push('turn changes, successful load and new game invalidate unconfirmed drafts');

  await select('#game-mode', 'ai-reinforcements'); await click('#reset'); await edit(); await add('warrior'); await click('#end-turn');
  assert.equal(await page.locator('#production-queue-apply').count(), 0); assert.equal(await page.locator('#production-queue-edit').isDisabled(), true);
  const aiPending = await save(); await click('#production-queue-edit'); assert.deepEqual(await save(), aiPending);
  await page.clock.runFor(10000); assert.equal(await page.locator('#production-queue-edit').isEnabled(), true);
  checks.push('AI turns disable edits and cannot submit a stale draft');

  await select('#game-mode', 'ai-conquest'); await click('#reset'); const siege = await save(); await edit(); await add('walls'); await click('#production-queue-apply');
  assert.equal((await save()).cities['city-1'].production.currentItemId, 'walls');
  const finished = structuredClone(siege); finished.currentTurn = finished.scenarioObjective.turnLimit;
  finished.lastProcessedTurn = finished.currentTurn; await load(finished);
  await click('#end-turn'); await page.clock.runFor(10000); const result = await save();
  assert.ok(result.gameResult); assert.equal(await page.locator('#production-queue-edit').isDisabled(), true);
  checks.push('walls are available in the defense scenario and finished games disable queue editing');

  const zero = structuredClone(base); zero.cities['city-1'].yieldSummary.production = 0;
  await load(zero); assert.match(await page.locator('#production-queue-list').innerText(), /生産量0/);
  const legacy = structuredClone(base); delete legacy.partyRecoveryVersion;
  await load(legacy); await edit(); await click('#production-queue-cancel'); assert.deepEqual(await save(), legacy);
  checks.push('zero-production forecasts are explicit and historical saves remain unchanged when inspected');

  await load(base); await edit(); await page.locator('[data-queue-index="0"] [data-queue-action="down"]').focus();
  await page.keyboard.press('Enter'); assert.deepEqual(await rows(), ['archer', 'warrior', 'warrior']);
  assert.equal(await page.evaluate(() => document.activeElement.dataset.queueFocus), '0-down');
  await page.locator('#production-queue').scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(output, 'queue-wide.png') });
  await page.setViewportSize({ width: 390, height: 844 }); await page.locator('#production-queue').scrollIntoViewIfNeeded();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: path.join(output, 'queue-mobile.png') });
  checks.push('keyboard reorder retains focus and the complete editor fits 1440px and 390px viewports');
  assert.deepEqual(errors, []); assert.deepEqual(failures, []);
  const report = { verifiedAt: new Date().toISOString(), browser: await browser.version(), checks, pageErrors: errors, httpFailures: failures };
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2));
} catch (error) {
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), checks, pageErrors: errors, httpFailures: failures, error: String(error.stack ?? error) }, null, 2) + '\n');
  throw error;
} finally { if (browser) await browser.close(); server.close(); }
