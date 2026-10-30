import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialGameState, restoreGameState, serializeGameState } from '../src/core/game-state.js';
import { createTwoCityGameState, createDuelGameState, createAiConquestGameState } from '../src/core/scenarios.js';
import { HumanController } from '../src/core/human-controller.js';
import { RuleSystem } from '../src/core/rule-system.js';
import { applyProduction } from '../src/systems/production-system.js';
import { productionPlan, productionPlanError, productionForecast, queueForSelection } from '../src/ui/production-queue.js';
const player = 'kingdom-1', controller = new HumanController(player);
function fixture() {
  const state = createInitialGameState(117);
  state.cities['city-1'].production = { currentItemId: 'warrior', queue: ['archer', 'warrior', 'monument'], progressByItem: { warrior: 7, archer: 3, monument: 9 } };
  return state;
}
function set(state, items, cityId = 'city-1') {
  const result = RuleSystem.execute(state, controller.setProduction(state, cityId, items[0] ?? null, items.slice(1)));
  assert.equal(result.ok, true, result.reason); return result.state;
}
function reject(state, command) {
  const before = serializeGameState(state), result = RuleSystem.execute(state, command);
  assert.equal(result.ok, false); assert.equal(result.state, state); assert.deepEqual(result.events, []); assert.equal(serializeGameState(state), before);
}

test('production draft is a detached ordered copy including the active item', () => {
  const state = fixture(), city = state.cities['city-1'], before = serializeGameState(state), plan = productionPlan(city);
  assert.deepEqual(plan, ['warrior', 'archer', 'warrior', 'monument']); plan.reverse(); plan.pop();
  assert.equal(serializeGameState(state), before); assert.deepEqual(productionPlan(null), []);
});
test('forecast consumes per-type progress once across repeated Unit reservations', () => {
  const state = fixture(), city = state.cities['city-1']; city.yieldSummary.production = 5;
  const rows = productionForecast(city, ['warrior', 'warrior', 'archer']);
  assert.deepEqual(rows.map(row => row.progress), [7, 0, 3]); assert.deepEqual(rows.map(row => row.turns), [1, 4, 7]);
});
test('forecast and draft validation do not change state, resources, IDs, logs or RNG', () => {
  const state = fixture(), before = serializeGameState(state), city = state.cities['city-1'];
  for (let i = 0; i < 10; i++) { productionForecast(city); productionPlanError(state, city, productionPlan(city)); queueForSelection(city, 'warrior'); }
  assert.equal(serializeGameState(state), before);
});
test('zero production has no finite completion forecast and an empty plan has no rows', () => {
  const state = fixture(), city = state.cities['city-1']; city.yieldSummary.production = 0;
  assert.ok(productionForecast(city).every(row => row.turns === null)); assert.deepEqual(productionForecast(city, []), []);
});
test('plan validation permits empty plans and repeated Units but not duplicate or built buildings', () => {
  const state = fixture(), city = state.cities['city-1'];
  for (const plan of [[], ['warrior', 'warrior'], ['monument', 'archer']]) assert.equal(productionPlanError(state, city, plan), null);
  assert.ok(productionPlanError(state, city, ['monument', 'monument'])); city.buildings.push('monument');
  assert.ok(productionPlanError(state, city, ['monument'])); assert.ok(productionPlanError(state, null, []));
});
test('plan validation rejects unknown identifiers and malformed drafts', () => {
  const state = fixture();
  for (const plan of [null, {}, [null], ['constructor'], ['__proto__'], ['no-item']]) assert.ok(productionPlanError(state, state.cities['city-1'], plan));
});
test('wall reservations retain the existing city-defense availability rule', () => {
  const state = fixture(); assert.ok(productionPlanError(state, state.cities['city-1'], ['walls']));
  const defended = createAiConquestGameState(117); assert.equal(productionPlanError(defended, defended.cities['city-1'], ['walls']), null);
});
test('quick selection preserves reservations, promotes a queued building once and never aliases its source', () => {
  const city = fixture().cities['city-1'], before = structuredClone(city);
  assert.deepEqual(queueForSelection(city, 'warrior'), ['archer', 'warrior', 'monument']);
  const queue = queueForSelection(city, 'monument'); assert.deepEqual(queue, ['archer', 'warrior']); queue.pop(); assert.deepEqual(city, before);
  assert.deepEqual(queueForSelection(undefined, 'warrior'), []);
});
test('clearing production is one successful Command, retaining accumulated work without refunds or RNG use', () => {
  const state = fixture(), stopped = set(state, []), city = stopped.cities['city-1'];
  assert.equal(city.production.currentItemId, null); assert.deepEqual(city.production.queue, []);
  assert.deepEqual(city.production.progressByItem, state.cities['city-1'].production.progressByItem);
  for (const key of ['rng', 'nextIds', 'kingdoms', 'units', 'parties']) assert.deepEqual(stopped[key], state[key]);
  assert.equal(stopped.commandLog.length, 1); assert.equal(stopped.eventLog.at(-1).type, 'ProductionSet');
  assert.deepEqual(restoreGameState(serializeGameState(stopped)), stopped);
});
test('only explicit null with an empty queue may stop production; malformed alternatives reject atomically', () => {
  const state = fixture();
  for (const [itemId, queue] of [[undefined, []], [null, ['warrior']], [null, null], [false, []], ['', []], ['warrior', [null]]]) reject(state, controller.setProduction(state, 'city-1', itemId, queue));
  const missing = controller.setProduction(state, 'city-1', null); delete missing.payload.itemId; reject(state, missing);
});
test('stop then resume restores the item-specific progress without immediate production', () => {
  const state = fixture(), resumed = set(set(state, []), ['monument', 'warrior']);
  assert.equal(resumed.cities['city-1'].production.progressByItem.monument, 9);
  assert.deepEqual(resumed.cities['city-1'].production.progressByItem, state.cities['city-1'].production.progressByItem);
  assert.deepEqual(resumed.units, state.units); assert.deepEqual(resumed.rng, state.rng);
});
test('reordering retains all progress and ordinary overflow completes the planned orders', () => {
  const state = set(fixture(), ['archer', 'warrior', 'warrior']), city = state.cities['city-1'], events = [];
  applyProduction(state, city, 20, events);
  assert.deepEqual(events.filter(e => e.type === 'ItemCompleted').map(e => e.itemId), ['archer', 'warrior']);
  assert.equal(city.production.currentItemId, 'warrior'); assert.equal(city.production.progressByItem.warrior, 0); assert.equal(city.production.progressByItem.monument, 9);
});
test('stopped production stays stopped over a round and resumes deterministically after saving', () => {
  const stopped = set(fixture(), []), restored = restoreGameState(serializeGameState(stopped));
  const advance = state => RuleSystem.execute(state, controller.endTurn(state)).state;
  const next = advance(stopped); assert.deepEqual(next, advance(restored));
  assert.deepEqual(next.cities['city-1'].production, stopped.cities['city-1'].production); assert.deepEqual(next.units, stopped.units);
  const resumed = set(next, ['warrior', 'archer']); assert.deepEqual(advance(resumed), advance(restoreGameState(serializeGameState(resumed))));
});
test('queue edits affect only the selected city in two-city games', () => {
  const state = createTwoCityGameState(117), other = structuredClone(state.cities['city-1']);
  const edited = set(state, ['archer', 'monument', 'warrior'], 'city-2'); assert.deepEqual(edited.cities['city-1'], other);
  assert.deepEqual(productionPlan(edited.cities['city-2']), ['archer', 'monument', 'warrior']);
});
test('foreign cities, wrong turns and finished games reject stop commands without side effects', () => {
  const state = createDuelGameState(117); reject(state, controller.setProduction(state, 'city-2', null));
  const wrong = controller.setProduction(state, 'city-1', null); wrong.turn++; reject(state, wrong);
  state.phase = 'GAME_OVER'; reject(state, controller.setProduction(state, 'city-1', null));
});
test('purchasing a queued building normalizes the confirmed queue and never spends Unit progress', () => {
  const state = fixture(), result = RuleSystem.execute(state, controller.purchaseItem(state, 'city-1', 'monument'));
  assert.equal(result.ok, true); const city = result.state.cities['city-1'];
  assert.deepEqual(productionPlan(city), ['warrior', 'archer', 'warrior']); assert.equal(city.production.progressByItem.warrior, 7);
  assert.equal(city.production.progressByItem.monument, 0);
});
test('legacy games keep their versions and production state on inspection and save round trips', () => {
  const state = fixture(); delete state.partyRecoveryVersion;
  const before = serializeGameState(state); productionForecast(state.cities['city-1']);
  assert.equal(serializeGameState(state), before); assert.deepEqual(restoreGameState(before), state);
  assert.equal(Object.hasOwn(set(state, []), 'partyRecoveryVersion'), false);
});
test('a repeated stop Command is rejected without appending another event or changing state', () => {
  const state = fixture(), command = controller.setProduction(state, 'city-1', null), stopped = RuleSystem.execute(state, command).state;
  reject(stopped, command);
});
