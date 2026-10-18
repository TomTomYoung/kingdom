import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialGameState, restoreGameState, serializeGameState } from '../src/core/game-state.js';
import { HumanController } from '../src/core/human-controller.js';
import { RuleSystem } from '../src/core/rule-system.js';
import { applyProduction } from '../src/systems/production-system.js';
const controller = new HumanController('kingdom-1');

test('built and duplicate queued buildings reject atomically while repeated units remain legal', () => {
  const state = createInitialGameState();
  for (const [item, queue] of [['monument', ['monument']], ['warrior', ['monument', 'monument']]]) {
    const before = serializeGameState(state), result = RuleSystem.execute(state, controller.setProduction(state, 'city-1', item, queue));
    assert.equal(result.ok, false); assert.equal(result.state, state); assert.equal(serializeGameState(state), before);
  }
  state.cities['city-1'].buildings.push('monument');
  assert.equal(RuleSystem.execute(state, controller.setProduction(state, 'city-1', 'monument')).ok, false);
  assert.equal(RuleSystem.execute(state, controller.setProduction(state, 'city-1', 'warrior', ['warrior'])).ok, true);
});

test('buying the current building advances the queue without refunds or free production', () => {
  const state = createInitialGameState(), city = state.cities['city-1'];
  city.production = { currentItemId: 'monument', queue: ['warrior', 'monument', 'warrior'], progressByItem: { monument: 15, warrior: 4 } };
  const result = RuleSystem.execute(state, controller.purchaseItem(state, city.id, 'monument'));
  assert.equal(result.ok, true); const next = result.state.cities[city.id];
  assert.deepEqual(next.production, { currentItemId: 'warrior', queue: ['warrior'], progressByItem: { monument: 0, warrior: 4 } });
  assert.equal(result.state.kingdoms['kingdom-1'].stockpiles.gold, 20); assert.equal(Object.keys(result.state.units).length, 0);
  assert.equal(result.events.filter(e => e.type === 'ItemCompleted').length, 1);
  assert.deepEqual(restoreGameState(serializeGameState(result.state)), result.state);
});

test('buying a queued building preserves current unit progress and repeated unit orders', () => {
  const state = createInitialGameState(), city = state.cities['city-1'];
  city.production = { currentItemId: 'warrior', queue: ['monument', 'warrior'], progressByItem: { monument: 7, warrior: 9 } };
  const result = RuleSystem.execute(state, controller.purchaseItem(state, city.id, 'monument'));
  assert.equal(result.ok, true);
  assert.deepEqual(result.state.cities[city.id].production, { currentItemId: 'warrior', queue: ['warrior'], progressByItem: { monument: 0, warrior: 9 } });
});

test('legacy duplicate queues skip built buildings without consuming production or duplicate completion', () => {
  const state = createInitialGameState(), city = state.cities['city-1'], events = [];
  city.buildings = ['monument']; city.production = { currentItemId: 'monument', queue: ['monument', 'warrior'], progressByItem: { monument: 5 } };
  applyProduction(state, city, 12, events);
  assert.equal(Object.keys(state.units).length, 1); assert.deepEqual(city.buildings, ['monument']);
  assert.equal(events.some(e => e.type === 'ItemCompleted' && e.itemId === 'monument'), false);
  assert.equal(city.production.currentItemId, null);
});
