import { installHudNavigation } from './hud-navigation.mjs';
import { finishTurn, prepareTurnFixture } from './turn-flow-helpers.mjs';
// Optional real Chromium QA for magic targeting, resistance, shared protection, AI and saved continuation.
// Set KINGDOM_QA_MODULES and KINGDOM_BROWSER, then run:
// node tools/qa/browser-magic.mjs /tmp/kingdom-magic-qa
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { once } from 'node:events';

const root = fileURLToPath(new URL('../../', import.meta.url));
const output = path.resolve(process.argv[2] ?? '/tmp/kingdom-magic-qa');
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
  installHudNavigation(page);
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() >= 400 && !response.url().endsWith('favicon.ico')) failures.push(response.url()); });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => document.querySelector('#resources img'));
  await page.clock.install(); await page.clock.pauseAt(new Date());
  const click = selector => page.locator(selector).evaluate(element => element.click());
  const save = async () => { await click('#save'); return page.evaluate(() => JSON.parse(localStorage.getItem('kingdom-m1-save'))); };
  const load = async (value, valid = true) => { prepareTurnFixture(value); await page.evaluate(s => localStorage.setItem('kingdom-m1-save', JSON.stringify(s)), value); await click('#load'); if (valid) { assert.match(await page.locator('#message').innerText(), /セーブをロードしました/); await click('[data-select-party="party-1"]'); } };
  const select = async (selector, value) => page.locator(selector).evaluate((el, value) => { el.value = value; el.dispatchEvent(new Event('change', { bubbles: true })); }, value);
  const camera = () => page.evaluate(() => structuredClone(document.querySelector('#map')._layout));
  const choose = async (target = 'unit-6') => {
    await page.locator('#ability-caster').selectOption('unit-3');
    await page.locator('#ability-target').selectOption(target);
  };
  await select('#game-mode', 'ai-reinforcements'); await click('#reset');
  const fresh = await save(); assert.equal(fresh.activeAbilityVersion, 3);
  assert.equal(fresh.units['unit-3'].magicStrength, 18);
  assert.deepEqual(fresh.units['unit-3'].charges, { 'arcane-bolt': 3, 'arcane-wave': 2 });
  const fixture = structuredClone(fresh); fixture.scenarioId = 'magic-browser'; fixture.kingdoms['kingdom-2'].controllerType = 'human';
  fixture.activeAbilityVersion = 2;
  for (const u of Object.values(fixture.units)) { delete u.charges['arcane-wave']; delete u.abilityStates['arcane-wave']; }
  fixture.kingdoms['kingdom-1'].stockpiles.mana = 100;
  fixture.parties['party-2'].location = '2,-2,0'; fixture.parties['party-2'].guardOrders = {};
  for (const id of fixture.parties['party-2'].unitIds) {
    const u = fixture.units[id]; u.location = '2,-2,0'; u.coverPower = 0; u.tauntStrength = 0; u.evasion = 0;
  }
  fixture.units['unit-3'].accuracy = 1;
  fixture.units['unit-6'].resistance = 0; fixture.units['unit-6'].armor = 999;
  fixture.units['unit-7'].resistance = 25; fixture.units['unit-7'].armor = 999;
  fixture.parties['party-2'].guardOrders = { 'unit-7': { targetUnitId: 'unit-6', mode: 'share' } };
  await load(fixture); await choose();
  assert.match(await page.locator('#turn-tasks').innerText(), /魔弾/);
  await page.locator('#turn-tasks button').filter({ hasText: /^魔弾$/ }).click();
  assert.equal(await page.locator('#ability-kind').inputValue(), 'arcane-bolt');
  const options = await page.locator('#ability-target option').evaluateAll(options => options.map(o => o.value));
  assert.deepEqual(options, fixture.parties['party-2'].unitIds);
  const prediction = await page.locator('#ability-preview').innerText();
  assert.match(prediction, /魔法戦闘力 18.*命中率 100%.*反撃なし/); assert.match(prediction, /護衛/);
  const ranges = [...prediction.matchAll(/(unit-\d+): HP損失 (\d+)〜(\d+)/g)]; assert.equal(ranges.length, 2);
  assert.deepEqual(await save(), fixture);
  checks.push('new archers expose magic through public selectors, list only enemy targets, and preview each recipient without changing saved state or RNG');

  const cam = await camera(); await page.locator('#use-ability').focus(); await page.keyboard.press('Enter');
  const used = await save(); assert.deepEqual(await camera(), cam);
  assert.equal(used.kingdoms['kingdom-1'].stockpiles.mana, 94);
  assert.equal(used.units['unit-3'].charges['arcane-bolt'], 2);
  assert.equal(used.units['unit-3'].abilityStates['arcane-bolt'].usesRemaining, 0);
  assert.equal(used.parties['party-1'].activationState, 'ended'); assert.equal(used.parties['party-1'].attacksRemaining, 0);
  for (const [, id, min, max] of ranges) {
    const lost = fixture.units[id].currentHp - used.units[id].currentHp;
    assert.ok(lost >= Number(min) && lost <= Number(max), `${id} damage outside DOM prediction`);
  }
  assert.ok(used.units['unit-7'].currentHp > used.units['unit-6'].currentHp);
  assert.deepEqual(used.rng.territory, fixture.rng.territory); assert.notDeepEqual(used.rng.combat, fixture.rng.combat);
  assert.ok(used.eventLog.some(e => e.type === 'CombatDamage' && e.attackType === 'magic'));
  assert.ok(!used.eventLog.some(e => e.counter)); assert.match(await page.locator('#ability-log').innerText(), /魔弾.*総被害/);
  assert.equal(await page.locator('#use-ability').isDisabled(), true); await click('#use-ability'); assert.deepEqual(await save(), used);
  checks.push('keyboard casting pays once, applies individual resistance after Guard despite high armor, matches visible ranges and leaves the camera fixed');

  const oldMetadata = structuredClone(used); oldMetadata.eventLog.find(e => e.type === 'AbilityUsed').targetRow = 'front';
  await load(oldMetadata); assert.match(await page.locator('#ability-log').innerText(), /魔弾.*総被害/); assert.deepEqual(await save(), oldMetadata);
  await load(used); assert.deepEqual(await save(), used); await finishTurn(page); await finishTurn(page);
  const round = await save(); assert.equal(round.units['unit-3'].charges['arcane-bolt'], 2);
  assert.equal(round.units['unit-3'].abilityStates['arcane-bolt'].usesRemaining, 1);
  await load(fixture); await choose(); await page.locator('#use-ability').click(); assert.deepEqual(await save(), used);
  checks.push('cast save/load replays identically and round settlement restores uses without restoring finite charges');

  const intercept = structuredClone(fixture); intercept.parties['party-2'].guardOrders['unit-7'].mode = 'intercept';
  await load(intercept); await choose(); assert.match(await page.locator('#ability-preview').innerText(), /unit-7:.*割り込み/);
  await page.locator('#use-ability').click(); const interrupted = await save();
  assert.equal(interrupted.units['unit-6'].currentHp, 100); assert.ok(interrupted.units['unit-7'].currentHp < 100);
  assert.equal(interrupted.parties['party-2'].reactionCharges, 0);
  assert.equal(interrupted.units['unit-7'].guardCapacityRemaining, intercept.units['unit-7'].guardCapacityRemaining);
  checks.push('Intercept protects the selected target, consumes a reaction and uses the interceptor resistance');

  const cover = structuredClone(fixture); cover.parties['party-2'].guardOrders = {};
  cover.units['unit-3'].accuracy = 0; cover.units['unit-6'].coverPower = 0.25; cover.units['unit-7'].tauntStrength = 0.15;
  await load(cover); await choose('unit-8'); assert.match(await page.locator('#ability-preview').innerText(), /命中率 0%/);
  assert.match(await page.locator('#ability-preview').innerText(), /遮蔽/); assert.match(await page.locator('#ability-preview').innerText(), /挑発/);
  await page.locator('#use-ability').click(); const covered = await save();
  assert.equal(covered.units['unit-8'].currentHp, 100); assert.ok(covered.units['unit-6'].currentHp < 100);
  assert.ok(covered.eventLog.some(e => e.type === 'CombatMiss')); assert.ok(covered.eventLog.some(e => e.type === 'CombatCover'));
  cover.units['unit-6'].coverPower = 0;
  await load(cover); await choose('unit-8'); await page.locator('#use-ability').click(); const missed = await save();
  assert.equal(missed.eventLog.findLast(e => e.type === 'AbilityUsed').damage, 0);
  assert.equal(missed.kingdoms['kingdom-1'].stockpiles.mana, 94);
  checks.push('Cover and Taunt are visible; forced misses damage cover or disappear while still consuming mana and charges');

  for (const [reason, mutate] of [
    [/mana/, s => { s.kingdoms['kingdom-1'].stockpiles.mana = 5; }],
    [/チャージ/, s => { s.units['unit-3'].charges['arcane-bolt'] = 0; }],
    [/使用回数/, s => { s.units['unit-3'].abilityStates['arcane-bolt'].usesRemaining = 0; }],
    [/魔法戦闘力/, s => { s.units['unit-3'].magicStrength = 0; }],
    [/射程/, s => { s.parties['party-2'].location = '5,-5,0'; for (const id of s.parties['party-2'].unitIds) s.units[id].location = '5,-5,0'; }],
  ]) {
    const blocked = structuredClone(fixture); mutate(blocked); await load(blocked); await choose();
    assert.equal(await page.locator('#use-ability').isDisabled(), true); assert.match(await page.locator('#ability-preview').innerText(), reason);
    await click('#use-ability'); assert.deepEqual(await save(), blocked);
  }
  await load(used);
  for (const mutate of [s => { s.activeAbilityVersion = 1; }, s => { delete s.units['unit-3'].charges['arcane-bolt']; }, s => { s.eventLog.find(e => e.type === 'AbilityUsed').damage = -1; }]) {
    const corrupt = structuredClone(used); mutate(corrupt); await load(corrupt, false);
    assert.match(await page.locator('#message').innerText(), /セーブデータが不正/); assert.deepEqual(await save(), used);
  }
  const old = structuredClone(fixture); old.activeAbilityVersion = 1;
  for (const u of Object.values(old.units)) if (u.typeId === 'archer') { u.abilityStates = {}; u.charges = {}; u.magicStrength = 0; }
  await load(old); assert.deepEqual(await save(), old);
  assert.equal(await page.locator('#ability-caster option[value="unit-3"]').count(), 0);
  checks.push('illegal magic and malformed saves preserve live state; v1 saves do not acquire magic, power or charges');

  const ai = structuredClone(fixture); ai.kingdoms['kingdom-2'].controllerType = 'ai'; ai.kingdoms['kingdom-2'].stockpiles.mana = 100;
  await load(ai); const aiCam = await camera(); await finishTurn(page); const aiStart = await save();
  assert.equal(await page.locator('#ability-caster').isDisabled(), true);
  await page.clock.runFor(10000); const afterAi = await save();
  assert.ok(afterAi.commandLog.some(c => c.type === 'UseAbility' && c.playerId === 'kingdom-2' && c.payload.abilityId === 'arcane-bolt'));
  assert.match(await page.locator('#ai-activity').innerText(), /魔弾/); assert.deepEqual(await camera(), aiCam);
  await load(aiStart); await page.clock.runFor(10000); assert.deepEqual(await save(), afterAi);
  checks.push('AI casts through the shared command after handoff, names magic correctly, preserves the camera and resumes identically from a mid-turn save');

  await load(fixture); await choose(); await page.locator('#abilities').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(output, 'magic-wide.png') });
  await page.setViewportSize({ width: 390, height: 844 }); await page.locator('#abilities').scrollIntoViewIfNeeded();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: path.join(output, 'magic-mobile.png') });
  await page.locator('#use-ability').click(); assert.equal((await save()).units['unit-3'].charges['arcane-bolt'], 2);
  checks.push('desktop and mobile keep prediction inside the scrollable HUD drawer without horizontal overflow and allow the spell button to be reached');
  assert.deepEqual(errors, []); assert.deepEqual(failures, []);
  const report = { verifiedAt: new Date().toISOString(), browser: await browser.version(), checks, pageErrors: errors, httpFailures: failures };
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2));
} catch (error) {
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), checks, pageErrors: errors, httpFailures: failures, error: String(error.stack ?? error) }, null, 2) + '\n');
  throw error;
} finally { if (browser) await browser.close(); server.close(); }
