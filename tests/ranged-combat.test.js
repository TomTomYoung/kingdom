import test from 'node:test';
import assert from 'node:assert/strict';
import { createDuelGameState, createRangedDuelGameState } from '../src/core/scenarios.js';
import { restoreGameState, serializeGameState } from '../src/core/game-state.js';
import { HumanController } from '../src/core/human-controller.js';
import { RuleSystem } from '../src/core/rule-system.js';
import { FORMATION_SLOTS, FORMATION_ROWS, FORMATION_COLUMNS } from '../src/models/party.js';
import { ATTACK_DEFINITIONS, automaticTarget } from '../src/systems/combat-attacks.js';
import { isProtectionDisabled } from '../src/systems/damage-grid.js';
import { partyCombatStrength, previewPartyAttack, resolvePartyAttack, validatePartyAttack } from '../src/systems/combat-system.js';

const player = new HumanController('kingdom-1');
const options = [{}, { attackId: 'aimed', targetUnitId: 'unit-8' }, { attackId: 'precise', targetSlot: 'middle-center' }, { attackId: 'row', targetRow: 'front' }, { attackId: 'column', targetColumn: 'center' }, { attackId: 'area', targetSlot: 'front-center' }, { attackId: 'pierce', targetColumn: 'center' }];
const losses = state => Object.fromEntries(state.parties['party-2'].unitIds.map(id => [id, 100 - state.units[id].currentHp]));
function fixed(state, targeting, raw = 30, hit = true) {
  const events = [];
  const result = resolvePartyAttack(state, state.parties['party-1'], state.parties['party-2'], 'ranged', events, () => raw, targeting, () => hit);
  assert.equal(result.ok, true, result.reason); return events;
}
const prediction = (state, targeting) => previewPartyAttack(state, 'party-1', 'party-2', 'ranged', targeting);

test('ranged duel has five mixed units per kingdom and leaves the legacy duel intact', () => {
  const state = createRangedDuelGameState(), old = createDuelGameState();
  assert.equal(state.scenarioId, 'ranged-duel'); assert.equal(Object.keys(state.units).length, 10);
  for (const party of Object.values(state.parties)) assert.deepEqual(party.unitIds.map(id => state.units[id].typeId), ['warrior', 'warrior', 'archer', 'archer', 'ballista']);
  assert.equal(old.scenarioId, 'duel'); assert.equal(Object.keys(old.units).length, 6);
  assert.ok(Object.values(old.units).every(unit => unit.typeId === 'warrior'));
  assert.equal(prediction(old, {}).ok, false);
  assert.deepEqual(restoreGameState(serializeGameState(state)), state);
});

test('archers and ballistae can both be purchased and produced with their own stats', () => {
  for (const type of ['archer', 'ballista']) {
    let state = createRangedDuelGameState(); state.kingdoms['kingdom-1'].stockpiles.gold = 1000;
    let result = RuleSystem.execute(state, player.purchaseItem(state, 'city-1', type)); assert.equal(result.ok, true, result.reason);
    const purchased = result.state.units[`unit-${state.nextIds.unit}`]; assert.equal(purchased.typeId, type); assert.ok(purchased.rangedStrength > 0);
    result = RuleSystem.execute(state, player.setProduction(state, 'city-1', type)); assert.equal(result.ok, true); state = result.state;
    for (let turn = 0; turn < 20 && Object.keys(state.units).length === 10; turn++) {
      const controller = new HumanController(state.activePlayerId); const end = RuleSystem.execute(state, controller.endTurn(state)); assert.equal(end.ok, true); state = end.state;
    }
    assert.ok(Object.values(state.units).some(unit => unit.id === 'unit-11' && unit.typeId === type));
  }
});

test('normal targeting favors an exposed taunter while aim keeps its explicit target', () => {
  const state = createRangedDuelGameState(), defender = state.parties['party-2'];
  state.units['unit-7'].tauntStrength = 0.8;
  assert.equal(automaticTarget(state, defender).id, 'unit-7');
  const aimed = prediction(state, { attackId: 'aimed', targetUnitId: 'unit-8' });
  assert.equal(aimed.primaryTargetId, 'unit-8'); assert.deepEqual(aimed.taunts, ['unit-7']); assert.equal(aimed.hitChance, 0);
  state.units['unit-7'].statusEffects = ['fear']; assert.equal(automaticTarget(state, defender).id, 'unit-6');
  state.units['unit-6'].statusEffects = [{ type: 'stun' }]; assert.equal(automaticTarget(state, defender).id, 'unit-6', 'equal untaunting units retain depth/lane priority');
});

test('Unit and slot aim are equivalent and choosing a target never mutates state or RNG', () => {
  const state = createRangedDuelGameState(), before = serializeGameState(state);
  const byUnit = prediction(state, { attackId: 'aimed', targetUnitId: 'unit-8' }), bySlot = prediction(state, { attackId: 'aimed', targetSlot: 'middle-center' });
  assert.deepEqual(byUnit, bySlot); assert.equal(serializeGameState(state), before);
  assert.deepEqual(byUnit.covers, ['unit-6']); assert.equal(byUnit.primaryTargetId, 'unit-8'); assert.ok(Math.abs(byUnit.hitChance - 0.45) < 1e-12);
  assert.ok(prediction(state, { attackId: 'precise', targetUnitId: 'unit-8' }).hitChance > byUnit.hitChance);
});

test('projectile misses hit Cover with Guard, while precise misses only spend the attack', () => {
  const aimed = createRangedDuelGameState(), precise = createRangedDuelGameState();
  const hitEvents = fixed(aimed, { attackId: 'aimed', targetUnitId: 'unit-8' }, 30, false);
  assert.deepEqual(losses(aimed), { 'unit-6': 13, 'unit-7': 13, 'unit-8': 0, 'unit-9': 0, 'unit-10': 0 });
  assert.ok(hitEvents.some(event => event.type === 'CombatCover' && event.coverUnitId === 'unit-6'));
  assert.ok(hitEvents.some(event => event.type === 'CombatGuard')); assert.equal(aimed.units['unit-7'].guardCapacityRemaining, 35);
  const events = fixed(precise, { attackId: 'precise', targetUnitId: 'unit-8' }, 30, false);
  assert.ok(events.some(event => event.type === 'CombatMiss')); assert.ok(!events.some(event => event.type === 'CombatDamage'));
  assert.equal(precise.parties['party-1'].attacksRemaining, 0); assert.equal(precise.parties['party-1'].movementRemaining, 0);
  assert.equal(precise.units['unit-7'].guardCapacityRemaining, 50);
});

test('dead or disabled units cannot supply Cover or Taunt and no-cover misses deal no HP loss', () => {
  for (const disable of [unit => { unit.currentHp = 0; }, unit => { unit.statusEffects = [{ id: 'break' }]; }]) {
    const state = createRangedDuelGameState(); disable(state.units['unit-6']);
    assert.deepEqual(prediction(state, { attackId: 'aimed', targetUnitId: 'unit-8' }).covers, []);
    const before = Object.fromEntries(Object.entries(state.units).map(([id, unit]) => [id, unit.currentHp]));
    fixed(state, { attackId: 'aimed', targetUnitId: 'unit-8' }, 30, false);
    assert.deepEqual(Object.fromEntries(Object.entries(state.units).map(([id, unit]) => [id, unit.currentHp])), before);
  }
});

test('row, column and cross apply their exact fixed patterns and damage weights', () => {
  for (const [targeting, expected] of [
    [{ attackId: 'row', targetRow: 'front' }, { 'unit-6': 13, 'unit-7': 13, 'unit-8': 0, 'unit-9': 0, 'unit-10': 0 }],
    [{ attackId: 'column', targetColumn: 'center' }, { 'unit-6': 17, 'unit-7': 0, 'unit-8': 18, 'unit-9': 0, 'unit-10': 0 }],
    [{ attackId: 'area', targetSlot: 'front-center' }, { 'unit-6': 13, 'unit-7': 13, 'unit-8': 14, 'unit-9': 0, 'unit-10': 0 }],
  ]) {
    const state = createRangedDuelGameState(); state.parties['party-2'].guardOrders = {};
    fixed(state, targeting); assert.deepEqual(losses(state), expected);
  }
});

test('cross targets exactly the center and orthogonal neighbors for all nine centers', () => {
  for (const center of FORMATION_SLOTS) {
    const state = createRangedDuelGameState(), party = state.parties['party-2']; party.guardOrders = {};
    const [row, column] = center.split('-'), r = FORMATION_ROWS.indexOf(row), c = FORMATION_COLUMNS.indexOf(column);
    const expected = FORMATION_SLOTS.filter(slot => { const [rr, cc] = slot.split('-'); return Math.abs(FORMATION_ROWS.indexOf(rr) - r) + Math.abs(FORMATION_COLUMNS.indexOf(cc) - c) <= 1; });
    const ordered = [...expected, ...FORMATION_SLOTS.filter(slot => !expected.includes(slot))];
    party.formation = Object.fromEntries(party.unitIds.map((id, index) => [ordered[index], id]));
    const preview = prediction(state, { attackId: 'area', targetSlot: center });
    assert.deepEqual(new Set(preview.targetSlots), new Set(expected));
    const events = fixed(state, { attackId: 'area', targetSlot: center });
    const damageSlots = events.filter(event => event.type === 'CombatDamage').map(event => event.targetSlot);
    assert.deepEqual(new Set(damageSlots), new Set(expected));
  }
  const empty = createRangedDuelGameState(); assert.equal(prediction(empty, { attackId: 'area', targetSlot: 'middle-left' }).ok, true, 'empty center can cover living neighbors');
});

test('pierce decays by living depth, skips gaps and casualties, and never spills to another column', () => {
  const state = createRangedDuelGameState(), party = state.parties['party-2']; party.guardOrders = {};
  party.formation = { 'front-center': 'unit-6', 'middle-center': 'unit-7', 'rear-center': 'unit-8', 'front-left': 'unit-9', 'front-right': 'unit-10' };
  fixed(state, { attackId: 'pierce', targetColumn: 'center' });
  assert.deepEqual(losses(state), { 'unit-6': 28, 'unit-7': 16, 'unit-8': 9, 'unit-9': 0, 'unit-10': 0 });
  const gap = createRangedDuelGameState(); gap.parties['party-2'].guardOrders = {};
  gap.parties['party-2'].formation = { 'front-left': 'unit-6', 'middle-left': 'unit-7', 'rear-left': 'unit-8', 'front-right': 'unit-9', 'rear-right': 'unit-10' };
  gap.units['unit-7'].currentHp = gap.units['unit-7'].hp = 0; gap.units['unit-7'].status = 'shattered';
  fixed(gap, { attackId: 'pierce', targetColumn: 'left' });
  assert.equal(gap.units['unit-8'].currentHp, 83); assert.equal(gap.units['unit-9'].currentHp, 100);
});

test('floor-to-zero pattern allocation causes no minimum damage, Guard spend or reaction', () => {
  for (const attackId of ['row', 'area']) {
    const state = createRangedDuelGameState(), targeting = attackId === 'row' ? { attackId, targetRow: 'front' } : { attackId, targetSlot: 'front-center' };
    const events = fixed(state, targeting, 1);
    assert.ok(!events.some(event => ['CombatDamage', 'CombatGuard', 'CombatIntercept'].includes(event.type)));
    assert.ok(Object.values(losses(state)).every(value => value === 0)); assert.equal(state.units['unit-7'].guardCapacityRemaining, 50);
  }
});

test('area shares the primary only and combines direct plus Guard before one armor deduction', () => {
  const state = createRangedDuelGameState(), events = fixed(state, { attackId: 'area', targetSlot: 'front-center' });
  assert.deepEqual(losses(state), { 'unit-6': 6, 'unit-7': 20, 'unit-8': 14, 'unit-9': 0, 'unit-10': 0 });
  assert.equal(events.filter(event => event.type === 'CombatGuard').length, 1); assert.equal(state.units['unit-7'].guardCapacityRemaining, 43);
  const recipient = events.filter(event => event.type === 'CombatDamage' && event.targetUnitId === 'unit-7'); assert.equal(recipient.length, 1);
  assert.equal(recipient[0].allocatedDamage, 22); assert.deepEqual(new Set(recipient[0].roles), new Set(['guard', 'area']));
});

test('area Intercept spends one reaction without retargeting the rest of the pattern', () => {
  const state = createRangedDuelGameState(); state.parties['party-2'].guardOrders['unit-7'].mode = 'intercept';
  const events = fixed(state, { attackId: 'area', targetSlot: 'front-center' });
  assert.deepEqual(losses(state), { 'unit-6': 0, 'unit-7': 28, 'unit-8': 14, 'unit-9': 0, 'unit-10': 0 });
  assert.equal(events.filter(event => event.type === 'CombatIntercept').length, 1); assert.equal(state.parties['party-2'].reactionCharges, 0);
});

test('a fixed cross can defeat all five members and retain their formation in the save', () => {
  const state = createRangedDuelGameState(), party = state.parties['party-2']; party.guardOrders = {};
  party.formation = { 'front-center': 'unit-6', 'middle-left': 'unit-7', 'middle-center': 'unit-8', 'middle-right': 'unit-9', 'rear-center': 'unit-10' };
  for (const id of party.unitIds) state.units[id].currentHp = state.units[id].hp = 1;
  const formation = structuredClone(party.formation), events = fixed(state, { attackId: 'area', targetSlot: 'middle-center' });
  assert.equal(party.status, 'defeated'); assert.deepEqual(party.formation, formation);
  assert.equal(events.filter(event => event.type === 'PartyDefeated').length, 1); assert.ok(!events.some(event => event.counter));
  assert.deepEqual(restoreGameState(serializeGameState(state)), state);
});

test('each profile requires its own living unit type and that shooter must have sufficient range', () => {
  const state = createRangedDuelGameState(), attacker = state.parties['party-1'], defender = state.parties['party-2'];
  defender.location = '4,-4,0'; defender.unitIds.forEach(id => { state.units[id].location = defender.location; });
  assert.equal(validatePartyAttack(state, attacker, defender, 'ranged', { attackId: 'row', targetRow: 'front' }).ok, false);
  assert.equal(validatePartyAttack(state, attacker, defender, 'ranged', { attackId: 'column', targetColumn: 'center' }).ok, true);
  state.units['unit-5'].range = 1; state.units['unit-3'].range = 5;
  assert.equal(validatePartyAttack(state, attacker, defender, 'ranged', { attackId: 'area', targetSlot: 'front-center' }).ok, false);
  assert.equal(partyCombatStrength(state, attacker, 'ranged', 1, ATTACK_DEFINITIONS.area), 25);
  state.units['unit-5'].currentHp = 0; assert.equal(validatePartyAttack(state, attacker, defender, 'ranged', { attackId: 'column', targetColumn: 'center' }).ok, false);
});

test('malformed, foreign, empty, ambiguous and modifier-injecting targets reject atomically', () => {
  const state = createRangedDuelGameState(), before = serializeGameState(state);
  for (const targeting of [null, [], 42, 'row', { attackId: null }, { attackId: 'unknown' }, { attackId: '__proto__' }, { attackId: 'row', targetRow: 'x' }, { attackId: 'column', targetColumn: [] }, { attackId: 'area', targetSlot: 'center-middle' }, { attackId: 'precise', targetUnitId: 'unit-1' }, { attackId: 'precise', targetSlot: 'front-right' }, { attackId: 'aimed', targetUnitId: 'unit-8', targetSlot: 'middle-center' }, { attackId: 'normal', targetSlot: 'middle-center' }, { attackId: 'row', targetRow: 'front', multiplier: 100 }, { attackId: 'aimed', targetUnitId: {} }, { attackId: 'area', targetSlot: null }]) {
    const result = RuleSystem.execute(state, player.attackParty(state, 'party-1', 'party-2', 'ranged', targeting));
    assert.equal(result.ok, false, JSON.stringify(targeting)); assert.equal(result.state, state); assert.deepEqual(result.events, []); assert.equal(serializeGameState(state), before);
  }
});

test('all profile predictions enclose actual losses, ignore RNG, and reproduce after save restoration', () => {
  for (const hp of [1, 15, 100]) for (const mode of ['share', 'intercept']) for (const targeting of options) {
    const state = createRangedDuelGameState(); state.units['unit-6'].currentHp = state.units['unit-6'].hp = hp; state.parties['party-2'].guardOrders['unit-7'].mode = mode;
    const before = serializeGameState(state), forecast = prediction(state, targeting); assert.equal(forecast.ok, true); assert.equal(serializeGameState(state), before);
    const unreadable = structuredClone(state); Object.defineProperty(unreadable, 'rng', { get() { throw new Error('forecast accessed future RNG'); } });
    assert.deepEqual(prediction(unreadable, targeting), forecast);
    for (const seed of [0, 1, 77, 0xffffffff]) {
      const fresh = structuredClone(state); fresh.rng.combat.state = seed;
      const command = player.attackParty(fresh, 'party-1', 'party-2', 'ranged', targeting), result = RuleSystem.execute(fresh, command); assert.equal(result.ok, true);
      for (const [id, range] of Object.entries(forecast.damage)) {
        const damage = fresh.units[id].currentHp - result.state.units[id].currentHp;
        assert.ok(damage >= range.min && damage <= range.max, `${JSON.stringify(targeting)} ${id}: ${damage} outside ${JSON.stringify(range)}`);
      }
      assert.deepEqual(restoreGameState(serializeGameState(result.state)), result.state);
      assert.deepEqual(RuleSystem.execute(restoreGameState(serializeGameState(fresh)), command), result);
    }
  }
});

test('older saves receive neutral aiming fields and corrupt probabilities are rejected', () => {
  const state = createDuelGameState(); for (const unit of Object.values(state.units)) for (const key of ['accuracy', 'evasion', 'tauntStrength', 'coverPower']) delete unit[key];
  const restored = restoreGameState(serializeGameState(state));
  for (const unit of Object.values(restored.units)) assert.deepEqual([unit.accuracy, unit.evasion, unit.tauntStrength, unit.coverPower], [1, 0, 0, 0]);
  for (const key of ['accuracy', 'evasion', 'tauntStrength', 'coverPower']) for (const value of [-0.01, 1.01, null, '1']) {
    const corrupt = createRangedDuelGameState(); corrupt.units['unit-1'][key] = value;
    assert.throws(() => restoreGameState(serializeGameState(corrupt)));
  }
});

test('invalid status-effect identifiers cannot crash protection or enter a restored game', () => {
  for (const effect of [null, 7, {}, [], { type: {} }, { id: [] }, { type: 'stun', id: {} }, { type: '' }]) {
    assert.doesNotThrow(() => isProtectionDisabled({ statusEffects: [effect] }));
    const state = createRangedDuelGameState(); state.units['unit-7'].statusEffects = [effect];
    assert.throws(() => restoreGameState(serializeGameState(state)));
  }
  for (const effect of ['stun', { type: 'break' }, { id: 'fear' }]) {
    const state = createRangedDuelGameState(); state.units['unit-7'].statusEffects = [effect];
    assert.deepEqual(restoreGameState(serializeGameState(state)), state); assert.equal(isProtectionDisabled(state.units['unit-7']), true);
  }
});
