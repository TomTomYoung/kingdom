import test from 'node:test';
import assert from 'node:assert/strict';
import { createAiConquestGameState, createAiReinforcementGameState } from '../src/core/scenarios.js';
import { addCity, restoreGameState, serializeGameState } from '../src/core/game-state.js';
import { HumanController } from '../src/core/human-controller.js';
import { RuleSystem } from '../src/core/rule-system.js';
import { AIController, runAiTurn, executeAiStep } from '../src/core/ai-controller.js';
import { createUnit } from '../src/models/unit.js';
import { validateCaptureCity } from '../src/systems/city-capture.js';
import { scenarioOutcome } from '../src/systems/scenario-system.js';
import { Hex } from '../src/world/hex.js';

const human = new HumanController('kingdom-1'), enemy = new HumanController('kingdom-2'), capital = '4,-4,0';
function apply(state, input) { const result = RuleSystem.execute(state, input); assert.equal(result.ok, true, result.reason); return result.state; }
function unchanged(state, input) { const before = structuredClone(state), result = RuleSystem.execute(state, input); assert.equal(result.ok, false); assert.equal(result.state, state); assert.deepEqual(result.events, []); assert.deepEqual(state, before); }
const trip = state => { const restored = restoreGameState(serializeGameState(state)); assert.deepEqual(restored, state); return restored; };
function relocate(state, id, location) { const p = state.parties[id]; p.location = location; p.unitIds.forEach(id => { state.units[id].location = location; }); state.world.tiles[location].terrainId = 'plains'; }
function ready({ extraCity = false, onCity = true } = {}) {
  let state = createAiConquestGameState();
  // Historical conquest saves deliberately keep capture without durability.
  delete state.cityDefenseVersion; Object.values(state.cities).forEach(city => { delete city.defense; });
  state = apply(state, human.startTurn(state));
  if (onCity) relocate(state, 'party-1', capital);
  if (extraCity) { state.world.tiles['-4,4,0'].terrainId = 'plains'; addCity(state, { ownerId: 'kingdom-2', id: 'city-3', name: '余都', centerHex: '-4,4,0' }); }
  return state;
}
const capture = state => human.captureCity(state, 'party-1', 'city-2');
function destroy(state, id) {
  const p = state.parties[id]; p.status = 'defeated'; p.activationState = 'ended'; p.movementRemaining = p.attacksRemaining = p.reactionCharges = 0;
  p.unitIds.forEach(id => { Object.assign(state.units[id], { hp: 0, currentHp: 0, status: 'shattered' }); });
}
function recruit(state, owner = 'kingdom-2', location = capital) { const id = `unit-${state.nextIds.unit++}`; state.units[id] = createUnit(id, owner, 'warrior', location); state.kingdoms[owner].unitIds.push(id); return id; }

test('legacy conquest scenario is explicit, preserves tactical modes and survives save restoration', () => {
  const state = ready(); assert.equal(state.scenarioId, 'ai-conquest'); assert.equal(state.scenarioObjective.type, 'control-cities'); assert.equal(state.kingdoms['kingdom-2'].aiPolicy, 'reinforcements'); trip(state);
  const old = createAiReinforcementGameState(); assert.equal(old.scenarioObjective.type, 'eliminate-parties'); unchanged(old, capture(old)); trip(old);
});

test('capture transfers city and only its territory, preserving population and buildings while cancelling production', () => {
  const state = ready({ extraCity: true }), city = state.cities['city-2'];
  city.population = 4; city.foodStorage = 11; city.localCultureProgress = 7; city.buildings = ['monument'];
  city.production = { currentItemId: 'archer', queue: ['warrior'], progressByItem: { archer: 17, warrior: 8 } };
  const before = structuredClone(state), after = apply(state, capture(state)), owned = after.cities['city-2'];
  assert.deepEqual(state, before); assert.equal(owned.ownerId, 'kingdom-1'); assert.deepEqual(after.kingdoms['kingdom-1'].cityIds, ['city-1', 'city-2']); assert.deepEqual(after.kingdoms['kingdom-2'].cityIds, ['city-3']);
  for (const tile of Object.values(after.world.tiles)) assert.deepEqual(tile, { ...before.world.tiles[tile.key], ...(tile.territoryCityId === city.id ? { ownerId: 'kingdom-1' } : {}) });
  for (const key of ['id', 'name', 'centerHex', 'population', 'foodStorage', 'localCultureProgress', 'buildings', 'yieldModifiers']) assert.deepEqual(owned[key], before.cities[city.id][key]);
  assert.deepEqual(owned.production, { currentItemId: null, queue: [], progressByItem: {} }); assert.deepEqual(owned.workedTiles, []); assert.ok(Object.values(owned.yieldSummary).every(value => value === 0));
  assert.equal(after.gameResult, null); assert.equal(after.eventLog.at(-1).type, 'CityCaptured'); assert.equal(after.eventLog.at(-1).previousOwnerId, 'kingdom-2');
  for (const id of state.turnOrder) for (const key of ['stockpiles', 'progress', 'humanResources']) assert.deepEqual(after.kingdoms[id][key], before.kingdoms[id][key]);
  assert.notDeepEqual(after.kingdoms['kingdom-1'].derived, before.kingdoms['kingdom-1'].derived); assert.deepEqual(after.nextIds, before.nextIds); assert.deepEqual(after.rng, before.rng); trip(after);
});

test('capture preserves all units including enemy waiting troops and consumes the entire party activation', () => {
  const state = ready({ extraCity: true }), waiting = recruit(state); state.units['unit-1'].hp = state.units['unit-1'].currentHp = 20; state.units['unit-1'].guardCapacityRemaining = 3;
  const party = state.parties['party-1']; party.movementRemaining = 0;
  const after = apply(state, capture(state)), ended = after.parties[party.id];
  assert.deepEqual(after.units, state.units); assert.equal(after.units[waiting].ownerId, 'kingdom-2'); assert.equal(after.units[waiting].partyId, null);
  assert.deepEqual([ended.movementRemaining, ended.attacksRemaining, ended.reactionCharges, ended.activationState], [0, 0, 0, 'ended']); assert.equal(ended.hasAttacked, true);
  assert.deepEqual(ended.formation, party.formation); assert.deepEqual(ended.guardOrders, party.guardOrders); assert.equal(ended.morale, party.morale);
  unchanged(after, capture(after)); unchanged(after, human.moveParty(after, party.id, ['3,-3,0'])); unchanged(after, human.splitParty(after, party.id, ['unit-1'], '3,-3,0')); trip(after);
});

test('captured city income and new orders execute once on the next full-round start for the new owner', () => {
  let state = ready({ extraCity: true }); state = apply(state, capture(state));
  state = apply(state, human.setProduction(state, 'city-2', 'warrior'));
  const before = structuredClone(state); state = apply(state, human.endTurn(state));
  assert.deepEqual(state.cities['city-2'].yieldSummary, before.cities['city-2'].yieldSummary); assert.equal(state.cities['city-2'].production.progressByItem.warrior, undefined);
  unchanged(state, enemy.setProduction(state, 'city-2', 'archer')); unchanged(state, enemy.purchaseItem(state, 'city-2', 'warrior'));
  state = apply(state, enemy.endTurn(state));
  assert.ok(state.cities['city-2'].production.progressByItem.warrior > 0);
  assert.equal(state.kingdoms['kingdom-1'].stockpiles.gold - before.kingdoms['kingdom-1'].stockpiles.gold, state.cities['city-1'].yieldSummary.gold + state.cities['city-2'].yieldSummary.gold);
  assert.equal(state.kingdoms['kingdom-2'].stockpiles.gold - before.kingdoms['kingdom-2'].stockpiles.gold, state.cities['city-3'].yieldSummary.gold);
  assert.equal(state.eventLog.filter(e => e.type === 'YieldCollected' && e.cityId === 'city-2' && e.turn === 2).length, 1); trip(state);
});

test('capture requires an enemy city center, an owned military party, a ready activation and an attack', () => {
  const state = ready();
  for (const change of [s => { s.parties['party-1'].ownerId = 'kingdom-2'; }, s => { s.parties['party-1'].status = 'defeated'; },
    s => { s.parties['party-1'].activationState = 'ended'; }, s => { s.parties['party-1'].attacksRemaining = 0; },
    s => relocate(s, 'party-1', '3,-3,0'), s => { s.phase = 'TURN_END'; }, s => { s.activePlayerId = 'kingdom-2'; },
    s => { s.gameResult = { outcome: 'draw' }; }, s => destroy(s, 'party-1'), s => { delete s.scenarioObjective; },
    s => { for (const id of s.parties['party-1'].unitIds) s.units[id].typeId = 'settler'; }]) {
    const invalid = structuredClone(state); change(invalid); unchanged(invalid, capture(invalid));
  }
  for (const id of ['missing', 'constructor', '__proto__', null]) { unchanged(state, human.captureCity(state, id, 'city-2')); unchanged(state, human.captureCity(state, 'party-1', id)); }
  unchanged(state, human.captureCity(state, 'party-1', 'city-1'));
  unchanged(state, { ...capture(state), payload: null });
});

test('a garrison blocks movement and capture, whereas defeated historical occupants do not', () => {
  const state = ready({ onCity: false }); relocate(state, 'party-1', '3,-3,0'); relocate(state, 'party-2', capital);
  unchanged(state, human.moveParty(state, 'party-1', [capital])); unchanged(state, capture(state));
  const overlap = structuredClone(state); relocate(overlap, 'party-1', capital); unchanged(overlap, capture(overlap));
  destroy(state, 'party-2'); const moved = apply(state, human.moveParty(state, 'party-1', [capital])); const after = apply(moved, capture(moved));
  assert.equal(after.parties['party-2'].status, 'defeated'); assert.equal(after.gameResult.winnerId, 'kingdom-1'); trip(after);
});

test('an actual attack can defeat the last enemy army without ending conquest, then capture ends it', () => {
  let state = ready({ onCity: false }); relocate(state, 'party-2', capital); relocate(state, 'party-1', '3,-3,0');
  const p = state.parties['party-2']; p.guardOrders = {}; p.unitIds.forEach((id, i) => Object.assign(state.units[id], { hp: i ? 0 : 1, currentHp: i ? 0 : 1, status: i ? 'shattered' : 'active' }));
  state = apply(state, human.attackParty(state, 'party-1', p.id, 'ranged')); assert.equal(state.parties[p.id].status, 'defeated'); assert.equal(state.gameResult, null); trip(state);
  state = apply(state, human.endTurn(state)); state = apply(state, enemy.endTurn(state));
  state = apply(state, human.moveParty(state, 'party-1', [capital])); state = apply(state, capture(state));
  assert.deepEqual(state.gameResult, { outcome: 'victory', winnerId: 'kingdom-1', reason: 'cities-controlled', turn: 2 }); trip(state);
});

test('last-city loss ends immediately even with surviving armies and waiting units, preserving the cityless kingdom', () => {
  const state = ready(); recruit(state); const after = apply(state, capture(state));
  assert.equal(after.phase, 'GAME_OVER'); assert.equal(after.gameResult.reason, 'cities-controlled'); assert.deepEqual(after.kingdoms['kingdom-2'].cityIds, []);
  assert.equal(after.parties['party-2'].status, 'active'); assert.deepEqual(after.units, state.units);
  assert.equal(after.eventLog.filter(e => e.type === 'ScenarioFinished').length, 1); unchanged(after, human.endTurn(after)); assert.deepEqual(runAiTurn(after).commands, []); trip(after);
});

test('cityless human defeat also saves and reloads with the AI winner and surviving human records', () => {
  let state = ready({ onCity: false }); relocate(state, 'party-2', '0,0,0'); state = apply(state, human.endTurn(state));
  state = apply(state, enemy.captureCity(state, 'party-2', 'city-1'));
  assert.equal(state.gameResult.winnerId, 'kingdom-2'); assert.deepEqual(state.kingdoms['kingdom-1'].cityIds, []); assert.equal(state.activePlayerId, 'kingdom-2'); trip(state);
});

test('the city objective permits army rebuilding but still draws at the full-round deadline before income', () => {
  let state = ready({ onCity: false }); destroy(state, 'party-1'); destroy(state, 'party-2'); assert.equal(scenarioOutcome(state), null); trip(state);
  state.currentTurn = 40; state.lastProcessedTurn = 40; state = apply(state, human.endTurn(state)); const before = structuredClone(state);
  state = apply(state, enemy.endTurn(state)); assert.equal(state.gameResult.reason, 'turn-limit'); assert.equal(state.currentTurn, 40); assert.deepEqual(state.kingdoms, before.kingdoms); trip(state);
});

test('save validation rejects forged city outcomes, partial transfers and changed objective types without migration', () => {
  const won = apply(ready(), capture(ready()));
  for (const mutate of [s => { s.gameResult.winnerId = 'kingdom-2'; }, s => { s.gameResult.reason = 'elimination'; }, s => { s.gameResult = null; s.phase = 'PLAYER_ACTION'; },
    s => { s.scenarioObjective.type = 'eliminate-parties'; }, s => { delete s.scenarioObjective; delete s.gameResult; }, s => { delete s.kingdoms['kingdom-2'].aiPolicy; },
    s => { s.kingdoms['kingdom-2'].cityIds.push('city-2'); }, s => { s.world.tiles[capital].ownerId = 'kingdom-2'; }]) {
    const invalid = structuredClone(won); mutate(invalid); assert.throws(() => restoreGameState(serializeGameState(invalid)), /セーブデータ/);
  }
  const old = createAiReinforcementGameState(); old.scenarioObjective.type = 'control-cities'; assert.throws(() => trip(old), /objective/);
});

test('capture validation and AI planning are deterministic and do not read RNG', () => {
  let state = ready({ onCity: false }); relocate(state, 'party-2', '0,0,0'); state = apply(state, human.endTurn(state));
  const before = structuredClone(state), ai = new AIController('kingdom-2'); assert.equal(validateCaptureCity(state, 'kingdom-2', 'party-2', 'city-1').ok, true);
  const next = ai.nextCommand(state); assert.equal(next.type, 'CaptureCity'); assert.deepEqual(state, before);
  Object.defineProperty(state, 'rng', { get() { throw new Error('RNG read during planning'); } }); assert.deepEqual(ai.nextCommand(state), next);
});

test('AI moves toward unguarded enemy cities and captures them through the shared commands', () => {
  let state = ready({ onCity: false }); relocate(state, 'party-1', '-6,6,0'); relocate(state, 'party-2', '2,-2,0'); state.world.tiles['0,0,0'].terrainId = 'plains'; state = apply(state, human.endTurn(state));
  const before = trip(state), result = runAiTurn(state); assert.equal(result.ok, true, result.reason); assert.deepEqual(runAiTurn(before), result);
  assert.deepEqual(result.commands.map(c => c.type), ['MoveParty', 'CaptureCity']); assert.equal(result.state.gameResult.winnerId, 'kingdom-2'); trip(result.state);
});

test('AI prioritizes capture over attacking nearby surviving armies', () => {
  let state = ready({ onCity: false }); relocate(state, 'party-2', '0,0,0'); state = apply(state, human.endTurn(state));
  const next = new AIController('kingdom-2').nextCommand(state); assert.equal(next.type, 'CaptureCity'); const result = executeAiStep(state); assert.equal(result.ok, true); assert.equal(result.state.gameResult.winnerId, 'kingdom-2');
});

test('AI rebuilds after losing its last party while its city survives', () => {
  let state = ready({ onCity: false }); destroy(state, 'party-2'); relocate(state, 'party-1', '-6,6,0'); state = apply(state, human.endTurn(state));
  const result = runAiTurn(state); assert.equal(result.ok, true, result.reason); assert.ok(result.commands.some(c => c.type === 'SetCityProduction')); assert.ok(result.commands.some(c => c.type === 'PurchaseCityItem')); assert.ok(result.commands.some(c => c.type === 'CreateParty'));
  assert.equal(result.state.gameResult, null); assert.ok(Object.values(result.state.parties).some(p => p.ownerId === 'kingdom-2' && p.status === 'active')); trip(result.state);
});

test('AI does not teleport through a guarded or sealed city and always completes a bounded turn', () => {
  let state = ready({ onCity: false }); relocate(state, 'party-1', '0,0,0'); relocate(state, 'party-2', '3,-3,0'); state = apply(state, human.endTurn(state));
  const result = runAiTurn(state); assert.equal(result.ok, true, result.reason); assert.equal(result.commands.some(c => c.type === 'CaptureCity'), false); assert.equal(result.state.cities['city-1'].ownerId, 'kingdom-1');
  const trapped = ready({ onCity: false }); relocate(trapped, 'party-2', '-6,6,0');
  for (let d = 0; d < 6; d++) trapped.world.tiles[Hex.fromKey('0,0,0').neighbor(d).key].terrainId = 'void';
  relocate(trapped, 'party-1', '0,0,0'); const turn = apply(trapped, human.endTurn(trapped)), done = runAiTurn(turn); assert.equal(done.ok, true); assert.ok(done.commands.length <= 129); assert.equal(done.state.gameResult, null);
});

test('recapture updates both ownership lists and cancels new production without duplicating IDs or income', () => {
  let state = ready({ extraCity: true }); state = apply(state, capture(state)); state = apply(state, human.setProduction(state, 'city-2', 'archer'));
  relocate(state, 'party-1', '3,-3,0'); relocate(state, 'party-2', capital); state = apply(state, human.endTurn(state));
  const before = structuredClone(state); state = apply(state, enemy.captureCity(state, 'party-2', 'city-2'));
  assert.deepEqual(state.kingdoms['kingdom-1'].cityIds, ['city-1']); assert.deepEqual(state.kingdoms['kingdom-2'].cityIds, ['city-3', 'city-2']);
  assert.equal(state.cities['city-2'].production.currentItemId, null); assert.deepEqual(state.nextIds, before.nextIds); assert.deepEqual(state.rng, before.rng); trip(state);
});

test('two conquest AIs finish reproducibly across saves under the command and round bounds', () => {
  let state = ready({ onCity: false }); state.kingdoms['kingdom-1'].controllerType = 'ai'; state.kingdoms['kingdom-1'].aiPolicy = 'reinforcements';
  for (let i = 0; i < 80 && !state.gameResult; i++) { const next = runAiTurn(state); assert.equal(next.ok, true, next.reason); assert.ok(next.commands.length <= 129); assert.deepEqual(runAiTurn(trip(state)), next); state = next.state; }
  assert.equal(state.phase, 'GAME_OVER'); assert.ok(state.gameResult.turn <= 40); trip(state);
});


test('AI waits at a costly city approach when its last movement point cannot pay entry, then captures next turn', () => {
  let state = ready({ onCity: false }); relocate(state, 'party-1', '-6,6,0'); relocate(state, 'party-2', '1,-1,0');
  state.world.tiles['0,0,0'].terrainId = 'hills'; state = apply(state, human.endTurn(state)); state.parties['party-2'].movementRemaining = 1;
  const result = runAiTurn(state); assert.equal(result.ok, true); assert.equal(result.state.parties['party-2'].location, '1,-1,0');
  assert.equal(result.commands.some(c => c.type === 'MoveParty' && c.payload.partyId === 'party-2'), false);
  state = apply(result.state, human.endTurn(result.state)); const next = runAiTurn(state); assert.equal(next.ok, true); assert.equal(next.state.gameResult.winnerId, 'kingdom-2'); trip(next.state);
});
