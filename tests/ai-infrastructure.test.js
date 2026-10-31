import test from 'node:test';
import assert from 'node:assert/strict';
import { createAiConquestGameState, createAiReinforcementGameState, createAiSkirmishGameState } from '../src/core/scenarios.js';
import { createInitialGameState, addCity, restoreGameState, serializeGameState } from '../src/core/game-state.js';
import { HumanController } from '../src/core/human-controller.js';
import { AIController, runAiTurn, executeAiStep, AI_TURN_COMMAND_LIMIT } from '../src/core/ai-controller.js';
import { chooseSupplyCommand } from '../src/core/ai-economy.js';
import { chooseInfrastructureCommand, hasInfrastructureAi, infrastructurePriority, infrastructureOrdersThisTurn } from '../src/core/ai-infrastructure.js';
import { RuleSystem } from '../src/core/rule-system.js';
import { RULESET } from '../src/core/ruleset.js';
import { createUnit } from '../src/models/unit.js';
import { updateDerivedCapabilities } from '../src/models/kingdom.js';
import { applyProduction } from '../src/systems/production-system.js';

const player = 'kingdom-2', human = new HumanController('kingdom-1'), ai = new AIController(player), cityId = 'city-2';
const apply = (s, c) => { const r = RuleSystem.execute(s, c); assert.equal(r.ok, true, r.reason); return r.state; };
const trip = s => { const restored = restoreGameState(serializeGameState(s)); assert.deepEqual(restored, s); return restored; };
const k = s => s.kingdoms[player], city = s => s.cities[cityId];
function relocate(s, id, key) { const p = s.parties[id]; p.location = key; s.world.tiles[key].terrainId = 'plains'; p.unitIds.forEach(id => { s.units[id].location = key; }); }
function unlock(s, ids = ['writing']) { k(s).research = { currentTechnologyId: null, progressByTechnology: {}, completedTechnologyIds: [...ids] }; k(s).progress.science = ids.reduce((n, id) => n + RULESET.technologies[id].scienceCost, 0); }
function endArmy(s) { Object.assign(s.parties['party-2'], { movementRemaining: 0, attacksRemaining: 0, reactionCharges: 0, activationState: 'ended' }); }
function fixture(make = createAiReinforcementGameState) {
  let s = make(117); s = apply(s, human.startTurn(s)); s = apply(s, human.endTurn(s));
  relocate(s, 'party-1', '-5,5,0'); relocate(s, 'party-2', '6,-6,0'); endArmy(s);
  unlock(s); k(s).stockpiles.gold = 300; updateDerivedCapabilities(k(s), s); return s;
}
const choose = s => chooseInfrastructureCommand(s, player, `test-${s.commandLog.length}`);
const round = s => { const turn = s.currentTurn; do { const c = new HumanController(s.activePlayerId); s = apply(s, c.endTurn(s)); } while (s.currentTurn === turn && !s.gameResult); return s; };
function recruit(s, type = 'warrior', owner = player, where = '4,-4,0') {
  const id = `unit-${s.nextIds.unit++}`; s.units[id] = createUnit(id, owner, type, where); s.kingdoms[owner].unitIds.push(id); return s.units[id];
}

test('only new reinforcement and conquest scenarios opt into infrastructure AI; old research saves remain exact', () => {
  for (const make of [createAiReinforcementGameState, createAiConquestGameState]) { const s = make(); assert.equal(s.aiInfrastructureVersion, 1); trip(s); }
  assert.equal(hasInfrastructureAi(createInitialGameState()), false); assert.equal(hasInfrastructureAi(createAiSkirmishGameState()), false);
  const s = fixture(); delete s.aiInfrastructureVersion; const restored = trip(s);
  assert.equal(choose(restored), null); assert.equal(ai.nextCommand(restored).payload.itemId, 'warrior');
  assert.equal(Object.hasOwn(restored, 'aiInfrastructureVersion'), false);
});
test('invalid infrastructure versions and versions without research reject rather than silently upgrading', () => {
  for (const version of [null, false, true, '1', 0, 2, -1, 1.5, {}]) {
    const s = fixture(); s.aiInfrastructureVersion = version; assert.throws(() => restoreGameState(serializeGameState(s)), /aiInfrastructureVersion/);
  }
  const s = fixture(); delete s.researchVersion; Object.values(s.kingdoms).forEach(kingdom => { delete kingdom.research; });
  assert.throws(() => restoreGameState(serializeGameState(s)), /aiInfrastructureVersion/);
});
test('planner is deterministic and read-only, and does not inspect future RNG', () => {
  const s = fixture(), text = serializeGameState(s), next = choose(s); assert.equal(next.payload.itemId, 'library');
  for (let i = 0; i < 8; i++) assert.deepEqual(choose(s), next);
  assert.equal(serializeGameState(s), text);
  Object.defineProperty(s, 'rng', { get() { throw Error('RNG must not be inspected'); } }); assert.deepEqual(choose(s), next);
});
test('planner does nothing on foreign turns, human/tactical controllers, game over or wrong phase', () => {
  for (const edit of [s => { s.activePlayerId = 'kingdom-1'; }, s => { k(s).controllerType = 'human'; }, s => { k(s).aiPolicy = 'tactical'; }, s => { s.phase = 'TURN_START'; }, s => { s.gameResult = {}; }]) {
    const s = fixture(); edit(s); const text = serializeGameState(s); assert.equal(choose(s), null); assert.equal(serializeGameState(s), text);
  }
});
test('locked, completed and already reserved facilities are never purchased or duplicated', () => {
  const s = fixture(); unlock(s, []); assert.equal(choose(s), null); unlock(s);
  for (const setup of [() => { city(s).buildings = ['library']; }, () => { city(s).buildings = []; city(s).production.currentItemId = 'library'; }, () => { city(s).production.currentItemId = 'warrior'; city(s).production.queue = ['archer', 'library']; }]) {
    setup(); const before = structuredClone(city(s)); assert.equal(choose(s), null); assert.deepEqual(city(s), before);
  }
});
test('army rebuilding precedes investment; dead, civilian and queued units cannot satisfy its live minimum', () => {
  const s = fixture(), ids = s.parties['party-2'].unitIds;
  s.units[ids[0]].currentHp = s.units[ids[0]].hp = 0; s.units[ids[0]].status = 'shattered';
  recruit(s, 'settler'); city(s).production.currentItemId = 'warrior'; city(s).production.queue = Array(10).fill('warrior');
  assert.equal(choose(s), null);
  city(s).production.currentItemId = null; city(s).production.queue = [];
  assert.equal(chooseSupplyCommand(s, player, 'rebuild').payload.itemId, 'warrior');
});
test('waiting soldiers alone cannot trigger investment without a live military party', () => {
  const s = fixture(), p = s.parties['party-2'];
  p.unitIds.forEach(id => { s.units[id].currentHp = s.units[id].hp = 0; s.units[id].status = 'shattered'; }); p.status = 'defeated';
  for (let n = 0; n < 5; n++) recruit(s);
  assert.equal(choose(s), null);
});
test('a threatened city suspends investment throughout the kingdom, including an already walled city', () => {
  const s = fixture(createAiConquestGameState); relocate(s, 'party-1', '2,-2,0');
  city(s).buildings.push('walls'); city(s).defense.wallHp = 60;
  s.world.tiles['8,-8,0'].terrainId = 'plains'; addCity(s, { ownerId: player, id: 'city-3', name: '後方都市', centerHex: '8,-8,0' });
  assert.equal(choose(s), null);
  relocate(s, 'party-1', '-5,5,0'); assert.ok(choose(s));
});
test('threat boundary is three hexes; distant, defeated and civilian-only parties do not block', () => {
  const s = fixture(); relocate(s, 'party-1', '1,-1,0'); assert.equal(choose(s), null);
  relocate(s, 'party-1', '0,0,0'); assert.ok(choose(s));
  relocate(s, 'party-1', '1,-1,0'); s.parties['party-1'].status = 'defeated'; assert.ok(choose(s));
  s.parties['party-1'].status = 'active'; s.parties['party-1'].unitIds.forEach(id => { s.units[id].typeId = 'settler'; }); assert.ok(choose(s));
});
test('an enemy waiting unit on the city center blocks investment, while friendly garrisons do not', () => {
  const s = fixture(); relocate(s, 'party-2', city(s).centerHex); assert.ok(choose(s));
  const enemy = recruit(s, 'settler', 'kingdom-1'); assert.equal(choose(s), null);
  enemy.currentHp = enemy.hp = 0; enemy.status = 'shattered'; assert.ok(choose(s));
});
test('urgent walls are chosen before facilities even if research and funds are available', () => {
  const s = fixture(createAiConquestGameState); relocate(s, 'party-1', '2,-2,0');
  assert.equal(chooseSupplyCommand(s, player, 'wall').payload.itemId, 'walls'); assert.equal(choose(s), null);
});
test('facility purchase pays the full price, preserves emergency funds, and never adds immediate income', () => {
  const s = fixture(); k(s).stockpiles.gold = 152; const before = structuredClone(s), next = choose(s);
  assert.equal(next.type, 'PurchaseCityItem'); const result = apply(s, next);
  assert.equal(k(result).stockpiles.gold, 72); assert.deepEqual(city(result).buildings, ['library']);
  assert.deepEqual(k(result).progress, k(before).progress); assert.deepEqual(city(result).yieldSummary, city(before).yieldSummary);
  for (const key of ['rng', 'units', 'parties', 'nextIds']) assert.deepEqual(result[key], before[key]); trip(result);
});
test('one Gold below the reserve threshold falls back to production without spending money', () => {
  const s = fixture(); k(s).stockpiles.gold = 151; const next = choose(s); assert.equal(next.type, 'SetCityProduction');
  const result = apply(s, next); assert.equal(k(result).stockpiles.gold, 151); assert.equal(city(result).production.currentItemId, 'library');
});
test('production keeps all partial work and existing orders are never displaced', () => {
  const s = fixture(); k(s).stockpiles.gold = 24; city(s).production.progressByItem = { library: 9, warrior: 7 };
  const result = apply(s, choose(s)); assert.deepEqual(city(result).production.progressByItem, city(s).production.progressByItem);
  city(s).production.currentItemId = 'warrior'; city(s).production.queue = ['archer', 'monument']; const before = structuredClone(city(s).production);
  assert.equal(choose(s), null); assert.deepEqual(city(s).production, before);
  k(s).stockpiles.gold = 300; const bought = apply(s, choose(s)); assert.deepEqual(city(bought).production, { ...before, progressByItem: { ...before.progressByItem, library: 0 } });
});
test('zero production is not assigned an unfinishable building, but a funded purchase remains possible', () => {
  const s = fixture(); city(s).yieldSummary.production = 0; k(s).stockpiles.gold = 151; assert.equal(choose(s), null);
  k(s).stockpiles.gold = 152; assert.equal(choose(s).type, 'PurchaseCityItem');
});
test('military purchases and facility purchases share the same per-city per-turn cap', () => {
  let s = fixture(); const c = new HumanController(player); s = apply(s, c.purchaseItem(s, cityId, 'warrior'));
  city(s).production.currentItemId = 'archer'; assert.equal(choose(s), null);
  city(s).production.currentItemId = null; assert.equal(choose(s).type, 'SetCityProduction');
  const facility = apply(fixture(), choose(fixture())); city(facility).production.currentItemId = 'archer';
  assert.equal(chooseSupplyCommand(facility, player, 'no-second-purchase'), null);
});
test('kingdom-wide investment limit survives reload and includes both production and purchase', () => {
  for (const gold of [24, 300]) {
    let s = fixture(); unlock(s, ['writing', 'agriculture', 'engineering']); k(s).stockpiles.gold = gold;
    s.world.tiles['8,-8,0'].terrainId = 'plains'; addCity(s, { ownerId: player, id: 'city-3', name: '後方', centerHex: '8,-8,0' });
    s = apply(s, choose(s)); assert.equal(infrastructureOrdersThisTurn(s, player), 1); assert.equal(choose(trip(s)), null);
    const next = round(s); endArmy(next); next.activePlayerId = player; next.activePlayerIndex = 1;
    assert.equal(infrastructureOrdersThisTurn(next, player), 0); assert.ok(choose(next));
  }
});
test('different kingdoms have independent limits; cities are visited in stable ID order', () => {
  const s = fixture(); s.world.tiles['8,-8,0'].terrainId = 'plains'; addCity(s, { ownerId: player, id: 'city-3', name: '後方', centerHex: '8,-8,0' });
  const reversed = structuredClone(s); reversed.cities = Object.fromEntries(Object.entries(reversed.cities).reverse());
  assert.deepEqual(choose(reversed), choose(s)); assert.equal(choose(s).payload.cityId, cityId);
  const after = apply(s, choose(s)); assert.equal(infrastructureOrdersThisTurn(after, 'kingdom-1'), 0);
});
test('low-food and low-production priorities are explicit, but never bypass technology requirements', () => {
  const s = fixture(); unlock(s, ['writing', 'agriculture', 'engineering']);
  city(s).yieldSummary.food = 2; city(s).yieldSummary.production = 3;
  assert.equal(infrastructurePriority(city(s), k(s))[0], 'granary'); assert.equal(choose(s).payload.itemId, 'granary');
  city(s).yieldSummary.food = 5; assert.equal(choose(s).payload.itemId, 'workshop');
  unlock(s, ['writing']); assert.equal(choose(s).payload.itemId, 'library');
});
test('unfinished research favors a library; complete research favors productive capacity', () => {
  const s = fixture(); city(s).yieldSummary.food = city(s).yieldSummary.production = 5;
  unlock(s, ['writing', 'agriculture']); assert.equal(choose(s).payload.itemId, 'library');
  unlock(s, ['writing', 'agriculture', 'engineering']); assert.equal(choose(s).payload.itemId, 'workshop');
});
test('at the military recruitment cap, safe infrastructure remains eligible without issuing more troops', () => {
  const s = fixture(); delete s.aiExpansionVersion; // Preserve the pre-expansion supply ordering.
  for (let i = 0; i < 10; i++) recruit(s);
  assert.equal(chooseSupplyCommand(s, player, 'at-cap').payload.itemId, 'library');
});
test('purchased and produced buildings yield only on subsequent collection and production completes once', () => {
  const s = fixture(), bought = apply(s, choose(s)), after = round(bought);
  assert.equal(city(after).lastYieldBreakdown.buildings.find(b => b.buildingId === 'library').yields.science, 2);
  k(s).stockpiles.gold = 24; const produced = apply(s, choose(s)), events = [];
  applyProduction(produced, city(produced), 100, events); applyProduction(produced, city(produced), 100, events);
  assert.equal(events.filter(e => e.type === 'ItemCompleted' && e.itemId === 'library').length, 1);
});
test('normal AI uses shared facility commands; forcing EndTurn bypasses all discretionary actions', () => {
  const s = fixture(), next = ai.nextCommand(s); assert.equal(next.type, 'PurchaseCityItem'); assert.equal(next.payload.itemId, 'library');
  assert.equal(ai.nextCommand(s, { forceEnd: true }).type, 'EndTurn');
  const after = apply(s, next), replay = runAiTurn(trip(after)); assert.deepEqual(replay, runAiTurn(after));
});
test('AI still takes immediate military actions before facility spending', () => {
  const s = fixture(createAiConquestGameState); relocate(s, 'party-1', '5,-5,0');
  Object.assign(s.parties['party-2'], { movementRemaining: 2, attacksRemaining: 1, activationState: 'ready' });
  assert.notEqual(ai.nextCommand(s).type, 'PurchaseCityItem');
});
test('mid-turn resumed facility choice and post-purchase continuation are identical without double charges', () => {
  const s = fixture(), restored = trip(s); assert.deepEqual(executeAiStep(restored), executeAiStep(s));
  const after = executeAiStep(s).state, text = serializeGameState(after), duplicate = RuleSystem.execute(after, ai.nextCommand(s));
  assert.equal(duplicate.ok, false); assert.equal(duplicate.state, after); assert.equal(serializeGameState(after), text);
  assert.deepEqual(runAiTurn(trip(after)), runAiTurn(after));
});
test('an invalid stale order rejects atomically when the research unlock or treasury is no longer valid', () => {
  for (const edit of [s => unlock(s, []), s => { k(s).stockpiles.gold = 0; }]) {
    const s = fixture(), command = choose(s); edit(s); const text = serializeGameState(s), result = RuleSystem.execute(s, command);
    assert.equal(result.ok, false); assert.equal(result.state, s); assert.equal(serializeGameState(s), text);
  }
});
test('bounded two-AI games terminate reproducibly across seeds and every saved command boundary', () => {
  for (const seed of [1, 7, 42, 117]) for (const make of [createAiReinforcementGameState, createAiConquestGameState]) {
    let s = make(seed); s.kingdoms['kingdom-1'].controllerType = 'ai'; s.kingdoms['kingdom-1'].aiPolicy = 'reinforcements';
    s = apply(s, human.startTurn(s)); let steps = 0;
    while (!s.gameResult && steps < 40 * 2 * (AI_TURN_COMMAND_LIMIT + 1)) {
      const commands = s.commandLog.filter(c => c.playerId === s.activePlayerId && c.turn === s.currentTurn).length;
      const options = { forceEnd: commands >= AI_TURN_COMMAND_LIMIT };
      const a = executeAiStep(s, options), b = executeAiStep(trip(s), options);
      assert.equal(a.ok, true, a.reason); assert.deepEqual(a, b); s = a.state; steps++;
    }
    assert.ok(s.gameResult, `seed ${seed}`); trip(s);
  }
});
