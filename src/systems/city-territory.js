import { Hex } from '../world/hex.js';

// cityId locates a city center; territoryCityId assigns land to one city.
export function getCityTerritoryTiles(state, city) {
  if (!city) return [];
  return Object.values(state.world.tiles).filter(tile => tile.ownerId === city.ownerId && tile.territoryCityId === city.id);
}

export function claimTileForCity(state, city, tile) {
  if (!tile || tile.terrainId === 'void' || state.cities[city.id] !== city
    || (tile.ownerId !== null && tile.ownerId !== city.ownerId)
    || (tile.territoryCityId !== null && tile.territoryCityId !== city.id)
    || (tile.cityId !== null && tile.cityId !== city.id)) throw new Error('この都市の領土として取得できないタイルです');
  tile.ownerId = city.ownerId;
  tile.territoryCityId = city.id;
}

// Called only after validation of a legacy save with no territory fields.
// Resolve every assignment before writing; resources, snapshots and RNG stay intact.
export function assignLegacyCityTerritories(state) {
  const citiesByOwner = new Map();
  for (const city of Object.values(state.cities)) {
    const cities = citiesByOwner.get(city.ownerId) ?? [];
    cities.push(city); citiesByOwner.set(city.ownerId, cities);
  }
  const assignments = Object.values(state.world.tiles).map(tile => {
    if (tile.ownerId === null) return [tile, null];
    const cities = citiesByOwner.get(tile.ownerId);
    if (!cities?.length) throw new Error('セーブデータが不正です: 所有タイルを管理する都市がありません');
    const centerCity = tile.cityId !== null ? state.cities[tile.cityId] : null;
    if (centerCity?.ownerId === tile.ownerId) return [tile, centerCity.id];
    const hex = Hex.fromKey(tile.key);
    const city = [...cities].sort((a, b) => hex.distance(Hex.fromKey(a.centerHex)) - hex.distance(Hex.fromKey(b.centerHex)) || a.id.localeCompare(b.id))[0];
    return [tile, city.id];
  });
  for (const [tile, cityId] of assignments) tile.territoryCityId = cityId;
}
