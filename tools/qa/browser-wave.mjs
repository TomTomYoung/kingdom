import { installHudNavigation } from './hud-navigation.mjs';
import { finishTurn, prepareTurnFixture } from './turn-flow-helpers.mjs';
// Optional real Chromium QA for row magic targeting, combined damage, AI and saved continuation.
// Set KINGDOM_QA_MODULES and KINGDOM_BROWSER, then run:
// node tools/qa/browser-wave.mjs /tmp/kingdom-wave-qa
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { once } from 'node:events';

const root = fileURLToPath(new URL('../../', import.meta.url));
const output = path.resolve(process.argv[2] ?? '/tmp/kingdom-wave-qa');
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
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } }), page = await context.newPage();
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
    await page.locator('#ability-kind').selectOption('arcane-wave');
    await page.locator('#ability-target').selectOption(target);
  };
  await select('#game-mode', 'ai-reinforcements'); await click('#reset');
  const fresh = await save(); assert.equal(fresh.activeAbilityVersion, 3);
  assert.deepEqual(fresh.units['unit-3'].charges, { 'arcane-bolt': 3, 'arcane-wave': 2 });
  const fixture = structuredClone(fresh); fixture.scenarioId = 'wave-browser'; fixture.kingdoms['kingdom-2'].controllerType = 'human';
  fixture.kingdoms['kingdom-1'].stockpiles.mana = 100;
  const enemy = fixture.parties['party-2']; enemy.location = '2,-2,0';
  enemy.formation = { 'front-center': 'unit-6', 'front-left': 'unit-7', 'front-right': 'unit-8', 'middle-center': 'unit-9', 'rear-center': 'unit-10' };
  enemy.guardOrders = { 'unit-7': { targetUnitId: 'unit-6', mode: 'share' } };
  for (const id of enemy.unitIds) Object.assign(fixture.units[id], { location: enemy.location, armor: 999, resistance: 0, evasion: 1, coverPower: 1, tauntStrength: 1 });
  fixture.units['unit-7'].resistance = 25; fixture.units['unit-3'].accuracy = 0;
  await load(fixture); await choose();
  assert.match(await page.locator('#turn-tasks').innerText(), /魔力波/);
  await page.locator('#turn-tasks button').filter({ hasText: /^魔力波$/ }).click();
  assert.equal(await page.locator('#ability-kind').inputValue(), 'arcane-wave');
  const prediction = await page.locator('#ability-preview').innerText();
  assert.match(prediction, /範囲内に必中.*反撃なし/); assert.match(prediction, /前列: unit-6、unit-7、unit-8（主対象 unit-6）/);
  assert.match(prediction, /60%/);
  const ranges = [...prediction.matchAll(/(unit-\d+): HP損失 (\d+)〜(\d+)/g)]; assert.equal(ranges.length, 3);
  assert.deepEqual(await save(), fixture);
  checks.push('public ability and task controls select the row spell, show its primary and complete footprint, and preserve saved state and RNG during preview');

  const cam = await camera(); await page.locator('#use-ability').focus(); await page.keyboard.press('Enter');
  const used = await save(); assert.deepEqual(await camera(), cam);
  assert.equal(used.kingdoms['kingdom-1'].stockpiles.mana, 90); assert.equal(used.units['unit-3'].charges['arcane-wave'], 1);
  assert.equal(used.units['unit-3'].charges['arcane-bolt'], 3); assert.equal(used.units['unit-3'].abilityStates['arcane-wave'].usesRemaining, 0);
  assert.equal(used.parties['party-1'].activationState, 'ended'); assert.equal(used.parties['party-1'].attacksRemaining, 0);
  for (const [, id, min, max] of ranges) {
    const lost = fixture.units[id].currentHp - used.units[id].currentHp; assert.ok(lost >= Number(min) && lost <= Number(max));
  }
  const guardDamage = used.eventLog.filter(e => e.type === 'CombatDamage' && e.targetUnitId === 'unit-7');
  assert.equal(guardDamage.length, 1); assert.deepEqual(guardDamage[0].roles, ['guard', 'area']);
  assert.equal(used.units['unit-9'].currentHp, 100); assert.equal(used.units['unit-10'].currentHp, 100);
  const event = used.eventLog.find(e => e.type === 'AbilityUsed'); assert.equal(event.targetRow, 'front'); assert.deepEqual(event.targetUnitIds, ['unit-6', 'unit-7', 'unit-8']);
  assert.ok(event.damage > event.rawDamage); assert.deepEqual(used.rng.territory, fixture.rng.territory);
  assert.equal(used.eventLog.some(e => ['CombatMiss', 'CombatCover', 'CombatTaunt'].includes(e.type)), false);
  assert.match(await page.locator('#ability-log').innerText(), /魔力波.*前列.*総被害/);
  assert.equal(await page.locator('#use-ability').isDisabled(), true); await click('#use-ability'); assert.deepEqual(await save(), used);
  checks.push('keyboard casting combines Guard and direct damage into one recipient event, matches DOM predictions, pays once, preserves bolt charges and never moves the camera');

  await load(used); assert.deepEqual(await save(), used); await finishTurn(page);
  assert.equal((await save()).units['unit-3'].abilityStates['arcane-wave'].usesRemaining, 0);
  await finishTurn(page); const round = await save(); assert.equal(round.units['unit-3'].abilityStates['arcane-wave'].usesRemaining, 1);
  assert.equal(round.units['unit-3'].charges['arcane-wave'], 1);
  await load(fixture); await choose(); await page.locator('#use-ability').click(); assert.deepEqual(await save(), used);
  checks.push('area history and charges round-trip exactly; handoff and round settlement restore only round uses and replay the same cast');

  const intercept = structuredClone(fixture); intercept.parties['party-2'].guardOrders['unit-7'].mode = 'intercept';
  await load(intercept); await choose(); assert.match(await page.locator('#ability-preview').innerText(), /unit-7:.*割り込み.*範囲内/);
  await page.locator('#use-ability').click(); const interrupted = await save();
  assert.equal(interrupted.units['unit-6'].currentHp, 100); assert.equal(interrupted.parties['party-2'].reactionCharges, 0);
  assert.equal(interrupted.units['unit-7'].guardCapacityRemaining, 50);
  assert.deepEqual(interrupted.eventLog.find(e => e.type === 'CombatDamage' && e.targetUnitId === 'unit-7').roles, ['intercept', 'area']);
  await load(fixture); await choose('unit-8'); assert.match(await page.locator('#ability-preview').innerText(), /主対象 unit-8/);
  await page.locator('#use-ability').click(); const changedPrimary = await save();
  assert.equal(changedPrimary.eventLog.some(e => e.type === 'CombatGuard'), false);
  await load(fixture); await choose('unit-10'); assert.match(await page.locator('#ability-preview').innerText(), /後列: unit-10/);
  await page.locator('#use-ability').click(); assert.deepEqual((await save()).eventLog.find(e => e.type === 'AbilityUsed').targetUnitIds, ['unit-10']);
  checks.push('Intercept combines its own area hit with the redirected primary; changing the anchor changes the protected primary or selects a different row without spreading through empty slots');

  for (const [reason, mutate] of [
    [/mana/, s => { s.kingdoms['kingdom-1'].stockpiles.mana = 9; }],
    [/チャージ/, s => { s.units['unit-3'].charges['arcane-wave'] = 0; }],
    [/使用回数/, s => { s.units['unit-3'].abilityStates['arcane-wave'].usesRemaining = 0; }],
    [/攻撃回数/, s => { s.parties['party-1'].attacksRemaining = 0; }],
    [/射程/, s => { s.parties['party-2'].location = '5,-5,0'; for (const id of s.parties['party-2'].unitIds) s.units[id].location = '5,-5,0'; }],
  ]) {
    const blocked = structuredClone(fixture); mutate(blocked); await load(blocked); await choose();
    assert.equal(await page.locator('#use-ability').isDisabled(), true); assert.match(await page.locator('#ability-preview').innerText(), reason);
    await click('#use-ability'); assert.deepEqual(await save(), blocked);
  }
  const dead = structuredClone(fixture); dead.units['unit-6'].hp = dead.units['unit-6'].currentHp = 0; dead.units['unit-6'].status = 'shattered';
  await load(dead); await choose('unit-8'); assert.equal(await page.locator('#ability-target option[value="unit-6"]').count(), 0);
  assert.doesNotMatch(await page.locator('#ability-preview').innerText(), /unit-6/);
  checks.push('shortages and range restrictions disable casting without changing state; HP-zero anchors disappear from target choices and the affected row');

  await load(used);
  for (const mutate of [s => { s.activeAbilityVersion = 2; }, s => { delete s.units['unit-3'].charges['arcane-wave']; }, s => { s.eventLog.find(e => e.type === 'AbilityUsed').targetUnitIds = ['unit-6', 'unit-6']; }]) {
    const corrupt = structuredClone(used); mutate(corrupt); await load(corrupt, false);
    assert.match(await page.locator('#message').innerText(), /セーブデータが不正/); assert.deepEqual(await save(), used);
  }
  const old = structuredClone(fixture); old.activeAbilityVersion = 2;
  for (const u of Object.values(old.units)) { delete u.charges['arcane-wave']; delete u.abilityStates['arcane-wave']; }
  await load(old); await page.locator('#ability-caster').selectOption('unit-3'); assert.equal(await page.locator('#ability-kind option[value="arcane-wave"]').count(), 0);
  assert.equal(await page.locator('#ability-kind').inputValue(), 'arcane-bolt'); assert.deepEqual(await save(), old);
  checks.push('malformed footprint, partial charges and version downgrade are rejected; valid v2 saves retain only the old spell without learning or refilling');

  const ai = structuredClone(fixture); ai.kingdoms['kingdom-2'].controllerType = 'ai'; ai.kingdoms['kingdom-2'].stockpiles.mana = 100;
  await load(ai); const aiCam = await camera(); await finishTurn(page); const aiStart = await save();
  assert.equal(await page.locator('#ability-caster').isDisabled(), true);
  await page.clock.runFor(10000); const afterAi = await save();
  assert.ok(afterAi.commandLog.some(c => c.type === 'UseAbility' && c.playerId === 'kingdom-2' && c.payload.abilityId === 'arcane-wave'));
  assert.match(await page.locator('#ai-activity').innerText(), /魔力波/); assert.deepEqual(await camera(), aiCam);
  await load(aiStart); await page.clock.runFor(10000); assert.deepEqual(await save(), afterAi);
  checks.push('AI uses the area spell through shared commands after handoff, displays its name, keeps the camera fixed and resumes identically from a mid-turn save');

  await load(fixture); await choose(); await page.locator('#use-ability').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(output, 'wave-wide.png') });
  await page.setViewportSize({ width: 390, height: 844 }); await page.locator('#abilities').scrollIntoViewIfNeeded();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: path.join(output, 'wave-mobile-controls.png') });
  await page.locator('#use-ability').scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(output, 'wave-mobile-preview.png') });
  await page.locator('#use-ability').click(); assert.equal((await save()).units['unit-3'].charges['arcane-wave'], 1);
  checks.push('1440x900 and 390x844 keep the map and turn controls fixed while the ability drawer scrolls to the footprint, damage ranges and usable cast button');
  assert.deepEqual(errors, []); assert.deepEqual(failures, []);
  const report = { verifiedAt: new Date().toISOString(), browser: await browser.version(), checks, pageErrors: errors, httpFailures: failures };
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2));
} catch (error) {
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), checks, pageErrors: errors, httpFailures: failures, error: String(error.stack ?? error) }, null, 2) + '\n');
  throw error;
} finally { if (browser) await browser.close(); server.close(); }
