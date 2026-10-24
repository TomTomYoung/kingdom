import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialGameState, addCity, addKingdom, restoreGameState, serializeGameState } from '../src/core/game-state.js';
import { createDuelGameState, createRangedDuelGameState, createTwoCityGameState } from '../src/core/scenarios.js';
import { HumanController } from '../src/core/human-controller.js';
import { RuleSystem } from '../src/core/rule-system.js';
import { calculateCityYields } from '../src/systems/yield-system.js';
import { expandTerritory, getTerritoryCandidates, tilePurchaseCost } from '../src/systems/territory-system.js';
import { getCityTerritoryTiles, claimTileForCity, assignLegacyCityTerritories } from '../src/systems/city-territory.js';

const controller = new HumanController('kingdom-1');
const execute = (state, command) => { const result = RuleSystem.execute(state, command); assert.equal(result.ok, true, result.reason); return result; };
const restore = state => restoreGameState(serializeGameState(state));
const candidateKeys = (state, cityId) => getTerritoryCandidates(state, state.cities[cityId]).map(tile => tile.key);
const allocations = state => Object.fromEntries(Object.values(state.world.tiles).map(tile => [tile.key, tile.territoryCityId]));

function assertExclusiveWork(state) {
  const seen = new Set();
  for (const city of Object.values(state.cities)) {
    assert.ok(city.workedTiles.length <= city.population);
    for (const key of city.workedTiles) {
      const tile = state.world.tiles[key];
      assert.equal(seen.has(key), false, `duplicate worked tile ${key}`); seen.add(key);
      assert.equal(tile.territoryCityId, city.id); assert.equal(tile.ownerId, city.ownerId);
      assert.notEqual(tile.terrainId, 'void');
    }
  }
}

test('single-city allocation preserves established yields, center meaning and 37/331-cell starts', () => {
  for (const radius of [3, 10]) {
    const state = createInitialGameState(117, { radius, startingParty: true }), city = state.cities['city-1'];
    assert.equal(state.cityTerritoryVersion, 1);
    assert.equal(Object.keys(state.world.tiles).length, radius === 3 ? 37 : 331);
    assert.deepEqual(city.workedTiles, ['-1,1,0', radius === 3 ? '0,-1,1' : '1,-1,0']);
    assert.deepEqual(city.yieldSummary, { food: 5, production: 4, gold: 2, science: 1, mana: 0, religion: 0, culture: 2 });
    assert.equal(getCityTerritoryTiles(state, city).length, 7);
    for (const tile of Object.values(state.world.tiles)) {
      assert.equal(tile.territoryCityId, tile.ownerId === null ? null : city.id);
      assert.equal(tile.cityId, tile.key === city.centerHex ? city.id : null);
    }
    assert.equal(state.kingdoms['kingdom-1'].derived.militaryPower, 12);
    assert.deepEqual(restore(state), state);
  }
});

test('two-city setup is one kingdom with separate land, economy and the initial party intact', () => {
  const state = createTwoCityGameState(), single = createInitialGameState(117, { startingParty: true });
  assert.equal(state.scenarioId, 'two-cities'); assert.deepEqual(state.turnOrder, ['kingdom-1']);
  assert.deepEqual(state.kingdoms['kingdom-1'].cityIds, ['city-1', 'city-2']);
  assert.equal(state.cities['city-2'].centerHex, '4,-4,0');
  assert.equal(getCityTerritoryTiles(state, state.cities['city-2']).length, 7);
  assert.deepEqual(state.parties, single.parties); assert.deepEqual(state.units, single.units);
  assert.deepEqual(state.rng, single.rng); assert.deepEqual(state.kingdoms['kingdom-1'].stockpiles, single.kingdoms['kingdom-1'].stockpiles);
  assert.deepEqual(state.cities['city-1'], single.cities['city-1']);
  assertExclusiveWork(state); assert.deepEqual(restore(state), state);
  for (const create of [createDuelGameState, createRangedDuelGameState]) {
    const duel = create();
    for (const tile of Object.values(duel.world.tiles).filter(tile => tile.ownerId !== null)) assert.equal(duel.cities[tile.territoryCityId].ownerId, tile.ownerId);
    assert.deepEqual(restore(duel), duel);
  }
});

test('K-05: every tile contributes to at most one city regardless of city processing order', () => {
  const state = createTwoCityGameState();
  for (const city of Object.values(state.cities)) city.population = 20;
  for (const city of Object.values(state.cities)) calculateCityYields(state, city);
  assertExclusiveWork(state);
  assert.equal(Object.values(state.cities).flatMap(city => city.workedTiles).length, 14);
  const before = structuredClone(state.cities);
  for (const city of Object.values(state.cities).reverse()) calculateCityYields(state, city);
  assert.deepEqual(state.cities, before);
  assert.ok(!state.cities['city-1'].workedTiles.includes(state.cities['city-2'].centerHex));
  const affected = state.world.tiles[state.cities['city-2'].workedTiles[0]];
  affected.terrainId = 'void';
  calculateCityYields(state, state.cities['city-2']);
  assert.equal(state.cities['city-2'].workedTiles.length, 6);
  assertExclusiveWork(state);
});

test('territory candidates follow each city boundary and may share an unclaimed frontier', () => {
  const state = createTwoCityGameState(), before = serializeGameState(state);
  const first = candidateKeys(state, 'city-1'), second = candidateKeys(state, 'city-2');
  assert.ok(first.includes('2,-2,0') && second.includes('2,-2,0'));
  assert.ok(first.includes('-2,2,0') && !second.includes('-2,2,0'));
  assert.ok(second.includes('6,-6,0') && !first.includes('6,-6,0'));
  assert.equal(serializeGameState(state), before, 'candidate lookup is read-only');
  state.world.tiles['5,-5,0'].terrainId = 'void';
  assert.ok(!candidateKeys(state, 'city-2').includes('6,-6,0'), 'owned Void is not a source of adjacency');
});

test('Gold buys for the selected city, rejects remote-city borders atomically and claims shared land once', () => {
  let state = createTwoCityGameState(); state.kingdoms['kingdom-1'].stockpiles.gold = 1000;
  const before = serializeGameState(state), remote = controller.purchaseTile(state, 'city-1', '6,-6,0');
  const rejected = RuleSystem.execute(state, remote);
  assert.equal(rejected.ok, false); assert.equal(rejected.state, state); assert.deepEqual(rejected.events, []);
  assert.equal(serializeGameState(state), before);
  const key = '2,-2,0', cost = tilePurchaseCost(state, state.cities['city-2'], state.world.tiles[key]);
  const culture = Object.values(state.cities).map(city => city.localCultureProgress), rng = structuredClone(state.rng);
  const bought = execute(state, controller.purchaseTile(state, 'city-2', key)); state = bought.state;
  assert.equal(state.world.tiles[key].ownerId, 'kingdom-1'); assert.equal(state.world.tiles[key].territoryCityId, 'city-2');
  assert.equal(state.world.tiles[key].cityId, null); assert.equal(state.kingdoms['kingdom-1'].stockpiles.gold, 1000 - cost);
  assert.deepEqual(Object.values(state.cities).map(city => city.localCultureProgress), culture); assert.deepEqual(state.rng, rng);
  assert.equal(bought.events.find(event => event.type === 'TerritoryExpanded').cityId, 'city-2');
  assert.ok(!candidateKeys(state, 'city-1').includes(key) && !candidateKeys(state, 'city-2').includes(key));
  const second = RuleSystem.execute(state, controller.purchaseTile(state, 'city-1', key));
  assert.equal(second.ok, false); assert.equal(second.state, state);
  for (const city of Object.values(state.cities)) { city.population = 20; calculateCityYields(state, city); }
  assert.ok(state.cities['city-2'].workedTiles.includes(key)); assertExclusiveWork(state);
  assert.deepEqual(restore(state), state);
});

test('culture expands the requesting city and remains deterministic after save/load', () => {
  const a = createTwoCityGameState(42), b = restore(a), cityId = 'city-2', prior = new Set(candidateKeys(a, cityId));
  const beforeCombat = structuredClone(a.rng.combat), beforeStock = structuredClone(a.kingdoms['kingdom-1'].stockpiles);
  const firstLand = getCityTerritoryTiles(a, a.cities['city-1']).map(tile => tile.key);
  const eventsA = [], eventsB = [];
  assert.equal(expandTerritory(a, a.cities[cityId], eventsA), true); assert.equal(expandTerritory(b, b.cities[cityId], eventsB), true);
  assert.deepEqual(a, b); assert.deepEqual(eventsA, eventsB);
  const event = eventsA[0]; assert.equal(event.cityId, cityId); assert.equal(event.source, 'culture'); assert.ok(prior.has(event.tileKey));
  assert.equal(a.world.tiles[event.tileKey].territoryCityId, cityId);
  assert.deepEqual(getCityTerritoryTiles(a, a.cities['city-1']).map(tile => tile.key), firstLand);
  assert.deepEqual(a.rng.combat, beforeCombat); assert.deepEqual(a.kingdoms['kingdom-1'].stockpiles, beforeStock);
  assert.deepEqual(restore(a), a);
});

test('a blocked city keeps culture and cannot expand from another city frontier', () => {
  let state = createTwoCityGameState();
  for (const key of candidateKeys(state, 'city-1')) state.world.tiles[key].terrainId = 'void';
  assert.equal(candidateKeys(state, 'city-1').length, 0); assert.ok(candidateKeys(state, 'city-2').length > 0);
  const city = state.cities['city-1'], beforeRng = structuredClone(state.rng), events = [];
  assert.equal(expandTerritory(state, city, events), false); assert.deepEqual(events, []); assert.deepEqual(state.rng, beforeRng);
  city.localCultureProgress = 10;
  const result = execute(state, controller.startTurn(state)); state = result.state;
  assert.equal(state.cities['city-1'].localCultureProgress, 10 + state.cities['city-1'].yieldSummary.culture);
  assert.ok(!result.events.some(event => event.type === 'TerritoryExpanded' && event.cityId === 'city-1'));
  assert.deepEqual(state.rng, beforeRng);
});

test('two-city turn start keeps food, production and culture local while summing kingdom income once', () => {
  let state = createTwoCityGameState(), first = state.cities['city-1'], second = state.cities['city-2'];
  first.foodStorage = 24 - first.yieldSummary.food;
  first.production = { currentItemId: 'warrior', queue: [], progressByItem: { warrior: 11 } };
  second.production = { currentItemId: 'monument', queue: [], progressByItem: { monument: 19 } };
  const original = structuredClone(state), gold = Object.values(state.cities).reduce((sum, city) => sum + city.yieldSummary.gold, 0);
  const science = Object.values(state.cities).reduce((sum, city) => sum + city.yieldSummary.science, 0);
  const result = execute(state, controller.startTurn(state)); state = result.state;
  assert.equal(state.kingdoms['kingdom-1'].stockpiles.gold, original.kingdoms['kingdom-1'].stockpiles.gold + gold);
  assert.equal(state.kingdoms['kingdom-1'].progress.science, science);
  assert.equal(state.cities['city-1'].population, 3); assert.equal(state.cities['city-1'].foodStorage, 0);
  assert.equal(state.cities['city-2'].population, 2); assert.equal(state.cities['city-2'].foodStorage, second.yieldSummary.food);
  assert.equal(state.kingdoms['kingdom-1'].humanResources.native, original.kingdoms['kingdom-1'].humanResources.native + 1);
  assert.equal(state.units['unit-2'].location, first.centerHex);
  assert.deepEqual(state.cities['city-1'].buildings, []); assert.deepEqual(state.cities['city-2'].buildings, ['monument']);
  assert.equal(state.cities['city-1'].localCultureProgress, first.yieldSummary.culture);
  assert.equal(state.cities['city-2'].localCultureProgress, second.yieldSummary.culture);
  assert.equal(result.events.filter(event => event.type === 'YieldCollected').length, 2);
  assertExclusiveWork(state);
  const repeated = RuleSystem.execute(state, controller.startTurn(state)); assert.equal(repeated.ok, false); assert.equal(repeated.state, state);
  assert.deepEqual(restore(state), state);
});

test('city production selection and Unit purchases target only the requested city', () => {
  let state = createTwoCityGameState(); state.kingdoms['kingdom-1'].stockpiles.gold = 200;
  state = execute(state, controller.setProduction(state, 'city-1', 'warrior')).state;
  state = execute(state, controller.setProduction(state, 'city-2', 'ballista')).state;
  const first = structuredClone(state.cities['city-1']), secondProduction = structuredClone(state.cities['city-2'].production);
  state = execute(state, controller.purchaseItem(state, 'city-2', 'archer')).state;
  assert.deepEqual(state.cities['city-1'], first); assert.deepEqual(state.cities['city-2'].production, secondProduction);
  assert.equal(state.units['unit-2'].typeId, 'archer'); assert.equal(state.units['unit-2'].location, state.cities['city-2'].centerHex);
  assert.equal(state.kingdoms['kingdom-1'].stockpiles.gold, 128);
});

test('setup addCity preserves existing land and rejects invalid centers before mutating state', () => {
  const state = createInitialGameState(), before = serializeGameState(state);
  for (const options of [
    { ownerId: 'missing', id: 'city-2', centerHex: '4,-4,0' },
    { ownerId: 'kingdom-1', id: 'city-1', centerHex: '4,-4,0' },
    { ownerId: 'kingdom-1', id: 'city-2', centerHex: '0,0,0' },
    { ownerId: 'kingdom-1', id: 'city-2', centerHex: '1,-1,0' },
    { ownerId: 'kingdom-1', id: '__proto__', centerHex: '4,-4,0' },
    { ownerId: 'kingdom-1', id: 'city-2', centerHex: '99,-99,0' },
  ]) { assert.throws(() => addCity(state, options)); assert.equal(serializeGameState(state), before); }
  const existing = getCityTerritoryTiles(state, state.cities['city-1']).map(tile => tile.key), money = state.kingdoms['kingdom-1'].stockpiles.gold;
  state.world.tiles['2,-2,0'].ownerId = 'kingdom-1';
  addCity(state, { ownerId: 'kingdom-1', id: 'city-2', name: '第二都', centerHex: '2,-2,0' });
  assert.deepEqual(getCityTerritoryTiles(state, state.cities['city-1']).map(tile => tile.key), existing);
  assert.equal(state.world.tiles['1,-1,0'].territoryCityId, 'city-1'); assert.equal(state.world.tiles['2,-2,0'].cityId, 'city-2');
  assert.equal(state.kingdoms['kingdom-1'].stockpiles.gold, money); assertExclusiveWork(state);
  assert.deepEqual(restore(state), state);
});

test('legacy land assignment uses nearest same-kingdom city then ID and preserves all other state', () => {
  const original = createTwoCityGameState(); original.world.tiles['2,-2,0'].ownerId = 'kingdom-1';
  addKingdom(original, { id: 'kingdom-2', name: '他国', cityId: 'city-3', cityName: '他都', centerHex: '-4,4,0' });
  delete original.cityTerritoryVersion;
  for (const tile of Object.values(original.world.tiles)) delete tile.territoryCityId;
  const a = structuredClone(original), b = structuredClone(original);
  b.cities = Object.fromEntries(Object.entries(b.cities).reverse()); b.kingdoms['kingdom-1'].cityIds.reverse();
  assignLegacyCityTerritories(a); assignLegacyCityTerritories(b);
  assert.deepEqual(allocations(a), allocations(b));
  assert.equal(a.world.tiles['2,-2,0'].territoryCityId, 'city-1');
  assert.equal(a.world.tiles['4,-4,0'].territoryCityId, 'city-2');
  assert.equal(a.world.tiles['-4,4,0'].territoryCityId, 'city-3');
  for (const tile of Object.values(a.world.tiles)) delete tile.territoryCityId;
  assert.deepEqual(a, original, 'migration helper changes only land affiliation');
  const broken = structuredClone(original); broken.cities = {};
  assert.throws(() => assignLegacyCityTerritories(broken), /都市/);
  assert.ok(Object.values(broken.world.tiles).every(tile => !Object.hasOwn(tile, 'territoryCityId')), 'failed assignment is atomic');
});

test('land claims preserve city-center identity and reject other cities, other owners and Void', () => {
  const state = createTwoCityGameState(), first = state.cities['city-1'], second = state.cities['city-2'];
  const foreign = state.world.tiles['6,-6,0']; foreign.ownerId = 'kingdom-2';
  const voidTile = state.world.tiles['-2,2,0']; voidTile.terrainId = 'void';
  const before = serializeGameState(state);
  for (const tile of [state.world.tiles[second.centerHex], state.world.tiles['3,-3,0'], foreign, voidTile]) assert.throws(() => claimTileForCity(state, first, tile));
  assert.equal(serializeGameState(state), before);
  const tile = state.world.tiles['2,-2,0']; claimTileForCity(state, second, tile);
  assert.equal(tile.cityId, null); assert.equal(tile.territoryCityId, second.id); assert.equal(tile.ownerId, second.ownerId);
});
