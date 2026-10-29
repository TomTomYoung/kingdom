import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialGameState, addKingdom, restoreGameState, serializeGameState } from '../src/core/game-state.js';
import { HumanController } from '../src/core/human-controller.js';
import { RuleSystem } from '../src/core/rule-system.js';
import { createUnit } from '../src/models/unit.js';
import { createParty } from '../src/models/party.js';
import { validateReinforceParty, validateMergeParties, validateSplitParty } from '../src/systems/party-reorganization.js';

const player = 'kingdom-1', human = new HumanController(player), origin = '0,0,0', adjacent = '1,-1,0';
function apply(state, input) { const result = RuleSystem.execute(state, input); assert.equal(result.ok, true, result.reason); return result.state; }
function unchanged(state, input) {
  const snapshot = serializeGameState(state), result = RuleSystem.execute(state, input);
  assert.equal(result.ok, false, JSON.stringify(input)); assert.equal(result.state, state); assert.deepEqual(result.events, []);
  assert.equal(serializeGameState(state), snapshot, 'HP, resources, IDs, RNG and logs remain unchanged');
}
const roundTrip = state => { const restored = restoreGameState(serializeGameState(state)); assert.deepEqual(restored, state); return restored; };
function unit(state, location = origin, type = 'warrior', owner = player) {
  const id = `unit-${state.nextIds.unit++}`, value = createUnit(id, owner, type, location);
  state.units[id] = value; state.kingdoms[owner].unitIds.push(id); return value;
}
function party(state, count, location = origin, owner = player) {
  const ids = Array.from({ length: count }, () => unit(state, location, 'warrior', owner).id), id = `party-${state.nextIds.party++}`;
  state.parties[id] = createParty(id, owner, ids, location); ids.forEach(unitId => { state.units[unitId].partyId = id; });
  state.world.tiles[location].terrainId = 'plains'; return state.parties[id];
}
function fixture(count = 3) {
  let state = createInitialGameState(); state = apply(state, human.startTurn(state)); party(state, count);
  state.world.tiles[adjacent].terrainId = 'plains'; return state;
}
const reinforce = (s, ids = ['unit-4']) => human.reinforceParty(s, 'party-1', ids);
const split = (s, ids = ['unit-1'], location = adjacent) => human.splitParty(s, 'party-1', ids, location);
const merge = s => human.mergeParties(s, 'party-2', 'party-1');
function ended(party) { assert.deepEqual([party.movementRemaining, party.attacksRemaining, party.reactionCharges, party.activationState], [0, 0, 0, 'ended']); }
function wounded(state) { for (const u of Object.values(state.units)) { u.hp = u.currentHp = 13; u.guardCapacityRemaining = Math.min(2, u.guardCapacityMax); } }

test('reinforcement preserves existing formation, HP, guard capacity and resources, then ends activation', () => {
  const state = fixture(); unit(state, origin, 'archer'); unit(state, origin, 'settler'); wounded(state);
  state.parties['party-1'].formation = { 'front-center': 'unit-1', 'rear-left': 'unit-2', 'rear-right': 'unit-3' };
  state.parties['party-1'].guardOrders = { 'unit-1': { targetUnitId: 'unit-2', mode: 'share' } };
  const before = structuredClone(state), after = apply(state, reinforce(state, ['unit-4', 'unit-5'])), p = after.parties['party-1'];
  assert.deepEqual(state, before); assert.equal(p.unitIds.length, 5); ended(p);
  assert.equal(p.formation['front-center'], 'unit-1'); assert.equal(p.formation['front-left'], 'unit-4'); assert.equal(p.formation['front-right'], 'unit-5');
  assert.deepEqual(p.guardOrders, before.parties[p.id].guardOrders);
  for (const id of p.unitIds) { assert.equal(after.units[id].currentHp, 13); assert.equal(after.units[id].guardCapacityRemaining, before.units[id].guardCapacityRemaining); assert.equal(after.units[id].partyId, p.id); }
  assert.deepEqual(after.nextIds, before.nextIds); assert.deepEqual(after.rng, before.rng); assert.deepEqual(after.kingdoms, before.kingdoms);
  assert.equal(after.eventLog.at(-1).type, 'PartyReinforced'); roundTrip(after);
});

test('reinforcement rejects malformed selections and units that are absent, dead, foreign, assigned or elsewhere', () => {
  const state = fixture(); unit(state);
  for (const ids of [[], null, {}, ['unit-4', 'unit-4'], ['missing'], ['constructor'], [null], ['unit-1']]) unchanged(state, reinforce(state, ids));
  for (const change of [{ partyId: 'party-1' }, { location: adjacent }, { ownerId: 'other' }, { currentHp: 0 }, { status: 'shattered' }]) {
    const invalid = structuredClone(state); Object.assign(invalid.units['unit-4'], change); unchanged(invalid, reinforce(invalid));
  }
  const full = fixture(5); unit(full); unchanged(full, reinforce(full, ['unit-6']));
});

test('all reorganization commands reject wrong owner, missing parties, exhausted actions and finished games atomically', () => {
  const state = fixture(); unit(state); party(state, 1, adjacent);
  for (const mutation of [s => { s.activePlayerId = 'other'; }, s => { s.phase = 'TURN_END'; }, s => { s.gameResult = { outcome: 'draw' }; },
    s => { s.parties['party-1'].activationState = 'ended'; }, s => { s.parties['party-1'].movementRemaining = 0; },
    s => { s.parties['party-1'].status = 'defeated'; }, s => { s.parties['party-1'].ownerId = 'other'; }, s => { delete s.parties['party-1']; }]) {
    const invalid = structuredClone(state); mutation(invalid);
    for (const command of [reinforce(invalid), split(invalid, ['unit-1'], '1,0,-1'), merge(invalid)]) unchanged(invalid, command);
  }
  for (const id of ['missing', 'constructor', '__proto__']) {
    unchanged(state, human.reinforceParty(state, id, ['unit-4'])); unchanged(state, human.splitParty(state, id, ['unit-1'], adjacent)); unchanged(state, human.mergeParties(state, id, 'party-1'));
  }
});

test('splitting preserves slots and internal guard orders, drops cross-party guards and repairs the original leader', () => {
  const state = fixture(5); wounded(state); const p = state.parties['party-1'];
  p.formation = { 'front-center': 'unit-1', 'front-left': 'unit-2', 'middle-right': 'unit-3', 'rear-center': 'unit-4', 'rear-right': 'unit-5' };
  p.guardOrders = { 'unit-1': { targetUnitId: 'unit-2', mode: 'intercept' }, 'unit-3': { targetUnitId: 'unit-4', mode: 'share' }, 'unit-5': { targetUnitId: 'unit-1', mode: 'share' } };
  p.morale = 71; p.cohesion = 63; p.movementMaximum = 3; p.attacksMaximum = 2; state.units['unit-4'].commandContribution = 100;
  const after = apply(state, split(state, ['unit-1', 'unit-2'])), original = after.parties['party-1'], child = after.parties['party-2'];
  assert.equal(original.leaderUnitId, 'unit-4'); assert.equal(child.leaderUnitId, 'unit-1');
  assert.deepEqual(child.formation, { 'front-center': 'unit-1', 'front-left': 'unit-2' });
  assert.deepEqual(original.guardOrders, { 'unit-3': { targetUnitId: 'unit-4', mode: 'share' } });
  assert.deepEqual(child.guardOrders, { 'unit-1': { targetUnitId: 'unit-2', mode: 'intercept' } });
  for (const value of [original, child]) { ended(value); assert.equal(value.morale, 71); assert.equal(value.cohesion, 63); assert.equal(value.movementMaximum, 3); assert.equal(value.attacksMaximum, 2); }
  assert.equal(child.hasMoved, true); assert.equal(original.hasMoved, false);
  for (const id of child.unitIds) { assert.equal(after.units[id].partyId, child.id); assert.equal(after.units[id].location, adjacent); }
  for (const u of Object.values(after.units)) { assert.equal(u.currentHp, 13); assert.equal(u.guardCapacityRemaining, 2); }
  assert.equal(after.nextIds.party, state.nextIds.party + 1); assert.deepEqual(after.rng, state.rng); roundTrip(after);
});

test('splits carry casualties with a living unit, but never produce a party with no living members', () => {
  const state = fixture(); Object.assign(state.units['unit-1'], { hp: 0, currentHp: 0, status: 'shattered' });
  unchanged(state, split(state, ['unit-1'])); unchanged(state, split(state, ['unit-2', 'unit-3']));
  const after = apply(state, split(state, ['unit-1', 'unit-2']));
  assert.equal(after.parties['party-2'].leaderUnitId, 'unit-2'); assert.equal(after.parties['party-1'].leaderUnitId, 'unit-3');
  assert.equal(after.units['unit-1'].currentHp, 0); assert.equal(after.units['unit-1'].status, 'shattered'); roundTrip(after);
});

test('split selections must be a strict nonempty unique subset and destinations must be free neighboring land', () => {
  const state = fixture();
  for (const ids of [[], ['unit-1', 'unit-2', 'unit-3'], ['unit-1', 'unit-1'], ['missing'], ['constructor'], null, [3]]) unchanged(state, split(state, ids));
  for (const key of [origin, '2,-2,0', 'missing', 'constructor', '1,2,3']) unchanged(state, split(state, ['unit-1'], key));
  const voidState = structuredClone(state); voidState.world.tiles[adjacent].terrainId = 'void'; unchanged(voidState, split(voidState));
  const occupied = structuredClone(state); party(occupied, 1, adjacent); unchanged(occupied, split(occupied));
  const invalidIds = [1, 0, Number.MAX_SAFE_INTEGER, 1.5];
  for (const value of invalidIds) { const invalid = structuredClone(state); invalid.nextIds.party = value; unchanged(invalid, split(invalid)); }
});

test('split terrain cost is checked against remaining movement and defeated records do not occupy land', () => {
  const state = fixture(); state.world.tiles[adjacent].terrainId = 'forest'; state.parties['party-1'].movementRemaining = 1;
  unchanged(state, split(state)); state.parties['party-1'].movementRemaining = 2;
  const defeated = party(state, 1, adjacent); defeated.status = 'defeated';
  Object.assign(state.units[defeated.unitIds[0]], { hp: 0, currentHp: 0, status: 'shattered' });
  state.world.tiles[adjacent].terrainId = 'forest';
  const after = apply(state, split(state)); assert.equal(after.eventLog.at(-1).cost, 2);
  assert.equal(after.parties['party-3'].location, adjacent); assert.equal(after.parties['party-2'].status, 'defeated'); roundTrip(after);
});

test('merge retains the recipient identity and slots, transfers members and guards, and preserves damage', () => {
  const state = fixture(2), donor = party(state, 2, adjacent), target = state.parties['party-1']; wounded(state);
  donor.guardOrders = { 'unit-3': { targetUnitId: 'unit-4', mode: 'share' } }; target.guardOrders = { 'unit-1': { targetUnitId: 'unit-2', mode: 'intercept' } };
  donor.formation = { 'front-left': 'unit-3', 'rear-center': 'unit-4' }; donor.morale = 50; target.cohesion = 60;
  target.movementMaximum = 3; donor.attacksMaximum = 2;
  const after = apply(state, merge(state)), merged = after.parties['party-1'];
  assert.equal(after.parties['party-2'], undefined); assert.equal(merged.leaderUnitId, 'unit-1'); assert.equal(merged.location, origin);
  assert.deepEqual(merged.formation, { 'front-left': 'unit-1', 'front-center': 'unit-2', 'front-right': 'unit-3', 'rear-center': 'unit-4' });
  assert.deepEqual(merged.guardOrders, { ...target.guardOrders, ...donor.guardOrders });
  assert.equal(merged.morale, 50); assert.equal(merged.cohesion, 60); assert.equal(merged.movementMaximum, 2); assert.equal(merged.attacksMaximum, 1); ended(merged);
  for (const u of Object.values(after.units)) { assert.equal(u.currentHp, 13); assert.equal(u.guardCapacityRemaining, 2); assert.equal(u.partyId, merged.id); assert.equal(u.location, origin); }
  assert.deepEqual(after.rng, state.rng); assert.deepEqual(after.nextIds, state.nextIds); assert.deepEqual(after.kingdoms, state.kingdoms); roundTrip(after);
});

test('merge rejects the same party, distant, hostile, exhausted or over-capacity parties, counting casualties', () => {
  const state = fixture(); party(state, 2, adjacent);
  unchanged(state, human.mergeParties(state, 'party-1', 'party-1'));
  for (const change of [{ location: '3,-3,0' }, { ownerId: 'enemy' }, { status: 'defeated' }, { movementRemaining: 0 }, { activationState: 'ended' }]) {
    const invalid = structuredClone(state); Object.assign(invalid.parties['party-2'], change); unchanged(invalid, merge(invalid));
  }
  const full = fixture(4); party(full, 2, adjacent); Object.assign(full.units['unit-1'], { hp: 0, currentHp: 0, status: 'shattered' }); unchanged(full, merge(full));
  const expensive = structuredClone(state); expensive.world.tiles[origin].terrainId = 'hills'; expensive.parties['party-2'].movementRemaining = 1; unchanged(expensive, merge(expensive));
  expensive.parties['party-2'].movementRemaining = 2; const after = apply(expensive, merge(expensive)); assert.equal(after.eventLog.at(-1).cost, 2);
});

test('merge repairs a fallen recipient leader using live command contribution', () => {
  const state = fixture(2); party(state, 2, adjacent); Object.assign(state.units['unit-1'], { hp: 0, currentHp: 0, status: 'shattered' });
  state.units['unit-4'].commandContribution = 100;
  const after = apply(state, merge(state)); assert.equal(after.parties['party-1'].leaderUnitId, 'unit-4'); assert.equal(after.units['unit-1'].currentHp, 0); roundTrip(after);
});

test('reorganization never refreshes actions in the current round, including after reload', () => {
  let state = fixture(); unit(state); state = apply(state, reinforce(state)); state = roundTrip(state);
  unchanged(state, split(state)); unchanged(state, human.moveParty(state, 'party-1', [adjacent]));
  unit(state); unchanged(state, reinforce(state, ['unit-5']));
  state = apply(state, human.endTurn(state)); state = apply(state, split(state));
  ended(state.parties['party-1']); ended(state.parties['party-2']); unchanged(state, merge(state));
  unchanged(state, human.moveParty(state, 'party-2', ['2,-2,0']));
  state = apply(state, human.endTurn(state)); state = apply(state, merge(state)); unchanged(state, split(state)); roundTrip(state);
  const restored = roundTrip(state); assert.deepEqual(apply(restored, human.endTurn(restored)), apply(state, human.endTurn(state)));
});

test('receiving party cannot evade the activation cost on another human turn', () => {
  let state = fixture(); state.world.tiles['4,-4,0'].terrainId = 'plains';
  addKingdom(state, { id: 'kingdom-2', name: 'Other', cityId: 'city-2', cityName: 'Other city', centerHex: '4,-4,0' });
  state = apply(state, split(state)); state = apply(state, human.endTurn(state));
  ended(state.parties['party-1']); ended(state.parties['party-2']); unchanged(state, merge(state));
  const other = new HumanController('kingdom-2'); state = apply(state, other.endTurn(state));
  assert.equal(state.parties['party-1'].activationState, 'ready'); assert.equal(state.parties['party-2'].reactionCharges, 1);
  state = apply(state, merge(state)); roundTrip(state);
});

test('shared validation is read-only and never consumes RNG; malformed new save references reject', () => {
  const state = fixture(); unit(state); party(state, 1, adjacent); const snapshot = structuredClone(state);
  assert.equal(validateReinforceParty(state, player, 'party-1', ['unit-4']).ok, true);
  assert.equal(validateMergeParties(state, player, 'party-2', 'party-1').ok, true);
  assert.equal(validateSplitParty(state, player, 'party-1', ['unit-1'], adjacent).ok, false); assert.deepEqual(state, snapshot);
  let after = apply(state, merge(state)); after.units['unit-5'].partyId = 'party-2'; assert.throws(() => roundTrip(after), /partyId|parties/);
  after = apply(fixture(), split(fixture())); after.parties['party-1'].guardOrders['unit-2'] = { targetUnitId: 'unit-1', mode: 'share' };
  assert.throws(() => roundTrip(after), /guardOrders/);
});
