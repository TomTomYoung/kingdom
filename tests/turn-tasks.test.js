import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialGameState, restoreGameState, serializeGameState, addKingdom } from '../src/core/game-state.js';
import { createDuelGameState, createAiSkirmishGameState, createAiConquestGameState, createTwoCityGameState, createSettlementGameState } from '../src/core/scenarios.js';
import { enableTurnFlow, listTurnTasks, pendingTurnTasks } from '../src/core/turn-tasks.js';
import { HumanController } from '../src/core/human-controller.js';
import { RuleSystem } from '../src/core/rule-system.js';
import { AIController, runAiTurn } from '../src/core/ai-controller.js';
import { RULESET } from '../src/core/ruleset.js';
import { createUnit } from '../src/models/unit.js';
import { processTurnEnd, processTurnStart } from '../src/core/turn-engine.js';

const human = s => new HumanController(s.activePlayerId);
const apply = (s, c) => { const r = RuleSystem.execute(s, c); assert.equal(r.ok, true, r.reason); return r.state; };
const trip = s => restoreGameState(serializeGameState(s));
const begin = (s = createInitialGameState(117, { startingParty: true })) => apply(enableTurnFlow(s), human(s).startTurn(s));
function skipRemaining(s) { for (const task of pendingTurnTasks(s)) s = apply(s, human(s).skipTurnAction(s, task.id)); return s; }
const finish = s => { s = skipRemaining(s); return apply(s, human(s).endTurn(s)); };
const reject = (s, c) => { const before = structuredClone(s), r = RuleSystem.execute(s, c); assert.equal(r.ok, false); assert.strictEqual(r.state, s); assert.deepEqual(s, before); assert.deepEqual(r.events, []); };

test('fresh turn starts with no free income, production, research or RNG advance', () => {
  const initial = createInitialGameState(117, { startingParty: true });
  const s = begin(structuredClone(initial));
  assert.deepEqual(s.kingdoms, initial.kingdoms); assert.deepEqual(s.cities, initial.cities); assert.deepEqual(s.rng, initial.rng);
  assert.equal(s.lastSettledTurn, 0); assert.equal(s.lastProcessedTurn, 1);
  assert.deepEqual(pendingTurnTasks(s).map(t => t.id), ['party:party-1', 'production:city-1', 'research:kingdom-1']);
});

test('listing is pure and direct EndTurn cannot bypass outstanding orders', () => {
  const s = begin(), before = structuredClone(s);
  for (let i = 0; i < 4; i++) assert.equal(listTurnTasks(s).length, 3);
  assert.deepEqual(s, before); reject(s, human(s).endTurn(s));
});

test('individual skip/resume changes no budget, RNG, HP or order and persists through save/load', () => {
  let s = begin(); const before = structuredClone(s);
  s = apply(s, human(s).skipTurnAction(s, 'party:party-1'));
  assert.deepEqual(s.parties, before.parties); assert.deepEqual(s.kingdoms, before.kingdoms); assert.deepEqual(s.units, before.units); assert.deepEqual(s.rng, before.rng);
  assert.equal(pendingTurnTasks(s).length, 2); assert.deepEqual(trip(s), s);
  reject(s, human(s).skipTurnAction(s, 'party:party-1'));
  s = apply(s, human(s).resumeTurnAction(s, 'party:party-1')); assert.equal(pendingTurnTasks(s).length, 3);
  reject(s, human(s).resumeTurnAction(s, 'party:party-1'));
});

test('stale, foreign, malformed and repeated skip commands are rejected atomically', () => {
  const s = begin(createDuelGameState());
  for (const id of ['party:party-2', 'party:missing', 'production:city-2', '__proto__']) reject(s, human(s).skipTurnAction(s, id));
  const c = human(s).skipTurnAction(s, 'party:party-1'); const next = apply(s, c); reject(next, c);
  reject(s, { ...c, turn: 2 }); reject(s, { ...c, payload: { taskId: 7 } }); reject(s, { ...c, playerId: 'kingdom-2' });
});

test('movement keeps the party pending until its remaining legal actions are exhausted', () => {
  let s = begin(); for (let q = 1; q <= 3; q++) s.world.tiles[`${q},0,${-q}`].terrainId = 'plains';
  s = apply(s, human(s).skipTurnAction(s, 'party:party-1'));
  s = apply(s, human(s).moveParty(s, 'party-1', ['1,0,-1']));
  assert.ok(pendingTurnTasks(s).some(t => t.id === 'party:party-1'));
  const path = Array.from({ length: s.parties['party-1'].movementRemaining }, (_, i) => `${i + 2},0,${-i - 2}`);
  s = apply(s, human(s).moveParty(s, 'party-1', path));
  assert.ok(!listTurnTasks(s).some(t => t.id === 'party:party-1'));
});

test('an immobile exhausted or defeated party does not trap turn completion', () => {
  for (const modify of [s => { s.parties['party-1'].movementRemaining = 0; }, s => { s.parties['party-1'].activationState = 'ended'; }, s => {
    s.units['unit-1'].hp = s.units['unit-1'].currentHp = 0; s.units['unit-1'].status = 'shattered'; s.parties['party-1'].status = 'defeated';
  }]) { const s = begin(); modify(s); assert.ok(!listTurnTasks(s).some(t => t.kind === 'party')); }
  const s = begin(); for (const tile of Object.values(s.world.tiles)) if (tile.key !== '0,0,0') tile.terrainId = 'void';
  assert.ok(!listTurnTasks(s).some(t => t.kind === 'party'));
});

test('production and research selection resolve their own tasks and pause reopens them', () => {
  let s = begin(); s = apply(s, human(s).setProduction(s, 'city-1', 'warrior'));
  s = apply(s, human(s).selectResearch(s, 'writing'));
  assert.deepEqual(pendingTurnTasks(s).map(t => t.kind), ['party']);
  s = apply(s, human(s).setProduction(s, 'city-1', null)); s = apply(s, human(s).selectResearch(s, null));
  assert.equal(pendingTurnTasks(s).length, 3);
});

test('each city has an independent production decision; completed research needs no choice', () => {
  const s = begin(createTwoCityGameState()); assert.equal(pendingTurnTasks(s).filter(t => t.kind === 'production').length, 2);
  s.kingdoms['kingdom-1'].research.completedTechnologyIds = Object.keys(RULESET.technologies);
  assert.ok(!listTurnTasks(s).some(t => t.kind === 'research'));
});

test('waiting troops appear only when they can form a party and disappear after deployment', () => {
  let s = begin(); const u = createUnit('unit-2', 'kingdom-1', 'warrior', '1,0,-1');
  s.world.tiles[u.location].terrainId = 'plains'; s.units[u.id] = u; s.kingdoms[u.ownerId].unitIds.push(u.id); s.nextIds.unit = 3;
  assert.ok(listTurnTasks(s).some(t => t.id === 'unit:unit-2'));
  s = apply(s, human(s).createParty(s, [u.id], u.location));
  assert.ok(!listTurnTasks(s).some(t => t.kind === 'unit')); assert.ok(listTurnTasks(s).some(t => t.id === 'party:party-2'));
  assert.deepEqual(trip(s), s);
});

test('handoff does not collect, reset actions, or reuse the other player skips', () => {
  let s = skipRemaining(begin(createDuelGameState())); const before = structuredClone(s);
  s = apply(s, human(s).endTurn(s));
  assert.equal(s.activePlayerId, 'kingdom-2'); assert.equal(s.currentTurn, 1); assert.equal(s.lastSettledTurn, 0);
  assert.deepEqual(s.kingdoms, before.kingdoms); assert.deepEqual(s.parties, before.parties); assert.deepEqual(s.cities, before.cities);
  assert.equal(s.turnTasks.skipped.length, 0); assert.ok(pendingTurnTasks(s).every(t => !t.id.includes('kingdom-1') && t.entityId !== 'party-1'));
  assert.deepEqual(trip(s), s);
});

test('only the last player triggers one settlement; the next round restores decisions', () => {
  let s = begin(createDuelGameState()); const gold = s.kingdoms['kingdom-1'].stockpiles.gold;
  s = finish(s); s = skipRemaining(s); const r = RuleSystem.execute(s, human(s).endTurn(s)); assert.equal(r.ok, true);
  s = r.state; assert.equal(s.currentTurn, 2); assert.equal(s.lastSettledTurn, 1); assert.equal(s.activePlayerId, 'kingdom-1');
  assert.equal(r.events.filter(e => e.type === 'YieldCollected').length, 2);
  assert.equal(s.kingdoms['kingdom-1'].stockpiles.gold, gold + s.cities['city-1'].yieldSummary.gold);
  assert.equal(r.events.filter(e => e.type === 'TurnSettled').length, 1);
  assert.ok(r.events.filter(e => e.type === 'YieldCollected').every(e => e.turn === 1));
  const copy = structuredClone(s), events = []; processTurnEnd(s, events, 1); processTurnStart(s, events);
  assert.deepEqual(s, copy); assert.deepEqual(events, []); assert.equal(s.turnTasks.skipped.length, 0); assert.deepEqual(trip(s), s);
});

test('three participants finish in order before production/research/resource settlement', () => {
  let s = createDuelGameState(); s.world.tiles['-4,4,0'].terrainId = 'plains';
  addKingdom(s, { id: 'kingdom-3', name: '第三国', cityId: 'city-3', centerHex: '-4,4,0' }); s = begin(s);
  s = apply(s, human(s).setProduction(s, 'city-1', 'warrior')); s = apply(s, human(s).selectResearch(s, 'writing'));
  const progress = structuredClone(s.kingdoms['kingdom-1'].progress); s = finish(s); s = finish(s);
  assert.deepEqual(s.kingdoms['kingdom-1'].progress, progress); assert.equal(s.currentTurn, 1);
  s = finish(s); assert.equal(s.currentTurn, 2); assert.ok(s.cities['city-1'].production.progressByItem.warrior > 0); assert.ok(s.kingdoms['kingdom-1'].research.progressByTechnology.writing > 0);
});

test('AI follows the same gate, skips remaining decisions and reaches the human without looping', () => {
  let s = finish(begin(createAiSkirmishGameState())); reject(s, human(s).endTurn(s));
  const r = runAiTurn(s); assert.equal(r.ok, true, r.reason); assert.equal(r.state.activePlayerId, 'kingdom-1');
  assert.ok(r.commands.some(c => c.type === 'SkipTurnAction')); assert.equal(r.commands.at(-1).type, 'EndTurn');
  assert.equal(r.events.filter(e => e.type === 'TurnSettled').length, 1); assert.deepEqual(trip(r.state), r.state);
  const forced = new AIController(s.activePlayerId).nextCommand(s, { forceEnd: true }); assert.equal(forced.type, 'SkipTurnAction');
  const bounded = runAiTurn(s, { commandLimit: 1 }); assert.equal(bounded.ok, true); assert.equal(bounded.commands.at(-1).type, 'EndTurn');
});

test('mid-AI save resumes deterministically with the same individual skips and settlement', () => {
  let s = finish(begin(createAiSkirmishGameState())); s = apply(s, new AIController(s.activePlayerId).nextCommand(s));
  assert.deepEqual(runAiTurn(trip(s)), runAiTurn(s));
});

test('newly founded city becomes an immediate production decision', () => {
  let s = begin(createSettlementGameState()); const party = s.parties['party-1']; party.location = '4,0,-4'; party.unitIds.forEach(id => { s.units[id].location = party.location; });
  assert.ok(listTurnTasks(s).find(t => t.id === 'party:party-1').actions.includes('都市建設'));
  s = apply(s, human(s).foundCity(s, party.id, 'unit-2'));
  assert.ok(pendingTurnTasks(s).some(t => t.id === 'production:city-2')); assert.deepEqual(trip(s), s);
});

test('city bombardment is a separate legal decision and vanishes after firing', () => {
  let s = begin(createAiConquestGameState()); const city = s.cities['city-1']; city.buildings.push('walls'); city.defense.wallHp = RULESET.cityDefense.wallHp;
  const enemy = s.parties['party-2']; enemy.location = '2,0,-2'; enemy.unitIds.forEach(id => { s.units[id].location = enemy.location; });
  s.world.tiles[enemy.location].terrainId = 'plains';
  assert.ok(pendingTurnTasks(s).some(t => t.id === 'bombardment:city-1'));
  s = apply(s, human(s).bombardParty(s, city.id, enemy.id)); assert.ok(!listTurnTasks(s).some(t => t.kind === 'bombardment'));
});

test('old saves migrate at the playable boundary without paying or resetting anything', () => {
  const legacy = createInitialGameState(117, { startingParty: true }); const old = apply(legacy, human(legacy).startTurn(legacy));
  const s = enableTurnFlow(trip(old)); assert.deepEqual(s.kingdoms, old.kingdoms); assert.deepEqual(s.parties, old.parties); assert.deepEqual(s.eventLog, old.eventLog); assert.deepEqual(s.rng, old.rng);
  const copy = structuredClone(s); enableTurnFlow(s); assert.deepEqual(s, copy); assert.deepEqual(trip(s), s);
  assert.equal(finish(s).currentTurn, 2);
});

test('corrupted task versions, owners, skips and settlement markers are rejected before use', () => {
  const s = begin();
  for (const edit of [x => { x.turnFlowVersion = 9; }, x => { delete x.turnFlowVersion; }, x => { delete x.turnTasks; }, x => { x.turnTasks.skipped = ['party:missing']; },
    x => { x.turnTasks.skipped = ['party:party-1', 'party:party-1']; }, x => { x.turnTasks.turn++; }, x => { x.turnTasks.playerId = 'kingdom-2'; }, x => { x.lastSettledTurn++; }]) {
    const copy = structuredClone(s); edit(copy); assert.throws(() => trip(copy), /turnFlow/);
  }
});
