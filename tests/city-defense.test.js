import test from 'node:test';
import assert from 'node:assert/strict';
import { createAiConquestGameState, createAiReinforcementGameState } from '../src/core/scenarios.js';
import { addCity, restoreGameState, serializeGameState } from '../src/core/game-state.js';
import { HumanController } from '../src/core/human-controller.js';
import { RuleSystem } from '../src/core/rule-system.js';
import { SeededRng } from '../src/core/rng.js';
import { AIController, runAiTurn, executeAiStep } from '../src/core/ai-controller.js';
import { chooseCityDefenseCommand, chooseSupplyCommand, chooseDeploymentCommand } from '../src/core/ai-economy.js';
import { previewCityAttack } from '../src/systems/city-siege.js';
import { createUnit } from '../src/models/unit.js';
import { createParty } from '../src/models/party.js';

const human = new HumanController('kingdom-1'), enemy = new HumanController('kingdom-2');
const execute = (s, c) => { const r = RuleSystem.execute(s, c); assert.equal(r.ok, true, r.reason); return r.state; };
const trip = s => { const after = restoreGameState(serializeGameState(s)); assert.deepEqual(after, s); return after; };
function relocate(s, id, location) { const p = s.parties[id]; p.location = location; p.unitIds.forEach(id => { s.units[id].location = location; }); s.world.tiles[location].terrainId = 'plains'; }
function ready(seed = 117) { let s = createAiConquestGameState(seed); s = execute(s, human.startTurn(s)); relocate(s, 'party-1', '3,-3,0'); relocate(s, 'party-2', '-6,6,0'); return s; }
const attack = (s, type = 'melee', partyId = 'party-1') => human.attackCity(s, partyId, 'city-2', type);
const round = s => execute(execute(s, human.endTurn(s)), enemy.endTurn(s));
const forecast = (s, type = 'melee') => previewCityAttack(s, 'kingdom-1', 'party-1', 'city-2', type);
function units(s, owner, location, count = 1) {
  return Array.from({ length: count }, () => { const id = `unit-${s.nextIds.unit++}`; s.units[id] = createUnit(id, owner, 'warrior', location); s.kingdoms[owner].unitIds.push(id); return id; });
}
function party(s, owner, location, count = 1) { s.world.tiles[location].terrainId = 'plains'; const ids = units(s, owner, location, count), id = `party-${s.nextIds.party++}`; s.parties[id] = createParty(id, owner, ids, location); ids.forEach(uid => { s.units[uid].partyId = id; }); return id; }
function onlyLeader(s, id = 'party-1', hp = 100) { const p = s.parties[id]; p.guardOrders = {}; p.unitIds.forEach(uid => Object.assign(s.units[uid], { currentHp: uid === p.leaderUnitId ? hp : 0, hp: uid === p.leaderUnitId ? hp : 0, status: uid === p.leaderUnitId ? 'active' : 'shattered' })); }
function unchanged(s, command) { const before = structuredClone(s), r = RuleSystem.execute(s, command); assert.equal(r.ok, false); assert.equal(r.state, s); assert.deepEqual(r.events, []); assert.deepEqual(s, before); }
const counterEvents = s => s.eventLog.filter(e => e.type === 'CityCounterattacked');
function aiReady() { let s = ready(); s = execute(s, human.endTurn(s)); s.kingdoms['kingdom-2'].stockpiles.gold = 144; return s; }

// Version 1 and earlier capture-only modes are covered by their retained suites.
test('new conquest starts version 2 with one counterattack and preserves it through saves', () => {
  const s = ready(); assert.equal(s.cityDefenseVersion, 2);
  for (const city of Object.values(s.cities)) assert.deepEqual(city.defense, { hp: 100, wallHp: 0, lastDamagedTurn: null, counterattacksRemaining: 1 }); trip(s);
});

test('melee siege retaliates through shared guard, armor and morale resolution with two RNG draws', () => {
  const s = ready(), before = structuredClone(s), p = s.parties['party-1'], target = p.unitIds[0], guard = p.unitIds[1];
  const after = execute(s, attack(s)), events = after.eventLog, hit = counterEvents(after).at(-1), damage = events.filter(e => e.type === 'CombatDamage');
  assert.deepEqual(s, before); assert.equal(hit.cityId, 'city-2'); assert.equal(after.cities['city-2'].defense.counterattacksRemaining, 0);
  assert.deepEqual(hit.guards, [guard]); assert.deepEqual(hit.intercepts, []); assert.ok(after.units[target].currentHp < 100); assert.ok(after.units[guard].currentHp < 100);
  assert.equal(after.units[guard].guardCapacityRemaining, 50 - events.find(e => e.type === 'CombatGuard').amount);
  for (const e of damage) { assert.equal(e.damage, Math.max(1, e.allocatedDamage - s.units[e.targetUnitId].armor)); assert.equal(e.attackerCityId, 'city-2'); }
  assert.equal(after.parties[p.id].morale, 100 - Math.ceil(hit.damage * 0.25));
  const rng = SeededRng.fromJSON(s.rng.combat); rng.next(); rng.next(); assert.deepEqual(after.rng.combat, rng.toJSON()); assert.deepEqual(after.rng.territory, s.rng.territory);
  assert.deepEqual([after.parties[p.id].movementRemaining, after.parties[p.id].attacksRemaining, after.parties[p.id].reactionCharges, after.parties[p.id].activationState], [0, 0, 0, 'ended']); trip(after);
});

test('intercept uses the attacking party reaction before the siege closes all reactions', () => {
  const s = ready(), p = s.parties['party-1'], target = p.unitIds[0], guard = p.unitIds[1]; p.guardOrders[guard].mode = 'intercept';
  const preview = forecast(s); assert.equal(preview.counter, 'certain'); assert.deepEqual(preview.intercepts, [guard]); assert.equal(preview.damage[target].max, 0);
  const after = execute(s, attack(s)); assert.equal(after.units[target].currentHp, 100); assert.ok(after.units[guard].currentHp < 100); assert.equal(after.units[guard].guardCapacityRemaining, 50); assert.equal(after.parties[p.id].reactionCharges, 0); trip(after);
  const spent = structuredClone(s); spent.parties[p.id].reactionCharges = 0; const noIntercept = execute(spent, attack(spent)); assert.equal(counterEvents(noIntercept).at(-1).intercepts.length, 0); assert.ok(noIntercept.units[target].currentHp < 100);
});

test('exhausted, disabled, distant or dead guards do not absorb city retaliation', () => {
  for (const mutate of [s => { s.units['unit-2'].guardCapacityRemaining = 0; }, s => { s.units['unit-2'].statusEffects = ['stun']; }, s => { s.units['unit-2'].guardRange = 0; }, s => { Object.assign(s.units['unit-2'], { hp: 0, currentHp: 0, status: 'shattered' }); }]) {
    const s = ready(); mutate(s); const after = execute(s, attack(s)); assert.deepEqual(counterEvents(after).at(-1).guards, []); assert.ok(after.units['unit-1'].currentHp < 100); trip(after);
  }
});

test('ranged siege and a successful breach skip retaliation without spending its charge or RNG draw', () => {
  for (const breach of [false, true]) {
    const s = ready(); if (breach) s.cities['city-2'].defense.hp = 1;
    const type = breach ? 'melee' : 'ranged', preview = forecast(s, type); assert.equal(preview.counter, 'none');
    const after = execute(s, attack(s, type)); assert.equal(counterEvents(after).length, 0); assert.deepEqual(after.units, s.units); assert.equal(after.cities['city-2'].defense.counterattacksRemaining, 1);
    const rng = SeededRng.fromJSON(s.rng.combat); rng.next(); assert.deepEqual(after.rng.combat, rng.toJSON()); trip(after);
  }
});

test('remaining walls can retaliate with body HP zero; exhausted counter cannot be refreshed by purchase', () => {
  let s = ready(); s.cities['city-2'].buildings = ['walls']; Object.assign(s.cities['city-2'].defense, { hp: 0, wallHp: 60 }); s = execute(s, attack(s)); assert.equal(counterEvents(s).length, 1); trip(s);
  s = ready(); s = execute(s, attack(s)); s = execute(s, human.endTurn(s)); s.kingdoms['kingdom-2'].stockpiles.gold = 200;
  s = execute(s, enemy.purchaseItem(s, 'city-2', 'walls')); assert.equal(s.cities['city-2'].defense.counterattacksRemaining, 0); trip(s);
});

test('one city counters at most once per full round, independently of other cities and handoffs', () => {
  let s = ready(), second = party(s, 'kingdom-1', '4,-3,-1');
  s.world.tiles['4,-2,-2'].terrainId = 'plains'; addCity(s, { ownerId: 'kingdom-2', id: 'city-3', name: '反撃都', centerHex: '4,-2,-2' }); const third = party(s, 'kingdom-1', '4,-1,-3');
  s = execute(s, attack(s)); s = execute(s, attack(s, 'melee', second)); assert.equal(counterEvents(s).length, 1); assert.equal(s.cities['city-3'].defense.counterattacksRemaining, 1);
  s = execute(s, human.attackCity(s, third, 'city-3', 'melee')); assert.equal(s.cities['city-3'].defense.counterattacksRemaining, 0); assert.equal(counterEvents(s).length, 2);
  s = execute(s, human.endTurn(s)); assert.equal(s.cities['city-2'].defense.counterattacksRemaining, 0);
  s = execute(s, enemy.endTurn(s)); assert.equal(s.cities['city-2'].defense.counterattacksRemaining, 1);
  s.cities['city-2'].defense.hp = 100; s = execute(s, attack(s)); assert.equal(counterEvents(s).length, 3); trip(s);
});

test('counter preview never reads RNG and bounds all HP losses including a conditional breach', () => {
  for (const seed of [1, 7, 117, 999]) for (const hp of [1, 22, 100]) for (const mode of ['share', 'intercept', 'off']) {
    const s = ready(seed), p = s.parties['party-1']; s.cities['city-2'].defense.hp = hp;
    if (mode === 'off') p.guardOrders = {}; else p.guardOrders['unit-2'].mode = mode;
    const before = structuredClone(s), safe = { ...s, rng: new Proxy({}, { get() { throw new Error('RNG read'); } }) }, preview = forecast(safe);
    assert.deepEqual(s, before); if (hp === 22) assert.equal(preview.counter, 'possible');
    const result = execute(s, attack(s));
    for (const id of p.unitIds) { const loss = s.units[id].currentHp - result.units[id].currentHp; assert.ok(loss >= preview.damage[id].min && loss <= preview.damage[id].max, `${id}: ${loss}`); }
    assert.deepEqual(execute(trip(s), attack(s)), result); trip(result);
  }
});

test('city counter repairs leadership or defeats the entire party without ending city-control play', () => {
  let s = ready(); s.parties['party-1'].guardOrders = {}; s.units['unit-1'].hp = s.units['unit-1'].currentHp = 1;
  s = execute(s, attack(s)); assert.equal(s.units['unit-1'].status, 'shattered'); assert.equal(s.parties['party-1'].leaderUnitId, 'unit-2'); assert.ok(s.eventLog.some(e => e.type === 'PartyLeaderChanged')); trip(s);
  s = ready(); onlyLeader(s, 'party-1', 1); s = execute(s, attack(s)); assert.equal(s.parties['party-1'].status, 'defeated'); assert.equal(s.gameResult, null); assert.equal(counterEvents(s).at(-1).defeated, true);
  unchanged(s, human.captureCity(s, 'party-1', 'city-2')); trip(s);
});

test('failed attacks cannot spend city charges and a rejected replay cannot trigger another counter', () => {
  const s = ready(); unchanged(s, human.attackCity(s, 'party-1', 'city-1', 'melee')); unchanged(s, attack(s, 'magic'));
  const command = attack(s), after = execute(s, command); unchanged(after, command); unchanged(after, attack(after)); assert.equal(counterEvents(after).length, 1);
});

test('capture resets retaliation to zero and newly founded cities receive their own counter', () => {
  let s = ready(); s.world.tiles['-4,4,0'].terrainId = 'plains'; addCity(s, { ownerId: 'kingdom-2', id: 'city-3', name: '余都', centerHex: '-4,4,0' });
  assert.equal(s.cities['city-3'].defense.counterattacksRemaining, 1); s.cities['city-2'].defense.hp = 0;
  s = execute(s, human.moveParty(s, 'party-1', ['4,-4,0'])); s = execute(s, human.captureCity(s, 'party-1', 'city-2')); assert.equal(s.cities['city-2'].defense.counterattacksRemaining, 0); s = round(s); assert.equal(s.cities['city-2'].defense.counterattacksRemaining, 1);
  relocate(s, 'party-1', '0,4,-4'); const p = s.parties['party-1'], settler = p.unitIds.at(-1); s.units[settler] = { ...createUnit(settler, p.ownerId, 'settler', p.location), partyId: p.id };
  s = execute(s, human.foundCity(s, p.id, settler)); assert.equal(s.cities['city-4'].defense.counterattacksRemaining, 1); trip(s);
});

test('version 2 requires integral bounded charges; version 1 cannot contain partial retaliation data', () => {
  const s = ready();
  for (const value of [-1, 0.5, 2, null, undefined, '1']) { const bad = structuredClone(s); bad.cities['city-2'].defense.counterattacksRemaining = value; assert.throws(() => restoreGameState(serializeGameState(bad)), /counterattacksRemaining/); }
  const mixed = structuredClone(s); mixed.cityDefenseVersion = 1; assert.throws(() => restoreGameState(serializeGameState(mixed)), /counterattacksRemaining/);
  const future = structuredClone(s); future.cityDefenseVersion = 3; assert.throws(() => restoreGameState(serializeGameState(future)), /cityDefenseVersion/);
  s.cities['city-2'].defense.counterattacksRemaining = 0; trip(s);
});

test('version-1 siege keeps no counter, no wall AI and exactly one attack RNG draw', () => {
  let s = ready(); s.cityDefenseVersion = 1; Object.values(s.cities).forEach(city => { delete city.defense.counterattacksRemaining; });
  const after = execute(s, attack(s)); assert.deepEqual(after.units, s.units); assert.equal(counterEvents(after).length, 0); assert.equal(forecast(s).counter, 'none'); trip(after);
  s = execute(s, human.endTurn(s)); s.kingdoms['kingdom-2'].stockpiles.gold = 200; assert.equal(chooseCityDefenseCommand(s, 'kingdom-2', 'wall'), null);
  assert.equal(chooseCityDefenseCommand(createAiReinforcementGameState(), 'kingdom-2', 'wall'), null);
});

test('threatened AI buys walls while keeping reserve and pending military orders', () => {
  let s = aiReady(); s = execute(s, enemy.setProduction(s, 'city-2', 'archer', ['warrior'])); s.cities['city-2'].production.progressByItem.archer = 10;
  const before = structuredClone(s), chosen = chooseSupplyCommand(s, 'kingdom-2', 'wall'); assert.deepEqual(s, before); assert.equal(chosen.type, 'PurchaseCityItem'); assert.equal(chosen.payload.itemId, 'walls');
  s = execute(s, chosen); assert.equal(s.kingdoms['kingdom-2'].stockpiles.gold, 24); assert.equal(s.cities['city-2'].defense.wallHp, 60); assert.deepEqual(s.cities['city-2'].production, before.cities['city-2'].production); assert.deepEqual(s.rng, before.rng); trip(s);
  assert.equal(chooseCityDefenseCommand(s, 'kingdom-2', 'again'), null);
});

test('wall AI falls back to empty-city production without replacing any existing queue', () => {
  let s = aiReady(); s.kingdoms['kingdom-2'].stockpiles.gold = 143;
  const command = chooseSupplyCommand(s, 'kingdom-2', 'wall'); assert.equal(command.type, 'SetCityProduction'); assert.equal(command.payload.itemId, 'walls'); s = execute(s, command); trip(s);
  assert.equal(chooseCityDefenseCommand(s, 'kingdom-2', 'again'), null);
  s = aiReady(); s.kingdoms['kingdom-2'].stockpiles.gold = 0; s = execute(s, enemy.setProduction(s, 'city-2', 'warrior', ['archer'])); const before = structuredClone(s); assert.equal(chooseCityDefenseCommand(s, 'kingdom-2', 'wall'), null); assert.deepEqual(s, before);
});

test('wall AI needs a real nearby military threat and an existing army, preserving rebuilding', () => {
  for (const change of [s => relocate(s, 'party-1', '-6,0,6'), s => s.parties['party-1'].unitIds.forEach(id => { s.units[id].typeId = 'settler'; }), s => { s.parties['party-1'].status = 'defeated'; }, s => { onlyLeader(s, 'party-2'); }, s => { Object.values(s.units).filter(u => u.ownerId === 'kingdom-2').forEach(u => { u.partyId = null; }); delete s.parties['party-2']; }]) {
    const s = aiReady(); change(s); assert.equal(chooseCityDefenseCommand(s, 'kingdom-2', 'wall'), null);
  }
  const s = aiReady(); onlyLeader(s, 'party-2'); const chosen = chooseSupplyCommand(s, 'kingdom-2', 'rebuild'); assert.equal(chosen.type, 'SetCityProduction'); assert.notEqual(chosen.payload.itemId, 'walls');
});

test('wall AI does not fortify a city with enemy occupants but can fortify under its own garrison', () => {
  const s = aiReady(); relocate(s, 'party-1', '4,-4,0'); assert.equal(chooseCityDefenseCommand(s, 'kingdom-2', 'wall'), null);
  relocate(s, 'party-1', '3,-3,0'); relocate(s, 'party-2', '4,-4,0'); assert.equal(chooseCityDefenseCommand(s, 'kingdom-2', 'wall').payload.itemId, 'walls');
});

test('all AI purchases share the per-city cap and walls remain available at the military unit cap', () => {
  let s = aiReady(); s.kingdoms['kingdom-2'].stockpiles.gold = 300; s = execute(s, enemy.purchaseItem(s, 'city-2', 'warrior'));
  s = execute(s, enemy.setProduction(s, 'city-2', 'archer')); assert.equal(chooseCityDefenseCommand(s, 'kingdom-2', 'wall'), null);
  s = aiReady(); units(s, 'kingdom-2', '4,-4,0', 10); const command = chooseSupplyCommand(s, 'kingdom-2', 'wall'); assert.equal(command.payload.itemId, 'walls'); assert.equal(command.type, 'PurchaseCityItem');
});

test('multiple threatened cities share gold and produce rather than overspending after the first wall', () => {
  let s = aiReady(); s.world.tiles['4,-2,-2'].terrainId = 'plains'; addCity(s, { ownerId: 'kingdom-2', id: 'city-3', name: '壁都', centerHex: '4,-2,-2' });
  let command = chooseCityDefenseCommand(s, 'kingdom-2', 'wall-1'); assert.equal(command.payload.cityId, 'city-2'); s = execute(s, command);
  command = chooseCityDefenseCommand(s, 'kingdom-2', 'wall-2'); assert.equal(command.type, 'SetCityProduction'); assert.equal(command.payload.cityId, 'city-3'); s = execute(s, command); assert.equal(s.kingdoms['kingdom-2'].stockpiles.gold, 24); trip(s);
});

test('AI wall decisions never inspect RNG and save-resumed spending does not duplicate purchases', () => {
  const s = aiReady(); Object.assign(s.parties['party-2'], { activationState: 'ended', movementRemaining: 0, attacksRemaining: 0 });
  const safe = { ...s, rng: new Proxy({}, { get() { throw new Error('RNG read'); } }) }; assert.equal(new AIController('kingdom-2').nextCommand(safe).payload.itemId, 'walls');
  const step = executeAiStep(s); assert.equal(step.ok, true); assert.deepEqual(executeAiStep(trip(s)), step);
  const end = runAiTurn(step.state); assert.equal(end.ok, true, end.reason); assert.deepEqual(runAiTurn(trip(step.state)), end);
  assert.equal(end.state.commandLog.filter(c => c.turn === 1 && c.playerId === 'kingdom-2' && c.type === 'PurchaseCityItem' && c.payload.cityId === 'city-2').length, 1); trip(end.state);
});

test('AI skips stranded waiting troops on fortified enemy cities instead of issuing an illegal deployment', () => {
  const s = aiReady(); const stranded = units(s, 'kingdom-2', '0,0,0');
  assert.equal(chooseDeploymentCommand(s, 'kingdom-2', 'deploy'), null);
  const local = units(s, 'kingdom-2', '4,-4,0'); const command = chooseDeploymentCommand(s, 'kingdom-2', 'deploy'); assert.deepEqual(command.payload.unitIds, local); assert.ok(!command.payload.unitIds.includes(stranded[0])); execute(s, command);
});

test('AI avoids certain annihilation by city retaliation but still takes a guaranteed breach', () => {
  let s = aiReady(); relocate(s, 'party-1', '-6,6,0'); relocate(s, 'party-2', '1,-1,0'); onlyLeader(s, 'party-2', 1); s.kingdoms['kingdom-2'].stockpiles.gold = 0;
  const next = new AIController('kingdom-2').nextCommand(s); assert.notEqual(next.type, 'AttackCity');
  s.cities['city-1'].defense.hp = 1; assert.equal(new AIController('kingdom-2').nextCommand(s).type, 'AttackCity'); const result = executeAiStep(s); assert.equal(result.ok, true); assert.equal(result.state.parties['party-2'].status, 'active'); trip(result.state);
});

test('two version-2 AIs finish bounded reproducible play with siege, walls and saves', () => {
  let s = ready(); s.kingdoms['kingdom-1'].controllerType = 'ai'; s.kingdoms['kingdom-1'].aiPolicy = 'reinforcements';
  for (let i = 0; i < 80 && !s.gameResult; i++) { const next = runAiTurn(s); assert.equal(next.ok, true, next.reason); assert.ok(next.commands.length <= 129); assert.deepEqual(runAiTurn(trip(s)), next); s = next.state; }
  assert.equal(s.phase, 'GAME_OVER'); assert.ok(s.commandLog.some(c => c.type === 'AttackCity')); assert.ok(s.commandLog.some(c => c.payload.itemId === 'walls')); trip(s);
});
