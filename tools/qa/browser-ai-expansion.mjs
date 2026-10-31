// Optional real Chromium QA for escorted AI expansion, founding and saved continuation.
// Set KINGDOM_QA_MODULES and KINGDOM_BROWSER, then run:
// node tools/qa/browser-ai-expansion.mjs /tmp/kingdom-ai-expansion-qa
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { once } from 'node:events';

import { createAiConquestGameState } from '../../src/core/scenarios.js';
import { createUnit } from '../../src/models/unit.js';
import { createParty } from '../../src/models/party.js';
import { RuleSystem } from '../../src/core/rule-system.js';
import { HumanController } from '../../src/core/human-controller.js';

function fixture() {
  const h = new HumanController('kingdom-1');
  let s = createAiConquestGameState(117);
  s = RuleSystem.execute(s,h.startTurn(s)).state; s = RuleSystem.execute(s,h.endTurn(s)).state;
  for (const tile of Object.values(s.world.tiles)) tile.terrainId = 'plains';
  for (const [id,key] of [['party-1','-7,7,0'],['party-2','6,-6,0']]) {
    const p = s.parties[id]; p.location = key; p.unitIds.forEach(id => { s.units[id].location = key; });
    Object.assign(p,{movementRemaining:0,movementMaximum:0,attacksRemaining:0,reactionCharges:0,activationState:'ended'});
  }
  const id = `unit-${s.nextIds.unit++}`, pid = `party-${s.nextIds.party++}`, owner = 'kingdom-2';
  const u = createUnit(id,owner,'warrior','4,-4,0');u.partyId=pid;s.units[id]=u;s.kingdoms[owner].unitIds.push(id);
  s.parties[pid]=createParty(pid,owner,[id],u.location);
  Object.assign(s.parties[pid],{movementRemaining:0,attacksRemaining:0,reactionCharges:0,activationState:'ended'});
  s.kingdoms[owner].stockpiles.gold=300;
  return s;
}

const root = fileURLToPath(new URL('../../', import.meta.url));
const output = path.resolve(process.argv[2] ?? '/tmp/kingdom-ai-expansion-qa');
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

  const step = () => page.clock.runFor(180), finish = () => page.clock.runFor(30000);
  await select('#game-mode','ai-conquest'); await click('#reset'); assert.equal((await save()).aiExpansionVersion,1);
  const initial=fixture(); await load(initial);
  assert.match(await page.locator('#ai-expansion-status').innerText(),/生存兵6体.*護衛.*3都市/);
  await step();const bought=await save();
  assert.equal(bought.commandLog.at(-1).type,'PurchaseCityItem');assert.equal(bought.commandLog.at(-1).payload.itemId,'settler');
  assert.equal(bought.kingdoms['kingdom-2'].stockpiles.gold,180);assert.match(await page.locator('#ai-activity').innerText(),/開拓者購入 1回/);
  checks.push('new conquest enables expansion and its scheduled AI buys a settler at full cost with a protected reserve');

  const staged=structuredClone(bought),escort=Object.values(staged.units).find(u=>u.ownerId==='kingdom-2'&&u.location==='4,-4,0'&&u.typeId==='warrior');
  delete staged.parties[escort.partyId];escort.partyId=null;await load(staged);await step();const formed=await save();
  const expedition=Object.values(formed.parties).find(p=>p.unitIds.some(id=>formed.units[id].typeId==='settler'));
  assert.ok(expedition);assert.equal(expedition.unitIds.length,2);await step();let arranged=await save();
  assert.equal(arranged.commandLog.at(-1).type,'SetFormation');await step();arranged=await save();assert.equal(arranged.commandLog.at(-1).type,'SetGuardOrder');
  await step();const moving=await save();assert.equal(moving.commandLog.at(-1).type,'MoveParty');assert.equal(moving.commandLog.at(-1).payload.partyId,expedition.id);
  assert.ok(moving.parties[expedition.id].movementRemaining<2);
  checks.push('waiting settler and escort form a single protected formation and spend real movement on an expansion route');

  await finish();const continued=await save();await load(moving);await finish();assert.deepEqual(await save(),continued);
  checks.push('mid-expedition save resumes identical AI decisions, locations, reserves and RNG');
  let completed=continued;
  for(let rounds=0;rounds<10&&completed.kingdoms['kingdom-2'].cityIds.length<2;rounds++){
    assert.equal(completed.activePlayerId,'kingdom-1');await click('#end-turn');await finish();completed=await save();
  }
  assert.ok(completed.kingdoms['kingdom-2'].cityIds.length>=2);assert.ok(completed.eventLog.some(e=>e.type==='CityFounded'&&e.ownerId==='kingdom-2'));
  const founded=completed.eventLog.find(e=>e.type==='CityFounded'&&e.ownerId==='kingdom-2');
  assert.equal(completed.units[founded.settlerUnitId],undefined);assert.ok(completed.parties[founded.partyId]);
  await load(completed);assert.deepEqual(await save(),completed);
  checks.push('scheduled turns reach a real FoundCity result, consume only the settler and preserve the new city across reload');

  const poor=fixture();poor.kingdoms['kingdom-2'].stockpiles.gold=24;await load(poor);await step();const queued=await save();
  assert.equal(queued.cities['city-2'].production.currentItemId,'settler');assert.equal(queued.kingdoms['kingdom-2'].stockpiles.gold,24);
  assert.match(await page.locator('#ai-activity').innerText(),/開拓者生産予約/);
  checks.push('poor but safe AI reserves ordinary settler production rather than free purchasing');

  const threatened=fixture(),enemy=threatened.parties['party-1'];enemy.location='2,-2,0';enemy.unitIds.forEach(id=>{threatened.units[id].location=enemy.location;});
  await load(threatened);await step();const defended=await save();assert.equal(defended.commandLog.at(-1).payload.itemId,'walls');
  assert.equal(Object.values(defended.units).some(u=>u.typeId==='settler'),false);
  checks.push('nearby enemy pressure preserves emergency wall priority over expansion');

  const old=fixture();delete old.aiExpansionVersion;await load(old);assert.match(await page.locator('#ai-expansion-status').innerText(),/旧セーブ.*開拓なし/);
  await step();assert.notEqual((await save()).commandLog.at(-1).payload.itemId,'settler');
  const valid=await save(),invalid=structuredClone(valid);invalid.aiExpansionVersion=2;await load(invalid,false);
  assert.match(await page.locator('#message').innerText(),/不正/);assert.deepEqual(await save(),valid);
  checks.push('old infrastructure saves retain non-expanding AI and invalid expansion versions reject atomically');

  await load(completed);await page.locator('#scenario-status').scrollIntoViewIfNeeded();
  await page.screenshot({path:path.join(output,'expansion-wide.png')});
  await page.locator('#scenario-status').screenshot({path:path.join(output,'expansion-panel.png')});
  await page.setViewportSize({width:390,height:844});await page.locator('#scenario-status').scrollIntoViewIfNeeded();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.screenshot({path:path.join(output,'expansion-mobile.png')});
  checks.push('policy and city activity remain readable at 1440px and 390px with no horizontal overflow');
  assert.deepEqual(errors,[]);assert.deepEqual(failures,[]);
  const report={verifiedAt:new Date().toISOString(),browser:await browser.version(),checks,pageErrors:errors,httpFailures:failures};
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
} catch(error) {
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify({checks,pageErrors:errors,httpFailures:failures,error:String(error.stack??error)},null,2)+'\n');throw error;
} finally {if(browser)await browser.close();server.close();}
