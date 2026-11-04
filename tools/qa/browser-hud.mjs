// Viewport and navigation acceptance tests: real clicks, no automatic navigation adapter.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { once } from 'node:events';

const root = fileURLToPath(new URL('../../', import.meta.url));
const output = path.resolve(process.argv[2] ?? '/tmp/kingdom-hud-qa');
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

  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() >= 400 && !response.url().endsWith('favicon.ico')) failures.push(response.url()); });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => document.querySelector('#resources img'));
  
  const open = async view => {
    if (!await page.locator('#hud-drawer').isVisible()) await page.locator('.hud-nav [data-hud-open="menu"]').click();
    await page.selectOption('#hud-view-select', view);
  };
  const close = async () => { if (await page.locator('#hud-drawer').isVisible()) await page.click('#hud-close'); };
  const save = async () => { await open('menu'); await page.click('#save'); const s = await page.evaluate(() => JSON.parse(localStorage.getItem('kingdom-m1-save'))); await close(); return s; };
  const fresh = async mode => { await open('menu'); await page.selectOption('#game-mode', mode); await page.click('#reset'); };
  const camera = () => page.evaluate(() => structuredClone(document.querySelector('#map')._layout));
  const frame = () => page.evaluate(() => {
    const box = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { x:r.x, y:r.y, width:r.width, height:r.height, bottom:r.bottom }; };
    return { width:innerWidth, height:innerHeight, scrollWidth:document.documentElement.scrollWidth, scrollHeight:document.documentElement.scrollHeight,
      top:box('.hud-topbar'), map:box('#map'), footer:box('.hud-bottom'), turn:box('.hud-turn-control') };
  });
  const checkFrame = async (minMap) => {
    const f = await frame();
    assert.ok(f.scrollWidth <= f.width + 1 && f.scrollHeight <= f.height + 1, JSON.stringify(f));
    assert.ok(f.map.height >= minMap, JSON.stringify(f));
    assert.ok(f.turn.y >= f.map.bottom && f.turn.bottom <= f.height + 1, JSON.stringify(f));
    assert.equal(f.map.width, f.width); return f;
  };
  assert.equal(await page.locator('#hud-drawer').isVisible(), false);
  assert.match(await page.locator('#hud-task-count').innerText(), /未処理 3件/);
  assert.equal(await page.locator('#end-turn').isVisible(), false);
  const original = await save();
  for (const [width,height,minMap,label] of [[1440,900,650,'desktop'],[1366,768,530,'laptop'],[390,844,550,'mobile'],[844,390,200,'landscape']]) {
    await page.setViewportSize({width,height}); await page.waitForFunction(() => document.querySelector('#map').width > 0);
    const before = await checkFrame(minMap), cam = await camera();
    await page.screenshot({path:path.join(output,`hud-${label}.png`)});
    await open('production'); assert.deepEqual((await frame()).map,before.map); assert.deepEqual(await camera(),cam);
    assert.equal(await page.locator('[data-hud-view]:visible').count(),1);
    await checkFrame(minMap);
    const drawer = await page.locator('#hud-drawer').boundingBox(); assert.ok(drawer.y >= before.top.bottom && drawer.y+drawer.height <= before.footer.y+1);
    await page.locator('[data-produce="monument"]').scrollIntoViewIfNeeded();
    assert.ok(await page.evaluate(() => document.querySelector('#hud-drawer-body').scrollTop > 0));
    assert.deepEqual((await frame()).map,before.map); assert.deepEqual(await camera(),cam);
    await page.screenshot({path:path.join(output,`production-${label}.png`)}); await close();
  }
  checks.push('desktop, laptop, mobile and short landscape fit the viewport; only the detail body scrolls and opening panels preserves map geometry/camera');
  await page.setViewportSize({width:1440,height:900});
  for (const view of await page.locator('#hud-view-select option').evaluateAll(options=>options.map(o=>o.value))) {
    await open(view); assert.equal(await page.locator('[data-hud-view]:visible').count(),1);
    assert.equal(await page.locator('#hud-drawer').getAttribute('data-view'),view); await close();
  }
  assert.deepEqual(await save(), original);
  checks.push('all management views remain reachable, one panel at a time, without changing game state, logs or RNG');
  await page.locator('.hud-nav [data-hud-open="research"]').click(); await page.keyboard.press('Escape');
  assert.equal(await page.locator('#hud-drawer').isVisible(),false);
  assert.equal(await page.locator('.hud-nav [data-hud-open="research"]').evaluate(el=>el===document.activeElement),true);
  await page.locator('.hud-nav [data-hud-open="city"]').click();
  assert.equal(await page.locator('#hud-context-actions [data-hud-open="production"]').isVisible(),true);
  assert.equal(await page.locator('#hud-context-actions [data-hud-open="combat"]').isVisible(),false);
  await open('roster'); await page.click('[data-select-party="party-1"]'); await close();
  assert.equal(await page.locator('#hud-context-actions [data-hud-open="combat"]').isVisible(),true);
  assert.equal(await page.locator('#hud-context-actions [data-hud-open="production"]').isVisible(),false);
  checks.push('Escape closes details and restores focus; selecting city versus party switches the bottom action strip');
  await page.click('#hud-context-actions [data-hud-open="formation"]');
  assert.equal(await page.locator('#formation').isVisible(),true); await close();
  await page.click('#hud-context-actions [data-hud-open="abilities"]');
  assert.equal(await page.locator('#abilities').isVisible(),true); await close();
  await fresh('single');
  await page.click('#zoom-in'); await page.locator('#map').focus(); await page.keyboard.press('ArrowRight');
  const beforeNext = await camera(); await page.click('#next-turn-action');
  assert.equal(await page.locator('#hud-drawer').isVisible(),false); assert.deepEqual(await camera(),beforeNext);
  await page.click('#skip-current-action');
  await page.click('#next-turn-action'); assert.equal(await page.locator('#hud-drawer').getAttribute('data-view'),'production');
  assert.equal(await page.locator('.production-item').filter({has:page.locator('[data-produce="warrior"]')}).locator('[data-buy="warrior"]').count(),1);
  await page.click('[data-produce="warrior"]');
  await page.click('#next-turn-action'); assert.equal(await page.locator('#hud-drawer').getAttribute('data-view'),'research');
  await page.selectOption('#research-target','writing'); await page.click('#research-select');
  assert.equal(await page.locator('#next-turn-action').isVisible(),false);
  assert.equal(await page.locator('#end-turn').isEnabled(),true); assert.equal(await page.locator('#end-turn').isVisible(),true);
  await page.click('#hud-task-count'); await page.click('[data-resume-task="party:party-1"]');
  assert.equal(await page.locator('#end-turn').isVisible(),false); await page.click('[data-skip-task="party:party-1"]'); await close();
  assert.deepEqual(await camera(),beforeNext); await page.click('#end-turn');
  const settled=await save(); assert.equal(settled.currentTurn,2); assert.equal(settled.lastSettledTurn,1);
  assert.ok(settled.cities['city-1'].production.progressByItem.warrior > 0); assert.ok(settled.kingdoms['kingdom-1'].research.progressByTechnology.writing > 0);
  assert.deepEqual(await camera(),beforeNext);
  checks.push('persistent Next/Skip visits party, production and research; individual undo restores the gate; completing decisions enables settlement without moving the camera');
  await open('menu'); await page.click('#load'); assert.equal(await page.locator('#hud-drawer').isVisible(),false);
  assert.deepEqual(await save(),settled);
  await fresh('duel'); await page.click('#hud-context-actions [data-hud-open="combat"]');
  await page.selectOption('#combat-target','party-2'); assert.equal(await page.locator('#attack-party').isEnabled(),true);
  await page.click('#attack-party'); assert.ok((await save()).commandLog.some(c=>c.type==='AttackParty'));
  checks.push('save/load/new game and actual combat remain reachable through the new public controls');
  await page.setViewportSize({width:390,height:844}); await fresh('single');
  for (let i=0;i<3;i++) await page.click('#skip-current-action');
  await page.click('#end-turn'); assert.equal((await save()).currentTurn,2); await checkFrame(550);
  checks.push('mobile bottom controls can individually skip all decisions and finish the turn without page scrolling');
  await page.clock.install(); await page.clock.pauseAt(new Date()); await fresh('ai-skirmish');
  for (let i=0;i<3;i++) await page.click('#skip-current-action');
  const aiCamera=await camera(); await page.click('#end-turn');
  assert.match(await page.locator('#hud-turn-status').innerText(),/行動中/); assert.equal(await page.locator('#end-turn').isDisabled(),true);
  await page.clock.runFor(10000); assert.equal((await save()).currentTurn,2); assert.deepEqual(await camera(),aiCamera);
  checks.push('NPC progress is visible in the persistent footer and returns to the player without camera jumps');
  assert.deepEqual(errors,[]); assert.deepEqual(failures,[]);
  const report={verifiedAt:new Date().toISOString(),browser:await browser.version(),checks,pageErrors:errors,httpFailures:failures};
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n'); console.log(JSON.stringify(report,null,2));
} catch(error) {
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify({checks,pageErrors:errors,httpFailures:failures,error:String(error.stack??error)},null,2)+'\n'); throw error;
} finally { if(browser) await browser.close(); server.close(); }
