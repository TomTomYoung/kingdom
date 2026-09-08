import { RULESET } from '../core/ruleset.js';
import { createUnit } from '../models/unit.js';

export function completeItem(state, city, itemId, source, events) {
  const item = RULESET.items[itemId];
  if (item.category === 'unit') {
    const id = `unit-${state.nextIds.unit++}`;
    state.units[id] = createUnit(id, city.ownerId, itemId, city.centerHex);
    state.kingdoms[city.ownerId].unitIds.push(id);
    events.push({ type: 'ItemCompleted', cityId: city.id, itemId, entityId: id, source });
  } else {
    if (!city.buildings.includes(itemId)) city.buildings.push(itemId);
    events.push({ type: 'ItemCompleted', cityId: city.id, itemId, source });
  }
}

export function applyProduction(state, city, amount, events) {
  let overflow = amount;
  while (city.production.currentItemId && overflow > 0) {
    const itemId = city.production.currentItemId; const item = RULESET.items[itemId];
    const old = city.production.progressByItem[itemId] ?? 0;
    const applied = Math.min(overflow, item.productionCost - old);
    const progress = old + applied; overflow -= applied;
    city.production.progressByItem[itemId] = progress;
    events.push({ type: 'ProductionProgressed', cityId: city.id, itemId, amount: applied, progress });
    if (progress < item.productionCost) return;
    city.production.progressByItem[itemId] = 0;
    completeItem(state, city, itemId, 'production', events);
    city.production.currentItemId = city.production.queue.shift() ?? null;
  }
}
