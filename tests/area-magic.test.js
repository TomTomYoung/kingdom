import test from 'node:test';
import assert from 'node:assert/strict';
import { createAiReinforcementGameState } from '../src/core/scenarios.js';
import { restoreGameState, serializeGameState } from '../src/core/game-state.js';
import { HumanController } from '../src/core/human-controller.js';
import { RuleSystem } from '../src/core/rule-system.js';
import { SeededRng } from '../src/core/rng.js';
import { chooseAbilityCommand } from '../src/core/ai-abilities.js';
import { enableTurnFlow, listTurnTasks } from '../src/core/turn-tasks.js';
import { previewAbility, validateAbility } from '../src/systems/ability-system.js';
import { magicTargeting, resolveMagicStrike } from '../src/systems/magic-combat.js';
import { updateDerivedCapabilities } from '../src/models/kingdom.js';

const h = new HumanController('kingdom-1');
const payload = { partyId: 'party-1', casterUnitId: 'unit-3', abilityId: 'arcane-wave', targetUnitId: 'unit-6' };
const trip = s => restoreGameState(serializeGameState(s));
const command = (s, p = payload) => h.useAbility(s, p.partyId, p.casterUnitId, p.abilityId, p.targetUnitId);
const apply = (s, c) => { const r = RuleSystem.execute(s, c); assert.equal(r.ok, true, r.reason); return r.state; };
function fixture(seed = 117) {
  let s = createAiReinforcementGameState(seed);
  s.scenarioId = 'wave-test'; s.kingdoms['kingdom-2'].controllerType = 'human';
  s = apply(s, h.startTurn(s)); s.kingdoms['kingdom-1'].stockpiles.mana = 100;
  const enemy = s.parties['party-2']; enemy.location = '2,-2,0'; enemy.guardOrders = {};
  enemy.formation = { 'front-center': 'unit-6', 'front-left': 'unit-7', 'front-right': 'unit-8', 'middle-center': 'unit-9', 'rear-center': 'unit-10' };
  for (const id of enemy.unitIds) {
    const u = s.units[id]; u.location = enemy.location; u.resistance = 0; u.armor = 999;
    u.evasion = 1; u.coverPower = 1; u.tauntStrength = 1;
  }
  s.units['unit-3'].accuracy = 0;
  updateDerivedCapabilities(s.kingdoms['kingdom-1'], s); return s;
}
function oldVersion(s, version) {
  s.activeAbilityVersion = version;
  for (const u of Object.values(s.units)) {
    delete u.charges['arcane-wave']; delete u.abilityStates['arcane-wave'];
    if (version === 1 && u.typeId === 'archer') { u.charges = {}; u.abilityStates = {}; u.magicStrength = 0; }
  }
  return s;
}
function strike(s, raw = 60, p = payload) {
  const events = [];
  const result = resolveMagicStrike(s, validateAbility(s, 'kingdom-1', p), events, () => raw, () => { throw new Error('row spell read hit RNG'); });
  return { result, events };
}

test('new v3 archers learn both spells, while v1/v2 loads and purchases never acquire the wave', () => {
  const s = fixture(); assert.equal(s.activeAbilityVersion, 3);
  assert.deepEqual(s.units['unit-3'].charges, { 'arcane-bolt': 3, 'arcane-wave': 2 }); assert.deepEqual(trip(s), s);
  for (const version of [1, 2]) {
    const old = oldVersion(structuredClone(s), version); assert.deepEqual(trip(old), old);
    assert.equal(previewAbility(old, 'kingdom-1', payload).ok, false);
    const id = `unit-${old.nextIds.unit}`, bought = apply(old, h.purchaseItem(old, 'city-1', 'archer'));
    assert.equal(bought.units[id].charges['arcane-wave'], undefined);
    assert.equal(bought.units[id].magicStrength, version === 1 ? 0 : 18);
  }
  const id = `unit-${s.nextIds.unit}`, bought = apply(s, h.purchaseItem(s, 'city-1', 'archer'));
  assert.deepEqual(bought.units[id].charges, { 'arcane-bolt': 3, 'arcane-wave': 2 });
  let produced = apply(s, h.setProduction(s, 'city-1', 'archer')); produced.cities['city-1'].production.progressByItem.archer = 17;
  produced = apply(produced, h.endTurn(produced)); produced = apply(produced, new HumanController('kingdom-2').endTurn(produced));
  assert.deepEqual(produced.units[id].charges, { 'arcane-bolt': 3, 'arcane-wave': 2 });
});

test('wave fixes the selected row and primary, ignores accuracy/Cover/Taunt, and never hits another row', () => {
  const s = fixture(), before = structuredClone(s), checked = validateAbility(s, 'kingdom-1', payload);
  const targeting = magicTargeting(s, checked);
  assert.deepEqual(targeting.targets.map(t => t.unit.id), ['unit-6', 'unit-7', 'unit-8']); assert.deepEqual(s, before);
  const { result, events } = strike(s);
  assert.deepEqual(result.targetUnitIds, ['unit-6', 'unit-7', 'unit-8']); assert.equal(result.targetRow, 'front'); assert.equal(result.hit, true);
  for (const id of result.targetUnitIds) assert.equal(s.units[id].currentHp, 64);
  for (const id of ['unit-9', 'unit-10']) assert.equal(s.units[id].currentHp, 100);
  assert.equal(events.some(e => ['CombatMiss', 'CombatCover', 'CombatTaunt'].includes(e.type)), false);
});

test('Guard direct and shared damage combine before a single resistance application and HP event', () => {
  const s = fixture(); s.parties['party-2'].guardOrders = { 'unit-7': { targetUnitId: 'unit-6', mode: 'share' } };
  s.units['unit-7'].resistance = 25;
  const { result, events } = strike(s);
  assert.equal(s.units['unit-6'].currentHp, 82); assert.equal(s.units['unit-7'].currentHp, 80); assert.equal(s.units['unit-8'].currentHp, 64);
  assert.equal(s.units['unit-7'].guardCapacityRemaining, 32); assert.equal(result.damage, 74);
  const guard = events.filter(e => e.type === 'CombatDamage' && e.targetUnitId === 'unit-7');
  assert.equal(guard.length, 1); assert.equal(guard[0].allocatedDamage, 54); assert.deepEqual(guard[0].roles, ['guard', 'area']);
  assert.equal(events.filter(e => e.type === 'CombatGuard').length, 1);
});

test('Intercept in the row receives the redirected hit and its own direct hit once, spending one reaction', () => {
  const s = fixture(); s.parties['party-2'].guardOrders = { 'unit-7': { targetUnitId: 'unit-6', mode: 'intercept' } }; s.units['unit-7'].resistance = 25;
  const { events } = strike(s); assert.equal(s.units['unit-6'].currentHp, 100); assert.equal(s.units['unit-7'].currentHp, 74);
  assert.equal(s.parties['party-2'].reactionCharges, 0); assert.equal(s.units['unit-7'].guardCapacityRemaining, 50);
  const damage = events.filter(e => e.type === 'CombatDamage' && e.targetUnitId === 'unit-7');
  assert.equal(damage.length, 1); assert.equal(damage[0].allocatedDamage, 72); assert.deepEqual(damage[0].roles, ['intercept', 'area']);
});

test('only the primary gets Guard; an outside guard is included without redirecting secondary hits or chaining', () => {
  const s = fixture(), p = s.parties['party-2'], outside = s.units['unit-9'];
  Object.assign(outside, { guardRate: 0.5, guardCapacityMax: 50, guardCapacityRemaining: 50, guardRange: 1 });
  p.guardOrders = { 'unit-9': { targetUnitId: 'unit-6', mode: 'share' }, 'unit-6': { targetUnitId: 'unit-8', mode: 'intercept' } };
  const preview = previewAbility(s, 'kingdom-1', payload); assert.ok(preview.guards.includes('unit-9')); assert.ok(preview.damage['unit-9'].max > 0);
  const { events } = strike(s); assert.equal(s.units['unit-6'].currentHp, 82); assert.equal(outside.currentHp, 82);
  assert.equal(s.units['unit-8'].currentHp, 64); assert.equal(p.reactionCharges, 1);
  assert.equal(events.filter(e => e.type === 'CombatGuard').length, 1); assert.equal(events.some(e => e.type === 'CombatIntercept'), false);
});

test('empty and HP-zero slots remain empty; death of primary does not move the row or cancel later hits', () => {
  const s = fixture(); s.units['unit-6'].hp = s.units['unit-6'].currentHp = 1;
  s.units['unit-7'].hp = s.units['unit-7'].currentHp = 0; s.units['unit-7'].status = 'shattered';
  const { result, events } = strike(s); assert.deepEqual(result.targetUnitIds, ['unit-6', 'unit-8']);
  assert.equal(s.units['unit-8'].currentHp, 64); assert.equal(s.units['unit-9'].currentHp, 100);
  assert.ok(events.some(e => e.type === 'PartyLeaderChanged')); assert.equal(events.some(e => e.type === 'CombatDamage' && e.targetUnitId === 'unit-7'), false);
  const one = fixture(), p = { ...payload, targetUnitId: 'unit-10' }; const singleRow = strike(one, 60, p);
  assert.deepEqual(singleRow.result.targetUnitIds, ['unit-10']); assert.equal(singleRow.result.damage, 36);
});

test('zero allocation never creates minimum damage or consumes Guard capacity/reaction', () => {
  const s = fixture(); s.parties['party-2'].guardOrders = { 'unit-7': { targetUnitId: 'unit-6', mode: 'intercept' } };
  const { result, events } = strike(s, 1); assert.equal(result.damage, 0); assert.equal(s.parties['party-2'].reactionCharges, 1);
  assert.equal(events.some(e => e.type === 'CombatDamage'), false); assert.equal(s.units['unit-7'].guardCapacityRemaining, 50);
});

test('every legal raw roll, Guard mode, HP cap and resistance lies within RNG-free preview bounds', () => {
  for (const mode of ['off', 'share', 'intercept']) {
    const s = fixture(); s.parties['party-2'].guardOrders = { 'unit-7': { targetUnitId: 'unit-6', mode } };
    s.units['unit-6'].hp = s.units['unit-6'].currentHp = 3; s.units['unit-7'].resistance = 25; s.units['unit-7'].guardCapacityRemaining = 3;
    const before = structuredClone(s), preview = previewAbility({ ...s, get rng() { throw new Error('preview read RNG'); } }, 'kingdom-1', payload);
    assert.equal(preview.ok, true); assert.deepEqual(s, before); assert.equal(preview.hitChance, 1); assert.deepEqual(preview.covers, []);
    for (let raw = preview.rawDamage.min; raw <= preview.rawDamage.max; raw++) {
      const c = structuredClone(s), { result } = strike(c, raw);
      assert.ok(result.damage >= preview.totalDamage.min && result.damage <= preview.totalDamage.max);
      for (const [id, range] of Object.entries(preview.damage)) {
        const lost = s.units[id].currentHp - c.units[id].currentHp; assert.ok(lost >= range.min && lost <= range.max);
      }
    }
  }
});

test('wave pays exactly once, consumes one combat draw, ends activation and preserves bolt charges', () => {
  for (const seed of [1, 7, 42, 117]) {
    const s = fixture(seed), before = structuredClone(s), r = RuleSystem.execute(s, command(s)); assert.equal(r.ok, true, r.reason);
    const a = r.state, unit = a.units['unit-3']; assert.equal(a.kingdoms['kingdom-1'].stockpiles.mana, 90);
    assert.equal(unit.charges['arcane-wave'], 1); assert.equal(unit.abilityStates['arcane-wave'].usesRemaining, 0); assert.equal(unit.charges['arcane-bolt'], 3);
    assert.equal(a.parties['party-1'].movementRemaining, 0); assert.equal(a.parties['party-1'].attacksRemaining, 0); assert.equal(a.parties['party-1'].activationState, 'ended');
    assert.equal(a.parties['party-1'].reactionCharges, 1); assert.equal(a.parties['party-1'].hasAttacked, true); assert.equal(r.events.some(e => e.counter), false);
    const rng = SeededRng.fromJSON(s.rng.combat); rng.next(); assert.deepEqual(a.rng.combat, rng.toJSON()); assert.deepEqual(a.rng.territory, s.rng.territory);
    assert.deepEqual(trip(a), a); assert.deepEqual(RuleSystem.execute(trip(s), command(s)), r); assert.deepEqual(s, before);
    const event = a.eventLog.find(e => e.type === 'AbilityUsed'); assert.equal(event.targetRow, 'front'); assert.ok(event.damage > event.rawDamage);
    assert.equal(RuleSystem.execute(a, command(s)).ok, false);
  }
});

test('area deaths cancel rest, settle leadership once and can end the game', () => {
  const s = fixture(), enemy = s.parties['party-2']; enemy.restOrder = { turn: s.currentTurn, location: enemy.location };
  for (const id of enemy.unitIds) { const u = s.units[id]; u.hp = u.currentHp = ['unit-9', 'unit-10'].includes(id) ? 0 : 1; if (!u.hp) u.status = 'shattered'; }
  const r = RuleSystem.execute(s, command(s)); assert.equal(r.ok, true); assert.equal(r.state.parties['party-2'].restOrder, undefined);
  assert.equal(r.events.filter(e => e.type === 'PartyDefeated').length, 1); assert.equal(r.state.gameResult.winnerId, 'kingdom-1'); assert.deepEqual(trip(r.state), r.state);
});

test('round refresh restores wave uses, while finite wave and bolt charges survive save/load', () => {
  let s = apply(fixture(), command(fixture())); s = apply(s, h.endTurn(s));
  assert.equal(s.units['unit-3'].abilityStates['arcane-wave'].usesRemaining, 0);
  s = apply(s, new HumanController('kingdom-2').endTurn(s)); assert.equal(s.units['unit-3'].abilityStates['arcane-wave'].usesRemaining, 1);
  assert.equal(s.units['unit-3'].charges['arcane-wave'], 1); assert.equal(s.units['unit-3'].charges['arcane-bolt'], 3); assert.deepEqual(trip(s), s);
});

test('task listing and AI expose and select the legal wave without consuming RNG', () => {
  const s = fixture(); enableTurnFlow(s); const before = structuredClone(s);
  assert.ok(listTurnTasks(s).find(t => t.id === 'party:party-1').actions.includes('魔力波'));
  const c = chooseAbilityCommand({ ...s, get rng() { throw new Error('AI read RNG'); } }, 'kingdom-1', 'wave-ai');
  assert.equal(c.payload.abilityId, 'arcane-wave'); assert.deepEqual(chooseAbilityCommand(trip(s), 'kingdom-1', 'wave-ai'), c); assert.deepEqual(s, before);
  const after = apply(s, c); assert.equal(listTurnTasks(after).some(t => t.id === 'party:party-1'), false);
});

for (const [name, mutate] of [
  ['mana', s => { s.kingdoms['kingdom-1'].stockpiles.mana = 9; }],
  ['charge', s => { s.units['unit-3'].charges['arcane-wave'] = 0; }],
  ['round use', s => { s.units['unit-3'].abilityStates['arcane-wave'].usesRemaining = 0; }],
  ['stun', s => { s.units['unit-3'].statusEffects = ['stun']; }],
  ['movement', s => { s.parties['party-1'].movementRemaining = 0; }],
  ['attack', s => { s.parties['party-1'].attacksRemaining = 0; }],
  ['range', s => { s.parties['party-2'].location = '5,-5,0'; }],
  ['dead anchor', s => { s.units['unit-6'].hp = s.units['unit-6'].currentHp = 0; s.units['unit-6'].status = 'shattered'; }],
]) test(`invalid wave is atomic: ${name}`, () => {
  const s = fixture(); mutate(s); const before = structuredClone(s), r = RuleSystem.execute(s, command(s));
  assert.equal(previewAbility(s, 'kingdom-1', payload).ok, false); assert.equal(r.ok, false); assert.strictEqual(r.state, s); assert.deepEqual(r.events, []); assert.deepEqual(s, before);
});

test('callers cannot widen the row, supply weights or bypass friendly target and caster checks', () => {
  const s = fixture(); for (const patch of [{ targetUnitId: 'unit-1' }, { casterUnitId: 'unit-1' }, { targetRow: 'rear' }, { targets: ['unit-6','unit-9'] }, { multiplier: 99 }, { damage: 999 }, { manaCost: 0 }]) {
    const c = command(s); Object.assign(c.payload, patch); const r = RuleSystem.execute(s, c); assert.equal(r.ok, false); assert.strictEqual(r.state, s);
  }
});

test('wave saves reject downgrade, partial charges and invalid footprint/history without backfilling learning', () => {
  const s = fixture(), used = apply(s, command(s));
  for (const mutate of [x => { x.activeAbilityVersion = 2; }, x => { x.activeAbilityVersion = 4; }, x => { delete x.units['unit-3'].charges['arcane-wave']; }, x => { x.units['unit-3'].charges['arcane-wave'] = 3; }]) {
    const x = structuredClone(s); mutate(x); assert.throws(() => trip(x), /セーブデータ/);
  }
  for (const patch of [{ targetRow: 'diagonal' }, { targetUnitIds: [] }, { targetUnitIds: ['unit-7'] }, { targetUnitIds: ['unit-6','unit-6'] }, { targetUnitIds: ['unit-6','unit-7','unit-8','unit-9'] }, { targetUnitIds: ['unit-6',null] }, { hit: false }, { damage: 999 }, { rawDamage: 0 }]) {
    const x = structuredClone(used); Object.assign(x.eventLog.find(e => e.type === 'AbilityUsed'), patch); assert.throws(() => trip(x), /AbilityUsed/);
  }
  const missing = structuredClone(s); delete missing.units['unit-3'].charges['arcane-wave']; delete missing.units['unit-3'].abilityStates['arcane-wave']; assert.deepEqual(trip(missing), missing);
});
