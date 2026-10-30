// Optional real Chromium QA for city retaliation, shared guard damage, wall AI and save continuation.
// Set KINGDOM_QA_MODULES and KINGDOM_BROWSER, then run:
// node tools/qa/browser-city-defense.mjs /tmp/kingdom-city-defense-qa
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { once } from 'node:events';

const root = fileURLToPath(new URL('../../', import.meta.url));
const output = path.resolve(process.argv[2] ?? '/tmp/kingdom-city-defense-qa');
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
  const target = async (type = 'melee') => { await click('[data-select-party="party-1"]'); await select('#siege-city', 'city-2'); await select('#siege-type', type); };
  const relocate = (s, id, location) => { const p = s.parties[id]; p.location = location; p.unitIds.forEach(id => { s.units[id].location = location; }); s.world.tiles[location].terrainId = 'plains'; };
  await select('#game-mode', 'ai-conquest'); await click('#reset'); const initial = await save();
  assert.equal(initial.cityDefenseVersion, 3); assert.equal(initial.cities['city-1'].defense.counterattacksRemaining, 1);
  assert.match(await page.locator('#city-defense').innerText(), /反撃 1\/1/); assert.match(await page.locator('#scenario-detail').innerText(), /全体ターン1回反撃/);
  checks.push('new conquest explains one city counter per round alongside version-3 bombardment');

  const base = structuredClone(initial); relocate(base, 'party-1', '3,-3,0'); relocate(base, 'party-2', '-6,6,0');
  await load(base); await target(); assert.match(await page.locator('#siege-counter-preview').innerText(), /都市反撃: あり/); assert.match(await page.locator('#siege-counter-preview').innerText(), /unit-2.*肩代わり/); assert.deepEqual(await save(), base);
  await page.locator('#siege-panel').scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(output, 'counter-preview-wide.png') });
  await click('#attack-city'); const hit = await save();
  assert.equal(hit.cities['city-2'].defense.counterattacksRemaining, 0); assert.ok(hit.units['unit-1'].currentHp < 100); assert.ok(hit.units['unit-2'].currentHp < 100);
  assert.match(await page.locator('#siege-log').innerText(), /都市反撃:.*肩代わり/); assert.match(await page.locator('#combat-log').innerText(), /都市反撃/);
  assert.equal(await page.locator('#attack-city').isDisabled(), true); await load(hit); assert.deepEqual(await save(), hit);
  await load(base); await target(); await click('#attack-city'); assert.deepEqual(await save(), hit);
  checks.push('melee forecast is read-only; real retaliation shares damage with guard and replays identically after reload');

  await load(base); await click('[data-select-party="party-1"]'); await select('#guard-unit', 'unit-2'); await select('#guard-target', 'unit-1'); await select('#guard-mode', 'intercept'); await click('#set-guard'); await target();
  assert.match(await page.locator('#siege-counter-preview').innerText(), /unit-2.*割り込み/); await click('#attack-city'); const intercept = await save();
  assert.equal(intercept.units['unit-1'].currentHp, 100); assert.ok(intercept.units['unit-2'].currentHp < 100); assert.equal(intercept.parties['party-1'].reactionCharges, 0); assert.match(await page.locator('#siege-log').innerText(), /割り込み/);
  checks.push('actual guard controls enable interception before siege activation closes remaining reactions');

  for (const breach of [false, true]) {
    const value = structuredClone(base); if (breach) value.cities['city-2'].defense.hp = 1; await load(value); await target(breach ? 'melee' : 'ranged');
    assert.match(await page.locator('#siege-counter-preview').innerText(), /都市反撃: なし/); await click('#attack-city'); const after = await save(); assert.deepEqual(after.units, value.units); assert.equal(after.cities['city-2'].defense.counterattacksRemaining, 1);
  }
  checks.push('ranged siege and a guaranteed breach show no counter and preserve unit HP and city reaction charge');

  const weak = structuredClone(base); weak.parties['party-1'].guardOrders = {};
  weak.parties['party-1'].unitIds.forEach((id, i) => Object.assign(weak.units[id], { hp: i ? 0 : 1, currentHp: i ? 0 : 1, status: i ? 'shattered' : 'active' }));
  await load(weak); await target(); await click('#attack-city'); const defeated = await save(); assert.equal(defeated.parties['party-1'].status, 'defeated'); assert.equal(defeated.gameResult, null); assert.match(await page.locator('#siege-log').innerText(), /部隊敗北/); assert.equal(await page.locator('#end-turn').isEnabled(), true); await load(defeated); assert.deepEqual(await save(), defeated);
  checks.push('lethal city counter defeats the attacking party while city-control play and saving remain usable');

  const spent = structuredClone(base); spent.cities['city-2'].defense.counterattacksRemaining = 0; await load(spent); await target(); assert.match(await page.locator('#siege-counter-preview').innerText(), /都市反撃: なし/);
  await click('#end-turn'); await page.clock.runFor(6000); const reset = await save(); assert.equal(reset.currentTurn, 2); assert.equal(reset.cities['city-2'].defense.counterattacksRemaining, 1);
  const invalid = structuredClone(reset); invalid.cities['city-1'].defense.counterattacksRemaining = 2; await load(invalid); assert.match(await page.locator('#message').innerText(), /セーブデータが不正/); assert.deepEqual(await save(), reset);
  checks.push('spent city reactions survive loading, reset at the full round and reject corrupted saves atomically');

  const wallBase = structuredClone(base); Object.assign(wallBase.parties['party-2'], { movementRemaining: 0, attacksRemaining: 0, activationState: 'ended' }); wallBase.kingdoms['kingdom-2'].stockpiles.gold = 144;
  wallBase.cities['city-2'].production = { currentItemId: 'archer', queue: ['warrior'], progressByItem: { archer: 10 } };
  await load(wallBase); await click('#end-turn'); const beforeAI = await save(); await page.clock.runFor(180); const wallBuilt = await save();
  assert.equal(wallBuilt.commandLog.at(-1).payload.itemId, 'walls'); assert.equal(wallBuilt.commandLog.at(-1).type, 'PurchaseCityItem'); assert.equal(wallBuilt.kingdoms['kingdom-2'].stockpiles.gold, 24); assert.equal(wallBuilt.cities['city-2'].defense.wallHp, 60); assert.deepEqual(wallBuilt.cities['city-2'].production, wallBase.cities['city-2'].production);
  assert.match(await page.locator('#ai-activity').innerText(), /城壁発注 1回/); await load(beforeAI); await page.clock.runFor(180); assert.deepEqual(await save(), wallBuilt);
  await page.clock.runFor(6000); const end = await save(); assert.equal(end.currentTurn, 2); assert.equal(end.commandLog.filter(c => c.turn === 1 && c.playerId === 'kingdom-2' && c.type === 'PurchaseCityItem').length, 1);
  checks.push('AI buys threatened-city walls with reserve intact, preserves military orders and resumes without duplicate spending');

  const producing = structuredClone(wallBase); producing.kingdoms['kingdom-2'].stockpiles.gold = 0; producing.cities['city-2'].production = { currentItemId: null, queue: [], progressByItem: {} };
  await load(producing); await click('#end-turn'); await page.clock.runFor(180); const queued = await save(); assert.equal(queued.cities['city-2'].production.currentItemId, 'walls'); assert.equal(queued.commandLog.at(-1).type, 'SetCityProduction');
  const rebuilding = structuredClone(producing); rebuilding.parties['party-2'].unitIds.slice(1).forEach(id => Object.assign(rebuilding.units[id], { hp: 0, currentHp: 0, status: 'shattered' }));
  await load(rebuilding); await click('#end-turn'); await page.clock.runFor(180); const rebuilt = await save(); assert.notEqual(rebuilt.cities['city-2'].production.currentItemId, 'walls'); assert.equal(rebuilt.commandLog.at(-1).type, 'SetCityProduction');
  checks.push('AI chooses wall production without purchase funds and prioritizes military rebuilding when its army is depleted');

  const legacy = structuredClone(base); legacy.cityDefenseVersion = 1; Object.values(legacy.cities).forEach(city => { delete city.defense.counterattacksRemaining; delete city.defense.bombardmentsRemaining; }); await load(legacy); await target();
  assert.match(await page.locator('#siege-rules').innerText(), /反撃のない旧攻城ルール/); assert.match(await page.locator('#siege-counter-preview').innerText(), /都市反撃: なし/); await click('#attack-city'); const oldHit = await save(); assert.deepEqual(oldHit.units, legacy.units); assert.equal(oldHit.cityDefenseVersion, 1);
  const ancient = structuredClone(legacy); delete ancient.cityDefenseVersion; Object.values(ancient.cities).forEach(city => { delete city.defense; }); await load(ancient); assert.equal(await page.locator('#siege-panel').isVisible(), false); assert.deepEqual(await save(), ancient);
  checks.push('version-1 siege and capture-only historical saves retain their respective rules');

  await load(base); await target(); await page.setViewportSize({ width: 390, height: 844 }); await page.locator('#siege-panel').scrollIntoViewIfNeeded(); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)); await page.screenshot({ path: path.join(output, 'counter-preview-mobile.png') });
  await click('#attack-city'); await page.locator('#siege-log').scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(output, 'counter-log-mobile.png') });
  checks.push('390px counter prediction and detailed loss log render without horizontal overflow');
  assert.deepEqual(errors, []); assert.deepEqual(failures, []);
  const report = { verifiedAt: new Date().toISOString(), browser: await browser.version(), checks, pageErrors: errors, httpFailures: failures };
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2));
} finally { if (browser) await browser.close(); server.close(); }
