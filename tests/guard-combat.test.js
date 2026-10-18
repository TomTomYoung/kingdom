import test from 'node:test';
import assert from 'node:assert/strict';
import { createDuelGameState } from '../src/core/scenarios.js';
import { restoreGameState, serializeGameState } from '../src/core/game-state.js';
import { HumanController } from '../src/core/human-controller.js';
import { RuleSystem } from '../src/core/rule-system.js';
import { allocateSingleDamage, exposedUnits } from '../src/systems/damage-grid.js';
import { previewPartyAttack } from '../src/systems/combat-system.js';
const player = new HumanController('kingdom-1');

test('Guard splits raw damage once, caps shares at 70%, and spends pre-armor capacity', () => {
  const state = createDuelGameState(), party = state.parties['party-2'], target = state.units['unit-4'], guard = state.units['unit-5'], events = [];
  guard.guardRate = 1; guard.guardCapacityRemaining = 50;
  let result = allocateSingleDamage(state, party, target, 40, events);
  assert.deepEqual(result.map(r => [r.unit.id, r.amount]), [['unit-4', 12], ['unit-5', 28]]);
  assert.equal(guard.guardCapacityRemaining, 22);
  result = allocateSingleDamage(state, party, target, 40, events);
  assert.deepEqual(result.map(r => r.amount), [18, 22]); assert.equal(guard.guardCapacityRemaining, 0);
  result = allocateSingleDamage(state, party, target, 40, events);
  assert.equal(result.length, 1); assert.equal(result[0].amount, 40);
});

test('Intercept replaces the primary target and consumes one reaction without chaining', () => {
  const state = createDuelGameState(), party = state.parties['party-2'], events = [];
  party.guardOrders['unit-5'].mode = 'intercept';
  party.guardOrders['unit-4'] = { targetUnitId: 'unit-5', mode: 'intercept' };
  let result = allocateSingleDamage(state, party, state.units['unit-4'], 30, events);
  assert.deepEqual(result.map(r => [r.unit.id, r.amount]), [['unit-5', 30]]); assert.equal(party.reactionCharges, 0);
  assert.equal(state.units['unit-5'].guardCapacityRemaining, 50);
  result = allocateSingleDamage(state, party, state.units['unit-4'], 30, events);
  assert.equal(result[0].unit.id, 'unit-4'); assert.equal(events.length, 1);
});

test('dead, out-of-range and disabled guards cannot share, and tied candidates are deterministic', () => {
  for (const disable of [s => { s.units['unit-5'].currentHp = 0; }, s => { s.units['unit-5'].statusEffects = ['stun']; }, s => { s.parties['party-2'].formation = { 'front-center': 'unit-4', 'rear-left': 'unit-5', 'rear-center': 'unit-6' }; }]) {
    const state = createDuelGameState(); disable(state);
    assert.equal(allocateSingleDamage(state, state.parties['party-2'], state.units['unit-4'], 30, []).length, 1);
  }
  const state = createDuelGameState(), party = state.parties['party-2'];
  party.formation = { 'front-center': 'unit-4', 'front-left': 'unit-5', 'front-right': 'unit-6' };
  party.guardOrders = { 'unit-6': { targetUnitId: 'unit-4', mode: 'share' }, 'unit-5': { targetUnitId: 'unit-4', mode: 'share' } };
  assert.equal(allocateSingleDamage(state, party, state.units['unit-4'], 30, [])[1].unit.id, 'unit-5');
});

test('empty lanes expose survivors without changing the formation', () => {
  const state = createDuelGameState(), party = state.parties['party-2'];
  state.units['unit-4'].currentHp = 0;
  const before = structuredClone(party.formation);
  assert.deepEqual(exposedUnits(state, party).map(e => e.unit.id), ['unit-5', 'unit-6']);
  assert.deepEqual(party.formation, before);
  assert.equal(exposedUnits(state, party, 'rear')[0].unit.id, 'unit-6');
});

test('guard commands validate ownership, membership and range without spending normal actions', () => {
  const state = createDuelGameState(), command = player.setGuardOrder(state, 'party-1', 'unit-2', 'unit-1', 'intercept');
  const result = RuleSystem.execute(state, command); assert.equal(result.ok, true);
  assert.equal(result.state.parties['party-1'].movementRemaining, 2); assert.equal(result.state.parties['party-1'].attacksRemaining, 1);
  for (const command of [player.setGuardOrder(state, 'party-2', 'unit-5', 'unit-4', 'share'), player.setGuardOrder(state, 'party-1', 'unit-2', 'unit-2', 'share'), player.setGuardOrder(state, 'party-1', 'unit-2', 'unit-3', 'share'), player.setGuardOrder(state, 'party-1', 'unit-2', 'unit-1', 'unknown')]) {
    const before = serializeGameState(state), rejected = RuleSystem.execute(state, command);
    assert.equal(rejected.ok, false); assert.equal(rejected.state, state); assert.equal(serializeGameState(state), before);
  }
});

test('forecast includes guard, lethal thresholds and counter ranges without reading future rolls', () => {
  for (const hp of [1, 15, 100]) for (const mode of ['share', 'intercept']) for (const rng of [1, 77, 123456789, 0xffffffff]) {
    const state = createDuelGameState(), defender = state.parties['party-2'];
    defender.guardOrders['unit-5'].mode = mode; state.units['unit-4'].currentHp = state.units['unit-4'].hp = hp; state.rng.combat.state = rng;
    const before = serializeGameState(state), preview = previewPartyAttack(state, 'party-1', 'party-2');
    assert.equal(preview.ok, true); assert.equal(serializeGameState(state), before);
    const other = structuredClone(state); other.rng.combat.state = rng ^ 19;
    assert.deepEqual(previewPartyAttack(other, 'party-1', 'party-2'), preview, 'prediction does not disclose next random value');
    const result = RuleSystem.execute(state, player.attackParty(state, 'party-1', 'party-2'));
    assert.equal(result.ok, true);
    for (const [id, range] of Object.entries(preview.damage)) {
      const damage = state.units[id].currentHp - result.state.units[id].currentHp;
      assert.ok(damage >= range.min && damage <= range.max, `${id}: ${damage} outside ${JSON.stringify(range)}`);
    }
    assert.deepEqual(restoreGameState(serializeGameState(result.state)), result.state);
  }
});

test('guard capacity and reactions recover at the round start, without reviving casualties', () => {
  let state = createDuelGameState();
  state.parties['party-2'].guardOrders['unit-5'].mode = 'intercept';
  state = RuleSystem.execute(state, player.attackParty(state, 'party-1', 'party-2')).state;
  assert.equal(state.parties['party-2'].reactionCharges, 0);
  state.units['unit-2'].guardCapacityRemaining = 1;
  state = RuleSystem.execute(state, player.endTurn(state)).state;
  assert.equal(state.units['unit-2'].guardCapacityRemaining, 1, 'another player is still in the same round');
  const second = new HumanController('kingdom-2'); state = RuleSystem.execute(state, second.endTurn(state)).state;
  assert.equal(state.units['unit-2'].guardCapacityRemaining, 50); assert.equal(state.parties['party-2'].reactionCharges, 1);
});

test('legacy zero-capacity units are not silently upgraded on restore', () => {
  const state = createDuelGameState();
  for (const unit of Object.values(state.units)) { unit.guardRate = unit.guardCapacityMax = unit.guardCapacityRemaining = 0; delete unit.guardRange; }
  for (const party of Object.values(state.parties)) delete party.guardOrders;
  const restored = restoreGameState(serializeGameState(state));
  assert.equal(restored.units['unit-1'].guardCapacityMax, 0); assert.deepEqual(restored.parties['party-1'].guardOrders, {});
});
