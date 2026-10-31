import test from 'node:test';
import assert from 'node:assert/strict';
import { createAiSkirmishGameState, createDuelGameState } from '../src/core/scenarios.js';
import { restoreGameState, serializeGameState } from '../src/core/game-state.js';
import { HumanController } from '../src/core/human-controller.js';
import { AIController, executeAiStep, runAiTurn } from '../src/core/ai-controller.js';
import { RuleSystem } from '../src/core/rule-system.js';
import { COMMAND_TYPES, command } from '../src/core/commands.js';
import { createUnit } from '../src/models/unit.js';
import { createParty } from '../src/models/party.js';
import { scenarioOutcome } from '../src/systems/scenario-system.js';
import { Hex } from '../src/world/hex.js';

const human = new HumanController('kingdom-1'), ai = new AIController('kingdom-2');
function apply(state, input) { const result = RuleSystem.execute(state, input); assert.equal(result.ok, true, result.reason); return result.state; }
function ready() { const state = createAiSkirmishGameState(); return apply(state, human.startTurn(state)); }
function aiTurn() { const state = ready(); return apply(state, human.endTurn(state)); }
function relocate(state, id, location) { const party = state.parties[id]; party.location = location; party.unitIds.forEach(id => { state.units[id].location = location; }); state.world.tiles[location].terrainId = 'plains'; }
function weaken(state, id) {
  const party = state.parties[id]; party.guardOrders = {};
  party.unitIds.forEach((id, i) => Object.assign(state.units[id], { hp: i ? 0 : 1, currentHp: i ? 0 : 1, status: i ? 'shattered' : 'active' }));
}
function eliminate(state, id) { weaken(state, id); const party = state.parties[id]; Object.assign(state.units[party.leaderUnitId], { hp: 0, currentHp: 0, status: 'shattered' }); party.status = 'defeated'; }
function roundTrip(state) { assert.deepEqual(restoreGameState(serializeGameState(state)), state); }
function won() { const state = ready(); relocate(state, 'party-2', '2,-2,0'); weaken(state, 'party-2'); return apply(state, human.attackParty(state, 'party-1', 'party-2', 'ranged')); }

test('AI scenario starts with a human, distant enemy AI, optional objective and round-trip state', () => {
  const state = ready(); assert.equal(state.scenarioId, 'ai-skirmish');
  assert.equal(state.kingdoms['kingdom-1'].controllerType, 'human'); assert.equal(state.kingdoms['kingdom-2'].controllerType, 'ai');
  assert.equal(state.gameResult, null); assert.equal(state.scenarioObjective.turnLimit, 40);
  assert.equal(ai.nextCommand(state), null); assert.equal(executeAiStep(state).ok, false); roundTrip(state);
});

test('AI choices are deterministic and never inspect future RNG or mutate state', () => {
  const state = aiTurn(), before = structuredClone(state), first = ai.nextCommand(state);
  assert.equal(first.type, 'MoveParty'); assert.deepEqual(ai.nextCommand(state), first); assert.deepEqual(state, before);
  Object.defineProperty(state, 'rng', { get() { throw new Error('AI must not inspect RNG'); } });
  assert.deepEqual(ai.nextCommand(state), first);
  relocate(state, 'party-2', '2,-2,0'); assert.equal(ai.nextCommand(state).type, 'AttackParty');
});

test('AI advances into firing range, attacks once, and ends its turn through ordinary Commands', () => {
  const state = aiTurn(), before = structuredClone(state), result = runAiTurn(state);
  assert.equal(result.ok, true, result.reason); assert.deepEqual(state, before);
  assert.deepEqual(result.commands.map(c => c.type), ['MoveParty', 'AttackParty', 'SelectResearch', 'EndTurn']);
  assert.equal(result.commands[1].payload.attackType, 'ranged'); assert.equal(result.state.activePlayerId, 'kingdom-1');
  assert.equal(result.state.currentTurn, 2); assert.ok(result.events.some(event => event.type === 'CombatDamage'));
  assert.equal(new Set(result.commands.map(c => c.commandId)).size, result.commands.length); roundTrip(result.state);
});

test('save in the middle of an AI turn resumes with exactly the same commands, RNG and outcome', () => {
  const first = executeAiStep(aiTurn()); assert.equal(first.ok, true);
  const restored = restoreGameState(serializeGameState(first.state));
  assert.deepEqual(runAiTurn(restored), runAiTurn(first.state));
});

test('AI handles melee-only parties and prioritizes an immediate legal attack', () => {
  const state = createDuelGameState(); state.kingdoms['kingdom-2'].controllerType = 'ai';
  const started = apply(state, human.startTurn(state)), turn = apply(started, human.endTurn(started));
  const next = ai.nextCommand(turn); assert.equal(next.type, 'AttackParty'); assert.equal(next.payload.attackType, 'melee');
  assert.equal(runAiTurn(turn).ok, true);
});

test('AI searches around impassable terrain and occupied cells using legal movement costs', () => {
  let state = aiTurn();
  for (const tile of Object.values(state.world.tiles)) tile.terrainId = 'void';
  const corridor = ['6,-6,0', '6,-5,-1', '5,-4,-1', '4,-3,-1', '3,-2,-1', '2,-1,-1', '1,-1,0'];
  for (const key of corridor) state.world.tiles[key].terrainId = 'plains';
  state.world.tiles['6,-5,-1'].terrainId = 'forest';
  let next = ai.nextCommand(state); assert.equal(next.type, 'MoveParty'); assert.deepEqual(next.payload.path, ['6,-5,-1']);
  state = apply(state, next); assert.equal(state.parties['party-2'].movementRemaining, 0);
  // A blocked army may still select research, then ends its turn; a defeated record does not block movement.
  const blocked = aiTurn(); for (let d = 0; d < 6; d++) blocked.world.tiles[Hex.fromKey('6,-6,0').neighbor(d).key].terrainId = 'void';
  blocked.world.tiles['5,-5,0'].terrainId = 'plains';
  const unit = createUnit('unit-11', 'kingdom-2', 'settler', '5,-5,0'); unit.partyId = 'party-3'; blocked.units[unit.id] = unit;
  blocked.parties['party-3'] = createParty('party-3', 'kingdom-2', [unit.id], unit.location);
  assert.equal(ai.nextCommand(blocked).type, 'SelectResearch');
  const selected = apply(blocked, ai.nextCommand(blocked)); assert.equal(ai.nextCommand(selected).type, 'EndTurn');
  blocked.parties['party-3'].status = 'defeated'; assert.equal(ai.nextCommand(blocked).type, 'MoveParty');
});

test('AI skips civilian-only and exhausted parties and enforces a finite command budget', () => {
  const state = aiTurn();
  for (const id of state.parties['party-2'].unitIds) state.units[id].typeId = 'settler';
  assert.equal(ai.nextCommand(state).type, 'SelectResearch');
  assert.equal(ai.nextCommand(apply(state, ai.nextCommand(state))).type, 'EndTurn');
  const exhausted = aiTurn(); exhausted.parties['party-2'].attacksRemaining = 0; assert.equal(ai.nextCommand(exhausted).type, 'SelectResearch');
  assert.equal(ai.nextCommand(apply(exhausted, ai.nextCommand(exhausted))).type, 'EndTurn');
  const bounded = runAiTurn(aiTurn(), { commandLimit: 1 });
  assert.equal(bounded.ok, true); assert.deepEqual(bounded.commands.map(c => c.type), ['MoveParty', 'EndTurn']);
  assert.equal(bounded.state.activePlayerId, 'kingdom-1');
  for (const commandLimit of [0, 129, NaN, 1.5]) assert.throws(() => runAiTurn(aiTurn(), { commandLimit }));
});

test('last enemy party defeat ends the scenario once, records winner and restores the finished state', () => {
  const state = won(); assert.equal(state.phase, 'GAME_OVER');
  assert.deepEqual(state.gameResult, { outcome: 'victory', winnerId: 'kingdom-1', reason: 'elimination', turn: 1 });
  assert.equal(state.eventLog.filter(e => e.type === 'ScenarioFinished').length, 1);
  assert.equal(state.parties['party-2'].status, 'defeated'); roundTrip(state);
});

test('AI can win and stops immediately without a trailing EndTurn or resource collection', () => {
  const state = aiTurn(); relocate(state, 'party-2', '2,-2,0'); weaken(state, 'party-1');
  const result = runAiTurn(state); assert.equal(result.ok, true);
  assert.equal(result.state.gameResult.winnerId, 'kingdom-2'); assert.equal(result.state.currentTurn, 1);
  assert.deepEqual(result.commands.map(c => c.type), ['AttackParty']);
  assert.deepEqual(result.state.kingdoms['kingdom-1'].stockpiles, state.kingdoms['kingdom-1'].stockpiles); roundTrip(result.state);
});

test('elimination considers all active parties, but cities and unformed units do not prevent defeat', () => {
  const state = ready(); eliminate(state, 'party-2');
  const unit = createUnit('unit-11', 'kingdom-2', 'warrior', '4,-4,0'); state.units[unit.id] = unit;
  assert.equal(scenarioOutcome(state).winnerId, 'kingdom-1');
  state.parties['party-3'] = createParty('party-3', 'kingdom-2', [unit.id], unit.location); unit.partyId = 'party-3';
  assert.equal(scenarioOutcome(state), null);
  eliminate(state, 'party-1'); assert.equal(scenarioOutcome(state).winnerId, 'kingdom-2');
  eliminate(state, 'party-3'); assert.equal(scenarioOutcome(state).outcome, 'draw');
});

test('turn limit applies after both players act and stops before next-round income or resets', () => {
  let state = ready(); state.scenarioObjective.turnLimit = 1;
  state = apply(state, human.endTurn(state)); assert.equal(state.gameResult, null);
  const before = structuredClone(state); state = apply(state, new HumanController('kingdom-2').endTurn(state));
  assert.deepEqual(state.gameResult, { outcome: 'draw', winnerId: null, reason: 'turn-limit', turn: 1 });
  assert.equal(state.currentTurn, 1); assert.equal(state.lastProcessedTurn, 1);
  assert.deepEqual(state.cities, before.cities); assert.deepEqual(state.kingdoms, before.kingdoms); assert.deepEqual(state.rng, before.rng);
  assert.equal(state.eventLog.filter(e => e.type === 'ScenarioFinished').length, 1); roundTrip(state);
});

test('all command types reject after game over without mutation, logs or RNG consumption', () => {
  const state = won(), before = serializeGameState(state);
  for (const type of Object.values(COMMAND_TYPES)) {
    const result = RuleSystem.execute(state, command(type, state.activePlayerId, state.currentTurn, {}, `finished-${type}`));
    assert.equal(result.ok, false); assert.match(result.reason, /終了/); assert.equal(result.state, state); assert.deepEqual(result.events, []);
    assert.equal(serializeGameState(state), before);
  }
  assert.equal(ai.nextCommand(state), null); assert.deepEqual(runAiTurn(state).commands, []);
});

test('legacy hotseat saves retain their sandbox rules and missing controllers migrate to human', () => {
  let state = createDuelGameState(); delete state.kingdoms['kingdom-2'].controllerType;
  state = restoreGameState(serializeGameState(state)); assert.equal(state.kingdoms['kingdom-2'].controllerType, 'human');
  assert.equal(Object.hasOwn(state, 'scenarioObjective'), false); assert.equal(Object.hasOwn(state, 'gameResult'), false);
  eliminate(state, 'party-2'); state = apply(state, human.endTurn(state)); assert.equal(state.phase, 'PLAYER_ACTION'); assert.equal(state.activePlayerId, 'kingdom-2');
});

test('save validation rejects malformed objectives, forged results, inconsistent phases and controllers', () => {
  const bad = [
    s => { delete s.scenarioObjective; }, s => { delete s.gameResult; }, s => { s.scenarioObjective = null; },
    s => { s.scenarioObjective.type = 'domination'; }, s => { s.scenarioObjective.participantIds = ['kingdom-1', 'kingdom-1']; },
    s => { s.scenarioObjective.participantIds[1] = 'unknown'; }, s => { s.scenarioObjective.turnLimit = 0; },
    s => { s.scenarioObjective.turnLimit = 1.5; }, s => { s.currentTurn = 41; }, s => { s.phase = 'GAME_OVER'; },
    s => { s.kingdoms['kingdom-2'].controllerType = 'remote'; }, s => { s.gameResult = { outcome: 'victory', winnerId: 'kingdom-1', reason: 'elimination', turn: 1 }; },
    s => { eliminate(s, 'party-2'); },
  ];
  for (const mutate of bad) { const state = ready(); mutate(state); assert.throws(() => restoreGameState(serializeGameState(state)), /セーブデータ/); }
  for (const mutate of [s => { s.gameResult.winnerId = 'kingdom-2'; }, s => { s.gameResult.turn = 2; }, s => { s.gameResult.outcome = 'draw'; }, s => { s.phase = 'PLAYER_ACTION'; }, s => { s.gameResult.reason = 'turn-limit'; }]) {
    const state = won(); mutate(state); assert.throws(() => restoreGameState(serializeGameState(state)), /scenario/);
  }
});

test('a deterministic full AI match reaches a result and round-trips every turn', () => {
  let state = ready(); state.kingdoms['kingdom-1'].controllerType = 'ai';
  for (let i = 0; i < 80 && !state.gameResult; i++) {
    const result = runAiTurn(state); assert.equal(result.ok, true, result.reason); assert.ok(result.commands.length <= 129);
    state = result.state; roundTrip(state);
  }
  assert.equal(state.phase, 'GAME_OVER'); assert.ok(state.gameResult.turn <= 40);
});

test('a lethal counterattack awards victory to the defending kingdom', () => {
  const state = ready(); relocate(state, 'party-2', '2,-2,0'); weaken(state, 'party-1');
  const result = apply(state, human.attackParty(state, 'party-1', 'party-2', 'melee'));
  assert.equal(result.gameResult.winnerId, 'kingdom-2');
  assert.ok(result.eventLog.some(e => e.type === 'CombatDamage' && e.counter)); roundTrip(result);
});

test('elimination takes priority over the deadline and unfinished rounds cannot claim a draw', () => {
  const state = ready(); state.scenarioObjective.turnLimit = 1; eliminate(state, 'party-2');
  assert.equal(scenarioOutcome(state, { roundComplete: true }).reason, 'elimination');
  const forged = ready(); forged.scenarioObjective.turnLimit = 1; forged.phase = 'GAME_OVER';
  forged.gameResult = { outcome: 'draw', winnerId: null, reason: 'turn-limit', turn: 1 };
  assert.throws(() => restoreGameState(serializeGameState(forged)), /incomplete round/);
  const both = ready(); eliminate(both, 'party-1'); eliminate(both, 'party-2');
  const ended = apply(both, human.endTurn(both)); assert.equal(ended.gameResult.outcome, 'draw'); roundTrip(ended);
});
