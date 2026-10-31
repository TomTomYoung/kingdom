import { RULESET } from '../core/ruleset.js';
import { getCityTerritoryTiles } from './city-territory.js';
const YIELDS = ['food', 'production', 'gold', 'science', 'mana', 'religion', 'culture'];
export const emptyYields = () => Object.fromEntries(YIELDS.map((key) => [key, 0]));

export function assignWorkedTiles(state, city) {
  const owned = getCityTerritoryTiles(state, city)
    .filter((tile) => tile.terrainId !== 'void')
    .sort((a, b) => {
      const ay = RULESET.terrain[a.terrainId].yields; const by = RULESET.terrain[b.terrainId].yields;
      const score = (y) => y.food * 3 + y.production * 2 + y.gold + y.science + y.mana + y.religion + y.culture;
      return score(by) - score(ay) || a.key.localeCompare(b.key);
    });
  city.workedTiles = owned.slice(0, city.population).map((tile) => tile.key);
}

export function calculateCityYields(state, city) {
  assignWorkedTiles(state, city);
  const total = emptyYields();
  const tiles = city.workedTiles.map((key) => {
    const tile = state.world.tiles[key]; const yields = { ...RULESET.terrain[tile.terrainId].yields };
    YIELDS.forEach((name) => { total[name] += yields[name]; });
    return { tileKey: key, terrainId: tile.terrainId, yields };
  });
  const buildings = city.buildings.map((buildingId) => {
    const yields = buildingId === 'monument' ? { ...emptyYields(), culture: 2 } : { ...emptyYields(), ...RULESET.items[buildingId].yields };
    YIELDS.forEach((name) => { total[name] += yields[name]; });
    return { buildingId, yields };
  });
  total.food += 2; total.production += 1; total.gold += 2; total.science += 1; total.culture += 1;
  const modifiers = {};
  YIELDS.forEach((name) => {
    const before = total[name];
    total[name] = Math.max(0, before + (city.yieldModifiers?.[name] ?? 0));
    if (Object.hasOwn(city.yieldModifiers ?? {}, name)) modifiers[name] = total[name] - before;
  });
  const center = { food: 2, production: 1, gold: 2, science: 1, culture: 1 };
  city.yieldSummary = total;
  city.lastYieldBreakdown = { tiles, buildings, center, modifiers, total: { ...total } };
  return city.lastYieldBreakdown;
}
