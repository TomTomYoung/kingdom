import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialGameState, addCity, addKingdom, restoreGameState, serializeGameState } from '../src/core/game-state.js';
import { createSettlementGameState, createTwoCityGameState } from '../src/core/scenarios.js';
import { HumanController } from '../src/core/human-controller.js';
import { RuleSystem } from '../src/core/rule-system.js';
import { command, foundCity } from '../src/core/commands.js';
import { RULESET } from '../src/core/ruleset.js';
import { createUnit } from '../src/models/unit.js';
import { createParty } from '../src/models/party.js';
import { validateFoundCity } from '../src/systems/founding-system.js';
import { previewPartyAttack, partyCombatStrength } from '../src/systems/combat-system.js';
import { Hex } from '../src/world/hex.js';

const player = 'kingdom-1', controller = new HumanController(player), site = '4,0,-4';
function execute(state, input) {
  const result = RuleSystem.execute(state, input); assert.equal(result.ok, true, result.reason); return result;
}
function unchanged(state, input) {
  const before = serializeGameState(state), result = RuleSystem.execute(state, input);
  assert.equal(result.ok, false); assert.equal(result.state, state); assert.deepEqual(result.events, []);
  assert.equal(serializeGameState(state), before, 'Unit, territory, stockpiles, IDs, RNG and logs stay unchanged');
  return result;
}
function relocate(state, location) {
  const party = state.parties['party-1']; party.location = location;
  party.unitIds.forEach(id => { state.units[id].location = location; });
}
function ready({ solo = false } = {}) {
  let state = createSettlementGameState(117);
  state = execute(state, controller.startTurn(state)).state; relocate(state, site);
  if (solo) {
    delete state.units['unit-1']; state.kingdoms[player].unitIds = ['unit-2'];
    Object.assign(state.parties['party-1'], { unitIds: ['unit-2'], leaderUnitId: 'unit-2', formation: { 'front-center': 'unit-2' } });
  }
  return state;
}
const found = state => controller.foundCity(state, 'party-1', 'unit-2');
const roundTrip = state => assert.deepEqual(restoreGameState(serializeGameState(state)), state);

test('Settlers can be produced and purchased at the selected city with the configured costs', () => {
  let state = createTwoCityGameState(); state.kingdoms[player].stockpiles.gold = 400;
  const beforePopulation = state.cities['city-2'].population;
  state = execute(state, controller.purchaseItem(state, 'city-2', 'settler')).state;
  assert.equal(state.kingdoms[player].stockpiles.gold, 280);
  assert.equal(state.cities['city-2'].population, beforePopulation);
  let settler = Object.values(state.units).find(unit => unit.typeId === 'settler');
  assert.equal(settler.location, state.cities['city-2'].centerHex); assert.equal(settler.partyId, null);
  assert.equal(settler.meleeStrength, 0); assert.equal(settler.guardCapacityMax, 0);
  state = execute(state, controller.setProduction(state, 'city-1', 'settler')).state;
  for (let turn = 0; turn < 20 && Object.values(state.units).filter(unit => unit.typeId === 'settler').length < 2; turn++) state = execute(state, controller.endTurn(state)).state;
  assert.equal(Object.values(state.units).filter(unit => unit.typeId === 'settler').length, 2);
  const event = state.eventLog.find(entry => entry.itemId === 'settler' && entry.source === 'production');
  assert.equal(state.units[event.entityId].location, '0,0,0'); roundTrip(state);
  const poor = ready(); poor.kingdoms[player].stockpiles.gold = 119;
  unchanged(poor, controller.purchaseItem(poor, 'city-1', 'settler'));
});

test('founding consumes exactly the selected settler, preserves escorts and existing cities, and ends party actions', () => {
  const state = ready(), party = state.parties['party-1'];
  party.leaderUnitId = 'unit-2'; party.formation = { 'front-center': 'unit-1', 'middle-center': 'unit-2' };
  party.guardOrders['unit-1'] = { targetUnitId: 'unit-2', mode: 'share' };
  const result = execute(state, found(state)), next = result.state, city = next.cities['city-2'];
  assert.equal(city.population, 1); assert.equal(city.centerHex, site);
  assert.deepEqual(next.kingdoms[player].cityIds, ['city-1', 'city-2']);
  assert.deepEqual(next.kingdoms[player].unitIds, ['unit-1']); assert.equal(next.units['unit-2'], undefined);
  assert.equal(next.units['unit-1'].partyId, party.id); assert.deepEqual(next.units['unit-1'], state.units['unit-1']);
  assert.deepEqual(next.parties[party.id].formation, { 'front-center': 'unit-1' });
  assert.equal(next.parties[party.id].leaderUnitId, 'unit-1'); assert.deepEqual(next.parties[party.id].guardOrders, {});
  assert.equal(next.parties[party.id].movementRemaining, 0); assert.equal(next.parties[party.id].attacksRemaining, 0);
  assert.equal(next.parties[party.id].activationState, 'ended'); assert.equal(next.parties[party.id].morale, party.morale);
  assert.deepEqual(next.cities['city-1'], state.cities['city-1']);
  assert.deepEqual(next.rng, state.rng); assert.equal(next.nextIds.city, 3); assert.equal(next.nextIds.unit, state.nextIds.unit);
  assert.ok(result.events.some(event => event.type === 'CityFounded' && event.settlerUnitId === 'unit-2'));
  assert.equal(state.units['unit-2'].typeId, 'settler', 'input state is not mutated'); roundTrip(next);
  unchanged(next, found(next)); unchanged(next, result.state.commandLog.at(-1));
});

test('a solo settler removes its empty party and leaves a city without dangling references', () => {
  const state = ready({ solo: true }), next = execute(state, found(state)).state;
  assert.deepEqual(next.parties, {}); assert.deepEqual(next.units, {}); assert.deepEqual(next.kingdoms[player].unitIds, []);
  roundTrip(next);
  const resumed = execute(next, controller.endTurn(next)).state;
  assert.equal(Object.keys(resumed.cities).length, 2); assert.deepEqual(resumed.units, {}); roundTrip(resumed);
});

test('two settlers consume one selected Unit; dead escorts remain valid defeated history', () => {
  const state = ready(), party = state.parties['party-1'];
  const extra = createUnit('unit-3', player, 'settler', site); extra.partyId = party.id;
  state.units[extra.id] = extra; state.nextIds.unit = 4; state.kingdoms[player].unitIds.push(extra.id);
  party.unitIds.push(extra.id); party.formation['rear-left'] = extra.id;
  const next = execute(state, controller.foundCity(state, party.id, extra.id)).state;
  assert.ok(next.units['unit-2']); assert.equal(next.units['unit-3'], undefined); roundTrip(next);
  const dead = ready(); dead.units['unit-1'].currentHp = dead.units['unit-1'].hp = 0; dead.units['unit-1'].status = 'shattered';
  dead.parties['party-1'].leaderUnitId = 'unit-2';
  const result = execute(dead, found(dead)).state;
  assert.equal(result.parties['party-1'].status, 'defeated'); assert.equal(result.parties['party-1'].reactionCharges, 0); roundTrip(result);
});

test('new city claims only unowned non-Void neighbors and never transfers existing territory', () => {
  const state = ready(), center = Hex.fromKey(site);
  const own = state.world.tiles[center.neighbor(0).key], foreign = state.world.tiles[center.neighbor(1).key], voidTile = state.world.tiles[center.neighbor(2).key];
  own.ownerId = player; own.territoryCityId = 'city-1';
  state.world.tiles['-6,6,0'].terrainId = 'plains';
  addKingdom(state, { id: 'kingdom-2', name: '隣国', cityId: 'city-8', cityName: '隣都', centerHex: '-6,6,0' });
  foreign.ownerId = 'kingdom-2'; foreign.territoryCityId = 'city-8'; voidTile.terrainId = 'void';
  const next = execute(state, found(state)).state;
  assert.equal(next.world.tiles[site].cityId, 'city-9');
  assert.deepEqual(next.world.tiles[own.key], own); assert.deepEqual(next.world.tiles[foreign.key], foreign); assert.deepEqual(next.world.tiles[voidTile.key], voidTile);
  assert.ok(next.eventLog.at(-1).claimedTileKeys.includes(site)); roundTrip(next);
});

test('founding at the edge claims only existing neighbors and every permitted terrain is usable', () => {
  for (const terrainId of RULESET.founding.terrainIds) {
    const state = ready({ solo: true }); relocate(state, '10,0,-10'); state.world.tiles['10,0,-10'].terrainId = terrainId;
    const result = execute(state, found(state)), keys = result.events.find(event => event.type === 'CityFounded').claimedTileKeys;
    assert.ok(keys.length <= 4); assert.ok(keys.includes('10,0,-10')); roundTrip(result.state);
  }
});

test('founding grants no immediate income and the new city collects exactly once at next turn start', () => {
  const state = ready(), next = execute(state, found(state)).state, city = next.cities['city-2'];
  assert.deepEqual(next.kingdoms[player].stockpiles, state.kingdoms[player].stockpiles);
  assert.deepEqual(next.kingdoms[player].progress, state.kingdoms[player].progress);
  assert.deepEqual(next.kingdoms[player].humanResources, state.kingdoms[player].humanResources);
  assert.equal(city.foodStorage, 0); assert.equal(city.localCultureProgress, 0); assert.deepEqual(city.workedTiles, []);
  assert.ok(Object.values(city.yieldSummary).every(amount => amount === 0));
  assert.equal(next.eventLog.filter(event => event.cityId === city.id && event.type === 'YieldCollected').length, 0);
  const result = execute(next, controller.endTurn(next)), resumed = result.state;
  assert.equal(result.events.filter(event => event.cityId === city.id && event.type === 'YieldCollected').length, 1);
  assert.equal(resumed.kingdoms[player].stockpiles.gold - next.kingdoms[player].stockpiles.gold, Object.values(resumed.cities).reduce((sum, c) => sum + c.yieldSummary.gold, 0));
  assert.equal(resumed.cities[city.id].foodStorage, resumed.cities[city.id].yieldSummary.food);
  assert.equal(resumed.parties['party-1'].movementRemaining, 2);
  unchanged(resumed, controller.startTurn(resumed)); roundTrip(resumed);
});

test('FoundCity rejects malformed payloads and references atomically', () => {
  const state = ready();
  for (const payload of [null, [], {}, { partyId: 'party-1' }, { partyId: 'party-1', settlerUnitId: null }, { partyId: 'constructor', settlerUnitId: 'unit-2' }, { partyId: 'party-1', settlerUnitId: '__proto__' }, { partyId: 'party-1', settlerUnitId: 'unit-1' }]) unchanged(state, command('FoundCity', player, 1, payload, 'bad'));
  unchanged(state, foundCity(player, 2, 'party-1', 'unit-2', 'wrong-turn'));
  for (const mutate of [
    s => { s.phase = 'TURN_END'; }, s => { s.activePlayerId = 'kingdom-2'; },
    s => { s.parties['party-1'].ownerId = 'kingdom-2'; }, s => { s.parties['party-1'].status = 'defeated'; },
    s => { s.units['unit-2'].ownerId = 'kingdom-2'; }, s => { s.units['unit-2'].partyId = null; },
    s => { s.parties['party-1'].unitIds = ['unit-1']; }, s => { s.units['unit-2'].location = '0,0,0'; },
    s => { s.units['unit-2'].status = 'shattered'; }, s => { s.units['unit-2'].currentHp = 0; },
    s => { s.nextIds.city = 1; }, s => { s.nextIds.city = Number.MAX_SAFE_INTEGER; },
  ]) { const value = structuredClone(state); mutate(value); unchanged(value, found(value)); }
});

test('owned, Void, missing, occupied or too-close sites reject without side effects; distance four is legal', () => {
  for (const mutate of [
    s => { s.world.tiles[site].ownerId = player; s.world.tiles[site].territoryCityId = 'city-1'; },
    s => { s.world.tiles[site].ownerId = 'kingdom-2'; }, s => { s.world.tiles[site].terrainId = 'void'; },
    s => { s.world.tiles[site].cityId = 'city-1'; }, s => { delete s.world.tiles[site]; },
    s => { relocate(s, '3,0,-3'); }, s => { s.parties['party-9'] = createParty('party-9', player, ['unit-9'], site); },
    s => { s.units.enemy = createUnit('enemy', 'kingdom-2', 'warrior', site); },
    s => { s.world.tiles['7,0,-7'].terrainId = 'plains'; addKingdom(s, { id: 'kingdom-2', name: '敵', cityId: 'city-2', cityName: '敵都', centerHex: '7,0,-7' }); },
  ]) { const state = ready(); mutate(state); unchanged(state, found(state)); }
  const state = ready(); state.parties.old = { status: 'defeated', location: site };
  assert.equal(validateFoundCity(state, player, 'party-1', 'unit-2').ok, true, 'defeated history does not occupy land');
});

test('moving can be followed by founding with remaining movement; exhausted or ended parties must wait', () => {
  let state = ready(); relocate(state, '3,0,-3');
  state = execute(state, controller.moveParty(state, 'party-1', [site])).state;
  assert.equal(state.parties['party-1'].movementRemaining, 1); execute(state, found(state));
  for (const mutate of [s => { s.parties['party-1'].movementRemaining = 0; }, s => { s.parties['party-1'].activationState = 'ended'; }]) {
    const value = ready(); mutate(value); unchanged(value, found(value));
    const resumed = execute(value, controller.endTurn(value)).state; execute(resumed, found(resumed));
  }
});

test('legacy saves acquire a safe city sequence without changing economy, logs, map or RNG', () => {
  for (const state of [createInitialGameState(77, { radius: 3 }), createTwoCityGameState(), ready()]) {
    const legacy = structuredClone(state); delete legacy.nextIds.city;
    const restored = restoreGameState(JSON.stringify(legacy)); assert.deepEqual(restored, state);
  }
  const state = ready(); state.world.tiles['-6,6,0'].terrainId = 'plains';
  addCity(state, { ownerId: player, id: 'city-42', centerHex: '-6,6,0' }); delete state.nextIds.city;
  const migrated = restoreGameState(JSON.stringify(state)); assert.equal(migrated.nextIds.city, 43);
  assert.equal(execute(migrated, found(migrated)).state.world.tiles[site].cityId, 'city-43');
  for (const counter of [0, 1, null, -1, 2.5, '43', Number.MAX_SAFE_INTEGER + 1]) {
    const bad = structuredClone(migrated); bad.nextIds.city = counter; assert.throws(() => restoreGameState(JSON.stringify(bad)), /nextIds.city/);
  }
});

test('saved founding commands continue deterministically and a second city never reuses IDs', () => {
  let state = ready(); const restored = restoreGameState(serializeGameState(state));
  assert.deepEqual(execute(state, found(state)), execute(restored, found(restored)));
  state = execute(state, found(state)).state;
  state.kingdoms[player].stockpiles.gold = 500;
  state = execute(state, controller.purchaseItem(state, 'city-1', 'settler')).state;
  const settler = state.units['unit-3'];
  state = execute(state, controller.createParty(state, [settler.id], settler.location)).state;
  const party = state.parties['party-2']; party.location = '-5,0,5'; state.units[settler.id].location = party.location;
  state.world.tiles[party.location].terrainId = 'plains';
  state = execute(state, controller.foundCity(state, party.id, settler.id)).state;
  assert.equal(state.cities['city-3'].centerHex, '-5,0,5'); assert.equal(state.nextIds.city, 4); roundTrip(state);
});

test('civilian parties cannot attack or counterattack, but remain valid targets; escorts retain their offense', () => {
  const state = ready({ solo: true });
  state.world.tiles['-6,6,0'].terrainId = 'plains';
  addKingdom(state, { id: 'kingdom-2', name: '敵', cityId: 'city-2', cityName: '敵都', centerHex: '-6,6,0' });
  const enemy = createUnit('unit-3', 'kingdom-2', 'warrior', '5,0,-5'); enemy.partyId = 'party-2';
  state.world.tiles[enemy.location].terrainId = 'plains'; state.units[enemy.id] = enemy;
  state.kingdoms['kingdom-2'].unitIds.push(enemy.id); state.parties['party-2'] = createParty('party-2', enemy.ownerId, [enemy.id], enemy.location);
  state.nextIds.unit = 4; state.nextIds.party = 3;
  unchanged(state, controller.attackParty(state, 'party-1', 'party-2'));
  state.activePlayerIndex = 1; state.activePlayerId = enemy.ownerId;
  const preview = previewPartyAttack(state, 'party-2', 'party-1'); assert.equal(preview.ok, true); assert.equal(preview.counter, 'none');
  const other = new HumanController(enemy.ownerId), result = execute(state, other.attackParty(state, 'party-2', 'party-1'));
  assert.ok(result.state.units['unit-2'].currentHp < 100); assert.equal(result.state.units[enemy.id].currentHp, 100);
  assert.ok(!result.events.some(event => event.counter)); roundTrip(result.state);
  const escorted = ready(); assert.equal(partyCombatStrength(escorted, escorted.parties['party-1']), 20);
});
