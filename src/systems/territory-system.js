import { Hex } from '../world/hex.js';
import { RULESET } from '../core/ruleset.js';
import { SeededRng } from '../core/rng.js';
import { getCityTerritoryTiles, claimTileForCity } from './city-territory.js';

export function getTerritoryCandidates(state, city) {
  const owned = getCityTerritoryTiles(state, city).filter(tile => tile.terrainId !== 'void');
  const keys = new Set();
  for (const tile of owned) {
    const hex = new Hex(tile.q, tile.r, tile.s);
    for (let d = 0; d < 6; d += 1) {
      const candidate = state.world.tiles[hex.neighbor(d).key];
      if (candidate && candidate.ownerId === null && candidate.territoryCityId === null && candidate.cityId === null && candidate.terrainId !== 'void') keys.add(candidate.key);
    }
  }
  return [...keys].map((key) => state.world.tiles[key]).sort((a, b) => a.key.localeCompare(b.key));
}

export function tilePurchaseCost(state, city, tile) {
  const distance = Hex.fromKey(city.centerHex).distance(Hex.fromKey(tile.key));
  const yieldValue = Object.values(RULESET.terrain[tile.terrainId].yields).reduce((a, b) => a + b, 0);
  return 20 + distance * 5 + yieldValue * 2;
}

export function expandTerritory(state, city, events) {
  const candidates = getTerritoryCandidates(state, city);
  if (!candidates.length) return false;
  const center = Hex.fromKey(city.centerHex);
  const score = (tile) => Object.values(RULESET.terrain[tile.terrainId].yields).reduce((a, b) => a + b, 0) * 3 - center.distance(Hex.fromKey(tile.key));
  const bestScore = Math.max(...candidates.map(score)); const best = candidates.filter((tile) => score(tile) === bestScore);
  const rng = SeededRng.fromJSON(state.rng.territory); const selected = rng.pick(best); state.rng.territory = rng.toJSON();
  claimTileForCity(state, city, selected);
  events.push({ type: 'TerritoryExpanded', cityId: city.id, tileKey: selected.key, source: 'culture' });
  return true;
}
