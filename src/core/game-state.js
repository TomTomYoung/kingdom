import { RULESET, RULESET_VERSION } from './ruleset.js';
import { createWorldMap } from '../world/world-map.js';
import { Hex } from '../world/hex.js';
import { createKingdom, updateDerivedCapabilities } from '../models/kingdom.js';
import { createCity } from '../models/city.js';
import { calculateCityYields } from '../systems/yield-system.js';
import { createUnit } from '../models/unit.js';
import { createParty } from '../models/party.js';

export function createInitialGameState(seed = 117, { radius = RULESET.mapRadius, startingParty = false } = {}) {
  const world = createWorldMap(seed, radius);
  const kingdom = createKingdom(); const center = new Hex(0, 0, 0);
  const city = createCity(kingdom.id, center.key);
  for (const hex of [center, ...Array.from({ length: 6 }, (_, index) => center.neighbor(index))]) {
    const tile = world.tiles[hex.key];
    if (tile) { tile.ownerId = kingdom.id; if (hex.equals(center)) tile.cityId = city.id; }
  }
  const state = {
    schemaVersion: 1, rulesetVersion: RULESET_VERSION, seed, currentTurn: 1, phase: 'PLAYER_ACTION', lastProcessedTurn: 0,
    activePlayerId: kingdom.id, activePlayerIndex: 0, turnOrder: [kingdom.id], kingdoms: { [kingdom.id]: kingdom }, cities: { [city.id]: city }, units: {}, parties: {}, world,
    rng: { territory: { seed: (seed ^ 0x9e3779b9) >>> 0, state: (seed ^ 0x9e3779b9) >>> 0 }, combat: { seed: (seed ^ 0x85ebca6b) >>> 0, state: (seed ^ 0x85ebca6b) >>> 0 } },
    nextIds: { unit: 1, party: 1, command: 1 }, commandLog: [], eventLog: [],
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
  const value = JSON.parse(json);
  if (value.schemaVersion !== 1 || value.rulesetVersion !== RULESET_VERSION) throw new Error('Unsupported save version');
  value.parties ??= {};
  value.rng.combat ??= { seed: (value.seed ^ 0x85ebca6b) >>> 0, state: (value.seed ^ 0x85ebca6b) >>> 0 };
  value.turnOrder ??= Object.keys(value.kingdoms);
  value.activePlayerIndex ??= Math.max(0, value.turnOrder.indexOf(value.activePlayerId));
  value.nextIds.party ??= 1;
  for (const unit of Object.values(value.units)) {
    const definition = RULESET.unitTypes[unit.typeId] ?? RULESET.unitTypes.warrior;
    unit.partyId ??= null; unit.currentHp ??= unit.hp ?? definition.maxHp; unit.maxHp ??= definition.maxHp; unit.hp = unit.currentHp;
    for (const key of ['scaleClass', 'meleeStrength', 'rangedStrength', 'magicStrength', 'defenseStrength', 'resistance', 'armor', 'range', 'guardRate', 'moraleContribution', 'commandContribution']) unit[key] ??= definition[key];
    unit.guardCapacityMax ??= definition.guardCapacity; unit.guardCapacityRemaining ??= unit.guardCapacityMax;
    unit.status ??= 'active'; unit.statusEffects ??= [];
  }
  for (const party of Object.values(value.parties)) { party.attacksMaximum ??= 1; party.activationState ??= 'ready'; party.hasMoved ??= false; party.hasAttacked ??= false; party.reactionCharges ??= 1; }
  return value;
}

export function addKingdom(state, { id, name, cityId, cityName, centerHex, controllerType = 'human' }) {
  if (state.kingdoms[id] || state.cities[cityId]) throw new Error('KingdomまたはCity IDが重複しています');
  const center = Hex.fromKey(centerHex); const centerTile = state.world.tiles[center.key];
  if (!centerTile || centerTile.terrainId === 'void' || centerTile.ownerId !== null) throw new Error('都市を配置できないHexです');
  const kingdom = createKingdom(id, name, [cityId], controllerType); const city = createCity(id, center.key, cityId, cityName);
  for (const hex of [center, ...Array.from({ length: 6 }, (_, index) => center.neighbor(index))]) {
    const tile = state.world.tiles[hex.key]; if (tile?.ownerId === null && tile.terrainId !== 'void') tile.ownerId = id;
  }
  centerTile.cityId = cityId; state.kingdoms[id] = kingdom; state.cities[cityId] = city; state.turnOrder.push(id);
  calculateCityYields(state, city); updateDerivedCapabilities(kingdom, state); return state;
}
