import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialGameState, addKingdom, restoreGameState, serializeGameState } from '../src/core/game-state.js';
import { createDuelGameState, createTwoCityGameState, createAiSkirmishGameState, createAiConquestGameState } from '../src/core/scenarios.js';
import { HumanController } from '../src/core/human-controller.js';
import { AIController, runAiTurn } from '../src/core/ai-controller.js';
import { RuleSystem } from '../src/core/rule-system.js';
import { RULESET } from '../src/core/ruleset.js';
import { applyResearch, unassignedScience, researchForecast, researchSelectionError, itemResearchError, chooseResearchCommand } from '../src/systems/research-system.js';
import { calculateCityYields } from '../src/systems/yield-system.js';
import { productionPlanError } from '../src/ui/production-queue.js';

const player = 'kingdom-1', c = new HumanController(player), kingdom = s => s.kingdoms[player];
const apply = (s, cmd) => { const r = RuleSystem.execute(s, cmd); assert.equal(r.ok, true, r.reason); return r.state; };
const ready = (make = createInitialGameState) => { const s = make(117); return apply(s, c.startTurn(s)); };
const select = (s, id) => apply(s, c.selectResearch(s, id));
const nextRound = s => { const turn = s.currentTurn; do { const h = new HumanController(s.activePlayerId); s = apply(s, h.endTurn(s)); } while (s.currentTurn === turn && !s.gameResult); return s; };
const roundTrip = s => { const text = serializeGameState(s); assert.deepEqual(restoreGameState(text), s); return restoreGameState(text); };
function reject(s, cmd) { const before = serializeGameState(s), r = RuleSystem.execute(s, cmd); assert.equal(r.ok, false); assert.equal(r.state, s); assert.deepEqual(r.events, []); assert.equal(serializeGameState(s), before); }
function completed(s, ids = ['writing']) { const k = kingdom(s); k.progress.science = ids.reduce((n, id) => n + RULESET.technologies[id].scienceCost, 0); k.research.completedTechnologyIds = [...ids]; return s; }
function legacy(s) { delete s.aiInfrastructureVersion; delete s.researchVersion; Object.values(s.kingdoms).forEach(k => { delete k.research; }); return s; }

test('new games and added kingdoms initialize separate research; legacy setup stays unversioned', () => {
  const s = createDuelGameState(); assert.equal(s.researchVersion, 1);
  assert.notEqual(s.kingdoms['kingdom-1'].research, s.kingdoms['kingdom-2'].research); roundTrip(s);
  const old = createInitialGameState(117, { researchEnabled: false }); old.world.tiles['4,-4,0'].terrainId = 'plains';
  addKingdom(old, { id: 'kingdom-2', name: '別国', cityId: 'city-2', cityName: '別都', centerHex: '4,-4,0' });
  assert.equal(Object.hasOwn(old, 'researchVersion'), false); assert.ok(Object.values(old.kingdoms).every(k => !Object.hasOwn(k, 'research'))); roundTrip(old);
});
test('selection is one Command without science allocation, costs, actions, RNG or ID changes', () => {
  const s = ready(), before = structuredClone(s), after = select(s, 'writing');
  for (const key of ['rng', 'units', 'parties', 'cities', 'nextIds']) assert.deepEqual(after[key], s[key]);
  for (const key of ['stockpiles', 'progress', 'derived']) assert.deepEqual(kingdom(after)[key], kingdom(s)[key]);
  assert.deepEqual(kingdom(after).research.progressByTechnology, {}); assert.equal(after.commandLog.length, s.commandLog.length + 1); assert.equal(after.eventLog.at(-1).type, 'ResearchSelected'); assert.deepEqual(s, before);
});
test('full round allocates the existing science total once and preserves the cumulative military metric', () => {
  let s = select(ready(), 'writing'); const before = kingdom(s).progress.science; s = nextRound(s);
  const gained = s.eventLog.filter(e => e.turn === s.currentTurn && e.type === 'YieldCollected').reduce((n, e) => n + e.breakdown.total.science, 0);
  assert.equal(kingdom(s).progress.science, before + gained);
  assert.equal(kingdom(s).research.progressByTechnology.writing, kingdom(s).progress.science); assert.equal(unassignedScience(kingdom(s)), 0);
  reject(s, c.startTurn(s)); roundTrip(s);
});
test('two-city research uses both city incomes once, independent of city iteration order', () => {
  const s = select(ready(createTwoCityGameState), 'writing'), reverse = structuredClone(s); kingdom(reverse).cityIds.reverse();
  const a = nextRound(s), b = nextRound(reverse);
  assert.deepEqual(kingdom(a).research, kingdom(b).research); assert.equal(kingdom(a).progress.science, kingdom(b).progress.science);
  const progress = kingdom(a).research.progressByTechnology.writing; assert.equal(progress, kingdom(a).progress.science);
});
test('switch and pause retain per-topic progress; saved unassigned science is not duplicated', () => {
  let s = nextRound(select(ready(), 'writing')); const writing = kingdom(s).research.progressByTechnology.writing;
  s = nextRound(select(s, 'agriculture')); const agriculture = kingdom(s).research.progressByTechnology.agriculture;
  assert.ok(agriculture > 0); assert.equal(kingdom(s).research.progressByTechnology.writing, writing);
  s = select(s, null); const research = structuredClone(kingdom(s).research); s = nextRound(s);
  assert.deepEqual(kingdom(s).research, research); assert.ok(unassignedScience(kingdom(s)) > 0);
  const resumed = select(roundTrip(s), 'writing'), a = nextRound(resumed), b = nextRound(select(s, 'writing'));
  assert.deepEqual(a, b); assert.equal(kingdom(a).research.progressByTechnology.agriculture, agriculture);
  assert.equal(kingdom(a).research.progressByTechnology.writing + agriculture, kingdom(a).progress.science);
});
test('completion preserves overflow, creates no free building and never reuses the spent cost', () => {
  let s = ready(); kingdom(s).progress.science = 40; s = select(s, 'writing');
  assert.equal(kingdom(s).research.completedTechnologyIds.length, 0); s = nextRound(s);
  const k = kingdom(s); assert.deepEqual(k.research.completedTechnologyIds, ['writing']); assert.equal(k.research.currentTechnologyId, null);
  assert.equal(k.research.progressByTechnology.writing, 0); assert.equal(unassignedScience(k), k.progress.science - 12);
  assert.ok(!s.cities['city-1'].buildings.includes('library')); reject(s, c.selectResearch(s, 'writing'));
  s = nextRound(select(s, 'engineering')); assert.deepEqual(kingdom(s).research.completedTechnologyIds, ['writing', 'engineering']);
  assert.equal(unassignedScience(kingdom(s)), kingdom(s).progress.science - 36); roundTrip(s);
});
test('zero income still uses saved unassigned science, otherwise makes no progress', () => {
  let s = ready(); s.cities['city-1'].yieldModifiers.science = -100;
  kingdom(s).progress.science = 12; s = nextRound(select(s, 'writing')); assert.ok(kingdom(s).research.completedTechnologyIds.includes('writing'));
  s = nextRound(select(s, 'engineering')); assert.equal(kingdom(s).research.progressByTechnology.engineering, undefined); assert.equal(researchForecast(kingdom(s), s).turns, null);
});
test('two kingdoms advance only at the full-round boundary and keep research independent', () => {
  let s = select(ready(createDuelGameState), 'writing'); const r = structuredClone(kingdom(s).research); s = apply(s, c.endTurn(s));
  assert.deepEqual(kingdom(s).research, r); const other = new HumanController('kingdom-2');
  s = apply(s, other.selectResearch(s, 'agriculture')); s = apply(s, other.endTurn(s));
  assert.ok(kingdom(s).research.progressByTechnology.writing > 0); assert.ok(s.kingdoms['kingdom-2'].research.progressByTechnology.agriculture > 0);
  assert.equal(kingdom(s).research.progressByTechnology.agriculture, undefined); roundTrip(s);
});
test('unknown, unsafe, missing and malformed technology IDs reject atomically', () => {
  const s = ready(); for (const id of ['', 'missing', 'constructor', '__proto__', 'prototype', {}, [], 0, false, undefined]) reject(s, c.selectResearch(s, id));
  const cmd = c.selectResearch(s, 'writing'); delete cmd.payload.technologyId; reject(s, cmd);
});
test('prerequisites, completion, duplicate selection and duplicate Command IDs reject atomically', () => {
  let s = ready(); reject(s, c.selectResearch(s, 'engineering')); reject(s, c.selectResearch(s, null));
  const cmd = c.selectResearch(s, 'writing'); s = apply(s, cmd); reject(s, cmd); reject(s, c.selectResearch(s, 'writing'));
  s = nextRound(select(completed(ready()), 'engineering')); assert.equal(kingdom(s).research.currentTechnologyId, 'engineering');
});
test('wrong player, phase, turn and finished games cannot select or pause research', () => {
  const s = ready(createDuelGameState), other = new HumanController('kingdom-2'); reject(s, other.selectResearch(s, 'writing'));
  for (const change of [cmd => { cmd.phase = 'TURN_START'; }, cmd => { cmd.turn++; }, cmd => { cmd.playerId = 'missing'; }]) { const cmd = c.selectResearch(s, 'writing'); change(cmd); reject(s, cmd); }
  for (const phase of ['TURN_END', 'GAME_OVER']) { const copy = structuredClone(s); copy.phase = phase; reject(copy, c.selectResearch(copy, 'writing')); }
});
test('client fields cannot supply research cost, progress, completion or another kingdom', () => {
  const s = ready(), cmd = c.selectResearch(s, 'writing'), forged = structuredClone(cmd);
  Object.assign(forged.payload, { scienceCost: 0, progress: 999, completedTechnologyIds: ['writing'], kingdomId: 'kingdom-2' });
  const a = RuleSystem.execute(s, cmd), b = RuleSystem.execute(s, forged);
  assert.deepEqual(b.state.kingdoms, a.state.kingdoms); assert.deepEqual(b.events, a.events);
});
test('unresearched items reject as active production, queued production and immediate purchase', () => {
  const s = ready(); kingdom(s).stockpiles.gold = 1000;
  for (const item of ['library', 'granary', 'workshop']) {
    reject(s, c.setProduction(s, 'city-1', item)); reject(s, c.setProduction(s, 'city-1', 'warrior', [item])); reject(s, c.purchaseItem(s, 'city-1', item));
    assert.ok(productionPlanError(s, s.cities['city-1'], [item]));
  }
});
test('all existing production choices retain their prior availability', () => {
  let s = ready(createAiConquestGameState); kingdom(s).stockpiles.gold = 1000;
  for (const item of ['warrior', 'archer', 'ballista', 'settler', 'monument', 'walls']) {
    assert.equal(itemResearchError(s, player, item), null); assert.equal(RuleSystem.execute(s, c.setProduction(s, 'city-1', item)).ok, true);
  }
});
test('completed technology unlocks purchase at full price but does not immediately collect its bonus', () => {
  let s = completed(ready()); const city = s.cities['city-1'], before = structuredClone(city.yieldSummary), gold = kingdom(s).stockpiles.gold;
  s = apply(s, c.purchaseItem(s, 'city-1', 'library')); assert.equal(kingdom(s).stockpiles.gold, gold - 80); assert.deepEqual(s.cities['city-1'].yieldSummary, before);
  const without = structuredClone(s); without.cities['city-1'].buildings = [];
  const a = nextRound(s), b = nextRound(without); assert.equal(kingdom(a).progress.science - kingdom(b).progress.science, 2);
  reject(s, c.purchaseItem(s, 'city-1', 'library')); roundTrip(a);
});
test('new facilities use normal production, overflow and purchase queue normalization', () => {
  let s = completed(ready(), ['writing', 'agriculture', 'engineering']); kingdom(s).stockpiles.gold = 500;
  s = apply(s, c.setProduction(s, 'city-1', 'library', ['warrior', 'granary'])); s.cities['city-1'].production.progressByItem.library = 19;
  const produced = nextRound(s); assert.ok(produced.cities['city-1'].buildings.includes('library')); assert.ok(produced.cities['city-1'].production.progressByItem.warrior > 0);
  s = apply(s, c.purchaseItem(s, 'city-1', 'library')); assert.equal(s.cities['city-1'].production.currentItemId, 'warrior'); assert.deepEqual(s.cities['city-1'].production.queue, ['granary']); roundTrip(s);
});
test('granary and workshop yield exactly their configured bonuses on the next collection', () => {
  const s = completed(ready(), ['writing', 'agriculture', 'engineering']), city = s.cities['city-1']; const before = calculateCityYields(s, city).total;
  city.buildings.push('granary', 'workshop'); const after = calculateCityYields(s, city).total;
  assert.equal(after.food - before.food, 2); assert.equal(after.production - before.production, 2); assert.equal(after.science, before.science);
});
test('capturing research buildings keeps buildings but never transfers science or technology', () => {
  let s = ready(createAiConquestGameState); const enemy = s.cities['city-2'], other = s.kingdoms['kingdom-2'];
  other.progress.science = 12; other.research.completedTechnologyIds = ['writing']; enemy.buildings.push('library');
  enemy.defense.hp = 0; enemy.defense.wallHp = 0;
  const p = s.parties['party-1']; p.location = enemy.centerHex; p.unitIds.forEach(id => { s.units[id].location = p.location; });
  const science = kingdom(s).progress.science; s = apply(s, c.captureCity(s, 'party-1', 'city-2'));
  assert.ok(s.cities['city-2'].buildings.includes('library')); assert.equal(kingdom(s).progress.science, science); assert.deepEqual(kingdom(s).research.completedTechnologyIds, []); roundTrip(s);
});
test('forecast and research AI are read-only and never inspect future RNG', () => {
  const s = select(ready(), 'writing'), before = structuredClone(s); researchForecast(kingdom(s), s); unassignedScience(kingdom(s)); researchSelectionError(s, player, 'engineering'); assert.deepEqual(s, before);
  Object.defineProperty(s, 'rng', { get() { throw new Error('no RNG allowed'); } });
  assert.ok(researchForecast(kingdom(s), s)); assert.equal(chooseResearchCommand(s, player, 'check'), null);
});
test('forecasts account for paused progress once and distinguish bank-funded from no-income targets', () => {
  let s = ready(); kingdom(s).progress.science = 12; kingdom(s).research.progressByTechnology.agriculture = 5; s = select(s, 'writing');
  s.cities['city-1'].yieldSummary.science = 1; assert.equal(researchForecast(kingdom(s), s).turns, 5);
  s.cities['city-1'].yieldSummary.science = 0; assert.equal(researchForecast(kingdom(s), s).turns, null);
  kingdom(s).progress.science = 17; assert.equal(researchForecast(kingdom(s), s).turns, 1);
});
test('AI selects at most one topic, never replaces current research, and resumes identically', () => {
  let s = ready(createAiSkirmishGameState); s = apply(s, c.endTurn(s));
  const a = runAiTurn(s), b = runAiTurn(roundTrip(s)); assert.deepEqual(a, b);
  assert.equal(a.commands.filter(cmd => cmd.type === 'SelectResearch').length, 1); assert.equal(a.state.kingdoms['kingdom-2'].research.currentTechnologyId, 'writing');
  s = apply(a.state, c.endTurn(a.state)); assert.equal(runAiTurn(s).commands.filter(cmd => cmd.type === 'SelectResearch').length, 0);
});
test('AI follows prerequisites without selecting completed targets or pausing indefinitely', () => {
  const s = ready(); const k = kingdom(s);
  assert.equal(chooseResearchCommand(s, player, '1').payload.technologyId, 'writing');
  k.research.completedTechnologyIds = ['writing']; k.progress.science = 12;
  assert.equal(chooseResearchCommand(s, player, '2').payload.technologyId, 'agriculture');
  k.research.completedTechnologyIds.push('agriculture'); k.progress.science += 16;
  assert.equal(chooseResearchCommand(s, player, '3').payload.technologyId, 'engineering');
  k.research.completedTechnologyIds.push('engineering'); k.progress.science += 24;
  assert.equal(chooseResearchCommand(s, player, '4'), null);
});
test('research version validation rejects null, unsupported or partially missing data', () => {
  for (const change of [s => { s.researchVersion = 2; }, s => { s.researchVersion = null; }, s => { delete kingdom(s).research; }, s => { kingdom(s).research = []; }, s => { delete s.researchVersion; }]) {
    const s = ready(); change(s); assert.throws(() => restoreGameState(serializeGameState(s)), /research/);
  }
});
test('save validation rejects unknown IDs, duplicate completions and negative or oversized progress', () => {
  const bad = [r => { r.currentTechnologyId = 'constructor'; }, r => { delete r.currentTechnologyId; }, r => { r.progressByTechnology = null; }, r => { r.completedTechnologyIds = ['writing', 'writing']; }, r => { r.completedTechnologyIds = ['nope']; }, r => { r.progressByTechnology.nope = 1; }, r => { r.progressByTechnology.writing = -1; }, r => { r.progressByTechnology.writing = 12; }, r => { r.progressByTechnology.writing = '1'; }];
  for (const change of bad) { const s = ready(); change(kingdom(s).research); assert.throws(() => restoreGameState(serializeGameState(s)), /research/); }
});
test('save validation rejects unpaid completions, prerequisite bypass and double allocation', () => {
  const bad = [s => { kingdom(s).research.completedTechnologyIds = ['writing']; }, s => { kingdom(s).progress.science = 100; kingdom(s).research.completedTechnologyIds = ['engineering']; }, s => { kingdom(s).research.currentTechnologyId = 'engineering'; }, s => { kingdom(s).research.progressByTechnology.engineering = 1; }, s => { kingdom(s).research.progressByTechnology = { writing: 1, agriculture: 1 }; }, s => { completed(s); kingdom(s).research.progressByTechnology.writing = 1; }];
  for (const change of bad) { const s = ready(); change(s); assert.throws(() => restoreGameState(serializeGameState(s)), /research/); }
});
test('save validation rejects locked orders and stored work while permitting captured facilities', () => {
  for (const change of [s => { s.cities['city-1'].production.currentItemId = 'library'; }, s => { s.cities['city-1'].production.queue = ['workshop']; }, s => { s.cities['city-1'].production.progressByItem.granary = 1; }]) {
    const s = ready(); change(s); assert.throws(() => restoreGameState(serializeGameState(s)), /research/);
  }
  const s = ready(); s.cities['city-1'].buildings.push('library'); roundTrip(s);
});
test('legacy saves preserve exact state and reject injected research facilities or histories', () => {
  const s = legacy(ready(createAiSkirmishGameState)); const before = serializeGameState(s); roundTrip(s); assert.equal(serializeGameState(s), before); reject(s, c.selectResearch(s, 'writing'));
  for (const change of [s => { s.cities['city-1'].buildings.push('library'); }, s => { s.cities['city-1'].production.currentItemId = 'library'; }, s => { s.eventLog.push({ type: 'TechnologyCompleted', turn: 1 }); }]) { const copy = structuredClone(s); change(copy); assert.throws(() => restoreGameState(serializeGameState(copy)), /research/); }
});
test('every research boundary survives serialization with identical continuation', () => {
  let s = ready(); const checkpoints = [];
  for (const id of ['writing', 'agriculture', null, 'writing']) { s = select(s, id); checkpoints.push(s); s = nextRound(s); checkpoints.push(s); }
  for (const value of checkpoints) assert.deepEqual(nextRound(roundTrip(value)), nextRound(value));
});
test('all research complete does not grant victory or spend excess science', () => {
  let s = completed(ready(), ['writing', 'agriculture', 'engineering']); const total = kingdom(s).progress.science; s = nextRound(s);
  assert.ok(!s.gameResult); assert.ok(kingdom(s).progress.science > total); assert.ok(unassignedScience(kingdom(s)) > 0); assert.equal(kingdom(s).research.currentTechnologyId, null); roundTrip(s);
});
test('deadline ends before research allocation and cannot complete an unfinished technology', () => {
  let s = ready(createAiConquestGameState); s.currentTurn = s.scenarioObjective.turnLimit; s.lastProcessedTurn = s.currentTurn;
  s = select(s, 'writing'); kingdom(s).progress.science = 100; const before = structuredClone(kingdom(s).research); s = nextRound(s);
  assert.ok(s.gameResult); assert.deepEqual(kingdom(s).research, before); assert.equal(kingdom(s).progress.science, 100); roundTrip(s);
});

test('fractional science and alternating targets remain loadable without creating usable credit', () => {
  for (const rate of [0.1, 0.2, 0.3, 1 / 3, 1e-7, 1.1]) {
    let s = createInitialGameState(117); s.cities['city-1'].yieldModifiers.science = rate - 1;
    for (let i = 0; i < 70; i++) {
      const id = i % 2 ? 'writing' : 'agriculture';
      const result = RuleSystem.execute(s, c.selectResearch(s, id)); if (result.ok) s = result.state;
      s = nextRound(s); roundTrip(s);
      assert.ok(unassignedScience(kingdom(s)) <= kingdom(s).progress.science);
    }
  }
  const corrupt = ready(); kingdom(corrupt).research.progressByTechnology.writing = kingdom(corrupt).progress.science + 0.00001;
  assert.throws(() => restoreGameState(serializeGameState(corrupt)), /science allocated/);
});
