import test from 'node:test';
import assert from 'node:assert/strict';
import { createAiReinforcementGameState, createAiConquestGameState, createRangedDuelGameState } from '../src/core/scenarios.js';
import { restoreGameState, serializeGameState } from '../src/core/game-state.js';
import { ABILITIES } from '../src/core/abilities.js';
import { HumanController } from '../src/core/human-controller.js';
import { RuleSystem } from '../src/core/rule-system.js';
import { previewAbility } from '../src/systems/ability-system.js';
import { AIController, runAiTurn } from '../src/core/ai-controller.js';
import { chooseAbilityCommand } from '../src/core/ai-abilities.js';
import { updateDerivedCapabilities } from '../src/models/kingdom.js';

const player = 'kingdom-1', controller = new HumanController(player);
const payload = { partyId: 'party-1', casterUnitId: 'unit-1', abilityId: 'heal', targetUnitId: 'unit-3' };
const trip = state => restoreGameState(serializeGameState(state));
const cast = (state, patch = {}) => { const p = { ...payload, ...patch }; return controller.useAbility(state, p.partyId, p.casterUnitId, p.abilityId, p.targetUnitId); };
const apply = (s, c) => { const r = RuleSystem.execute(s, c); assert.equal(r.ok, true, r.reason); return r.state; };
function fixture() {
  const state = createAiReinforcementGameState(117);
  state.kingdoms['kingdom-2'].controllerType = 'human'; state.scenarioId = 'ability-test';
  const started = apply(state, controller.startTurn(state));
  started.kingdoms[player].stockpiles.mana = 20;
  started.units['unit-3'].hp = started.units['unit-3'].currentHp = 40;
  updateDerivedCapabilities(started.kingdoms[player], started);
  return started;
}
function round(state) {
  state = apply(state, new HumanController(state.activePlayerId).endTurn(state));
  return apply(state, new HumanController(state.activePlayerId).endTurn(state));
}

test('new reinforcement/conquest units learn the prototype, other scenarios retain empty ability fields', () => {
  for (const create of [createAiReinforcementGameState, createAiConquestGameState]) {
    const state = create(); assert.equal(state.activeAbilityVersion, 1);
    assert.deepEqual(state.units['unit-1'].abilityStates, { heal: { usesRemaining: 1 } });
    assert.deepEqual(state.units['unit-1'].charges, { heal: 3 });
    assert.deepEqual(state.units['unit-3'].abilityStates, {}); assert.deepEqual(trip(state), state);
  }
  const old = createRangedDuelGameState(); assert.equal(Object.hasOwn(old, 'activeAbilityVersion'), false);
  assert.deepEqual(old.units['unit-1'].abilityStates, {});
});

test('prediction is pure and exact; cast pays each cost once, ends activation and retains reaction/Guard', () => {
  const state = fixture(), before = structuredClone(state), p = state.parties['party-1'];
  const expected = previewAbility(state, player, payload);
  assert.equal(expected.recoveredHp, 30); assert.equal(expected.remainingHp, 70); assert.deepEqual(state, before);
  const result = RuleSystem.execute(state, cast(state)); assert.equal(result.ok, true);
  const after = result.state, party = after.parties[p.id];
  assert.equal(after.units['unit-3'].hp, expected.remainingHp); assert.equal(after.units['unit-3'].currentHp, 70);
  assert.equal(after.kingdoms[player].stockpiles.mana, 16); assert.equal(after.kingdoms[player].stockpiles.gold, state.kingdoms[player].stockpiles.gold);
  assert.equal(after.units['unit-1'].charges.heal, 2); assert.equal(after.units['unit-1'].abilityStates.heal.usesRemaining, 0);
  assert.equal(party.attacksRemaining, 0); assert.equal(party.movementRemaining, 0); assert.equal(party.activationState, 'ended');
  assert.equal(party.reactionCharges, p.reactionCharges); assert.deepEqual(party.guardOrders, p.guardOrders);
  assert.equal(after.units['unit-1'].guardCapacityRemaining, state.units['unit-1'].guardCapacityRemaining);
  assert.deepEqual(after.rng, state.rng); assert.deepEqual(state, before);
  assert.equal(after.kingdoms[player].derived.militaryPower, state.kingdoms[player].derived.militaryPower - 1);
  assert.equal(result.events[0].casterUnitId, 'unit-1'); assert.equal(result.events[0].targetUnitId, 'unit-3');
  assert.equal(result.events[0].recoveredHp, expected.recoveredHp); assert.deepEqual(result.events[0].costs, expected.costs);
  assert.equal(after.commandLog.length, state.commandLog.length + 1); assert.deepEqual(trip(after), after);
  const duplicate = RuleSystem.execute(after, cast(state)); assert.equal(duplicate.ok, false); assert.strictEqual(duplicate.state, after);
});

test('self-cast and capped healing do not restore other combat fields or revive dead members', () => {
  const state = fixture(), unit = state.units['unit-1']; unit.hp = unit.currentHp = 93; unit.guardCapacityRemaining = 2;
  unit.statusEffects = ['poison']; const before = structuredClone(unit);
  const p = { ...payload, targetUnitId: unit.id }, prediction = previewAbility(state, player, p);
  assert.equal(prediction.recoveredHp, 7);
  const after = apply(state, cast(state, p)); assert.equal(after.units[unit.id].hp, 100);
  for (const field of ['guardCapacityRemaining', 'statusEffects', 'loyalty', 'status', 'movement', 'attacksRemaining']) assert.deepEqual(after.units[unit.id][field], before[field]);
});

const rejections = [
  ['old save', s => { delete s.activeAbilityVersion; }],
  ['wrong turn owner', s => { s.activePlayerId = 'kingdom-2'; s.activePlayerIndex = 1; }],
  ['game over', s => { s.phase = 'GAME_OVER'; }],
  ['phase', s => { s.phase = 'TURN_END'; }],
  ['ended activation', s => { s.parties['party-1'].activationState = 'ended'; }],
  ['defeated party', s => { s.parties['party-1'].status = 'defeated'; }],
  ['insufficient movement', s => { s.parties['party-1'].movementRemaining = 0; }],
  ['insufficient attacks', s => { s.parties['party-1'].attacksRemaining = 0; }],
  ['insufficient mana', s => { s.kingdoms[player].stockpiles.mana = 3; }],
  ['spent finite charges', s => { s.units['unit-1'].charges.heal = 0; }],
  ['spent round uses', s => { s.units['unit-1'].abilityStates.heal.usesRemaining = 0; }],
  ['unlearned ability', s => { delete s.units['unit-1'].abilityStates.heal; }],
  ['dead caster', s => { s.units['unit-1'].hp = s.units['unit-1'].currentHp = 0; s.units['unit-1'].status = 'shattered'; }],
  ['dead target', s => { s.units['unit-3'].hp = s.units['unit-3'].currentHp = 0; s.units['unit-3'].status = 'shattered'; }],
  ['full target', s => { s.units['unit-3'].hp = s.units['unit-3'].currentHp = 100; }],
  ['detached target', s => { s.units['unit-3'].partyId = null; }],
  ['detached caster', s => { s.units['unit-1'].partyId = null; }],
  ['stun', s => { s.units['unit-1'].statusEffects = ['stun']; }],
  ['break object', s => { s.units['unit-1'].statusEffects = [{ type: 'BREAK' }]; }],
  ['fear object', s => { s.units['unit-1'].statusEffects = [{ id: 'fear' }]; }],
];
for (const [name, mutate] of rejections) test(`invalid ability leaves all state unchanged: ${name}`, () => {
  const state = fixture(); mutate(state); const before = structuredClone(state);
  assert.equal(previewAbility(state, player, payload).ok, false);
  const result = RuleSystem.execute(state, cast(state)); assert.equal(result.ok, false);
  assert.strictEqual(result.state, state); assert.deepEqual(result.events, []); assert.deepEqual(state, before);
});

test('unknown and forged IDs, enemy targets and caller-supplied costs/effects are rejected atomically', () => {
  const state = fixture();
  for (const patch of [{ abilityId: 'constructor' }, { partyId: '__proto__' }, { casterUnitId: 'unit-3' }, { casterUnitId: 'unit-6' }, { targetUnitId: 'unit-6' }, { targetUnitId: 'missing' }, { targetUnitId: null }, { manaCost: -100 }, { amount: 10000 }, { effect: 'revive' }]) {
    const c = cast(state); Object.assign(c.payload, patch); const result = RuleSystem.execute(state, c);
    assert.equal(result.ok, false, JSON.stringify(patch)); assert.strictEqual(result.state, state); assert.deepEqual(result.events, []);
  }
});

test('moving before casting is legal when one movement remains; no action can follow the cast', () => {
  let state = fixture(); state.world.tiles['2,-2,0'].terrainId = 'plains';
  state = apply(state, controller.moveParty(state, 'party-1', ['2,-2,0']));
  assert.equal(state.parties['party-1'].movementRemaining, 1);
  state = apply(state, cast(state));
  for (const c of [cast(state), controller.moveParty(state, 'party-1', ['1,-1,0']), controller.restParty(state, 'party-1')]) {
    const r = RuleSystem.execute(state, c); assert.equal(r.ok, false); assert.strictEqual(r.state, state);
  }
});

test('only a global round refreshes uses; handoff, load and repeated StartTurn never refill charges', () => {
  let state = fixture(); state = apply(state, cast(state)); const used = structuredClone(state);
  state = apply(state, controller.endTurn(state));
  assert.equal(state.units['unit-1'].abilityStates.heal.usesRemaining, 0); assert.deepEqual(trip(state), state);
  const refreshed = apply(state, new HumanController('kingdom-2').endTurn(state));
  assert.equal(refreshed.units['unit-1'].abilityStates.heal.usesRemaining, 1); assert.equal(refreshed.units['unit-1'].charges.heal, 2);
  assert.equal(refreshed.parties['party-1'].attacksRemaining, 1);
  assert.equal(RuleSystem.execute(refreshed, controller.startTurn(refreshed)).ok, false);
  assert.deepEqual(round(used), refreshed); assert.deepEqual(round(trip(used)), refreshed);
});

test('finite charges stay exhausted through rounds and rest', () => {
  let state = fixture(); state.units['unit-3'].hp = state.units['unit-3'].currentHp = 1;
  for (let i = 0; i < 3; i++) { state = apply(state, cast(state)); state = round(state); }
  assert.equal(state.units['unit-1'].charges.heal, 0); assert.equal(previewAbility(state, player, payload).ok, false);
  state = apply(state, controller.restParty(state, 'party-1')); state = round(state);
  assert.equal(state.units['unit-1'].charges.heal, 0); assert.deepEqual(trip(state), state);
});

test('purchase and production initialize only new warriors and do not refill existing units', () => {
  let state = fixture(); state.units['unit-1'].charges.heal = 1; state.kingdoms[player].stockpiles.gold = 500;
  for (const type of ['warrior', 'archer', 'settler']) {
    const id = `unit-${state.nextIds.unit}`; state = apply(state, controller.purchaseItem(state, 'city-1', type));
    assert.deepEqual(state.units[id].charges, type === 'warrior' ? { heal: 3 } : {});
  }
  state = apply(state, controller.setProduction(state, 'city-1', 'warrior'));
  state.cities['city-1'].production.progressByItem.warrior = 11; const id = `unit-${state.nextIds.unit}`;
  state = round(state); assert.equal(state.units[id].charges.heal, 3); assert.equal(state.units['unit-1'].charges.heal, 1);
  assert.deepEqual(trip(state), state);
  const old = createRangedDuelGameState(); const legacy = apply(old, controller.purchaseItem(old, 'city-1', 'warrior'));
  assert.deepEqual(legacy.units[`unit-${old.nextIds.unit}`].charges, {});
});

test('splitting, merging and changing formation preserve per-unit spent charges and uses', () => {
  let state = fixture(); state = apply(state, cast(state)); state = round(state);
  state.world.tiles['2,-2,0'].terrainId = 'plains';
  state = apply(state, controller.splitParty(state, 'party-1', ['unit-1'], '2,-2,0'));
  assert.equal(state.units['unit-1'].charges.heal, 2); state = round(state);
  state = apply(state, controller.mergeParties(state, state.units['unit-1'].partyId, 'party-1'));
  assert.equal(state.units['unit-1'].charges.heal, 2); assert.deepEqual(trip(state), state);
});

test('ability save validates feature version, paired counters, types, integer bounds and history without migration', () => {
  const base = fixture();
  const corruptions = [
    ...[0, 2, null, '1', true].map(v => s => { s.activeAbilityVersion = v; }),
    s => { delete s.activeAbilityVersion; },
    s => { s.units['unit-1'].abilityStates = null; },
    s => { s.units['unit-1'].charges = []; },
    s => { delete s.units['unit-1'].charges.heal; },
    s => { delete s.units['unit-1'].abilityStates.heal; },
    s => { s.units['unit-1'].abilityStates.heal = { usesRemaining: 1, power: 100 }; },
    s => { s.units['unit-1'].abilityStates.heal.usesRemaining = 2; },
    s => { s.units['unit-1'].abilityStates.heal.usesRemaining = -1; },
    s => { s.units['unit-1'].charges.heal = 1.5; },
    s => { s.units['unit-1'].charges.heal = 4; },
    s => { s.units['unit-1'].charges.heal = -1; },
    s => { s.units['unit-1'].charges.heal = null; },
    s => { s.units['unit-1'].charges.unknown = 1; },
    s => { s.units['unit-3'].charges.heal = 3; s.units['unit-3'].abilityStates.heal = { usesRemaining: 1 }; },
  ];
  for (const mutate of corruptions) { const state = structuredClone(base); mutate(state); assert.throws(() => trip(state), /セーブデータ/); }
  const used = apply(base, cast(base)); delete used.activeAbilityVersion;
  for (const u of Object.values(used.units)) { u.charges = {}; u.abilityStates = {}; }
  assert.throws(() => trip(used), /能力の履歴/);
  const legacy = createRangedDuelGameState(); legacy.units['unit-1'].charges = { historical: 7 };
  assert.deepEqual(trip(legacy), legacy);
});

test('AI uses legal healing after safe-rest priority, keeps deterministic targeting and old-state decisions', () => {
  const state = fixture(); state.kingdoms[player].controllerType = 'ai';
  // Enemy threat makes safe rest impossible, while the same-party spell is legal.
  state.parties['party-2'].location = '2,-2,0'; state.parties['party-2'].unitIds.forEach(id => { state.units[id].location = '2,-2,0'; });
  const before = structuredClone(state), command = new AIController(player).nextCommand(state);
  assert.equal(command.type, 'UseAbility'); assert.equal(command.payload.targetUnitId, 'unit-3'); assert.equal(command.payload.casterUnitId, 'unit-1');
  assert.deepEqual(state, before); assert.deepEqual(new AIController(player).nextCommand(trip(state)), command);
  const result = RuleSystem.execute(state, command); assert.equal(result.ok, true); assert.equal(result.state.units['unit-3'].currentHp, 70);
  assert.deepEqual(runAiTurn(trip(result.state)), runAiTurn(result.state));
  for (const unit of Object.values(state.units)) { unit.charges = {}; unit.abilityStates = {}; } delete state.activeAbilityVersion;
  assert.equal(chooseAbilityCommand(state, player, 'legacy'), null); assert.notEqual(new AIController(player).nextCommand(state).type, 'UseAbility');
  const safe = fixture(); safe.kingdoms[player].controllerType = 'ai'; assert.equal(new AIController(player).nextCommand(safe).type, 'RestParty');
});

test('seeded two-AI reinforcement and conquest games stay bounded and replay every round boundary', () => {
  for (const create of [createAiReinforcementGameState, createAiConquestGameState]) for (const seed of [117, 22]) {
    let state = create(seed); state.kingdoms[player].controllerType = 'ai'; state = apply(state, controller.startTurn(state));
    let steps = 0;
    while (!state.gameResult && steps++ < 90) {
      const direct = runAiTurn(state), restored = runAiTurn(trip(state));
      assert.deepEqual(restored, direct); assert.equal(direct.ok, true, direct.reason); state = direct.state;
    }
    assert.ok(state.gameResult); assert.ok(steps <= 80); assert.deepEqual(trip(state), state);
  }
});

test('malformed previews and malformed saved ability history cannot crash the UI or acquire caller costs', () => {
  const state = fixture();
  for (const payload of [null, undefined, [], 1, 'heal']) assert.equal(previewAbility(state, player, payload).ok, false);
  const used = apply(state, cast(state));
  for (const mutate of [
    e => { delete e.costs; }, e => { e.costs.mana = -4; }, e => { e.recoveredHp = 1000; },
    e => { e.chargesRemaining = 3; }, e => { e.targetUnitId = null; }, e => { e.abilityId = 'constructor'; },
  ]) {
    const bad = structuredClone(used); mutate(bad.eventLog.find(e => e.type === 'AbilityUsed'));
    assert.throws(() => trip(bad), /eventLog.AbilityUsed/);
  }
  const bad = structuredClone(used); bad.commandLog.at(-1).payload.manaCost = 0;
  assert.throws(() => trip(bad), /commandLog.UseAbility/);
});
