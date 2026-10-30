import test from 'node:test';
import assert from 'node:assert/strict';
import { createAiConquestGameState, createAiReinforcementGameState } from '../src/core/scenarios.js';
import { addCity, restoreGameState, serializeGameState } from '../src/core/game-state.js';
import { HumanController } from '../src/core/human-controller.js';
import { RuleSystem } from '../src/core/rule-system.js';
import { AIController, runAiTurn, executeAiStep } from '../src/core/ai-controller.js';
import { previewCityAttack } from '../src/systems/city-siege.js';
import { getReachablePartyPaths } from '../src/systems/movement-system.js';
import { createUnit } from '../src/models/unit.js';
import { createParty } from '../src/models/party.js';

const human = new HumanController('kingdom-1'), enemy = new HumanController('kingdom-2'), capital = '4,-4,0';
const execute = (s, c) => { const r = RuleSystem.execute(s, c); assert.equal(r.ok, true, r.reason); return r.state; };
const trip = s => { const restored = restoreGameState(serializeGameState(s)); assert.deepEqual(restored, s); return restored; };
function unchanged(s, c) { const before = structuredClone(s), r = RuleSystem.execute(s, c); assert.equal(r.ok, false); assert.equal(r.state, s); assert.deepEqual(r.events, []); assert.deepEqual(s, before); }
function relocate(s, id, location) { const p = s.parties[id]; p.location = location; p.unitIds.forEach(id => { s.units[id].location = location; }); s.world.tiles[location].terrainId = 'plains'; }
function ready(seed = 117) { let s = createAiConquestGameState(seed); s.cityDefenseVersion = 1; Object.values(s.cities).forEach(city => { delete city.defense.counterattacksRemaining; }); s = execute(s, human.startTurn(s)); relocate(s, 'party-1', '3,-3,0'); relocate(s, 'party-2', '-6,6,0'); return s; }
const attack = (s, kind = 'ranged') => human.attackCity(s, 'party-1', 'city-2', kind);
const round = s => execute(execute(s, human.endTurn(s)), enemy.endTurn(s));
function unit(s, owner, type, location, partyId = null) { const id = `unit-${s.nextIds.unit++}`; s.units[id] = createUnit(id, owner, type, location); s.units[id].partyId = partyId; s.kingdoms[owner].unitIds.push(id); return id; }

// Old conquest behavior is covered separately in city-capture.test.js.
test('version-1 conquest preserves defense on every city and preserves other scenarios', () => {
  const s = ready(); assert.equal(s.cityDefenseVersion, 1);
  for (const c of Object.values(s.cities)) assert.deepEqual(c.defense, { hp: 100, wallHp: 0, lastDamagedTurn: null });
  trip(s); const old = createAiReinforcementGameState(); assert.equal(old.cityDefenseVersion, undefined); assert.equal(old.cities['city-1'].defense, undefined);
  unchanged(old, human.purchaseItem(old, 'city-1', 'walls')); unchanged(old, human.setProduction(old, 'city-1', 'warrior', ['walls'])); unchanged(old, attack(old));
});

test('walls purchase charges gold once, preserves body HP and removes pending duplicate walls', () => {
  let s = ready(); s.kingdoms['kingdom-1'].stockpiles.gold = 200; s.cities['city-1'].defense.hp = 45;
  s = execute(s, human.setProduction(s, 'city-1', 'walls', ['archer'])); s.cities['city-1'].production.progressByItem.walls = 20;
  const before = structuredClone(s); s = execute(s, human.purchaseItem(s, 'city-1', 'walls'));
  assert.equal(s.kingdoms['kingdom-1'].stockpiles.gold, 80); assert.deepEqual(s.cities['city-1'].defense, { hp: 45, wallHp: 60, lastDamagedTurn: null });
  assert.equal(s.cities['city-1'].production.currentItemId, 'archer'); assert.equal(s.cities['city-1'].production.progressByItem.walls, 0); assert.deepEqual(s.rng, before.rng);
  unchanged(s, human.purchaseItem(s, 'city-1', 'walls')); unchanged(s, human.setProduction(s, 'city-1', 'walls')); trip(s);
});

test('wall production completes through the normal turn engine with overflow to the next item', () => {
  let s = ready(); s = execute(s, human.setProduction(s, 'city-1', 'walls', ['warrior'])); s.cities['city-1'].production.progressByItem.walls = 29;
  s = round(s); assert.ok(s.cities['city-1'].buildings.includes('walls')); assert.equal(s.cities['city-1'].defense.wallHp, 60); assert.ok(s.cities['city-1'].production.progressByItem.warrior > 0); trip(s);
});

test('defended city blocks movement, reachability, split, merge and forming waiting troops', () => {
  const s = ready(); assert.equal(getReachablePartyPaths(s, s.parties['party-1']).has(capital), false);
  unchanged(s, human.moveParty(s, 'party-1', [capital])); unchanged(s, human.splitParty(s, 'party-1', [s.parties['party-1'].unitIds[0]], capital));
  const id = unit(s, 'kingdom-1', 'warrior', capital); unchanged(s, human.createParty(s, [id], capital));
  // Existing occupants can occur when walls complete after a breach.
  const p = `party-${s.nextIds.party++}`; s.parties[p] = createParty(p, 'kingdom-1', [id], capital); s.units[id].partyId = p;
  const source = s.parties['party-1'], removed = source.unitIds.pop(); // Capacity must not hide the entry check.
  delete source.formation[Object.keys(source.formation).find(slot => source.formation[slot] === removed)]; s.units[removed].partyId = null;
  const result = RuleSystem.execute(s, human.mergeParties(s, 'party-1', p)); assert.equal(result.ok, false); assert.match(result.reason, /城壁と耐久/);
});

test('own fortified cities remain enterable and enemy wall-only cities remain blocked', () => {
  let s = ready(); relocate(s, 'party-1', '1,-1,0'); s.world.tiles['0,0,0'].terrainId = 'plains';
  s = execute(s, human.moveParty(s, 'party-1', ['0,0,0'])); assert.equal(s.parties['party-1'].location, '0,0,0');
  s = ready(); s.cities['city-2'].buildings.push('walls'); s.cities['city-2'].defense = { hp: 0, wallHp: 1, lastDamagedTurn: null };
  unchanged(s, human.moveParty(s, 'party-1', [capital])); relocate(s, 'party-1', capital); unchanged(s, human.captureCity(s, 'party-1', 'city-2')); trip(s);
});

test('invalid siege commands preserve all state, resources, logs, IDs and RNG', () => {
  const s = ready();
  for (const mutate of [v => { v.parties['party-1'].activationState = 'ended'; }, v => { v.parties['party-1'].attacksRemaining = 0; }, v => { v.parties['party-1'].status = 'defeated'; }, v => { v.activePlayerId = 'kingdom-2'; }, v => { v.phase = 'GAME_OVER'; }, v => { v.cities['city-2'].defense.hp = 0; }, v => { v.parties['party-1'].unitIds.forEach(id => { v.units[id].typeId = 'settler'; }); }, v => relocate(v, 'party-1', '-6,0,6')]) {
    const bad = structuredClone(s); mutate(bad); unchanged(bad, attack(bad));
  }
  for (const id of [null, '', 'constructor', '__proto__', 'missing']) { unchanged(s, human.attackCity(s, id, 'city-2')); unchanged(s, human.attackCity(s, 'party-1', id)); }
  unchanged(s, human.attackCity(s, 'party-1', 'city-1')); unchanged(s, attack(s, 'magic')); unchanged(s, { ...attack(s), payload: null });
  unchanged(s, { ...attack(s), phase: 'TURN_START' });
});

test('siege consumes the whole activation without harming units or changing ownership', () => {
  const s = ready(), before = structuredClone(s), after = execute(s, attack(s)), p = after.parties['party-1'];
  assert.deepEqual(s, before); assert.deepEqual(after.units, s.units); assert.deepEqual(after.nextIds, s.nextIds); assert.deepEqual(after.rng.territory, s.rng.territory); assert.notDeepEqual(after.rng.combat, s.rng.combat);
  assert.equal(after.cities['city-2'].ownerId, 'kingdom-2'); assert.deepEqual([p.movementRemaining, p.attacksRemaining, p.reactionCharges, p.activationState], [0, 0, 0, 'ended']); assert.equal(p.hasAttacked, true);
  unchanged(after, attack(after)); unchanged(after, human.captureCity(after, 'party-1', 'city-2')); trip(after);
});

test('wall absorbs first and overflow damages city body exactly once', () => {
  const s = ready(), c = s.cities['city-2']; c.buildings.push('walls'); c.defense.wallHp = 10;
  const after = execute(s, attack(s)), e = after.eventLog.find(e => e.type === 'CityDamaged');
  assert.equal(e.wallDamage, 10); assert.equal(e.cityDamage, Math.floor(e.rawDamage * e.multiplier) - 10); assert.equal(after.cities['city-2'].defense.hp, 100 - e.cityDamage); assert.equal(after.cities['city-2'].defense.wallHp, 0); trip(after);
});

test('ranged siege participation and wall bonus depend only on units whose own range reaches', () => {
  const s = ready(); s.cities['city-2'].buildings.push('walls'); s.cities['city-2'].defense.wallHp = 60;
  const near = previewCityAttack(s, 'kingdom-1', 'party-1', 'city-2', 'ranged'); assert.equal(near.participantIds.length, 3); assert.equal(near.multiplier, 1 + 0.5 / 3);
  relocate(s, 'party-1', '1,-1,0'); const far = previewCityAttack(s, 'kingdom-1', 'party-1', 'city-2', 'ranged');
  assert.deepEqual(far.participantIds.map(id => s.units[id].typeId), ['ballista']); assert.equal(far.multiplier, 1.5); assert.ok(far.wallDamage.min > near.wallDamage.min);
  unchanged(s, attack(s, 'melee')); relocate(s, 'party-1', '0,0,0'); unchanged(s, attack(s));
});

test('preview never reads RNG and bounds seeded actual damage including breach at low HP', () => {
  for (const seed of [1, 7, 117, 999]) for (const hp of [1, 45, 100]) for (const wallHp of [0, 10, 60]) {
    const s = ready(seed); s.cities['city-2'].buildings = ['walls']; Object.assign(s.cities['city-2'].defense, { hp, wallHp });
    const noRng = { ...s, rng: new Proxy({}, { get() { throw new Error('preview accessed RNG'); } }) };
    const before = structuredClone(s), preview = previewCityAttack(noRng, 'kingdom-1', 'party-1', 'city-2', 'ranged'); assert.equal(preview.ok, true); assert.deepEqual(s, before);
    const after = execute(s, attack(s)), e = after.eventLog.find(e => e.type === 'CityDamaged');
    for (const key of ['wallDamage', 'cityDamage']) assert.ok(e[key] >= preview[key].min && e[key] <= preview[key].max);
    assert.deepEqual(execute(trip(s), attack(s)), after); trip(after);
  }
});

test('client supplied damage and multiplier cannot change trusted siege resolution', () => {
  const s = ready(), command = attack(s), injected = structuredClone(command); Object.assign(injected.payload, { multiplier: 1000, damage: 1000, targeting: { multiplier: 1000 } });
  const normal = execute(s, command), result = execute(s, injected); assert.deepEqual(result.cities, normal.cities); assert.deepEqual(result.rng, normal.rng); assert.deepEqual(result.eventLog, normal.eventLog);
});

test('breach does not capture; later legal movement and capture win and reset defense', () => {
  let s = ready(); s.cities['city-2'].defense.hp = 1; s.cities['city-2'].buildings.push('walls');
  s = execute(s, attack(s)); assert.equal(s.cities['city-2'].defense.hp, 0); assert.equal(s.cities['city-2'].ownerId, 'kingdom-2'); assert.equal(s.gameResult, null); assert.equal(s.eventLog.at(-1).type, 'CityBreached');
  unchanged(s, human.moveParty(s, 'party-1', [capital])); s = round(s); s = execute(s, human.moveParty(s, 'party-1', [capital])); s = execute(s, human.captureCity(s, 'party-1', 'city-2'));
  assert.equal(s.gameResult.winnerId, 'kingdom-1'); assert.deepEqual(s.cities['city-2'].defense, { hp: 25, wallHp: 0, lastDamagedTurn: 2 }); assert.ok(s.cities['city-2'].buildings.includes('walls')); trip(s);
});

test('active garrison still blocks a breached city until defeated', () => {
  const s = ready(); s.cities['city-2'].defense.hp = 0; relocate(s, 'party-2', capital);
  unchanged(s, human.moveParty(s, 'party-1', [capital])); relocate(s, 'party-1', capital); unchanged(s, human.captureCity(s, 'party-1', 'city-2'));
});

test('repair waits a full undamaged round, is capped, and does not consume RNG', () => {
  let s = ready(); relocate(s, 'party-1', '-5,5,0'); s.cities['city-2'].buildings.push('walls'); Object.assign(s.cities['city-2'].defense, { hp: 93, wallHp: 58, lastDamagedTurn: 1 });
  s = round(s); assert.equal(s.cities['city-2'].defense.hp, 93); const rng = structuredClone(s.rng.combat);
  s = round(s); assert.deepEqual(s.cities['city-2'].defense, { hp: 100, wallHp: 60, lastDamagedTurn: 1 }); assert.deepEqual(s.rng.combat, rng);
  assert.equal(s.eventLog.filter(e => e.type === 'CityDefenseRecovered').length, 1); s = round(s); assert.equal(s.eventLog.filter(e => e.type === 'CityDefenseRecovered').length, 1); trip(s);
});

test('adjacent or central enemy military blocks repair; civilian or defeated forces do not', () => {
  for (const position of ['3,-3,0', capital]) {
    let s = ready(); relocate(s, 'party-1', position); s.cities['city-2'].defense.hp = 0;
    s = round(s); assert.equal(s.cities['city-2'].defense.hp, 0);
    for (const id of s.parties['party-1'].unitIds) s.units[id].typeId = 'settler'; s = round(s); assert.equal(s.cities['city-2'].defense.hp, 10);
  }
  let s = ready(); s.cities['city-2'].defense.hp = 30; s.parties['party-1'].status = 'defeated'; s.parties['party-1'].unitIds.forEach(id => Object.assign(s.units[id], { hp: 0, currentHp: 0, status: 'shattered' })); s = round(s); assert.equal(s.cities['city-2'].defense.hp, 40); trip(s);
});

test('new cities created by addCity and FoundCity receive defenses without altering old ones', () => {
  let s = ready(); s.world.tiles['-4,0,4'].terrainId = 'plains'; addCity(s, { ownerId: 'kingdom-1', id: 'city-3', name: '新都', centerHex: '-4,0,4' });
  assert.equal(s.cities['city-3'].defense.hp, 100); relocate(s, 'party-1', '0,4,-4');
  const settler = unit(s, 'kingdom-1', 'settler', '0,4,-4'), p = s.parties['party-1'];
  const old = p.unitIds.pop(); delete p.formation[Object.keys(p.formation).find(slot => p.formation[slot] === old)]; s.units[old].partyId = null;
  p.unitIds.push(settler); p.formation['rear-right'] = settler; s.units[settler].partyId = p.id;
  s = execute(s, human.foundCity(s, p.id, settler)); assert.deepEqual(s.cities['city-4'].defense, { hp: 100, wallHp: 0, lastDamagedTurn: null }); trip(s);
});

test('walls completed under an enemy occupant do not trap it without a legal siege option', () => {
  let s = ready(); s.cities['city-2'].defense.hp = 0; s = execute(s, human.moveParty(s, 'party-1', [capital])); s = execute(s, human.endTurn(s));
  s.kingdoms['kingdom-2'].stockpiles.gold = 200; s = execute(s, enemy.purchaseItem(s, 'city-2', 'walls')); s = execute(s, enemy.endTurn(s));
  unchanged(s, human.captureCity(s, 'party-1', 'city-2')); assert.equal(previewCityAttack(s, 'kingdom-1', 'party-1', 'city-2', 'melee').ok, true); s = execute(s, attack(s, 'melee')); assert.ok(s.cities['city-2'].defense.wallHp < 60); trip(s);
});

test('save validation rejects partial versions, missing defense, bad ranges and ungated walls', () => {
  const s = ready();
  for (const mutate of [v => { delete v.cityDefenseVersion; }, v => { v.cityDefenseVersion = 2; }, v => { v.cityDefenseVersion = null; }, v => { delete v.cities['city-2'].defense; }, v => { v.cities['city-2'].defense = null; }, v => { v.cities['city-2'].defense.hp = 101; }, v => { v.cities['city-2'].defense.hp = -1; }, v => { v.cities['city-2'].defense.hp = 1.5; }, v => { v.cities['city-2'].defense.wallHp = 1; }, v => { delete v.cities['city-2'].defense.lastDamagedTurn; }, v => { v.cities['city-2'].defense.lastDamagedTurn = 2; }, v => { v.scenarioObjective.type = 'eliminate-parties'; }]) {
    const bad = structuredClone(s); mutate(bad); assert.throws(() => restoreGameState(serializeGameState(bad)), /セーブデータが不正/);
  }
  const legacy = structuredClone(s); delete legacy.cityDefenseVersion; Object.values(legacy.cities).forEach(c => { delete c.defense; }); trip(legacy);
  for (const mutate of [v => v.cities['city-1'].buildings.push('walls'), v => { v.cities['city-1'].production.currentItemId = 'walls'; }, v => v.cities['city-1'].production.queue.push('walls'), v => { v.cities['city-1'].production.progressByItem.walls = 0; }]) {
    const bad = structuredClone(legacy); mutate(bad); assert.throws(() => restoreGameState(serializeGameState(bad)), /セーブデータが不正/);
  }
});

test('AI uses siege, breaches and then moves/captures with identical save-resumed commands', () => {
  let s = ready(); relocate(s, 'party-1', '-6,6,0'); relocate(s, 'party-2', '2,-2,0'); s.world.tiles['0,0,0'].terrainId = 'plains'; s.cities['city-1'].defense.hp = 1;
  s = execute(s, human.endTurn(s)); const before = structuredClone(s); assert.equal(new AIController('kingdom-2').nextCommand(s).type, 'AttackCity'); assert.deepEqual(s, before);
  const hit = executeAiStep(s); assert.equal(hit.ok, true); assert.deepEqual(executeAiStep(trip(s)), hit); assert.equal(hit.state.cities['city-1'].defense.hp, 0);
  s = runAiTurn(hit.state).state; s = execute(s, human.endTurn(s)); const finish = runAiTurn(s); assert.equal(finish.ok, true); assert.ok(finish.commands.some(c => c.type === 'CaptureCity')); assert.equal(finish.state.gameResult.winnerId, 'kingdom-2'); trip(finish.state);
});

test('AI routes to firing range instead of attempting defended city entry and terminates bounded turns', () => {
  let s = ready(); relocate(s, 'party-1', '-6,6,0'); relocate(s, 'party-2', '6,-6,0'); s = execute(s, human.endTurn(s));
  const result = runAiTurn(s); assert.equal(result.ok, true, result.reason); assert.ok(result.commands.some(c => c.type === 'MoveParty')); const next = runAiTurn(execute(result.state, human.endTurn(result.state))); assert.equal(next.ok, true, next.reason); assert.ok(next.commands.some(c => c.type === 'AttackCity')); assert.ok(result.commands.length <= 129); assert.notEqual(result.state.parties['party-2'].location, '0,0,0'); trip(result.state);
});

test('two defended-city AIs play reproducibly through victory or the 40-round draw', () => {
  let s = ready(); s.kingdoms['kingdom-1'].controllerType = 'ai'; s.kingdoms['kingdom-1'].aiPolicy = 'reinforcements';
  for (let i = 0; i < 80 && !s.gameResult; i++) { const result = runAiTurn(s); assert.equal(result.ok, true, result.reason); assert.ok(result.commands.length <= 129); assert.deepEqual(runAiTurn(trip(s)), result); s = result.state; }
  assert.equal(s.phase, 'GAME_OVER'); assert.ok(s.commandLog.some(c => c.type === 'AttackCity')); trip(s);
});
