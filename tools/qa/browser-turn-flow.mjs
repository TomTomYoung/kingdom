import { finishTurn, prepareTurnFixture } from './turn-flow-helpers.mjs';
// Optional real Chromium QA for turn decisions, end-of-round settlement and a stable map camera.
// Set KINGDOM_QA_MODULES and KINGDOM_BROWSER, then run:
// node tools/qa/browser-abilities.mjs /tmp/kingdom-turn-flow-qa
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { once } from 'node:events';

const root = fileURLToPath(new URL('../../', import.meta.url));
const output = path.resolve(process.argv[2] ?? '/tmp/kingdom-turn-flow-qa');
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
  const load = async value => { await page.evaluate(s => localStorage.setItem('kingdom-m1-save', JSON.stringify(s)), value); await click('#load'); assert.match(await page.locator('#message').innerText(), /セーブをロードしました/); };
  const fresh = async mode => { await page.selectOption('#game-mode', mode); await click('#reset'); return save(); };
  const camera = () => page.evaluate(() => structuredClone(document.querySelector('#map')._layout));
  const move = async key => page.evaluate(key => {
    const canvas = document.querySelector('#map'), { size, center } = canvas._layout, rect = canvas.getBoundingClientRect();
    const [q, r] = key.split(',').map(Number);
    canvas.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, button: 2, clientX: rect.left + center.x + size * Math.sqrt(3) * (q + r / 2), clientY: rect.top + center.y + size * 1.5 * r }));
  }, key);
  let s = await save();
  assert.equal(s.turnFlowVersion, 1); assert.equal(s.lastSettledTurn, 0);
  assert.equal(s.eventLog.filter(e => e.type === 'YieldCollected').length, 0);
  assert.equal(await page.locator('[data-turn-task]').count(), 3);
  assert.equal(await page.locator('#end-turn').isDisabled(), true);
  await click('#end-turn'); assert.deepEqual(await save(), s);
  checks.push('new game lists party, production and research; disabled EndTurn changes nothing and no initial free income is collected');

  await page.locator('[data-skip-task="party:party-1"]').focus(); await page.keyboard.press('Enter');
  const skipped = await save(); assert.deepEqual(skipped.turnTasks.skipped, ['party:party-1']);
  assert.equal(await page.locator('#end-turn').isDisabled(), true);
  await load(skipped); assert.deepEqual(await save(), skipped);
  await click('[data-resume-task="party:party-1"]'); assert.deepEqual((await save()).turnTasks.skipped, []);
  checks.push('keyboard individual skip persists across load, does not clear other decisions, and can be undone');

  s = await fresh('settlement'); await click('#zoom-in');
  await page.locator('#map').focus(); await page.keyboard.press('ArrowRight');
  const beforeMove = await camera(); await move('1,0,-1');
  assert.equal((await save()).parties['party-1'].location, '1,0,-1'); assert.deepEqual(await camera(), beforeMove);
  assert.ok(await page.locator('[data-turn-task="party:party-1"]').count());
  await move('2,0,-2'); assert.equal((await save()).parties['party-1'].location, '2,0,-2'); assert.deepEqual(await camera(), beforeMove);
  await click('#next-turn-action'); assert.deepEqual(await camera(), beforeMove);
  await click('#focus-party'); assert.notDeepEqual(await camera(), beforeMove);
  checks.push('right-click moves and next-decision navigation retain the panned/zoomed camera; explicit focus still works');

  s = await fresh('duel'); await click('[data-produce="warrior"]');
  await page.selectOption('#research-target', 'writing'); await click('#research-select');
  assert.equal(await page.locator('[data-turn-task]').count(), 1);
  await click('[data-skip-task="party:party-1"]'); assert.equal(await page.locator('#end-turn').isEnabled(), true);
  const beforeHandoff = await save(), beforeCamera = await camera(); await click('#end-turn');
  const handed = await save(); assert.equal(handed.activePlayerId, 'kingdom-2'); assert.equal(handed.currentTurn, 1);
  assert.deepEqual(handed.kingdoms, beforeHandoff.kingdoms); assert.deepEqual(handed.cities, beforeHandoff.cities); assert.deepEqual(await camera(), beforeCamera);
  assert.equal(await page.locator('#end-turn').isDisabled(), true); assert.equal(await page.locator('[data-skip-task]').count(), 3);
  await finishTurn(page); const settled = await save(); assert.equal(settled.currentTurn, 2); assert.equal(settled.lastSettledTurn, 1);
  assert.equal(settled.eventLog.filter(e => e.type === 'TurnSettled').length, 1); assert.ok(settled.cities['city-1'].production.progressByItem.warrior > 0);
  assert.ok(settled.kingdoms['kingdom-1'].research.progressByTechnology.writing > 0);
  assert.equal(settled.turnTasks.skipped.length, 0); assert.deepEqual(await camera(), beforeCamera);
  await load(handed); await finishTurn(page); assert.deepEqual(await save(), settled);
  checks.push('hotseat decisions are independent; last player settles production/research/resources once and save continuation is identical');

  s = await fresh('ai-skirmish'); await click('#zoom-in'); await page.locator('#map').focus(); await page.keyboard.press('ArrowRight');
  const aiCamera = await camera(); await finishTurn(page); const midAi = await save();
  assert.equal(midAi.activePlayerId, 'kingdom-2'); assert.equal(await page.locator('#end-turn').isDisabled(), true);
  assert.equal(await page.locator('[data-skip-task]').count(), 0);
  await page.clock.runFor(10000); const done = await save();
  assert.equal(done.activePlayerId, 'kingdom-1'); assert.equal(done.currentTurn, 2); assert.deepEqual(await camera(), aiCamera);
  assert.ok(done.commandLog.some(c => c.playerId === 'kingdom-2' && c.type === 'SkipTurnAction'));
  assert.equal(done.eventLog.filter(e => e.type === 'TurnSettled').length, 1);
  await load(midAi); await page.clock.runFor(10000); assert.deepEqual(await save(), done);
  checks.push('NPC moves, attacks and individual skips run only after player EndTurn, never move the camera, and resume deterministically');

  const old = await fresh('single'); delete old.turnFlowVersion; delete old.turnTasks; delete old.lastSettledTurn;
  const beforeOld = structuredClone(old); await load(old); const migrated = await save();
  assert.equal(migrated.turnFlowVersion, 1); assert.deepEqual(migrated.kingdoms, beforeOld.kingdoms); assert.deepEqual(migrated.rng, beforeOld.rng);
  assert.deepEqual(migrated.eventLog, beforeOld.eventLog); assert.equal(await page.locator('#end-turn').isDisabled(), true);
  const corrupt = structuredClone(migrated); corrupt.turnTasks.turn++;
  await page.evaluate(s => localStorage.setItem('kingdom-m1-save', JSON.stringify(s)), corrupt); await click('#load');
  assert.match(await page.locator('#message').innerText(), /不正/); assert.deepEqual(await save(), migrated);
  checks.push('old playable saves gain the new decision flow without rewards or RNG changes; corrupted task metadata leaves the current game intact');

  for (const mode of ['single', 'two-cities', 'settlement', 'duel', 'ranged-duel', 'ai-skirmish', 'ai-reinforcements', 'ai-conquest']) {
    const freshState = await fresh(mode); assert.equal(freshState.turnFlowVersion, 1); assert.equal(freshState.lastSettledTurn, 0);
    assert.ok(await page.locator('[data-turn-task]').count()); assert.equal(await page.locator('#end-turn').isDisabled(), true);
  }
  checks.push('all eight new-game modes use the same decision list and completion gate');
  await fresh('single'); await page.locator('#turn-tasks').scrollIntoViewIfNeeded();
  await page.locator('#turn-tasks').screenshot({ path: path.join(output, 'turn-tasks-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 }); await page.locator('#turn-tasks').scrollIntoViewIfNeeded();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: path.join(output, 'turn-tasks-mobile.png') });
  await finishTurn(page); assert.equal((await save()).currentTurn, 2);
  checks.push('desktop/mobile task controls are visible without overflow and mobile individual skips complete a turn');
  assert.deepEqual(errors, []); assert.deepEqual(failures, []);
  const report = { verifiedAt: new Date().toISOString(), browser: await browser.version(), checks, pageErrors: errors, httpFailures: failures };
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2));
} catch (error) {
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), checks, pageErrors: errors, httpFailures: failures, error: String(error.stack ?? error) }, null, 2) + '\n');
  throw error;
} finally { if (browser) await browser.close(); server.close(); }
