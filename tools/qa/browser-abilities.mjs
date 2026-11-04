// Optional real Chromium QA for active ability controls, costs, counters and saved continuation.
// Set KINGDOM_QA_MODULES and KINGDOM_BROWSER, then run:
// node tools/qa/browser-abilities.mjs /tmp/kingdom-abilities-qa
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { once } from 'node:events';

const root = fileURLToPath(new URL('../../', import.meta.url));
const output = path.resolve(process.argv[2] ?? '/tmp/kingdom-abilities-qa');
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
  const oldSingle = await save(); assert.equal(Object.hasOwn(oldSingle, 'activeAbilityVersion'), false);
  assert.match(await page.locator('#abilities').innerText(), /新規/);
  await select('#game-mode', 'ai-reinforcements'); await click('#reset');
  const fresh = await save(); assert.equal(fresh.activeAbilityVersion, 1);
  assert.deepEqual(fresh.units['unit-1'].charges, { heal: 3 });
  assert.equal(await page.locator('#use-ability').isDisabled(), true);
  const fixture = structuredClone(fresh); fixture.scenarioId = 'ability-browser'; fixture.kingdoms['kingdom-2'].controllerType = 'human';
  fixture.kingdoms['kingdom-1'].stockpiles.mana = 20; fixture.units['unit-3'].hp = fixture.units['unit-3'].currentHp = 40;
  await load(fixture); assert.equal(await page.locator('#use-ability').isEnabled(), true);
  assert.match(await page.locator('#ability-preview').innerText(), /40 → 70/);
  await select('#ability-caster', 'unit-2'); await select('#ability-target', 'unit-1');
  assert.equal(await page.locator('#use-ability').isDisabled(), true); assert.match(await page.locator('#ability-preview').innerText(), /満タン/);
  await select('#ability-target', 'unit-3'); assert.deepEqual(await save(), fixture);
  await page.locator('#use-ability').focus(); await page.keyboard.press('Enter');
  const used = await save(); assert.equal(used.units['unit-3'].hp, 70); assert.equal(used.kingdoms['kingdom-1'].stockpiles.mana, 16);
  assert.equal(used.units['unit-2'].charges.heal, 2); assert.equal(used.units['unit-2'].abilityStates.heal.usesRemaining, 0);
  assert.equal(used.parties['party-1'].activationState, 'ended'); assert.equal(used.parties['party-1'].attacksRemaining, 0);
  assert.deepEqual(used.rng, fixture.rng); assert.match(await page.locator('#ability-log').innerText(), /unit-2.*unit-3.*30/);
  assert.equal(await page.locator('#use-ability').isDisabled(), true);
  checks.push('new mode exposes caster/target selection and exact prediction; keyboard cast pays all costs once with a visible log');

  await load(used); assert.deepEqual(await save(), used);
  await click('#end-turn'); const handed = await save(); assert.equal(handed.units['unit-2'].abilityStates.heal.usesRemaining, 0);
  await click('#end-turn'); const nextRound = await save();
  assert.equal(nextRound.units['unit-2'].abilityStates.heal.usesRemaining, 1); assert.equal(nextRound.units['unit-2'].charges.heal, 2);
  await load(used); await click('#end-turn'); await click('#end-turn'); assert.deepEqual(await save(), nextRound);
  checks.push('save/load and player handoff retain charges; only round start replenishes per-round uses and replay is identical');

  const capped = structuredClone(fixture); capped.units['unit-3'].hp = capped.units['unit-3'].currentHp = 95;
  await load(capped); assert.match(await page.locator('#ability-preview').innerText(), /95 → 100.*\+5/);
  await click('#use-ability'); assert.equal((await save()).units['unit-3'].hp, 100);
  const dead = structuredClone(fixture); dead.units['unit-3'].hp = dead.units['unit-3'].currentHp = 0; dead.units['unit-3'].status = 'shattered';
  await load(dead); await select('#ability-target', 'unit-3'); assert.equal(await page.locator('#use-ability').isDisabled(), true);
  assert.match(await page.locator('#ability-preview').innerText(), /HPが残る/);
  checks.push('capped healing matches preview and HP-zero targets cannot be revived');

  for (const [reason, mutate] of [
    [/mana/, s => { s.kingdoms['kingdom-1'].stockpiles.mana = 3; }],
    [/チャージ/, s => { s.units['unit-1'].charges.heal = 0; }],
    [/使用回数/, s => { s.units['unit-1'].abilityStates.heal.usesRemaining = 0; }],
    [/stun/, s => { s.units['unit-1'].statusEffects = ['stun']; }],
    [/移動力/, s => { s.parties['party-1'].movementRemaining = 0; }],
    [/攻撃回数/, s => { s.parties['party-1'].attacksRemaining = 0; }],
  ]) {
    const blocked = structuredClone(fixture); mutate(blocked); await load(blocked);
    assert.equal(await page.locator('#use-ability').isDisabled(), true); assert.match(await page.locator('#ability-preview').innerText(), reason);
    await click('#use-ability'); assert.deepEqual(await save(), blocked);
  }
  checks.push('mana, finite charges, round uses, status, movement and attack shortages show reasons and preserve state');

  await load(used);
  for (const mutate of [s => { s.activeAbilityVersion = 2; }, s => { delete s.units['unit-1'].charges.heal; }, s => { s.units['unit-1'].charges.heal = 4; }]) {
    const corrupt = structuredClone(used); mutate(corrupt); await load(corrupt, false);
    assert.match(await page.locator('#message').innerText(), /セーブデータが不正/); assert.deepEqual(await save(), used);
  }
  checks.push('invalid version and partial or out-of-bounds ability saves are rejected before replacing the live game');

  const legacy = structuredClone(fixture); delete legacy.activeAbilityVersion;
  for (const unit of Object.values(legacy.units)) { unit.charges = {}; unit.abilityStates = {}; }
  await load(legacy); assert.equal(await page.locator('#use-ability').count(), 0); assert.deepEqual(await save(), legacy);
  await click('#end-turn'); await click('#end-turn'); assert.equal(Object.hasOwn(await save(), 'activeAbilityVersion'), false);
  await load(fixture); await click('[data-buy="warrior"]'); const bought = await save();
  assert.deepEqual(bought.units[`unit-${fixture.nextIds.unit}`].charges, { heal: 3 });
  checks.push('legacy games stay unchanged; newly purchased warriors in enabled games receive their own charges');

  const aiFixture = structuredClone(fixture); aiFixture.kingdoms['kingdom-2'].controllerType = 'ai';
  aiFixture.parties['party-2'].location = '2,-2,0'; aiFixture.parties['party-2'].unitIds.forEach(id => { aiFixture.units[id].location = '2,-2,0'; });
  aiFixture.kingdoms['kingdom-2'].stockpiles.mana = 20; aiFixture.units['unit-8'].hp = aiFixture.units['unit-8'].currentHp = 30;
  await load(aiFixture); await click('#end-turn'); const aiStart = await save();
  assert.equal(await page.locator('#use-ability').isDisabled(), true); assert.equal(await page.locator('#ability-caster').isDisabled(), true);
  await page.clock.runFor(10000); const aiAfter = await save();
  assert.ok(aiAfter.commandLog.some(c => c.type === 'UseAbility' && c.playerId === 'kingdom-2'));
  assert.equal(aiAfter.units['unit-8'].hp, 60); assert.match(await page.locator('#ai-activity').innerText(), /治癒/);
  await load(aiStart); await page.clock.runFor(10000); assert.deepEqual(await save(), aiAfter);
  checks.push('AI handoff disables controls, heals under threat using the shared command and resumes identically from a mid-turn save');

  const ending = structuredClone(fixture); ending.currentTurn = ending.scenarioObjective.turnLimit; ending.lastProcessedTurn = ending.currentTurn;
  await load(ending); await click('#end-turn'); await click('#end-turn'); const ended = await save(); assert.ok(ended.gameResult);
  assert.equal(await page.locator('#use-ability').isDisabled(), true); await click('#use-ability'); assert.deepEqual(await save(), ended);
  checks.push('game-over locks ability controls without spending resources or changing the finished game');

  await load(fixture); await page.locator('#abilities').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(output, 'abilities-wide.png') });
  await page.locator('#abilities').screenshot({ path: path.join(output, 'abilities-panel.png') });
  await page.setViewportSize({ width: 390, height: 844 }); await page.locator('#abilities').scrollIntoViewIfNeeded();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: path.join(output, 'abilities-mobile.png') });
  await page.locator('#use-ability').focus(); await page.keyboard.press('Enter'); assert.equal((await save()).units['unit-3'].hp, 70);
  checks.push('1440px and 390px render costs, counters, targets and prediction without horizontal overflow; mobile keyboard action works');
  assert.deepEqual(errors, []); assert.deepEqual(failures, []);
  const report = { verifiedAt: new Date().toISOString(), browser: await browser.version(), checks, pageErrors: errors, httpFailures: failures };
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2));
} catch (error) {
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), checks, pageErrors: errors, httpFailures: failures, error: String(error.stack ?? error) }, null, 2) + '\n');
  throw error;
} finally { if (browser) await browser.close(); server.close(); }
