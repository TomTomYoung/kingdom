import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialGameState, restoreGameState, serializeGameState } from '../src/core/game-state.js';
import { createDuelGameState } from '../src/core/scenarios.js';
import { HumanController } from '../src/core/human-controller.js';
import { RuleSystem } from '../src/core/rule-system.js';
import { createParty, occupiesMapTile } from '../src/models/party.js';
import { createUnit } from '../src/models/unit.js';
import { getReachablePartyPaths } from '../src/systems/movement-system.js';

const roundTrip = (state) => restoreGameState(serializeGameState(state));
function execute(state, command) { const result = RuleSystem.execute(state, command); assert.equal(result.ok, true, result.reason); return result.state; }
function controller(state) { return new HumanController(state.activePlayerId); }
function nextTurn(state) { return execute(state, controller(state).endTurn(state)); }
function addUnit(state, location, partyId = null) {
  const id = `unit-${state.nextIds.unit++}`, unit = createUnit(id, 'kingdom-1', 'warrior', location);
  unit.partyId = partyId; state.units[id] = unit; state.kingdoms['kingdom-1'].unitIds.push(id); return unit;
}
function defeatedAt(state, location) {
  state.world.tiles[location].terrainId = 'plains';
  const id = `party-${state.nextIds.party++}`, unit = addUnit(state, location, id), party = createParty(id, 'kingdom-1', [unit.id], location);
  unit.currentHp = unit.hp = 0; unit.status = 'shattered';
  Object.assign(party, { status: 'defeated', activationState: 'ended', movementRemaining: 0, attacksRemaining: 0, reactionCharges: 0 });
  state.parties[id] = party; return party;
}

test('combat defeat releases the tile while preserving casualties, formation and save history', () => {
  let state = createDuelGameState();
  const defeatedId = 'party-2', location = state.parties[defeatedId].location;
  state.parties[defeatedId].guardOrders = {};
  for (const id of state.parties[defeatedId].unitIds) state.units[id].hp = state.units[id].currentHp = 1;
  for (let attempt = 0; attempt < 3; attempt++) {
    state = execute(state, controller(state).attackParty(state, 'party-1', defeatedId));
    if (state.parties[defeatedId].status === 'defeated') break;
    state = nextTurn(nextTurn(state));
  }
  assert.equal(state.parties[defeatedId].status, 'defeated');
  assert.equal(occupiesMapTile(state.parties[defeatedId]), false);
  state = nextTurn(nextTurn(state));
  const casualtyRecord = structuredClone({ party: state.parties[defeatedId], units: state.parties[defeatedId].unitIds.map(id => state.units[id]) });
  assert.equal(casualtyRecord.units.every(unit => unit.currentHp === 0), true);
  assert.ok(getReachablePartyPaths(state, state.parties['party-1']).has(location));
  state = execute(state, controller(state).moveParty(state, 'party-1', [location]));
  assert.equal(state.parties['party-1'].location, state.parties[defeatedId].location);
  assert.deepEqual({ party: state.parties[defeatedId], units: state.parties[defeatedId].unitIds.map(id => state.units[id]) }, casualtyRecord);
  assert.deepEqual(roundTrip(state), state);
});

test('movement may pass through a defeated record but still rejects an active occupant', () => {
  let state = createInitialGameState(117, { startingParty: true });
  const dead = defeatedAt(state, '1,-1,0'); state.world.tiles['2,-2,0'].terrainId = 'plains';
  const route = getReachablePartyPaths(state, state.parties['party-1']).get('2,-2,0');
  assert.deepEqual(route.path, ['1,-1,0', '2,-2,0']);
  const before = serializeGameState(state);
  const blocked = structuredClone(state); blocked.parties[dead.id].status = 'active';
  assert.equal(RuleSystem.execute(blocked, controller(blocked).moveParty(blocked, 'party-1', route.path)).ok, false);
  assert.equal(serializeGameState(state), before);
  state = execute(state, controller(state).moveParty(state, 'party-1', route.path));
  assert.equal(state.parties['party-1'].location, '2,-2,0');
  assert.equal(state.parties[dead.id].location, '1,-1,0');
});

test('a new party can share a historical defeat tile while a second active party cannot', () => {
  let state = createInitialGameState();
  const dead = defeatedAt(state, '0,0,0'), waiting = addUnit(state, dead.location);
  state = execute(state, controller(state).createParty(state, [waiting.id], dead.location));
  assert.equal(state.units[waiting.id].partyId, 'party-2');
  const extra = addUnit(state, dead.location), before = serializeGameState(state);
  const result = RuleSystem.execute(state, controller(state).createParty(state, [extra.id], dead.location));
  assert.equal(result.ok, false); assert.match(result.reason, /占有/); assert.equal(serializeGameState(state), before);
  assert.deepEqual(roundTrip(state), state);
});

test('save validation allows historical overlap and rejects disguised live parties or active overlap', () => {
  const state = createInitialGameState(117, { startingParty: true });
  const dead = defeatedAt(state, '0,0,0'); defeatedAt(state, '0,0,0');
  assert.deepEqual(roundTrip(state), state);
  const disguised = structuredClone(state), unit = disguised.units[dead.unitIds[0]];
  unit.hp = unit.currentHp = 50; unit.status = 'active';
  assert.throws(() => roundTrip(disguised), /敗北部隊/);
  const overlapping = structuredClone(state); overlapping.parties[dead.id].status = 'active';
  assert.throws(() => roundTrip(overlapping), /占有/);
});
