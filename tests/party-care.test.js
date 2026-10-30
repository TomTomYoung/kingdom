import test from 'node:test';
import assert from 'node:assert/strict';
import { restoreGameState, serializeGameState } from '../src/core/game-state.js';
import { createRangedDuelGameState, createAiConquestGameState, createAiSkirmishGameState, createAiReinforcementGameState } from '../src/core/scenarios.js';
import { HumanController } from '../src/core/human-controller.js';
import { RuleSystem } from '../src/core/rule-system.js';
import { AIController, runAiTurn } from '../src/core/ai-controller.js';
import { recruitmentNeeds } from '../src/core/ai-economy.js';
import { previewPartyRest, processPartyRest, validateRemoveCasualties } from '../src/systems/party-care.js';
import { previewPartyAttack } from '../src/systems/combat-system.js';
import { createUnit } from '../src/models/unit.js';
import { updateDerivedCapabilities } from '../src/models/kingdom.js';

const human = new HumanController('kingdom-1'), enemy = new HumanController('kingdom-2');
const apply = (s, c) => { const r = RuleSystem.execute(s, c); assert.equal(r.ok, true, r.reason); return r.state; };
const trip = s => { const next = restoreGameState(serializeGameState(s)); assert.deepEqual(next, s); return next; };
function unchanged(s, c) { const before = structuredClone(s), r = RuleSystem.execute(s, c); assert.equal(r.ok, false, JSON.stringify(c)); assert.equal(r.state, s); assert.deepEqual(r.events, []); assert.deepEqual(s, before); }
function relocate(s, id, location) { const p = s.parties[id]; p.location = location; p.unitIds.forEach(id => { s.units[id].location = location; }); s.world.tiles[location].terrainId = 'plains'; }
function hp(s, id, amount) { Object.assign(s.units[id], { hp: amount, currentHp: amount, status: amount > 0 ? 'active' : s.units[id].scaleClass === 'individual' ? 'downed' : 'shattered' }); }
function ready(factory = createRangedDuelGameState, seed = 117) { let s = factory(seed); s = apply(s, human.startTurn(s)); relocate(s, 'party-1', '0,0,0'); relocate(s, 'party-2', '6,-6,0'); hp(s, 'unit-1', 41); return s; }
const rest = s => human.restParty(s, 'party-1');
const remove = s => human.removeCasualties(s, 'party-1');
const round = s => { s = apply(s, human.endTurn(s)); return apply(s, enemy.endTurn(s)); };
function ended(p) { assert.deepEqual([p.movementRemaining, p.attacksRemaining, p.reactionCharges, p.activationState], [0, 0, 0, 'ended']); }
function recruit(s, location = '0,0,0') { const id = `unit-${s.nextIds.unit++}`; s.units[id] = createUnit(id, 'kingdom-1', 'warrior', location); s.kingdoms['kingdom-1'].unitIds.push(id); return id; }

test('new games enable care; rest reserves the entire activation without healing or consuming RNG/resources', () => {
  const s = ready(), before = structuredClone(s), p = s.parties['party-1']; assert.equal(s.partyRecoveryVersion, 1);
  s.units['unit-1'].guardCapacityRemaining = 7; s.units['unit-1'].charges = { special: 2 }; p.morale = 58; p.cohesion = 63;
  const after = apply(s, rest(s)); ended(after.parties[p.id]); assert.equal(after.units['unit-1'].currentHp, 41);
  assert.deepEqual(after.parties[p.id].restOrder, { turn: 1, location: p.location });
  assert.deepEqual(after.units, s.units); assert.deepEqual(after.rng, before.rng); assert.deepEqual(after.kingdoms, before.kingdoms); assert.deepEqual(after.nextIds, before.nextIds);
  assert.equal(after.parties[p.id].morale, 58); assert.equal(after.parties[p.id].cohesion, 63); trip(after);
  unchanged(after, rest(after)); unchanged(after, human.moveParty(after, p.id, ['1,-1,0']));
  unchanged(after, human.reinforceParty(after, p.id, [recruit(after)]));
});

test('city recovery waits for the full round, caps at max HP, keeps charges and does not revive casualties', () => {
  let s = ready(); hp(s, 'unit-2', 95); hp(s, 'unit-3', 0); s.units['unit-1'].charges = { special: 2 };
  s = apply(s, rest(s)); s = apply(s, human.endTurn(s)); assert.equal(s.units['unit-1'].currentHp, 41); assert.ok(s.parties['party-1'].restOrder);
  const next = apply(trip(s), enemy.endTurn(s)); assert.equal(next.currentTurn, 2);
  assert.equal(next.units['unit-1'].currentHp, 71); assert.equal(next.units['unit-1'].hp, 71); assert.equal(next.units['unit-2'].currentHp, 100);
  assert.equal(next.units['unit-3'].currentHp, 0); assert.equal(next.units['unit-3'].status, 'shattered'); assert.equal(next.units['unit-3'].guardCapacityRemaining, 0);
  assert.equal(next.parties['party-1'].restOrder, undefined); assert.equal(next.parties['party-1'].activationState, 'ready');
  assert.deepEqual(next.units['unit-1'].charges, { special: 2 });
  const event = next.eventLog.find(e => e.type === 'PartyRestCompleted'); assert.deepEqual(event.recovery.map(v => v.hp), [30, 5]); trip(next);
  const noOrder = round(next); assert.equal(noOrder.units['unit-1'].currentHp, 71, 'no passive healing');
});

test('field recovery is 20 on neutral or owned non-center land, including construct and civilian units', () => {
  for (const location of ['1,-1,0', '-3,3,0']) {
    let s = ready(); relocate(s, 'party-1', location); hp(s, 'unit-5', 24);
    const unit = s.units['unit-4']; Object.assign(unit, createUnit(unit.id, unit.ownerId, 'settler', location), { partyId: 'party-1' }); hp(s, unit.id, 60);
    const preview = previewPartyRest(s, 'kingdom-1', 'party-1'); assert.equal(preview.amount, 20); assert.equal(preview.cityId, null);
    s = round(apply(s, rest(s))); assert.equal(s.units['unit-1'].currentHp, 61); assert.equal(s.units['unit-5'].currentHp, 44); assert.equal(s.units['unit-4'].currentHp, 80); trip(s);
  }
});

test('care preview and validation never read RNG or mutate state', () => {
  const s = ready(); hp(s, 'unit-3', 0); const before = structuredClone(s);
  const noRng = new Proxy(s, { get(target, key) { if (key === 'rng') throw new Error('RNG was read'); return target[key]; } });
  assert.equal(previewPartyRest(noRng, 'kingdom-1', 'party-1').recovery[0].hp, 30);
  assert.deepEqual(validateRemoveCasualties(noRng, 'kingdom-1', 'party-1').unitIds, ['unit-3']); assert.deepEqual(s, before);
});

test('both care commands reject invalid envelopes, ownership, exhausted/part-used activations and defeated parties atomically', () => {
  const base = ready(); hp(base, 'unit-2', 0);
  for (const mutate of [s => { s.phase = 'TURN_END'; }, s => { s.activePlayerId = 'kingdom-2'; }, s => { s.gameResult = { outcome: 'draw' }; }, s => { s.lastProcessedTurn = 0; },
    s => { s.parties['party-1'].hasMoved = true; }, s => { s.parties['party-1'].hasAttacked = true; }, s => { s.parties['party-1'].movementRemaining = 1; }, s => { s.parties['party-1'].attacksRemaining = 0; },
    s => { s.parties['party-1'].activationState = 'ended'; }, s => { s.parties['party-1'].status = 'defeated'; }, s => { s.parties['party-1'].ownerId = 'kingdom-2'; }, s => { delete s.partyRecoveryVersion; }]) {
    const s = structuredClone(base); mutate(s); unchanged(s, rest(s)); unchanged(s, remove(s));
  }
  for (const id of ['missing', 'constructor', '__proto__', '', null, {}]) { unchanged(base, human.restParty(base, id)); unchanged(base, human.removeCasualties(base, id)); }
  for (const factory of [rest, remove]) for (const payload of [null, [], {}, { partyId: 2 }]) unchanged(base, { ...factory(base), payload });
  const full = ready(); hp(full, 'unit-1', 100); unchanged(full, rest(full)); unchanged(full, remove(full));
});

test('care rejects hostile territory, adjacent armies and defended cities, but ignores civilian/dead/waiting enemies', () => {
  const base = ready(createAiConquestGameState); hp(base, 'unit-3', 0);
  for (const setup of [s => relocate(s, 'party-1', '4,-4,0'), s => relocate(s, 'party-2', '1,-1,0'), s => { relocate(s, 'party-1', '3,-3,0'); s.world.tiles['3,-3,0'].ownerId = null; s.world.tiles['3,-3,0'].territoryCityId = null; }]) {
    const s = structuredClone(base); setup(s); unchanged(s, rest(s)); unchanged(s, remove(s));
  }
  for (const civilian of [false, true]) {
    const s = structuredClone(base); relocate(s, 'party-2', '1,-1,0');
    for (const id of s.parties['party-2'].unitIds) {
      if (civilian) Object.assign(s.units[id], createUnit(id, 'kingdom-2', 'settler', '1,-1,0'), { partyId: 'party-2' }); else hp(s, id, 0);
    }
    if (!civilian) s.parties['party-2'].status = 'defeated';
    assert.equal(previewPartyRest(s, 'kingdom-1', 'party-1').ok, true); assert.equal(validateRemoveCasualties(s, 'kingdom-1', 'party-1').ok, true);
  }
  const s = ready(); s.units['unit-6'].partyId = null; s.units['unit-6'].location = '1,-1,0'; s.parties['party-2'].unitIds.shift(); delete s.parties['party-2'].formation['front-center']; s.parties['party-2'].leaderUnitId = 'unit-7'; s.parties['party-2'].guardOrders = {};
  assert.equal(previewPartyRest(s, 'kingdom-1', 'party-1').ok, true); trip(apply(s, rest(s)));
});

test('enemy approach immediately cancels rest even if the enemy retreats before the next round', () => {
  let s = ready(); relocate(s, 'party-2', '2,-2,0'); s.world.tiles['1,-1,0'].terrainId = 'plains';
  s = apply(s, rest(s)); s = apply(s, human.endTurn(s)); s = apply(s, enemy.moveParty(s, 'party-2', ['1,-1,0']));
  assert.equal(s.parties['party-1'].restOrder, undefined); assert.match(s.eventLog.at(-1).reason, /敵軍/); ended(s.parties['party-1']);
  s = apply(s, enemy.moveParty(s, 'party-2', ['2,-2,0'])); s = apply(trip(s), enemy.endTurn(s)); assert.equal(s.units['unit-1'].currentHp, 41);
});

test('ranged damage cancels rest through the shared resolver, preserving deterministic replay and guards', () => {
  let s = ready(); relocate(s, 'party-2', '2,-2,0');
  s = apply(s, rest(s)); s = apply(s, human.endTurn(s)); const before = structuredClone(s);
  const preview = previewPartyAttack(new Proxy(s, { get(t, k) { if (k === 'rng') throw new Error('RNG'); return t[k]; } }), 'party-2', 'party-1', 'ranged'); assert.equal(preview.ok, true); assert.deepEqual(s, before);
  const c = enemy.attackParty(s, 'party-2', 'party-1', 'ranged'), hit = apply(s, c); assert.deepEqual(hit, apply(trip(s), c));
  assert.equal(hit.parties['party-1'].restOrder, undefined); assert.ok(hit.eventLog.some(e => e.type === 'PartyRestCancelled' && /被害/.test(e.reason)));
  const after = apply(hit, enemy.endTurn(hit)); assert.equal(after.units['unit-1'].currentHp, hit.units['unit-1'].currentHp); trip(after);
});

test('missed precision fire leaves rest intact, while a lethal hit retains defeated records and cannot revive them', () => {
  let s = ready(); relocate(s, 'party-2', '2,-2,0'); s.parties['party-1'].guardOrders = {}; s.units['unit-1'].evasion = 1;
  s = apply(s, rest(s)); s = apply(s, human.endTurn(s));
  for (const id of ['unit-8', 'unit-9']) s.units[id].accuracy = 0;
  const miss = apply(s, enemy.attackParty(s, 'party-2', 'party-1', 'ranged', { attackId: 'precise', targetUnitId: 'unit-1' }));
  assert.ok(miss.parties['party-1'].restOrder); assert.equal(apply(miss, enemy.endTurn(miss)).units['unit-1'].currentHp, 71);
  let weak = ready(); relocate(weak, 'party-2', '2,-2,0'); weak.parties['party-1'].guardOrders = {}; hp(weak, 'unit-1', 1); weak.parties['party-1'].unitIds.slice(1).forEach(id => hp(weak, id, 0));
  weak = apply(weak, rest(weak)); weak = apply(weak, human.endTurn(weak)); weak = apply(weak, enemy.attackParty(weak, 'party-2', 'party-1', 'ranged'));
  assert.equal(weak.parties['party-1'].status, 'defeated'); assert.equal(weak.parties['party-1'].restOrder, undefined); weak = apply(weak, enemy.endTurn(weak));
  unchanged(weak, remove(weak)); assert.equal(weak.parties['party-1'].unitIds.length, 5); assert.equal(weak.units['unit-1'].hp, 0); trip(weak);
});

test('turn-start recovery rechecks hostile occupation and safety without refreshing or double-applying orders', () => {
  for (const mutate of [s => relocate(s, 'party-2', '1,-1,0'), s => { s.world.tiles['0,0,0'].ownerId = 'kingdom-2'; }, s => { s.parties['party-1'].location = '1,0,-1'; }]) {
    const s = apply(ready(), rest(ready())); mutate(s); s.currentTurn++;
    const events = []; processPartyRest(s, s.parties['party-1'], events); assert.equal(s.units['unit-1'].hp, 41); assert.equal(s.parties['party-1'].restOrder, undefined); assert.equal(events[0].type, 'PartyRestCancelled');
  }
  const s = apply(ready(), rest(ready())), events = []; processPartyRest(s, s.parties['party-1'], events); assert.equal(s.units['unit-1'].hp, 41);
  s.currentTurn++; processPartyRest(s, s.parties['party-1'], events); processPartyRest(s, s.parties['party-1'], events); assert.equal(s.units['unit-1'].hp, 71); assert.equal(events.length, 1);
});

test('removing casualties preserves Unit history and survivors, cleans slots and cross-member guards, and repairs leadership', () => {
  const s = ready(), p = s.parties['party-1']; hp(s, 'unit-1', 0); hp(s, 'unit-3', 0); s.units['unit-4'].commandContribution = 100;
  p.guardOrders = { 'unit-1': { targetUnitId: 'unit-2', mode: 'share' }, 'unit-2': { targetUnitId: 'unit-1', mode: 'intercept' }, 'unit-4': { targetUnitId: 'unit-5', mode: 'share' } }; p.morale = 43;
  const after = apply(s, remove(s)), result = after.parties[p.id]; ended(result);
  assert.deepEqual(result.unitIds, ['unit-2', 'unit-4', 'unit-5']); assert.equal(result.leaderUnitId, 'unit-4'); assert.equal(result.morale, 43);
  assert.deepEqual(result.formation, { 'front-left': 'unit-2', 'rear-left': 'unit-4', 'rear-right': 'unit-5' }); assert.deepEqual(result.guardOrders, { 'unit-4': { targetUnitId: 'unit-5', mode: 'share' } });
  for (const id of ['unit-1', 'unit-3']) assert.deepEqual(after.units[id], { ...s.units[id], partyId: null });
  for (const id of result.unitIds) assert.deepEqual(after.units[id], s.units[id]);
  assert.deepEqual(after.kingdoms['kingdom-1'].unitIds, s.kingdoms['kingdom-1'].unitIds); assert.deepEqual(after.rng, s.rng); assert.deepEqual(after.nextIds, s.nextIds);
  assert.deepEqual(after.eventLog.at(-1).formation, { 'front-center': 'unit-1', 'middle-center': 'unit-3' }); trip(after);
});

test('removed casualties free capacity next round, stay at the old tile, and cannot be reformed or reinforced', () => {
  let s = ready(); hp(s, 'unit-3', 0); const id = recruit(s); unchanged(s, human.reinforceParty(s, 'party-1', [id]));
  s = apply(s, remove(s)); unchanged(s, human.reinforceParty(s, 'party-1', [id])); unchanged(s, rest(s)); unchanged(s, remove(s));
  s = round(trip(s)); s = apply(s, human.reinforceParty(s, 'party-1', [id])); assert.equal(s.parties['party-1'].unitIds.length, 5);
  s = round(s); s.world.tiles['1,-1,0'].terrainId = 'plains'; s = apply(s, human.moveParty(s, 'party-1', ['1,-1,0'])); assert.equal(s.units['unit-3'].location, '0,0,0');
  unchanged(s, human.createParty(s, ['unit-3'], '0,0,0')); unchanged(s, human.reinforceParty(s, 'party-1', ['unit-3']));
  const living = recruit(s); s = apply(s, human.createParty(s, [living], '0,0,0')); assert.equal(s.parties['party-3'].location, '0,0,0'); trip(s);
});

test('dead units stop contributing to military power in new games without changing recruitment cap or legacy calculations', () => {
  const s = ready(); hp(s, 'unit-3', 0); updateDerivedCapabilities(s.kingdoms['kingdom-1'], s); const newPower = s.kingdoms['kingdom-1'].derived.militaryPower;
  assert.equal(recruitmentNeeds(s, 'kingdom-1').total, 4);
  const removed = apply(s, remove(s)); assert.equal(removed.kingdoms['kingdom-1'].derived.militaryPower, newPower); assert.equal(recruitmentNeeds(removed, 'kingdom-1').total, 4);
  delete s.partyRecoveryVersion; updateDerivedCapabilities(s.kingdoms['kingdom-1'], s); assert.equal(s.kingdoms['kingdom-1'].derived.militaryPower, newPower + 4);
  let hit = ready(); relocate(hit, 'party-2', '2,-2,0'); hp(hit, 'unit-1', 1); hit.parties['party-1'].guardOrders = {}; updateDerivedCapabilities(hit.kingdoms['kingdom-1'], hit); const before = hit.kingdoms['kingdom-1'].derived.militaryPower;
  hit = apply(hit, human.endTurn(hit)); hit = apply(hit, enemy.attackParty(hit, 'party-2', 'party-1', 'ranged')); assert.equal(hit.units['unit-1'].hp, 0); assert.equal(hit.kingdoms['kingdom-1'].derived.militaryPower, before - 4);
});

test('saved orders require matching version, turn, location, wounds, zero actions and a living safe party', () => {
  const base = apply(ready(), rest(ready()));
  for (const mutate of [s => { delete s.partyRecoveryVersion; }, s => { s.partyRecoveryVersion = 2; }, s => { s.partyRecoveryVersion = null; },
    s => { s.parties['party-1'].restOrder = null; }, s => { s.parties['party-1'].restOrder.turn = 0; }, s => { s.parties['party-1'].restOrder.turn = 2; }, s => { delete s.parties['party-1'].restOrder.location; },
    s => { s.parties['party-1'].restOrder.location = '1,-1,0'; }, s => { s.parties['party-1'].activationState = 'ready'; }, s => { s.parties['party-1'].reactionCharges = 1; },
    s => { s.parties['party-1'].movementRemaining = 1; }, s => { s.parties['party-1'].attacksRemaining = 1; }, s => { s.parties['party-1'].hasMoved = true; }, s => { s.parties['party-1'].hasAttacked = true; },
    s => { hp(s, 'unit-1', 100); }, s => { s.lastProcessedTurn = 0; }, s => relocate(s, 'party-2', '1,-1,0')]) {
    const s = structuredClone(base); mutate(s); assert.throws(() => restoreGameState(serializeGameState(s)), /セーブデータが不正/);
  }
  trip(base); assert.deepEqual(round(base), round(trip(base)));
});

test('detached casualty saves retain bidirectional membership and do not silently repair corrupt references', () => {
  const s = ready(); hp(s, 'unit-3', 0); const removed = apply(s, remove(s)); trip(removed);
  for (const mutate of [s => { s.units['unit-3'].partyId = 'party-1'; }, s => { s.parties['party-1'].formation['middle-center'] = 'unit-3'; }, s => { s.parties['party-1'].leaderUnitId = 'unit-3'; }, s => { s.parties['party-1'].guardOrders['unit-2'] = { targetUnitId: 'unit-3', mode: 'share' }; }, s => { delete s.partyRecoveryVersion; }]) {
    const broken = structuredClone(removed); mutate(broken); assert.throws(() => restoreGameState(serializeGameState(broken)), /セーブデータが不正/);
  }
});

test('AI chooses safe casualty removal then rest before deployment, uses shared commands and resumes identically', () => {
  let s = ready(createAiReinforcementGameState); hp(s, 'unit-6', 40); hp(s, 'unit-8', 0); s = apply(s, human.endTurn(s));
  const ai = new AIController('kingdom-2'), first = ai.nextCommand(s); assert.equal(first.type, 'RemoveCasualties');
  const result = runAiTurn(s); assert.equal(result.ok, true, result.reason); assert.deepEqual(result, runAiTurn(trip(s))); assert.equal(result.commands.filter(c => c.type === 'RemoveCasualties').length, 1);
  s = apply(result.state, human.endTurn(result.state)); assert.equal(ai.nextCommand(s).type, 'RestParty');
  const rested = runAiTurn(s); assert.equal(rested.ok, true, rested.reason); assert.equal(rested.state.units['unit-6'].hp, 60); assert.ok(rested.commands.length <= 129); trip(rested.state);
});

test('AI rests at 50 percent HP, skips minor wounds or threats and prioritizes a legal city capture', () => {
  for (const amount of [50, 51]) {
    let s = ready(createAiSkirmishGameState); hp(s, 'unit-6', amount); s = apply(s, human.endTurn(s)); const c = new AIController('kingdom-2').nextCommand(s); assert.equal(c.type === 'RestParty', amount === 50);
  }
  let s = ready(createAiSkirmishGameState); relocate(s, 'party-1', '5,-5,0'); hp(s, 'unit-6', 40); s = apply(s, human.endTurn(s)); assert.notEqual(new AIController('kingdom-2').nextCommand(s).type, 'RestParty');
  s = ready(createAiConquestGameState); relocate(s, 'party-1', '-6,6,0'); relocate(s, 'party-2', '0,0,0'); s.cities['city-1'].defense.hp = 0; hp(s, 'unit-6', 40); s = apply(s, human.endTurn(s)); assert.equal(new AIController('kingdom-2').nextCommand(s).type, 'CaptureCity');
});

test('old saves keep former actions, military counting and AI without adding rest orders or recovery versions', () => {
  let s = ready(createAiSkirmishGameState); delete s.partyRecoveryVersion; hp(s, 'unit-6', 10); hp(s, 'unit-8', 0); trip(s);
  unchanged(s, rest(s)); unchanged(s, remove(s)); s = apply(s, human.endTurn(s)); const after = runAiTurn(s); assert.equal(after.ok, true, after.reason);
  assert.equal(after.commands.some(c => ['RestParty', 'RemoveCasualties'].includes(c.type)), false); assert.equal(after.state.units['unit-6'].hp, 10); assert.equal(after.state.partyRecoveryVersion, undefined); trip(after.state);
});

test('two AIs finish bounded deterministic games across skirmish, reinforcement and city objectives with care enabled', () => {
  for (const factory of [createAiSkirmishGameState, createAiReinforcementGameState, createAiConquestGameState]) {
    let s = ready(factory, 19); s.kingdoms['kingdom-1'].controllerType = 'ai'; hp(s, 'unit-1', 40); hp(s, 'unit-6', 40);
    let turns = 0;
    while (!s.gameResult && turns++ < 81) { const r = runAiTurn(s); assert.equal(r.ok, true, r.reason); assert.ok(r.commands.length <= 129); if (turns % 9 === 0) assert.deepEqual(r, runAiTurn(trip(s))); s = r.state; }
    assert.ok(s.gameResult); assert.ok(s.commandLog.some(c => c.type === 'RestParty')); trip(s);
  }
});


test('rest resolves before income and territory expansion, independent of kingdom processing order', () => {
  const base = ready(); relocate(base, 'party-1', '-3,3,0'); base.cities['city-2'].localCultureProgress = 10000;
  const pending = apply(base, rest(base));
  for (const reverse of [false, true]) {
    const s = structuredClone(pending); if (reverse) s.kingdoms = Object.fromEntries(Object.entries(s.kingdoms).reverse());
    const after = round(s); assert.equal(after.units['unit-1'].hp, 61);
    const completed = after.eventLog.findIndex(e => e.type === 'PartyRestCompleted');
    const income = after.eventLog.findIndex((e, i) => i > completed && e.type === 'YieldCollected');
    assert.ok(completed >= 0 && income > completed); trip(after);
  }
});
