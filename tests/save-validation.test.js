import test from 'node:test';
import assert from 'node:assert/strict';
import { addKingdom, createInitialGameState, restoreGameState, serializeGameState } from '../src/core/game-state.js';
import { HumanController } from '../src/core/human-controller.js';
import { RuleSystem } from '../src/core/rule-system.js';
import { createUnit } from '../src/models/unit.js';
import { createParty } from '../src/models/party.js';

const restore = (state) => restoreGameState(serializeGameState(state));
const fresh = () => createInitialGameState(117, { startingParty: true });

test('malformed saves reject structural, numeric and reference corruption', () => {
  const cases = [
    ['kingdoms', s => { s.kingdoms = null; }],
    ['stockpiles', s => { s.kingdoms['kingdom-1'].stockpiles = {}; }],
    ['city owner membership', s => { s.kingdoms['kingdom-1'].cityIds = []; }],
    ['missing city', s => { s.kingdoms['kingdom-1'].cityIds.push('missing'); }],
    ['unit owner membership', s => { s.kingdoms['kingdom-1'].unitIds = []; }],
    ['duplicate unit membership', s => { s.kingdoms['kingdom-1'].unitIds.push('unit-1'); }],
    ['missing units', s => { delete s.units; }],
    ['unknown terrain', s => { s.world.tiles['0,0,0'].terrainId = 'missing'; }],
    ['inherited terrain name', s => { s.world.tiles['0,0,0'].terrainId = 'constructor'; }],
    ['bad coordinates', s => { s.world.tiles['0,0,0'].q = 3; }],
    ['bad city tile', s => { s.world.tiles['0,0,0'].cityId = null; }],
    ['unknown tile owner', s => { s.world.tiles['0,0,0'].ownerId = 'missing'; }],
    ['invalid radius', s => { s.world.radius = -1; }],
    ['empty map', s => { s.world.tiles = {}; }],
    ['bad worked tile', s => { s.cities['city-1'].workedTiles = ['missing']; }],
    ['unknown production', s => { s.cities['city-1'].production.currentItemId = 'missing'; }],
    ['invalid queue', s => { s.cities['city-1'].production.queue = {}; }],
    ['negative production', s => { s.cities['city-1'].production.progressByItem.warrior = -1; }],
    ['overflow production', s => { s.cities['city-1'].production.progressByItem.warrior = 100; }],
    ['invalid buildings', s => { s.cities['city-1'].buildings = ['warrior']; }],
    ['unknown unit type', s => { s.units['unit-1'].typeId = 'missing'; }],
    ['invalid HP', s => { s.units['unit-1'].currentHp = 101; }],
    ['mismatched HP', s => { s.units['unit-1'].hp = 1; }],
    ['invalid guard', s => { s.units['unit-1'].guardCapacityRemaining = 5; }],
    ['missing party', s => { s.units['unit-1'].partyId = 'missing'; }],
    ['broken party membership', s => { s.units['unit-1'].partyId = null; }],
    ['mismatched location', s => { s.units['unit-1'].location = '1,-1,0'; }],
    ['empty party', s => { s.parties['party-1'].unitIds = []; }],
    ['malformed party membership', s => { s.parties['party-1'].unitIds = 4; }],
    ['null city', s => { s.cities['city-1'] = null; }],
    ['duplicate slot', s => { s.parties['party-1'].formation['rear-left'] = 'unit-1'; }],
    ['invalid slot', s => { s.parties['party-1'].formation = { nowhere: 'unit-1' }; }],
    ['missing leader', s => { s.parties['party-1'].leaderUnitId = 'missing'; }],
    ['negative movement', s => { s.parties['party-1'].movementRemaining = -1; }],
    ['excess movement', s => { s.parties['party-1'].movementRemaining = 3; }],
    ['fractional attacks', s => { s.parties['party-1'].attacksRemaining = 0.5; }],
    ['invalid turn index', s => { s.activePlayerIndex = 1; }],
    ['invalid active player', s => { s.activePlayerId = 'missing'; }],
    ['duplicate turn order', s => { s.turnOrder.push('kingdom-1'); }],
    ['invalid combat RNG', s => { s.rng.combat.state = -1; }],
    ['null RNG', s => { s.rng = null; }],
    ['colliding unit ID', s => { s.nextIds.unit = 1; }],
    ['colliding party ID', s => { s.nextIds.party = 1; }],
    ['invalid log', s => { s.commandLog = [null]; }],
    ['null legacy field', s => { s.parties = null; }],
    ['infinite resources', s => { s.kingdoms['kingdom-1'].stockpiles.gold = Infinity; }],
    ['numeric string', s => { s.kingdoms['kingdom-1'].stockpiles.gold = '100'; }],
  ];
  for (const [name, corrupt] of cases) {
    const state = fresh(); corrupt(state); const before = serializeGameState(state);
    assert.throws(() => restore(state), /セーブ/, name);
    assert.equal(serializeGameState(state), before, `${name}: input preserved`);
  }
});

test('invalid JSON, unsupported versions and primitive roots have readable errors', () => {
  for (const json of ['{', 'null', '[]', 'true', '0', '{}', '{"schemaVersion":2,"rulesetVersion":"m1.0"}']) assert.throws(() => restoreGameState(json), /セーブ/);
});

test('historical M1 unit omissions migrate without changing the 37-cell map', () => {
  const legacy = createInitialGameState(117, { radius: 3 });
  legacy.units['unit-1'] = { id: 'unit-1', ownerId: 'kingdom-1', typeId: 'warrior', location: '0,0,0', hp: 71 };
  legacy.kingdoms['kingdom-1'].unitIds = ['unit-1']; legacy.nextIds.unit = 2;
  delete legacy.parties; delete legacy.turnOrder; delete legacy.activePlayerIndex; delete legacy.rng.combat; delete legacy.nextIds.party;
  const restored = restore(legacy);
  assert.equal(Object.keys(restored.world.tiles).length, 37);
  assert.deepEqual(restored.world, legacy.world); assert.deepEqual(restored.rng.territory, legacy.rng.territory);
  assert.equal(restored.units['unit-1'].currentHp, 71); assert.equal(restored.units['unit-1'].partyId, null);
  assert.deepEqual(restore(restored), restored, 'migration is idempotent');
});

test('current save round trip preserves battle state and deterministic continuation', () => {
  let state = fresh();
  addKingdom(state, { id: 'kingdom-2', name: '他国', cityId: 'city-2', cityName: '他都', centerHex: '3,-3,0' });
  const unit = createUnit('unit-2', 'kingdom-2', 'warrior', '1,-1,0'); unit.partyId = 'party-2';
  state.units[unit.id] = unit; state.kingdoms['kingdom-2'].unitIds.push(unit.id);
  state.parties['party-2'] = createParty('party-2', 'kingdom-2', [unit.id], unit.location);
  state.nextIds.unit = 3; state.nextIds.party = 3;
  const first = new HumanController('kingdom-1'), second = new HumanController('kingdom-2');
  let result = RuleSystem.execute(state, first.attackParty(state, 'party-1', 'party-2'));
  assert.equal(result.ok, true); state = result.state;
  const restored = restore(state); assert.deepEqual(restored, state);
  const command = first.endTurn(state);
  const a = RuleSystem.execute(state, command), b = RuleSystem.execute(restored, command); assert.deepEqual(a, b);
  const counter = second.attackParty(a.state, 'party-2', 'party-1');
  assert.deepEqual(RuleSystem.execute(a.state, counter), RuleSystem.execute(b.state, counter));
});

test('defeated parties round trip and cannot regain movement by loading', () => {
  const state = fresh(), party = state.parties['party-1'], unit = state.units['unit-1'];
  unit.hp = unit.currentHp = 0; unit.status = 'shattered'; party.status = 'defeated'; party.activationState = 'ended';
  party.movementRemaining = party.attacksRemaining = party.reactionCharges = 0;
  assert.deepEqual(restore(state), state);
  const restored = restore(state), controller = new HumanController('kingdom-1');
  const next = RuleSystem.execute(restored, controller.endTurn(restored));
  assert.equal(next.ok, true); assert.equal(next.state.parties['party-1'].movementRemaining, 0);
});

test('overlapping parties and multiply assigned units are rejected', () => {
  const state = fresh(), unit = createUnit('unit-2', 'kingdom-1', 'warrior', '0,0,0'); unit.partyId = 'party-2';
  state.units[unit.id] = unit; state.kingdoms['kingdom-1'].unitIds.push(unit.id);
  state.parties['party-2'] = createParty('party-2', 'kingdom-1', [unit.id], unit.location);
  state.nextIds.unit = 3; state.nextIds.party = 3;
  assert.throws(() => restore(state), /占有/);
  state.parties['party-2'].location = '1,-1,0'; state.units['unit-2'].location = '1,-1,0';
  assert.deepEqual(restore(state), state);
  state.parties['party-2'].unitIds = ['unit-1'];
  assert.throws(() => restore(state), /セーブ/);
});
