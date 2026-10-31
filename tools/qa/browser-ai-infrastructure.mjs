// Optional real Chromium QA for AI facility investments, safety and saved continuation.
// Set KINGDOM_QA_MODULES and KINGDOM_BROWSER, then run:
// node tools/qa/browser-ai-infrastructure.mjs /tmp/kingdom-ai-infrastructure-qa
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { once } from 'node:events';

const root = fileURLToPath(new URL('../../', import.meta.url));
const output = path.resolve(process.argv[2] ?? '/tmp/kingdom-ai-infrastructure-qa');
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

  const make = async (mode = 'ai-reinforcements', gold = 300) => {
    await select('#game-mode', mode); await click('#reset'); const s = await save();
    s.activePlayerId = 'kingdom-2'; s.activePlayerIndex = 1;
    const k = s.kingdoms['kingdom-2']; k.stockpiles.gold = gold;
    k.research = { currentTechnologyId: null, progressByTechnology: {}, completedTechnologyIds: ['writing'] }; k.progress.science = 12;
    for (const [id, key] of [['party-1','-5,5,0'], ['party-2','6,-6,0']]) {
      const p = s.parties[id]; p.location = key; s.world.tiles[key].terrainId = 'plains'; p.unitIds.forEach(uid => { s.units[uid].location = key; });
    }
    Object.assign(s.parties['party-2'], { movementRemaining: 0, attacksRemaining: 0, reactionCharges: 0, activationState: 'ended' });
    return s;
  };
  const step = () => page.clock.runFor(180);
  const finish = () => page.clock.runFor(10000);
  const initial = await make(); assert.equal(initial.aiInfrastructureVersion, 1); await load(initial);
  assert.match(await page.locator('#ai-infrastructure-status').innerText(), /生存兵5体.*Gold72/);
  await step(); const bought = await save();
  assert.deepEqual(bought.cities['city-2'].buildings, ['library']); assert.equal(bought.kingdoms['kingdom-2'].stockpiles.gold, 220);
  assert.deepEqual(bought.rng, initial.rng); assert.deepEqual(bought.units, initial.units);
  assert.deepEqual(bought.cities['city-2'].yieldSummary, initial.cities['city-2'].yieldSummary);
  assert.match(await page.locator('#ai-activity').innerText(), /図書館購入 1回/);
  checks.push('new AI scenario declares the investment policy and a real scheduled AI step buys an unlocked library at full price without immediate income');

  await finish(); const continued = await save(); await load(bought); await finish(); assert.deepEqual(await save(), continued);
  const buys = continued.commandLog.filter(c => c.playerId === 'kingdom-2' && c.turn === bought.currentTurn && c.type === 'PurchaseCityItem');
  assert.equal(buys.length, 1); assert.equal(continued.cities['city-2'].lastYieldBreakdown.buildings.find(b => b.buildingId === 'library').yields.science, 2);
  checks.push('reload after the purchase preserves the shared purchase cap and reproduces the next human turn and library income');

  const production = await make('ai-reinforcements', 24); production.cities['city-2'].production.progressByItem = { library: 9, warrior: 7 };
  await load(production); await step(); const ordered = await save();
  assert.equal(ordered.cities['city-2'].production.currentItemId, 'library'); assert.equal(ordered.kingdoms['kingdom-2'].stockpiles.gold, 24);
  assert.deepEqual(ordered.cities['city-2'].production.progressByItem, production.cities['city-2'].production.progressByItem);
  assert.match(await page.locator('#ai-activity').innerText(), /図書館生産予約 1回/);
  await finish(); const productionContinuation = await save(); await load(ordered); await finish(); assert.deepEqual(await save(), productionContinuation);
  checks.push('poor AI uses idle production with retained partial progress and the reservation replays from a mid-turn save');

  const queued = await make(); queued.cities['city-2'].production = { currentItemId: 'warrior', queue: ['archer', 'monument'], progressByItem: { warrior: 7 } };
  await load(queued); await step(); assert.deepEqual((await save()).cities['city-2'].production, queued.cities['city-2'].production);
  const duplicate = structuredClone(queued); duplicate.cities['city-2'].production.queue.push('library');
  await load(duplicate); await step(); const skipped = await save(); assert.equal(skipped.cities['city-2'].buildings.includes('library'), false);
  assert.deepEqual(skipped.cities['city-2'].production, duplicate.cities['city-2'].production);
  checks.push('existing military queues survive facility purchases and already reserved libraries are not duplicated');

  const unsafe = await make('ai-conquest'); const p = unsafe.parties['party-1']; p.location = '2,-2,0'; p.unitIds.forEach(id => { unsafe.units[id].location = p.location; }); unsafe.world.tiles[p.location].terrainId = 'plains';
  await load(unsafe); await step(); const defended = await save();
  assert.equal(defended.commandLog.at(-1).payload.itemId, 'walls'); assert.equal(defended.cities['city-2'].buildings.includes('library'), false);
  assert.match(await page.locator('#ai-activity').innerText(), /城壁発注/);
  checks.push('nearby enemy pressure produces a wall order instead of discretionary facility investment');

  const weak = await make(); const dead = weak.units[weak.parties['party-2'].unitIds[0]]; dead.hp = dead.currentHp = 0; dead.status = 'shattered';
  // Leave four live soldiers and an exhausted activation; the normal supply AI must rebuild.
  weak.parties['party-2'].leaderUnitId = weak.parties['party-2'].unitIds[1];
  await load(weak); await step(); const rebuilt = await save();
  assert.equal(rebuilt.commandLog.at(-1).payload.itemId, 'warrior'); assert.equal(rebuilt.cities['city-2'].buildings.includes('library'), false);
  checks.push('fewer than five living soldiers trigger ordinary army rebuilding rather than a library');

  const old = await make(); delete old.aiInfrastructureVersion; await load(old);
  assert.match(await page.locator('#ai-infrastructure-status').innerText(), /旧セーブ.*施設投資なし/);
  await step(); const legacy = await save(); assert.equal(legacy.commandLog.at(-1).payload.itemId, 'warrior');
  assert.equal(Object.hasOwn(legacy, 'aiInfrastructureVersion'), false); assert.equal(legacy.cities['city-2'].buildings.includes('library'), false);
  checks.push('old research-enabled saves keep the former military policy and do not gain the new version');

  const corrupt = structuredClone(legacy); corrupt.aiInfrastructureVersion = 2; await load(corrupt, false);
  assert.match(await page.locator('#message').innerText(), /aiInfrastructureVersion/); assert.deepEqual(await save(), legacy);
  checks.push('unknown investment versions reject loading atomically without replacing the running game');

  await load(bought); await finish(); await page.locator('#scenario-status').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(output, 'ai-investment-wide.png') });
  await page.locator('#scenario-status').screenshot({ path: path.join(output, 'ai-investment-panel.png') });
  await page.setViewportSize({ width: 390, height: 844 }); await page.locator('#scenario-status').scrollIntoViewIfNeeded();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: path.join(output, 'ai-investment-mobile.png') });
  checks.push('investment policy and named facility activity remain readable at desktop and 390px without horizontal overflow');
  assert.deepEqual(errors, []); assert.deepEqual(failures, []);
  const report = { verifiedAt: new Date().toISOString(), browser: await browser.version(), checks, pageErrors: errors, httpFailures: failures };
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2));
} catch (error) {
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), checks, pageErrors: errors, httpFailures: failures, error: String(error.stack ?? error) }, null, 2) + '\n');
  throw error;
} finally { if (browser) await browser.close(); server.close(); }
