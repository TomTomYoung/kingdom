import { RULESET, RULESET_VERSION } from './ruleset.js';
import { createWorldMap } from '../world/world-map.js';
import { Hex } from '../world/hex.js';
import { createKingdom, updateDerivedCapabilities } from '../models/kingdom.js';
import { initializeCityDefense } from '../models/city-defense.js';
import { createCity } from '../models/city.js';
import { calculateCityYields } from '../systems/yield-system.js';
import { claimTileForCity } from '../systems/city-territory.js';
import { createUnit } from '../models/unit.js';
import { createParty } from '../models/party.js';
import { migrateAndValidateSave } from './save-validation.js';

export function createInitialGameState(seed = 117, { radius = RULESET.mapRadius, startingParty = false } = {}) {
  const world = createWorldMap(seed, radius);
  const kingdom = createKingdom(); const center = new Hex(0, 0, 0);
  const city = createCity(kingdom.id, center.key);
  for (const hex of [center, ...Array.from({ length: 6 }, (_, index) => center.neighbor(index))]) {
    const tile = world.tiles[hex.key];
    if (tile) { tile.ownerId = kingdom.id; tile.territoryCityId = city.id; if (hex.equals(center)) tile.cityId = city.id; }
  }
  const state = {
    schemaVersion: 1, rulesetVersion: RULESET_VERSION, cityTerritoryVersion: 1, seed, currentTurn: 1, phase: 'PLAYER_ACTION', lastProcessedTurn: 0,
    activePlayerId: kingdom.id, activePlayerIndex: 0, turnOrder: [kingdom.id], kingdoms: { [kingdom.id]: kingdom }, cities: { [city.id]: city }, units: {}, parties: {}, world,
    rng: { territory: { seed: (seed ^ 0x9e3779b9) >>> 0, state: (seed ^ 0x9e3779b9) >>> 0 }, combat: { seed: (seed ^ 0x85ebca6b) >>> 0, state: (seed ^ 0x85ebca6b) >>> 0 } },
    nextIds: { city: 2, unit: 1, party: 1, command: 1 }, commandLog: [], eventLog: [],
  };
  if (startingParty) {
    const unit = createUnit('unit-1', kingdom.id, 'warrior', center.key);
    unit.partyId = 'party-1'; state.units[unit.id] = unit; kingdom.unitIds.push(unit.id);
    state.parties['party-1'] = createParty('party-1', kingdom.id, [unit.id], center.key);
    state.nextIds.unit = 2; state.nextIds.party = 2;
  }
  calculateCityYields(state, city); updateDerivedCapabilities(kingdom, state);
  return state;
}

export function cloneGameState(state) { return structuredClone(state); }
export function serializeGameState(state) { return JSON.stringify(state); }
export function restoreGameState(json) {
  let value;
  try { value = JSON.parse(json); } catch { throw new Error('セーブデータが不正です: JSONを読み取れません'); }
  if (!value || value.schemaVersion !== 1 || value.rulesetVersion !== RULESET_VERSION) throw new Error('未対応のセーブ形式です');
  return migrateAndValidateSave(value);
}

export function addKingdom(state, { id, name, cityId, cityName, centerHex, controllerType = 'human' }) {
  if (state.kingdoms[id] || state.cities[cityId]) throw new Error('KingdomまたはCity IDが重複しています');
  const center = Hex.fromKey(centerHex); const centerTile = state.world.tiles[center.key];
  if (!centerTile || centerTile.terrainId === 'void' || centerTile.ownerId !== null) throw new Error('都市を配置できないHexです');
  const kingdom = createKingdom(id, name, [cityId], controllerType); const city = createCity(id, center.key, cityId, cityName);
  for (const hex of [center, ...Array.from({ length: 6 }, (_, index) => center.neighbor(index))]) {
    const tile = state.world.tiles[hex.key]; if (tile?.ownerId === null && tile.terrainId !== 'void') { tile.ownerId = id; tile.territoryCityId = cityId; }
  }
  initializeCityDefense(state, city);
  centerTile.cityId = cityId; state.kingdoms[id] = kingdom; state.cities[cityId] = city; state.turnOrder.push(id);
  advanceCityId(state, cityId);
  calculateCityYields(state, city); updateDerivedCapabilities(kingdom, state); return state;
}

// Scenario/setup helper. FoundCity, Settler costs and city spacing remain separate.
export function addCity(state, { ownerId, id, name = '新都', centerHex }) {
  if (typeof id !== 'string' || !id || Object.hasOwn(state.cities, id) || ['__proto__', 'constructor', 'prototype'].includes(id)) throw new Error('City IDが不正または重複しています');
  const kingdom = Object.hasOwn(state.kingdoms, ownerId) && state.kingdoms[ownerId];
  if (!kingdom) throw new Error('不明な王国です');
  const center = Hex.fromKey(centerHex), tile = state.world.tiles[center.key];
  if (!tile || tile.terrainId === 'void' || tile.cityId !== null || tile.territoryCityId !== null
    || (tile.ownerId !== null && tile.ownerId !== ownerId)) throw new Error('都市を配置できないHexです');
  const city = createCity(ownerId, center.key, id, name);
  initializeCityDefense(state, city);
  state.cities[id] = city; kingdom.cityIds.push(id); advanceCityId(state, id);
  claimTileForCity(state, city, tile); tile.cityId = id;
  for (let direction = 0; direction < 6; direction++) {
    const neighbor = state.world.tiles[center.neighbor(direction).key];
    if (neighbor?.ownerId === null && neighbor.territoryCityId === null && neighbor.cityId === null && neighbor.terrainId !== 'void') claimTileForCity(state, city, neighbor);
  }
  calculateCityYields(state, city); updateDerivedCapabilities(kingdom, state);
  return state;
}

function advanceCityId(state, id) {
  const match = id.match(/^city-(\d+)$/);
  if (match) state.nextIds.city = Math.max(state.nextIds.city, Number(match[1]) + 1);
}
