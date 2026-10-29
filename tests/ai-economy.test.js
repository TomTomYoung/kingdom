import test from 'node:test';
import assert from 'node:assert/strict';
import { createAiReinforcementGameState, createAiSkirmishGameState } from '../src/core/scenarios.js';
import { addCity, restoreGameState, serializeGameState } from '../src/core/game-state.js';
import { AIController, runAiTurn, executeAiStep } from '../src/core/ai-controller.js';
import { chooseSupplyCommand, chooseDeploymentCommand, chooseCityExitCommand, recruitmentNeeds } from '../src/core/ai-economy.js';
import { HumanController } from '../src/core/human-controller.js';
import { RuleSystem } from '../src/core/rule-system.js';
import { RULESET } from '../src/core/ruleset.js';
import { createUnit } from '../src/models/unit.js';
import { Hex } from '../src/world/hex.js';

const player = 'kingdom-2', human = new HumanController('kingdom-1'), ai = new AIController(player), capital = '4,-4,0';
function apply(state, input) { const result = RuleSystem.execute(state, input); assert.equal(result.ok, true, result.reason); return result.state; }
function ready() { let state = createAiReinforcementGameState(); return apply(state, human.startTurn(state)); }
function aiTurn() { let state = ready(); return apply(state, human.endTurn(state)); }
function relocate(state, id, key) { const p = state.parties[id]; p.location = key; p.unitIds.forEach(id => { state.units[id].location = key; }); state.world.tiles[key].terrainId = 'plains'; }
function recruit(state, type = 'warrior', key = capital, owner = player) {
  const id = `unit-${state.nextIds.unit++}`, unit = createUnit(id, owner, type, key);
  state.units[id] = unit; state.kingdoms[owner].unitIds.push(id); return unit;
}
function stop(state, id = 'party-2') { Object.assign(state.parties[id], { movementRemaining: 0, attacksRemaining: 0, activationState: 'ended' }); }
const roundTrip = state => restoreGameState(serializeGameState(state));

// Tactical saves do not silently acquire the new military supply policy.
test('reinforcement scenario is explicit and older tactical saves preserve both state and command choices', () => {
  const state = ready(); assert.equal(state.scenarioId, 'ai-reinforcements'); assert.equal(state.kingdoms[player].aiPolicy, 'reinforcements');
  assert.deepEqual(roundTrip(state), state); assert.equal(state.scenarioObjective.type, 'eliminate-parties');
  const old = createAiSkirmishGameState(), restored = roundTrip(old);
  assert.deepEqual(restored, old); assert.equal(Object.hasOwn(restored.kingdoms[player], 'aiPolicy'), false);
  let turn = apply(old, human.startTurn(old)); turn = apply(turn, human.endTurn(turn));
  assert.deepEqual(runAiTurn(turn).commands.map(c => c.type), ['MoveParty', 'AttackParty', 'EndTurn']);
});

test('supply planning is deterministic, read-only and does not read RNG', () => {
  const state = aiTurn(); stop(state); const before = structuredClone(state);
  const next = ai.nextCommand(state); assert.equal(next.type, 'SetCityProduction'); assert.equal(next.payload.itemId, 'warrior');
  assert.deepEqual(state, before); assert.deepEqual(ai.nextCommand(state), next);
  Object.defineProperty(state, 'rng', { get() { throw new Error('supply planning must not read RNG'); } });
  assert.deepEqual(ai.nextCommand(state), next);
});

test('new production uses an idle owned city and does not overwrite existing progress or queues', () => {
  let state = aiTurn(); stop(state);
  state.cities['city-1'].production.currentItemId = 'monument';
  state = apply(state, ai.nextCommand(state));
  assert.equal(state.cities['city-2'].production.currentItemId, 'warrior'); assert.equal(state.cities['city-1'].production.currentItemId, 'monument');
  const city = state.cities['city-2']; city.production.progressByItem.warrior = 7; city.production.queue = ['archer', 'monument'];
  const before = structuredClone(city.production); const next = chooseSupplyCommand(state, player, 'supply-1');
  assert.notEqual(next?.type, 'SetCityProduction'); assert.deepEqual(city.production, before);
  assert.deepEqual(roundTrip(state), state);
});

test('unit selection balances live and queued types at a 2:2:1 ratio', () => {
  const state = aiTurn(); state.kingdoms[player].stockpiles.gold = 1000;
  const city = state.cities['city-2']; city.production.currentItemId = 'warrior'; city.production.queue = ['warrior'];
  let next = chooseSupplyCommand(state, player, 'balance-1'); assert.equal(next.payload.itemId, 'archer');
  recruit(state, 'archer'); recruit(state, 'archer');
  next = chooseSupplyCommand(state, player, 'balance-2'); assert.equal(next.payload.itemId, 'ballista');
  assert.equal(recruitmentNeeds(state, player).total, 9);
});

test('purchases pay the full cost, preserve a Gold reserve and fall back to an affordable combat type', () => {
  let state = aiTurn(); stop(state); state.cities['city-2'].production.currentItemId = 'warrior';
  state.kingdoms[player].stockpiles.gold = 71; assert.equal(chooseSupplyCommand(state, player, 'poor'), null);
  state.kingdoms[player].stockpiles.gold = 72;
  const input = chooseSupplyCommand(state, player, 'exact'); assert.equal(input.payload.itemId, 'warrior');
  const before = structuredClone(state); state = apply(state, input);
  assert.equal(state.kingdoms[player].stockpiles.gold, 24);
  assert.deepEqual(state.kingdoms[player].progress, before.kingdoms[player].progress); assert.deepEqual(state.rng, before.rng);
  assert.equal(state.nextIds.unit, before.nextIds.unit + 1);
  assert.equal(state.units[`unit-${before.nextIds.unit}`].location, capital);
  const richer = aiTurn(); richer.cities['city-2'].production.currentItemId = 'warrior'; richer.kingdoms[player].stockpiles.gold = 96;
  assert.equal(chooseSupplyCommand(richer, player, 'archer').payload.itemId, 'archer');
});

test('purchase limits survive a mid-turn save and identical AI continuation creates no duplicate purchases', () => {
  let state = aiTurn(); stop(state); state.kingdoms[player].stockpiles.gold = 1000;
  state = apply(state, ai.nextCommand(state)); state = apply(state, ai.nextCommand(state));
  assert.equal(state.commandLog.at(-1).type, 'PurchaseCityItem');
  const restored = roundTrip(state); assert.deepEqual(runAiTurn(restored), runAiTurn(state));
  const result = runAiTurn(restored); assert.equal(result.ok, true);
  assert.equal(result.state.commandLog.filter(c => c.playerId === player && c.turn === 1 && c.type === 'PurchaseCityItem').length, 1);
  assert.ok(result.commands.some(c => c.type === 'CreateParty'));
});

test('pending production reserves capacity; dead and civilian units do not consume it', () => {
  const state = aiTurn();
  for (let i = 0; i < 9; i++) recruit(state);
  recruit(state, 'settler'); const dead = recruit(state); Object.assign(dead, { hp: 0, currentHp: 0, status: 'shattered' });
  state.cities['city-2'].production.currentItemId = 'archer';
  assert.equal(recruitmentNeeds(state, player).total, RULESET.aiRecruitment.maxCombatUnits);
  assert.equal(chooseSupplyCommand(state, player, 'capped'), null);
  state.cities['city-2'].production.currentItemId = null;
  assert.equal(chooseSupplyCommand(state, player, 'last-slot')?.type, undefined, 'five waiting troops hold new production until deployment');
  // Moving existing recruits away from the city permits exactly the remaining reservation.
  for (const u of Object.values(state.units)) if (u.partyId === null) u.location = '5,-5,0';
  const next = chooseSupplyCommand(state, player, 'last-slot'); assert.equal(next.type, 'SetCityProduction');
  const after = apply(state, next); assert.equal(recruitmentNeeds(after, player).total, 15);
  assert.equal(chooseSupplyCommand(after, player, 'no-overcommit'), null);
});

test('deployment groups up to five live military units at one free location with valid references', () => {
  const state = aiTurn();
  for (let i = 0; i < 7; i++) recruit(state, i % 2 ? 'archer' : 'warrior');
  const civilian = recruit(state, 'settler'), foreign = recruit(state, 'warrior', capital, 'kingdom-1'), dead = recruit(state);
  Object.assign(dead, { hp: 0, currentHp: 0, status: 'shattered' });
  const next = chooseDeploymentCommand(state, player, 'deploy'); assert.equal(next.type, 'CreateParty'); assert.equal(next.payload.unitIds.length, 5);
  assert.equal(next.payload.unitIds.includes(civilian.id), false); assert.equal(next.payload.unitIds.includes(foreign.id), false); assert.equal(next.payload.unitIds.includes(dead.id), false);
  const after = apply(state, next), party = after.parties[`party-${state.nextIds.party}`];
  assert.equal(party.location, capital); party.unitIds.forEach(id => assert.equal(after.units[id].partyId, party.id));
  assert.equal(chooseDeploymentCommand(after, player, 'blocked'), null); assert.deepEqual(roundTrip(after), after);
});

test('a friendly city blocker leaves by a legal path, then waiting troops deploy and join combat', () => {
  let state = aiTurn(); relocate(state, 'party-2', capital); const unit = recruit(state, 'archer');
  const input = ai.nextCommand(state); assert.equal(input.type, 'MoveParty'); assert.equal(input.payload.partyId, 'party-2');
  const first = executeAiStep(state); assert.equal(first.ok, true); assert.notEqual(first.state.parties['party-2'].location, capital);
  assert.equal(state.parties['party-2'].location, capital, 'input remains unchanged');
  const next = ai.nextCommand(first.state); assert.equal(next.type, 'CreateParty'); assert.deepEqual(next.payload.unitIds, [unit.id]);
  const result = runAiTurn(first.state); assert.equal(result.ok, true);
  const newId = result.state.units[unit.id].partyId;
  assert.ok(result.commands.some(c => c.type === 'MoveParty' && c.payload.partyId === newId));
  assert.ok(result.commands.some(c => c.type === 'AttackParty' && c.payload.attackerPartyId === newId));
  assert.deepEqual(roundTrip(result.state), result.state);
});

test('a city is also cleared for an affordable purchase but exhausted blockers cannot be teleported', () => {
  const state = aiTurn(); relocate(state, 'party-2', capital);
  const next = chooseCityExitCommand(state, player, 'clear'); assert.equal(next.type, 'MoveParty');
  stop(state); recruit(state); assert.equal(chooseCityExitCommand(state, player, 'exhausted'), null);
  assert.equal(chooseDeploymentCommand(state, player, 'occupied'), null);
  state.cities['city-2'].production.currentItemId = 'warrior';
  assert.equal(chooseSupplyCommand(state, player, 'occupied-purchase'), null);
});

test('enemy occupation and an impassable city exit cannot trigger illegal purchases or endless retry', () => {
  const enemy = aiTurn(); relocate(enemy, 'party-1', capital); recruit(enemy);
  assert.equal(chooseSupplyCommand(enemy, player, 'occupied'), null); assert.equal(chooseDeploymentCommand(enemy, player, 'occupied'), null);
  assert.equal(chooseCityExitCommand(enemy, player, 'occupied'), null);
  const trapped = aiTurn(); relocate(trapped, 'party-2', capital); recruit(trapped);
  for (let d = 0; d < 6; d++) trapped.world.tiles[Hex.fromKey(capital).neighbor(d).key].terrainId = 'void';
  relocate(trapped, 'party-1', '-5,5,0');
  trapped.cities['city-2'].production.currentItemId = 'warrior';
  const result = runAiTurn(trapped); assert.equal(result.ok, true); assert.deepEqual(result.commands.map(c => c.type), ['EndTurn']);
});

test('two AI cities use shared Gold, separate production and at most one purchase each per turn', () => {
  let state = aiTurn(); state.world.tiles['-4,4,0'].terrainId = 'plains';
  addCity(state, { ownerId: player, id: 'city-3', centerHex: '-4,4,0' });
  stop(state); state.kingdoms[player].stockpiles.gold = 200;
  const before = state.kingdoms[player].stockpiles.gold;
  const result = runAiTurn(state); assert.equal(result.ok, true, result.reason);
  const orders = result.commands.filter(c => c.type === 'SetCityProduction'); assert.deepEqual(orders.map(c => c.payload.cityId), ['city-2', 'city-3']);
  const buys = result.commands.filter(c => c.type === 'PurchaseCityItem'); assert.equal(buys.length, 2);
  assert.equal(new Set(buys.map(c => c.payload.cityId)).size, 2);
  const spent = buys.reduce((sum, c) => sum + RULESET.items[c.payload.itemId].purchaseOptions.gold, 0);
  const income = result.events.filter(e => e.type === 'YieldCollected' && e.cityId !== 'city-1').reduce((sum, e) => sum + e.breakdown.total.gold, 0);
  assert.equal(result.state.kingdoms[player].stockpiles.gold, before - spent + income); assert.ok(before - spent >= 24);
  assert.equal(result.state.cities['city-1'].production.currentItemId, null); assert.deepEqual(roundTrip(result.state), result.state);
});

test('normal turn-start production completes into waiting units that the AI deploys', () => {
  let state = ready(), produced;
  for (let i = 0; i < 12 && !state.gameResult; i++) {
    state = apply(state, human.endTurn(state)); const result = runAiTurn(state); assert.equal(result.ok, true); state = result.state;
    produced = state.eventLog.find(event => event.type === 'ItemCompleted' && event.source === 'production' && event.cityId === 'city-2' && state.units[event.entityId].partyId);
    if (produced) break;
  }
  assert.ok(produced); assert.ok(state.parties[state.units[produced.entityId].partyId]); assert.deepEqual(roundTrip(state), state);
});

test('recruitment policy cannot change completed outcomes or rescue a kingdom using waiting troops', () => {
  let state = ready(); relocate(state, 'party-2', '2,-2,0'); recruit(state, 'warrior');
  const party = state.parties['party-2']; party.guardOrders = {};
  party.unitIds.forEach((id, i) => Object.assign(state.units[id], { hp: i ? 0 : 1, currentHp: i ? 0 : 1, status: i ? 'shattered' : 'active' }));
  state = apply(state, human.attackParty(state, 'party-1', 'party-2', 'ranged'));
  assert.equal(state.gameResult.winnerId, 'kingdom-1'); assert.equal(ai.nextCommand(state), null);
  assert.deepEqual(runAiTurn(state).commands, []); assert.deepEqual(roundTrip(state), state);
});

test('unknown policies and reinforcement saves missing their required policy or objective reject atomically', () => {
  for (const invalid of [null, false, {}, 'remote', '']) { const state = ready(); state.kingdoms[player].aiPolicy = invalid; assert.throws(() => roundTrip(state), /aiPolicy/); }
  const missing = ready(); delete missing.kingdoms[player].aiPolicy; assert.throws(() => roundTrip(missing), /aiPolicy/);
  const noObjective = ready(); delete noObjective.scenarioObjective; delete noObjective.gameResult; assert.throws(() => roundTrip(noObjective), /scenario/);
  const tactical = createAiSkirmishGameState(); tactical.kingdoms[player].aiPolicy = 'tactical'; assert.deepEqual(roundTrip(tactical), tactical);
});

test('both reinforcement AIs complete bounded turns and a reproducible match across saves', () => {
  let state = ready(); state.kingdoms['kingdom-1'].controllerType = 'ai'; state.kingdoms['kingdom-1'].aiPolicy = 'reinforcements';
  for (let turn = 0; turn < 80 && !state.gameResult; turn++) {
    const direct = runAiTurn(state), restored = runAiTurn(roundTrip(state)); assert.deepEqual(direct, restored); assert.equal(direct.ok, true, direct.reason);
    assert.ok(direct.commands.length <= 129); state = direct.state;
  }
  assert.equal(state.phase, 'GAME_OVER'); assert.ok(state.gameResult.turn <= 40);
});
