import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialGameState, serializeGameState } from '../src/core/game-state.js';
import { COMMAND_TYPES, command, createParty, endTurn, moveParty, setFormation } from '../src/core/commands.js';
import { RuleSystem } from '../src/core/rule-system.js';
import { createUnit } from '../src/models/unit.js';

const player = 'kingdom-1';
function rejectUnchanged(state, input) {
  const before = serializeGameState(state);
  const result = RuleSystem.execute(state, input);
  assert.equal(result.ok, false, JSON.stringify(input));
  assert.equal(result.state, state);
  assert.deepEqual(result.events, []);
  assert.equal(serializeGameState(state), before, 'including RNG, stockpiles, next IDs and logs');
}
function fixture() {
  const state = createInitialGameState();
  for (const id of ['u1', 'u2']) {
    state.units[id] = createUnit(id, player, 'warrior', '0,0,0');
    state.kingdoms[player].unitIds.push(id);
  }
  return state;
}
const make = (type, payload = {}) => command(type, player, 1, payload, 'check');

test('all commands reject missing payloads, wrong phases and malformed envelopes without throwing', () => {
  const state = fixture();
  for (const value of [null, undefined, [], {}, 'command']) rejectUnchanged(state, value);
  for (const type of Object.values(COMMAND_TYPES)) {
    for (const payload of [null, [], 'payload']) rejectUnchanged(state, make(type, payload));
    rejectUnchanged(state, { ...make(type), phase: 'invalid' });
    rejectUnchanged(state, { ...make(type), commandId: {} });
    rejectUnchanged(state, { ...make(type), playerId: '__proto__' });
    if (!['StartTurn', 'EndTurn'].includes(type)) rejectUnchanged(state, make(type));
  }
  for (const phase of ['TURN_START', 'TURN_END']) {
    state.phase = phase;
    for (const type of Object.values(COMMAND_TYPES).filter((type) => type !== 'StartTurn')) rejectUnchanged(state, make(type));
  }
});

test('invalid references, queue, formation and path preserve the original state', () => {
  const state = fixture();
  const partyState = RuleSystem.execute(state, createParty(player, 1, ['u1'], '0,0,0', 'create')).state;
  for (const payload of [
    { cityId: 'city-1', itemId: 'warrior' },
    { cityId: 'city-1', itemId: 'warrior', queue: null },
    { cityId: 'city-1', itemId: 'warrior', queue: [null] },
    { cityId: 'city-1', itemId: 'constructor', queue: [] },
    { cityId: 'city-1', itemId: 'warrior', queue: ['toString'] },
    { cityId: 'missing', itemId: 'warrior', queue: [] },
  ]) rejectUnchanged(state, make('SetCityProduction', payload));
  for (const itemId of ['missing', '__proto__', 'constructor']) rejectUnchanged(state, make('PurchaseCityItem', { cityId: 'city-1', itemId, currency: 'gold' }));
  rejectUnchanged(state, make('PurchaseCityItem', { cityId: 'city-1', itemId: 'warrior', currency: 'constructor' }));
  for (const tileKey of ['constructor', 'garbage', '1,2,3']) rejectUnchanged(state, make('PurchaseTile', { cityId: 'city-1', tileKey }));
  for (const path of [undefined, null, {}, [], [null], ['constructor'], ['1,2,3']]) rejectUnchanged(partyState, moveParty(player, 1, 'party-1', path, 'move'));
  for (const formation of [undefined, null, [], {}, { 'front-left': 'missing' }, { invalid: 'u1' }]) rejectUnchanged(partyState, setFormation(player, 1, 'party-1', formation, 'formation'));
});

test('party creation rejects dead units, unknown/void tiles and occupied locations before allocating IDs', () => {
  for (const status of ['shattered', 'downed']) {
    const state = fixture(); state.units.u1.status = status;
    rejectUnchanged(state, createParty(player, 1, ['u1'], '0,0,0', 'create'));
  }
  const noHp = fixture(); noHp.units.u1.currentHp = 0;
  rejectUnchanged(noHp, createParty(player, 1, ['u1'], '0,0,0', 'create'));
  for (const location of ['missing', 'constructor', '0,0,0']) {
    const state = fixture(); state.units.u1.location = location;
    if (location === '0,0,0') state.world.tiles[location].terrainId = 'void';
    rejectUnchanged(state, createParty(player, 1, ['u1'], location, 'create'));
  }
  let state = fixture(); state = RuleSystem.execute(state, createParty(player, 1, ['u1'], '0,0,0', 'create')).state;
  rejectUnchanged(state, createParty(player, 1, ['u2'], '0,0,0', 'create-again'));
});

test('defeated or empty fighting parties never regain actions or guard, and cannot move or rearrange', () => {
  for (const defeated of [true, false]) {
    let state = fixture(); state = RuleSystem.execute(state, createParty(player, 1, ['u1'], '0,0,0', 'create')).state;
    state.units.u1.currentHp = 0; state.units.u1.guardCapacityMax = 20;
    if (defeated) { state.parties['party-1'].status = 'defeated'; state.units.u1.status = 'shattered'; }
    rejectUnchanged(state, moveParty(player, 1, 'party-1', ['1,-1,0'], 'move'));
    rejectUnchanged(state, setFormation(player, 1, 'party-1', { 'rear-center': 'u1' }, 'formation'));
    const result = RuleSystem.execute(state, endTurn(player, 1, 'end'));
    assert.equal(result.ok, true);
    state = result.state;
    assert.equal(state.parties['party-1'].movementRemaining, 0);
    assert.equal(state.parties['party-1'].attacksRemaining, 0);
    assert.equal(state.parties['party-1'].reactionCharges, 0);
    assert.equal(state.parties['party-1'].activationState, 'ended');
    assert.equal(state.units.u1.guardCapacityRemaining, 0);
    rejectUnchanged(state, moveParty(player, 2, 'party-1', ['1,-1,0'], 'move-next'));
  }
});
