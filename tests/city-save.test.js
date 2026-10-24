import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialGameState, restoreGameState, serializeGameState } from '../src/core/game-state.js';
import { createTwoCityGameState, createRangedDuelGameState } from '../src/core/scenarios.js';
import { HumanController } from '../src/core/human-controller.js';
import { RuleSystem } from '../src/core/rule-system.js';
import { getTerritoryCandidates } from '../src/systems/territory-system.js';
import { calculateCityYields } from '../src/systems/yield-system.js';

const restore = state => restoreGameState(serializeGameState(state));
function legacyCopy(state) {
  const copy = structuredClone(state);
  delete copy.cityTerritoryVersion;
  for (const tile of Object.values(copy.world.tiles)) delete tile.territoryCityId;
  return copy;
}
function authoritativeProgress(state) {
  const copy = legacyCopy(state);
  for (const city of Object.values(copy.cities)) {
    delete city.workedTiles; delete city.yieldSummary; delete city.lastYieldBreakdown;
  }
  for (const kingdom of Object.values(copy.kingdoms)) delete kingdom.derived;
  return copy;
}

test('historical single-city and two-kingdom saves gain territory without replaying or recalculating snapshots', () => {
  for (const current of [createInitialGameState(117, { radius: 3 }), createInitialGameState(82, { startingParty: true }), createRangedDuelGameState(117)]) {
    const legacy = legacyCopy(current), before = serializeGameState(legacy);
    const restored = restore(legacy);
    assert.equal(restored.cityTerritoryVersion, 1);
    assert.deepEqual(legacyCopy(restored), legacy, 'preserve all historical state except new membership fields');
    assert.equal(serializeGameState(legacy), before, 'caller input remains unchanged');
    for (const tile of Object.values(restored.world.tiles)) {
      if (tile.ownerId === null) assert.equal(tile.territoryCityId, null);
      else assert.equal(restored.cities[tile.territoryCityId].ownerId, tile.ownerId);
    }
    assert.deepEqual(restore(restored), restored, 'migration is idempotent');
  }
});

test('historical multi-city duplicate work is repaired without collecting income or touching progress', () => {
  const legacy = legacyCopy(createTwoCityGameState(117));
  const first = legacy.cities['city-1'], second = legacy.cities['city-2'];
  second.workedTiles = [...first.workedTiles]; second.yieldSummary = { ...first.yieldSummary }; second.lastYieldBreakdown = structuredClone(first.lastYieldBreakdown);
  first.production = { currentItemId: 'warrior', queue: ['archer'], progressByItem: { warrior: 7 } };
  second.production = { currentItemId: 'ballista', queue: [], progressByItem: { ballista: 11 } };
  first.foodStorage = 17; second.foodStorage = 8;
  first.localCultureProgress = 9; second.localCultureProgress = 4;
  legacy.kingdoms['kingdom-1'].stockpiles.gold = 317;
  const restored = restore(legacy), a = restored.cities['city-1'], b = restored.cities['city-2'];
  assert.deepEqual(authoritativeProgress(restored), authoritativeProgress(legacy));
  assert.equal(a.workedTiles.some(key => b.workedTiles.includes(key)), false);
  for (const city of [a, b]) {
    assert.ok(city.workedTiles.length <= city.population);
    assert.ok(city.workedTiles.every(key => restored.world.tiles[key].territoryCityId === city.id));
    assert.deepEqual(city.lastYieldBreakdown.total, city.yieldSummary);
    assert.deepEqual(city.lastYieldBreakdown.tiles.map(tile => tile.tileKey), city.workedTiles);
  }
  const k = restored.kingdoms['kingdom-1'];
  assert.equal(k.derived.militaryPower, Math.floor(k.progress.science / 5) + a.yieldSummary.production + b.yieldSummary.production + Math.floor(k.stockpiles.gold / 25) + Math.floor(k.stockpiles.mana / 5) + k.humanResources.military * 2 + k.unitIds.length * 4);
  assert.deepEqual(restore(restored), restored);
});

test('legacy territorial ties use city ID and keep centers and map topology unchanged', () => {
  const legacy = legacyCopy(createTwoCityGameState(117));
  const bridge = legacy.world.tiles['2,-2,0']; bridge.ownerId = 'kingdom-1'; bridge.terrainId = 'plains';
  legacy.kingdoms['kingdom-1'].cityIds.reverse();
  legacy.cities = Object.fromEntries(Object.entries(legacy.cities).reverse());
  const restored = restore(legacy);
  assert.equal(restored.world.tiles[bridge.key].territoryCityId, 'city-1');
  for (const city of Object.values(restored.cities)) {
    assert.equal(restored.world.tiles[city.centerHex].territoryCityId, city.id);
    assert.equal(restored.world.tiles[city.centerHex].cityId, city.id);
  }
  assert.deepEqual(legacyCopy(restored).world, legacy.world);
  assert.deepEqual(restored.rng, legacy.rng);
});

test('current city saves preserve exact snapshots after purchases and a full turn', () => {
  let state = createTwoCityGameState(117); const controller = new HumanController('kingdom-1');
  state.kingdoms['kingdom-1'].stockpiles.gold = 1000;
  const commands = [
    s => controller.setProduction(s, 'city-1', 'warrior'),
    s => controller.setProduction(s, 'city-2', 'ballista'),
    s => controller.purchaseItem(s, 'city-2', 'archer'),
    s => controller.purchaseTile(s, 'city-2', getTerritoryCandidates(s, s.cities['city-2'])[0].key),
    s => controller.endTurn(s),
  ];
  for (const make of commands) {
    const result = RuleSystem.execute(state, make(state)); assert.equal(result.ok, true, result.reason); state = result.state;
    assert.deepEqual(restore(state), state);
  }
});

test('migrated cities continue deterministically across repeated saves', () => {
  const controller = new HumanController('kingdom-1');
  let a = restore(legacyCopy(createTwoCityGameState(42))), b = restore(a);
  a.cities['city-1'].localCultureProgress = b.cities['city-1'].localCultureProgress = 9;
  a.cities['city-2'].localCultureProgress = b.cities['city-2'].localCultureProgress = 9;
  for (let step = 0; step < 8; step++) {
    const command = controller.endTurn(a);
    const left = RuleSystem.execute(a, command), right = RuleSystem.execute(b, command);
    assert.equal(left.ok, true); assert.deepEqual(left, right);
    a = left.state; b = restore(right.state);
  }
});

test('partial, foreign, invalid or inconsistent city territories reject rather than silently migrate', () => {
  const cases = [
    s => { delete s.cityTerritoryVersion; },
    s => { s.cityTerritoryVersion = 2; },
    s => { s.cityTerritoryVersion = null; },
    s => { s.cityTerritoryVersion = '1'; },
    s => { delete s.world.tiles['0,0,0'].territoryCityId; },
    s => { s.world.tiles['0,0,0'].territoryCityId = null; },
    s => { s.world.tiles['0,0,0'].territoryCityId = 'missing'; },
    s => { s.world.tiles['0,0,0'].territoryCityId = 'constructor'; },
    s => { s.world.tiles['0,0,0'].territoryCityId = []; },
    s => { s.world.tiles['0,0,0'].territoryCityId = 'city-2'; },
    s => { s.world.tiles['2,-2,0'].territoryCityId = 'city-1'; },
    s => { s.cities['city-2'].workedTiles = [...s.cities['city-1'].workedTiles]; },
    s => { s.cities['city-1'].workedTiles = Object.values(s.world.tiles).filter(t => t.territoryCityId === 'city-1' && t.terrainId !== 'void').slice(0, 3).map(t => t.key); },
  ];
  for (const corrupt of cases) {
    const state = createTwoCityGameState(117); corrupt(state); const before = serializeGameState(state);
    assert.throws(() => restore(state), /セーブ/);
    assert.equal(serializeGameState(state), before);
  }
  const foreign = createRangedDuelGameState(); foreign.world.tiles['1,-1,0'].territoryCityId = 'city-2';
  assert.throws(() => restore(foreign), /セーブ/);
});

test('legacy migration rejects broken old work references and partially introduced territory fields', () => {
  for (const corrupt of [
    s => { s.cities['city-1'].workedTiles = ['missing']; },
    s => { s.cities['city-1'].workedTiles = ['9,-9,0']; },
    s => { s.world.tiles['0,0,0'].territoryCityId = 'city-1'; },
    s => { s.cityTerritoryVersion = 1; },
  ]) {
    const state = legacyCopy(createTwoCityGameState()); corrupt(state);
    assert.throws(() => restore(state), /セーブ/);
  }
});

test('loss of old duplicated work cannot make negative modifiers create negative income or an unloadable save', () => {
  const legacy = legacyCopy(createTwoCityGameState());
  const first = legacy.cities['city-1'], second = legacy.cities['city-2'];
  for (const tile of Object.values(legacy.world.tiles)) if (tile.ownerId === 'kingdom-1') tile.terrainId = tile.q < 2 ? 'grassland' : 'hills';
  const previousWork = ['0,0,0', '1,-1,0'];
  first.workedTiles = [...previousWork]; second.workedTiles = [...previousWork];
  first.yieldSummary.food = 6; second.yieldSummary.food = 2; second.yieldModifiers.food = -4;
  const restored = restore(legacy), city = restored.cities['city-2'];
  assert.equal(city.yieldSummary.food, 0); assert.equal(city.yieldModifiers.food, -4);
  assert.equal(city.lastYieldBreakdown.modifiers.food, -2, 'record only the applied reduction');
  assert.deepEqual(authoritativeProgress(restored), authoritativeProgress(legacy));
  assert.deepEqual(restore(restored), restored);
  city.yieldModifiers.production = -100; city.yieldModifiers.gold = -100;
  calculateCityYields(restored, city);
  assert.equal(city.yieldSummary.production, 0); assert.equal(city.yieldSummary.gold, 0);
  assert.deepEqual(restore(restored), restored);
});

test('optional historical collection snapshots stay optional and malformed present data rejects safely', () => {
  const missing = createInitialGameState(); delete missing.cities['city-1'].lastYieldBreakdown;
  assert.deepEqual(restore(missing), missing);
  const old = legacyCopy(missing); assert.deepEqual(legacyCopy(restore(old)), old);
  const partial = createInitialGameState(); partial.cities['city-1'].lastYieldBreakdown = { tiles: [], buildings: [], total: {} };
  assert.deepEqual(restore(partial), partial);
  const corruptions = [
    c => { c.lastYieldBreakdown = null; },
    c => { c.lastYieldBreakdown.tiles = 3; },
    c => { c.lastYieldBreakdown.tiles = [null]; },
    c => { c.lastYieldBreakdown.tiles[0].tileKey = 'missing'; },
    c => { c.lastYieldBreakdown.tiles[0].terrainId = 'constructor'; },
    c => { c.lastYieldBreakdown.tiles[0].yields = []; },
    c => { c.lastYieldBreakdown.tiles[0].yields.food = '2'; },
    c => { c.lastYieldBreakdown.center = false; },
    c => { c.lastYieldBreakdown.center.unknown = 1; },
    c => { c.lastYieldBreakdown.buildings = [null]; },
    c => { c.lastYieldBreakdown.buildings = [{ buildingId: 'warrior', yields: {} }]; },
    c => { c.lastYieldBreakdown.modifiers = { production: null }; },
  ];
  for (const corrupt of corruptions) {
    const state = createInitialGameState(); corrupt(state.cities['city-1']); const before = serializeGameState(state);
    assert.throws(() => restore(state), /セーブ/); assert.equal(serializeGameState(state), before);
  }
});
