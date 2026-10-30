import { RULESET } from '../core/ruleset.js';
import { createUnit } from '../models/unit.js';

export function validateProductionSelection(city, itemId, queue) {
  const buildings = new Set(city.buildings);
  for (const id of [itemId, ...queue]) {
    if (id === null || RULESET.items[id].category !== 'building') continue;
    if (buildings.has(id)) return '建設済み、またはキュー内で重複している建物です';
    buildings.add(id);
  }
  return null;
}

// Also repair queues written before duplicate-building validation existed.
export function normalizeProduction(city) {
  const production = city.production, seen = new Set(city.buildings);
  for (const id of city.buildings) if (Object.hasOwn(production.progressByItem, id)) production.progressByItem[id] = 0;
  const remaining = [production.currentItemId, ...production.queue].filter((id) => {
    if (!id) return false;
    if (RULESET.items[id].category !== 'building') return true;
    if (seen.has(id)) return false;
    seen.add(id); return true;
  });
  production.currentItemId = remaining.shift() ?? null; production.queue = remaining;
}

export function completeItem(state, city, itemId, source, events) {
  const item = RULESET.items[itemId];
  if (item.category === 'unit') {
    const id = `unit-${state.nextIds.unit++}`;
    state.units[id] = createUnit(id, city.ownerId, itemId, city.centerHex);
    state.kingdoms[city.ownerId].unitIds.push(id);
    events.push({ type: 'ItemCompleted', cityId: city.id, itemId, entityId: id, source });
  } else {
    if (city.buildings.includes(itemId)) return false;
    city.buildings.push(itemId);
    if (itemId === 'walls') city.defense.wallHp = RULESET.cityDefense.wallHp;
    if (source === 'purchase') normalizeProduction(city);
    events.push({ type: 'ItemCompleted', cityId: city.id, itemId, source });
  }
  return true;
}

export function applyProduction(state, city, amount, events) {
  normalizeProduction(city);
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
    normalizeProduction(city);
  }
}
