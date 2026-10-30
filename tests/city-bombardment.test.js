import test from 'node:test';
import assert from 'node:assert/strict';
import { createAiConquestGameState, createAiReinforcementGameState } from '../src/core/scenarios.js';
import { addCity, serializeGameState, restoreGameState } from '../src/core/game-state.js';
import { RuleSystem } from '../src/core/rule-system.js';
import { HumanController } from '../src/core/human-controller.js';
import { AIController, executeAiStep, runAiTurn } from '../src/core/ai-controller.js';
import { SeededRng } from '../src/core/rng.js';
import { hasCityBombardment } from '../src/models/city-defense.js';
import { validateCityBombardment, previewCityBombardment } from '../src/systems/city-bombardment.js';
import { RULESET } from '../src/core/ruleset.js';
import { createParty } from '../src/models/party.js';
import { createUnit } from '../src/models/unit.js';

const human = new HumanController('kingdom-1'), enemy = new HumanController('kingdom-2');
const exec = (s, c) => { const r = RuleSystem.execute(s, c); assert.equal(r.ok, true, r.reason); return r.state; };
const trip = s => { const next = restoreGameState(serializeGameState(s)); assert.deepEqual(next, s); return next; };
function relocate(s, id, location) { const p = s.parties[id]; p.location = location; p.unitIds.forEach(id => { s.units[id].location = location; }); s.world.tiles[location].terrainId = 'plains'; }
function ready(seed = 117) {
  let s = createAiConquestGameState(seed); s = exec(s, human.startTurn(s));
  s.kingdoms['kingdom-1'].stockpiles.gold = 120; // Fund the wall purchase explicitly in this fixture.
  s = exec(s, human.purchaseItem(s, 'city-1', 'walls'));
  relocate(s, 'party-2', '2,-2,0'); return s;
}
const command = s => human.bombardParty(s, 'city-1', 'party-2');
const preview = s => previewCityBombardment(s, 'kingdom-1', 'city-1', 'party-2');
const fire = s => exec(s, command(s));
const round = s => exec(exec(s, human.endTurn(s)), enemy.endTurn(s));
function rejected(s, c) { const before = structuredClone(s), r = RuleSystem.execute(s, c); assert.equal(r.ok, false); assert.equal(r.state, s); assert.deepEqual(r.events, []); assert.deepEqual(s, before); }
function onlyLeader(s, partyId, hp) { const p = s.parties[partyId]; p.guardOrders = {}; for (const id of p.unitIds) Object.assign(s.units[id], { hp: id === p.leaderUnitId ? hp : 0, currentHp: id === p.leaderUnitId ? hp : 0, status: id === p.leaderUnitId ? 'active' : 'shattered' }); }
function addParty(s, id, owner, location, type = 'warrior') { const unitId = `unit-${s.nextIds.unit++}`; s.world.tiles[location].terrainId = 'plains'; const u = createUnit(unitId, owner, type, location); u.partyId = id; s.units[u.id] = u; s.kingdoms[owner].unitIds.push(u.id); s.parties[id] = createParty(id, owner, [u.id], location); s.nextIds.party++; return s.parties[id]; }
function historical(s, version) { s.cityDefenseVersion = version; for (const c of Object.values(s.cities)) { delete c.defense.bombardmentsRemaining; if (version === 1) delete c.defense.counterattacksRemaining; } return s; }

test('v3 new conquest initializes independent city counters and other modes remain unchanged', () => {
  const s = createAiConquestGameState(); assert.equal(s.cityDefenseVersion, 3); assert.equal(hasCityBombardment(s), true);
  for (const city of Object.values(s.cities)) assert.deepEqual(city.defense, { hp: 100, wallHp: 0, lastDamagedTurn: null, counterattacksRemaining: 1, bombardmentsRemaining: 1 });
  trip(s); const old = createAiReinforcementGameState(); assert.equal(hasCityBombardment(old), false); assert.equal(old.cities['city-1'].defense, undefined);
});

test('walls unlock ranged city fire with one combat RNG draw and no source-unit action cost or counter', () => {
  const s = ready(), before = structuredClone(s), after = fire(s), city = after.cities['city-1'];
  assert.deepEqual(s, before); assert.equal(city.defense.bombardmentsRemaining, 0); assert.equal(city.defense.counterattacksRemaining, 1);
  assert.deepEqual(after.parties['party-1'], s.parties['party-1']);
  for (const id of s.parties['party-1'].unitIds) assert.deepEqual(after.units[id], s.units[id]);
  assert.deepEqual(after.kingdoms['kingdom-1'], s.kingdoms['kingdom-1']); assert.deepEqual(after.nextIds, s.nextIds);
  assert.equal(after.eventLog.filter(e => e.type === 'CityBombarded').length, 1);
  assert.equal(after.eventLog.filter(e => e.type === 'CityCounterattacked').length, 0);
  const rng = SeededRng.fromJSON(s.rng.combat); rng.next(); assert.deepEqual(after.rng.combat, rng.toJSON()); assert.deepEqual(after.rng.territory, s.rng.territory);
  for (const e of after.eventLog.filter(e => e.type === 'CombatDamage')) { assert.equal(e.attackerCityId, 'city-1'); assert.equal(e.counter, false); assert.equal(e.attackId, 'city-bombardment'); }
  trip(after);
});

test('range is exactly one or two hexes, excluding the center and distant targets', () => {
  for (const [location, allowed] of [['1,0,-1', true], ['2,-2,0', true], ['3,-3,0', false], ['0,0,0', false]]) {
    const s = ready(); relocate(s, 'party-2', location); assert.equal(preview(s).ok, allowed);
    if (allowed) trip(fire(s)); else rejected(s, command(s));
  }
});

test('destroyed or unbuilt walls, ruined body and spent fire reject without spending resources or RNG', () => {
  for (const mutate of [s => { s.cities['city-1'].buildings = []; s.cities['city-1'].defense.wallHp = 0; }, s => { s.cities['city-1'].defense.wallHp = 0; }, s => { s.cities['city-1'].defense.hp = 0; }, s => { s.cities['city-1'].defense.bombardmentsRemaining = 0; }]) {
    const s = ready(); mutate(s); assert.equal(preview(s).ok, false); rejected(s, command(s)); trip(s);
  }
});

test('invalid payloads, references, ownership, phases and duplicate Commands reject atomically', () => {
  const s = ready();
  for (const mutate of [c => { c.payload = null; }, c => { delete c.payload.cityId; }, c => { c.payload.cityId = 'city-2'; }, c => { c.payload.cityId = '__proto__'; }, c => { delete c.payload.defenderPartyId; }, c => { c.payload.defenderPartyId = 'constructor'; }, c => { c.payload.defenderPartyId = 'party-1'; }, c => { c.turn++; }, c => { c.playerId = 'kingdom-2'; }, c => { c.phase = 'TURN_START'; }]) { const c = command(s); mutate(c); rejected(s, c); }
  const c = command(s), after = exec(s, c); rejected(after, c); rejected(after, command(after));
  const ended = structuredClone(s); ended.phase = 'GAME_OVER'; rejected(ended, command(ended));
});

test('client damage, radius, attack profile and count overrides are never trusted', () => {
  const s = ready(), c = command(s); Object.assign(c.payload, { strength: 99999, damage: 99999, range: 99, attacks: 99, targeting: { attackId: 'area' } });
  const injected = exec(s, c), normal = fire(s); assert.deepEqual(injected.units, normal.units); assert.deepEqual(injected.rng, normal.rng); assert.deepEqual(injected.cities, normal.cities); assert.deepEqual(injected.eventLog, normal.eventLog);
});

test('active enemy occupation blocks city fire even if new walls complete under the occupant', () => {
  const s = ready(), occupier = addParty(s, 'party-3', 'kingdom-2', '0,0,0');
  assert.match(preview(s).reason, /占有/); rejected(s, command(s));
  onlyLeader(s, occupier.id, 0); occupier.status = 'defeated'; occupier.activationState = 'ended'; occupier.movementRemaining = occupier.attacksRemaining = occupier.reactionCharges = 0;
  assert.equal(preview(s).ok, true); trip(fire(s));
});

test('defeated targets are invalid while living civilian parties may be targeted', () => {
  const s = ready(); onlyLeader(s, 'party-2', 0); s.parties['party-2'].status = 'defeated'; rejected(s, command(s));
  const civilian = addParty(s, 'party-3', 'kingdom-2', '1,0,-1', 'settler');
  const hit = exec(s, human.bombardParty(s, 'city-1', civilian.id)); assert.ok(hit.units[civilian.leaderUnitId].currentHp < 100); trip(hit);
});

test('Guard shares bounded raw damage, consumes capacity and applies recipient armor once', () => {
  const s = ready(), p = s.parties['party-2'], guard = p.unitIds[1], target = p.unitIds[0];
  const before = preview(s), hit = fire(s), e = hit.eventLog.find(e => e.type === 'CityBombarded'); assert.deepEqual(e.guards, [guard]); assert.deepEqual(before.guards, [guard]);
  assert.ok(hit.units[target].currentHp < s.units[target].currentHp); assert.ok(hit.units[guard].currentHp < s.units[guard].currentHp);
  for (const e of hit.eventLog.filter(e => e.type === 'CombatDamage')) assert.equal(e.damage, Math.max(1, e.allocatedDamage - s.units[e.targetUnitId].armor));
  assert.ok(hit.units[guard].guardCapacityRemaining < s.units[guard].guardCapacityRemaining); assert.equal(hit.parties[p.id].reactionCharges, s.parties[p.id].reactionCharges); trip(hit);
});

test('Intercept spends only the defending party reaction; disabled and exhausted guards do not protect', () => {
  const s = ready(), p = s.parties['party-2'], guard = p.unitIds[1], target = p.unitIds[0]; p.guardOrders[guard].mode = 'intercept';
  const hit = fire(s); assert.equal(hit.units[target].currentHp, s.units[target].currentHp); assert.ok(hit.units[guard].currentHp < 100); assert.equal(hit.parties[p.id].reactionCharges, 0);
  assert.deepEqual(preview(s).intercepts, [guard]);
  for (const mutate of [t => { t.parties[p.id].reactionCharges = 0; }, t => { t.units[guard].statusEffects = ['stun']; }]) { const t = structuredClone(s); mutate(t); const after = fire(t); assert.ok(after.units[target].currentHp < 100); assert.deepEqual(after.eventLog.find(e => e.type === 'CityBombarded').intercepts, []); }
});

test('exposed Taunt changes the primary target and leader loss inherits without changing friendly actions', () => {
  let s = ready(), p = s.parties['party-2']; s.units[p.unitIds[1]].tauntStrength = 100; assert.equal(preview(s).primaryTargetId, p.unitIds[1]);
  s = ready(); p = s.parties['party-2']; p.guardOrders = {}; Object.assign(s.units[p.leaderUnitId], { hp: 1, currentHp: 1 });
  const after = fire(s); assert.notEqual(after.parties[p.id].leaderUnitId, p.leaderUnitId); assert.ok(after.eventLog.some(e => e.type === 'PartyLeaderChanged')); trip(after);
});

test('lethal city fire retains defeat history, frees occupancy and does not end city-control play', () => {
  const s = ready(); onlyLeader(s, 'party-2', 1); const expected = preview(s); assert.equal(expected.defeat, 'certain');
  const after = fire(s); assert.equal(after.parties['party-2'].status, 'defeated'); assert.equal(after.gameResult, null);
  assert.deepEqual(after.parties['party-2'].formation, s.parties['party-2'].formation); assert.equal(after.units[s.parties['party-2'].leaderUnitId].currentHp, 0);
  assert.ok(after.kingdoms['kingdom-2'].derived.militaryPower < s.kingdoms['kingdom-2'].derived.militaryPower); trip(after);
});

test('city fire cancels rest at range two without refunding reserved actions or healing', () => {
  let s = ready(); relocate(s, 'party-1', '-4,4,0'); const p = s.parties['party-2'];
  // Neutral range-two tile is safe for rest under existing adjacent-threat rules.
  const tile = s.world.tiles[p.location]; tile.ownerId = null; tile.territoryCityId = null;
  for (const id of p.unitIds) Object.assign(s.units[id], { hp: 50, currentHp: 50 });
  s = exec(s, human.endTurn(s)); s = exec(s, enemy.restParty(s, p.id));
  // Use a third player's handoff-free fixture of the same round, before recovery.
  s.activePlayerId = 'kingdom-1'; s.activePlayerIndex = 0;
  const after = fire(s); assert.equal(after.parties[p.id].restOrder, undefined); assert.equal(after.parties[p.id].activationState, 'ended');
  assert.ok(after.eventLog.some(e => e.type === 'PartyRestCancelled')); assert.ok(after.units[p.leaderUnitId].currentHp < 50); trip(after);
});

test('predictions are read-only and never touch the RNG property', () => {
  const s = ready(), before = serializeGameState(s); const rng = s.rng;
  Object.defineProperty(s, 'rng', { configurable: true, get() { throw new Error('preview read RNG'); } });
  for (let i = 0; i < 5; i++) assert.equal(preview(s).ok, true);
  Object.defineProperty(s, 'rng', { configurable: true, writable: true, value: rng }); assert.equal(serializeGameState(s), before);
});

test('preview integer bounds enclose actual HP losses across seeds, armor, guard modes and lethal thresholds', () => {
  for (const seed of [1, 7, 42, 117, 999]) for (const mode of ['off', 'share', 'intercept']) for (const hp of [1, 15, 100]) {
    const s = ready(seed), p = s.parties['party-2']; if (mode === 'off') p.guardOrders = {}; else p.guardOrders[p.unitIds[1]].mode = mode;
    for (const id of p.unitIds) Object.assign(s.units[id], { hp, currentHp: hp, armor: seed % 9 });
    const prediction = preview(s), after = fire(s);
    for (const id of p.unitIds) { const actual = s.units[id].currentHp - after.units[id].currentHp; assert.ok(actual >= prediction.damage[id].min && actual <= prediction.damage[id].max, `${seed}/${mode}/${hp}/${id}`); }
    assert.deepEqual(after, fire(trip(s))); trip(after);
  }
});

test('city charges recover once per full round, not on handoff or wall purchase, and counters remain independent', () => {
  let s = ready(); s = fire(s); s = exec(s, human.endTurn(s)); assert.equal(s.cities['city-1'].defense.bombardmentsRemaining, 0);
  s = exec(s, enemy.endTurn(s)); assert.equal(s.cities['city-1'].defense.bombardmentsRemaining, 1);
  s = fire(s); rejected(s, human.startTurn(s)); assert.equal(s.cities['city-1'].defense.counterattacksRemaining, 1);
  s = exec(s, human.endTurn(s)); s = exec(s, enemy.attackCity(s, 'party-2', 'city-1', 'ranged')); assert.equal(s.cities['city-1'].defense.bombardmentsRemaining, 0);
  trip(s);
});

test('melee auto-retaliation and manual fire can each occur once in the same full round', () => {
  let s = ready(); relocate(s, 'party-2', '1,0,-1'); s = fire(s); s = exec(s, human.endTurn(s)); s = exec(s, enemy.attackCity(s, 'party-2', 'city-1', 'melee'));
  assert.equal(s.cities['city-1'].defense.counterattacksRemaining, 0); assert.equal(s.cities['city-1'].defense.bombardmentsRemaining, 0);
  assert.equal(s.eventLog.filter(e => e.type === 'CityBombarded').length, 1); assert.equal(s.eventLog.filter(e => e.type === 'CityCounterattacked').length, 1); trip(s);
});

test('newly added and founded cities initialize charges; capture resets both charges without changing ownership rules', () => {
  let s = ready(); s.world.tiles['-4,4,0'].terrainId = 'plains'; addCity(s, { ownerId: 'kingdom-2', id: 'city-3', name: '退避都', centerHex: '-4,4,0' });
  assert.equal(s.cities['city-3'].defense.bombardmentsRemaining, 1);
  s.cities['city-2'].defense.hp = 0; relocate(s, 'party-1', '4,-4,0'); s = exec(s, human.captureCity(s, 'party-1', 'city-2'));
  assert.equal(s.cities['city-2'].defense.bombardmentsRemaining, 0); assert.equal(s.cities['city-2'].defense.counterattacksRemaining, 0);
  s.kingdoms['kingdom-1'].stockpiles.gold = 120; s = exec(s, human.purchaseItem(s, 'city-2', 'walls'));
  assert.equal(s.cities['city-2'].defense.bombardmentsRemaining, 0); s = round(s); assert.equal(s.cities['city-2'].defense.bombardmentsRemaining, 1); trip(s);
  const founder = addParty(s, 'party-3', 'kingdom-1', '0,4,-4', 'settler'); s = exec(s, human.foundCity(s, founder.id, founder.leaderUnitId));
  assert.equal(s.cities['city-4'].defense.bombardmentsRemaining, 1); trip(s);
});

test('multiple cities fire independently and wall repair restores availability without extra charges', () => {
  let s = ready(); s.world.tiles['0,4,-4'].terrainId = 'plains'; addCity(s, { ownerId: 'kingdom-1', id: 'city-3', name: '砲台都', centerHex: '0,4,-4' });
  s.kingdoms['kingdom-1'].stockpiles.gold = 120; s = exec(s, human.purchaseItem(s, 'city-3', 'walls')); relocate(s, 'party-2', '0,2,-2');
  s = fire(s); assert.equal(s.cities['city-3'].defense.bombardmentsRemaining, 1); s = exec(s, human.bombardParty(s, 'city-3', 'party-2')); assert.equal(s.cities['city-3'].defense.bombardmentsRemaining, 0);
  s.cities['city-1'].defense.wallHp = 0; s.cities['city-1'].defense.lastDamagedTurn = null; s = round(s); assert.ok(s.cities['city-1'].defense.wallHp > 0); assert.equal(preview(s).ok, true); trip(s);
});

test('v3 requires bounded integral fire charges; older versions reject partial new fields and are not upgraded', () => {
  const s = ready();
  for (const value of [-1, 0.5, 2, null, undefined, '1']) { const bad = structuredClone(s); bad.cities['city-1'].defense.bombardmentsRemaining = value; assert.throws(() => restoreGameState(serializeGameState(bad)), /bombardmentsRemaining/); }
  for (const version of [1, 2]) { const old = historical(structuredClone(s), version); trip(old); assert.equal(preview(old).ok, false); rejected(old, command(old));
    old.cities['city-1'].defense.bombardmentsRemaining = 1; assert.throws(() => restoreGameState(serializeGameState(old)), /bombardmentsRemaining/);
  }
  const future = structuredClone(s); future.cityDefenseVersion = 4; assert.throws(() => restoreGameState(serializeGameState(future)), /cityDefenseVersion/);
});

test('AI uses the shared city command without a garrison, remains deterministic and does not read RNG', () => {
  let s = ready(); s = exec(s, human.endTurn(s)); s.kingdoms['kingdom-2'].stockpiles.gold = 120; s = exec(s, enemy.purchaseItem(s, 'city-2', 'walls')); relocate(s, 'party-1', '3,-3,0'); relocate(s, 'party-2', '6,-6,0');
  const before = serializeGameState(s), rng = s.rng;
  Object.defineProperty(s, 'rng', { configurable: true, get() { throw new Error('AI read RNG'); } });
  const choice = new AIController('kingdom-2').nextCommand(s); assert.equal(choice.type, 'BombardParty');
  Object.defineProperty(s, 'rng', { configurable: true, writable: true, value: rng }); assert.equal(serializeGameState(s), before);
  const step = executeAiStep(s); assert.equal(step.ok, true); assert.deepEqual(step, executeAiStep(trip(s))); assert.equal(step.state.cities['city-2'].defense.bombardmentsRemaining, 0);
  const finished = runAiTurn(step.state); assert.equal(finished.ok, true); assert.ok(finished.commands.length <= 129); trip(finished.state);
});

test('AI keeps legal capture first and never adds fire to old v2 or v1 decisions', () => {
  let s = ready(); s = exec(s, human.endTurn(s)); s.cities['city-1'].defense.hp = 0; s.cities['city-1'].defense.wallHp = 0; relocate(s, 'party-2', '0,0,0');
  assert.equal(new AIController('kingdom-2').nextCommand(s).type, 'CaptureCity');
  for (const version of [1, 2]) { const old = historical(structuredClone(s), version); assert.equal(new AIController('kingdom-2').nextCommand(old).type, 'CaptureCity'); trip(old); }
});

test('two v3 AI kingdoms finish bounded reproducible games across saved turns', () => {
  for (const seed of [1, 7, 42, 117]) {
    let s = createAiConquestGameState(seed); s = exec(s, human.startTurn(s));
    for (const k of Object.values(s.kingdoms)) { k.controllerType = 'ai'; k.aiPolicy = 'reinforcements'; }
    let turns = 0;
    while (!s.gameResult && turns++ < 80) {
      const before = trip(s), a = runAiTurn(s), b = runAiTurn(before); assert.equal(a.ok, true, a.reason); assert.deepEqual(b, a); s = a.state;
    }
    assert.ok(s.gameResult); assert.ok(turns <= 80); trip(s);
  }
});
