// Optional real Chromium QA for ranged targeting. Install Playwright separately.
// Set KINGDOM_QA_MODULES and KINGDOM_BROWSER, then run:
// node tools/qa/browser-ranged.mjs /tmp/kingdom-ranged-qa
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { once } from 'node:events';
const root = fileURLToPath(new URL('../../', import.meta.url));
const output = path.resolve(process.argv[2] ?? '/tmp/kingdom-ranged-qa');
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
const errors = [], failures = [], results = [];
try {
  browser = await chromium.launch({ headless: true, ...(process.env.KINGDOM_BROWSER ? { executablePath: process.env.KINGDOM_BROWSER } : {}) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } }), page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() >= 400 && !response.url().endsWith('favicon.ico')) failures.push(response.url()); });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => document.querySelector('#resources img'));
  const save = async () => { await page.click('#save'); return page.evaluate(() => JSON.parse(localStorage.getItem('kingdom-m1-save'))); };
  const fresh = async () => { await page.selectOption('#game-mode', 'ranged-duel'); await page.click('#reset'); await page.selectOption('#combat-target', 'party-2'); await page.selectOption('#attack-type', 'ranged'); };
  const footprint = async () => page.locator('.enemy-grid .attack-area').evaluateAll(cells => cells.map(cell => cell.dataset.enemySlot));
  for (const profile of ['normal', 'aimed', 'precise', 'row', 'column', 'area', 'pierce']) {
    await fresh(); const before = await save();
    assert.equal(before.scenarioId, 'ranged-duel'); assert.equal(Object.keys(before.units).length, 10);
    await page.selectOption('#attack-profile', profile);
    if (['aimed', 'precise'].includes(profile)) await page.selectOption('#attack-target-unit', 'unit-9');
    if (profile === 'row') await page.selectOption('#attack-target-row', 'rear');
    if (['column', 'pierce'].includes(profile)) await page.selectOption('#attack-target-column', 'center');
    if (profile === 'area') await page.selectOption('#attack-target-slot', 'middle-center');
    assert.deepEqual(await save(), before, `${profile}: targeting is state/RNG free`);
    assert.equal(await page.locator('#attack-party').isDisabled(), false, profile);
    const forecast = await page.locator('#combat-forecast').innerText();
    assert.match(forecast, /反撃なし/); assert.match(forecast, /主対象/);
    const slots = await footprint(); assert.ok(slots.length > 0, 'attack footprint shown');
    if (profile === 'row') assert.deepEqual(slots, ['rear-left', 'rear-center', 'rear-right']);
    if (['column', 'pierce'].includes(profile)) assert.deepEqual(slots, ['front-center', 'middle-center', 'rear-center']);
    if (profile === 'area') assert.deepEqual(new Set(slots), new Set(['front-center', 'middle-left', 'middle-center', 'middle-right', 'rear-center']));
    if (['aimed', 'precise'].includes(profile)) { assert.match(forecast, /命中率/); assert.match(forecast, /遮蔽: unit-7/); assert.match(forecast, /挑発: unit-6/); }
    await page.click('#attack-party'); const after = await save();
    assert.equal(after.parties['party-1'].attacksRemaining, 0); assert.equal(after.parties['party-1'].activationState, 'ended');
    assert.notDeepEqual(after.rng.combat, before.rng.combat);
    assert.equal(await page.locator('#attack-party').isDisabled(), true);
    const events = after.eventLog.slice(before.eventLog.length);
    assert.ok(events.some(event => event.type === 'CombatDamage' || event.type === 'CombatMiss'), 'shot resolved');
    assert.ok(events.filter(event => event.type === 'CombatDamage').every(event => !event.counter), 'ranged never counters');
    await page.click('#load'); assert.deepEqual(await save(), after, 'combat state survives load');
    assert.equal(await page.locator('#game-mode').inputValue(), 'ranged-duel');
    results.push({ profile, result: 'passed', forecast });
  }
  await fresh(); const targetBefore = await save();
  await page.selectOption('#attack-profile', 'aimed'); await page.selectOption('#attack-target-kind', 'slot');
  await page.selectOption('#attack-target-slot', 'rear-center'); assert.equal(await page.locator('#attack-party').isDisabled(), true, 'empty direct slot rejected');
  await page.click('[data-enemy-slot="rear-left"]'); assert.equal(await page.locator('#attack-target-slot').inputValue(), 'rear-left'); assert.equal(await page.locator('#attack-party').isDisabled(), false);
  await page.selectOption('#attack-target-kind', 'unit'); await page.click('[data-enemy-slot="middle-center"]'); assert.equal(await page.locator('#attack-target-unit').inputValue(), 'unit-8');
  await page.selectOption('#attack-profile', 'row'); await page.click('[data-enemy-slot="rear-right"]'); assert.equal(await page.locator('#attack-target-row').inputValue(), 'rear');
  await page.selectOption('#attack-profile', 'column'); await page.click('[data-enemy-slot="front-left"]'); assert.equal(await page.locator('#attack-target-column').inputValue(), 'left');
  await page.selectOption('#attack-profile', 'area'); await page.click('[data-enemy-slot="middle-left"]'); assert.equal(await page.locator('#attack-target-slot').inputValue(), 'middle-left');
  assert.equal(await page.locator('#attack-party').isDisabled(), false, 'empty cross center with live neighboring targets allowed');
  assert.deepEqual(await save(), targetBefore);
  assert.ok(await page.locator('.unit-type-badge').count() > 0, 'new units use readable badges');
  await page.locator('#combat-panel').screenshot({ path: path.join(output, 'targeting-desktop.png') });
  await page.evaluate(() => scrollTo(0, 0)); await page.screenshot({ path: path.join(output, 'desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no mobile horizontal overflow');
  await page.locator('#combat-panel').screenshot({ path: path.join(output, 'targeting-mobile.png') });
  await page.evaluate(() => scrollTo(0, 0)); await page.screenshot({ path: path.join(output, 'mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1050 });
  await fresh(); await page.click('#end-turn'); await page.click('[data-buy="archer"]');
  let economy = await save();
  assert.equal(economy.units['unit-11'].typeId, 'archer'); assert.equal(economy.units['unit-11'].ownerId, 'kingdom-2'); assert.equal(economy.units['unit-11'].location, '4,-4,0');
  await page.click('[data-produce="ballista"]');
  for (let turn = 0; turn < 24 && Object.values(economy.units).filter(unit => unit.ownerId === 'kingdom-2' && unit.typeId === 'ballista').length < 2; turn++) { await page.click('#end-turn'); economy = await save(); }
  const produced = Object.values(economy.units).find(unit => unit.ownerId === 'kingdom-2' && unit.typeId === 'ballista' && unit.partyId === null);
  assert.ok(produced, 'ballista completed through UI turns'); assert.equal(produced.location, '4,-4,0');
  await page.selectOption('#game-mode', 'duel'); await page.click('#reset'); await page.selectOption('#combat-target', 'party-2'); const legacy = await save();
  assert.equal(Object.keys(legacy.units).length, 6);
  await page.selectOption('#attack-type', 'ranged'); assert.equal(await page.locator('#attack-party').isDisabled(), true); assert.deepEqual(await save(), legacy);
  await page.selectOption('#attack-type', 'melee'); assert.equal(await page.locator('#attack-party').isDisabled(), false); await page.click('#attack-party');
  assert.ok((await save()).eventLog.some(event => event.type === 'CombatDamage' && event.counter), 'old melee counter retained');
  assert.deepEqual(errors, []); assert.deepEqual(failures, []);
  const report = { date: new Date().toISOString(), browser: await browser.version(), realBrowser: true, errors, failures,
    checks: ['seven attack profiles via UI', 'target preview has no state/RNG side effects', 'Unit and slot targeting', 'invalid empty direct slot', 'empty area center', 'grid click changes Unit/slot/row/column', 'attack footprint and HP forecast', 'ranged action exhaustion and no counter', 'save/load retains combat and mode', '390px layout', 'active-kingdom archer purchase', 'ballista production', 'legacy melee and invalid ranged'], results };
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report)); await context.close();
} finally { await browser?.close(); server.close(); }
