// Optional real Chromium QA for city durability, wall construction, siege preview, breach and AI continuation.
// Set KINGDOM_QA_MODULES and KINGDOM_BROWSER, then run:
// node tools/qa/browser-siege.mjs /tmp/kingdom-siege-qa
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { once } from 'node:events';

const root = fileURLToPath(new URL('../../', import.meta.url));
const output = path.resolve(process.argv[2] ?? '/tmp/kingdom-siege-qa');
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
  const target = async () => { await click('[data-select-party="party-1"]'); await select('#siege-city', 'city-2'); };
  const relocate = (s, id, location) => { const p = s.parties[id]; p.location = location; p.unitIds.forEach(id => { s.units[id].location = location; }); s.world.tiles[location].terrainId = 'plains'; };
  await select('#game-mode', 'ai-conquest'); await click('#reset'); const legacySiege = await save(); legacySiege.cityDefenseVersion = 1; Object.values(legacySiege.cities).forEach(city => { delete city.defense.counterattacksRemaining; delete city.defense.bombardmentsRemaining; }); await load(legacySiege); const initial = await save();
  assert.equal(initial.cityDefenseVersion, 1); assert.equal(initial.cities['city-1'].defense.hp, 100);
  assert.match(await page.locator('#city-defense').innerText(), /都市耐久 100\/100/); assert.equal(await page.locator('#siege-panel').isVisible(), true);
  checks.push('version-1 conquest preserves durability, siege controls and city-defense rules');

  let s = structuredClone(initial); s.kingdoms['kingdom-1'].stockpiles.gold = 200; await load(s);
  await click('[data-produce="walls"]'); const producing = await save(); assert.equal(producing.cities['city-1'].production.currentItemId, 'walls');
  await click('[data-buy="walls"]'); const fortified = await save(); assert.equal(fortified.kingdoms['kingdom-1'].stockpiles.gold, 80); assert.equal(fortified.cities['city-1'].defense.wallHp, 60); assert.equal(fortified.cities['city-1'].production.currentItemId, null);
  assert.equal(await page.locator('[data-buy="walls"]').isDisabled(), true); assert.match(await page.locator('#city-defense').innerText(), /城壁 60\/60/);
  await load(fortified); assert.deepEqual(await save(), fortified);
  checks.push('wall production and purchase share building rules, remove duplicate orders and round-trip unchanged');

  s = structuredClone(fortified); relocate(s, 'party-1', '3,-3,0'); relocate(s, 'party-2', '-8,8,0');
  s = await page.evaluate(async value => {
    const { Hex } = await import('./src/world/hex.js'); for (let d = 0; d < 6; d++) value.world.tiles[Hex.fromKey('-8,8,0').neighbor(d).key].terrainId = 'void'; return value;
  }, s);
  s.kingdoms['kingdom-2'].stockpiles.gold = 0;
  s.cities['city-2'].buildings = ['walls']; s.cities['city-2'].defense.wallHp = 60;
  s.cities['city-2'].production = { currentItemId: 'settler', queue: Array(10).fill('settler'), progressByItem: {} };
  await load(s); await target();
  assert.equal(await page.locator('#map-move').isDisabled(), true); assert.equal(await page.locator('#capture-city').isDisabled(), true);
  assert.equal(await page.locator('#attack-city').isEnabled(), true); assert.match(await page.locator('#siege-preview').innerText(), /予測: 城壁.*弩砲/);
  assert.match(await page.locator('#cell-content').innerText(), /都市耐久 100\/100.*城壁 60\/60/);
  assert.deepEqual(await save(), s);
  await page.locator('#siege-panel').scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(output, 'siege-preview-wide.png') });
  checks.push('enemy city selection previews wall-first damage without mutation and blocks entry/capture');

  await click('#attack-city'); let hit = await save();
  assert.ok(hit.cities['city-2'].defense.wallHp < 60); assert.equal(hit.cities['city-2'].defense.hp, 100);
  assert.equal(hit.parties['party-1'].activationState, 'ended'); assert.equal(await page.locator('#attack-city').isDisabled(), true);
  assert.match(await page.locator('#siege-log').innerText(), /攻城: 城壁/); await load(hit); assert.deepEqual(await save(), hit);
  checks.push('actual siege spends activation, damages walls first, records the attack and reloads identically');

  for (let i = 0; i < 10 && hit.cities['city-2'].defense.hp > 0; i++) {
    await click('#end-turn'); await page.clock.runFor(6000); const next = await save(); assert.equal(next.activePlayerId, 'kingdom-1'); assert.equal(next.gameResult, null);
    await target(); await click('#attack-city'); hit = await save();
  }
  assert.equal(hit.cities['city-2'].defense.hp, 0); assert.equal(hit.cities['city-2'].defense.wallHp, 0); assert.equal(hit.cities['city-2'].ownerId, 'kingdom-2'); assert.equal(hit.gameResult, null);
  assert.match(await page.locator('#siege-log').innerText(), /防御崩壊/); assert.equal(await page.locator('#map-move').isDisabled(), true);
  await click('#end-turn'); await page.clock.runFor(6000); await target(); assert.equal(await page.locator('#map-move').isEnabled(), true);
  await click('#map-move'); assert.equal(await page.locator('#capture-city').isEnabled(), true); await click('#capture-city'); const victory = await save();
  assert.equal(victory.gameResult.winnerId, 'kingdom-1'); assert.equal(victory.cities['city-2'].defense.hp, 25); assert.equal(victory.cities['city-2'].defense.wallHp, 0);
  assert.equal(await page.locator('#scenario-title').innerText(), '勝利'); assert.equal(await page.locator('#attack-city').isDisabled(), true); await load(victory); assert.deepEqual(await save(), victory);
  checks.push('repeated real attacks breach the city; next-turn movement and capture win with damaged inherited walls');

  const invalid = structuredClone(victory); invalid.cities['city-2'].defense.hp = 101; await load(invalid); assert.match(await page.locator('#message').innerText(), /セーブデータが不正/); assert.deepEqual(await save(), victory);
  checks.push('invalid durability save rejects without replacing the current game');

  s = structuredClone(initial); relocate(s, 'party-1', '-6,6,0'); relocate(s, 'party-2', '2,-2,0'); s.world.tiles['0,0,0'].terrainId = 'plains';
  await load(s); await click('#end-turn'); const beforeAi = await save(); await page.clock.runFor(180); const afterAi = await save();
  assert.equal(afterAi.commandLog.at(-1).type, 'AttackCity'); assert.ok(afterAi.cities['city-1'].defense.hp < 100); assert.match(await page.locator('#ai-activity').innerText(), /攻城 1回/);
  assert.equal(await page.locator('#attack-city').isDisabled(), true); await load(beforeAi); await page.clock.runFor(180); assert.deepEqual(await save(), afterAi);
  checks.push('AI uses AttackCity and resumes the same seeded siege from a mid-turn save');

  const legacy = structuredClone(initial); delete legacy.cityDefenseVersion; Object.values(legacy.cities).forEach(city => { delete city.defense; }); await load(legacy);
  assert.equal(await page.locator('#siege-panel').isVisible(), false); assert.equal(await page.locator('[data-produce="walls"]').isVisible(), false); assert.match(await page.locator('#scenario-detail').innerText(), /旧ルール/); assert.deepEqual(await save(), legacy);
  checks.push('historical conquest stays unfortified and explains how to start the new siege mode');

  await load(s); await click('[data-select-party="party-1"]'); await select('#siege-city', 'city-2');
  await page.setViewportSize({ width: 390, height: 844 }); await page.locator('#siege-panel').scrollIntoViewIfNeeded(); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: path.join(output, 'siege-mobile.png') });
  await page.setViewportSize({ width: 1440, height: 1050 }); await page.locator('#city-panel').scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(output, 'city-durability-wide.png') });
  checks.push('wide and 390px layouts expose durability and siege controls without horizontal overflow');
  await select('#game-mode', 'ai-reinforcements'); await click('#reset'); assert.equal(await page.locator('#siege-panel').isVisible(), false); assert.equal(await page.locator('[data-buy="walls"]').isVisible(), false);
  checks.push('existing non-conquest modes hide unavailable siege and walls');
  assert.deepEqual(errors, []); assert.deepEqual(failures, []);
  const report = { verifiedAt: new Date().toISOString(), browser: await browser.version(), checks, pageErrors: errors, httpFailures: failures };
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2));
} finally { if (browser) await browser.close(); server.close(); }
