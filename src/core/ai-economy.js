import { hasCityRetaliation, cityEntryError } from '../models/city-defense.js';
import { COMMAND_TYPES, createParty, moveParty, purchaseCityItem, setCityProduction, reinforceParty, mergeParties } from './commands.js';
import { RULESET } from './ruleset.js';
import { isActiveUnit, hasActiveUnits, occupiesMapTile } from '../models/party.js';
import { getReachablePartyPaths } from '../systems/movement-system.js';
import { Hex } from '../world/hex.js';
import { validateReinforceParty, validateMergeParties } from '../systems/party-reorganization.js';

const ordered = records => Object.values(records).sort((a, b) => a.id.localeCompare(b.id));
const combatUnit = unit => isActiveUnit(unit) && !RULESET.unitTypes[unit.typeId].civilian;
const waiting = (state, playerId) => ordered(state.units).filter(unit => unit.ownerId === playerId && unit.partyId === null && combatUnit(unit));
const cities = (state, playerId) => ordered(state.cities).filter(city => city.ownerId === playerId);
const occupant = (state, location) => Object.values(state.parties).find(party => occupiesMapTile(party) && party.location === location);
const purchaseCount = (state, playerId, cityId) => state.commandLog.filter(command => command.playerId === playerId && command.turn === state.currentTurn && command.type === COMMAND_TYPES.PURCHASE_CITY_ITEM && command.payload.cityId === cityId).length;

export function chooseReinforcementCommand(state, playerId, commandId) {
  const recruits = waiting(state, playerId);
  for (const party of ordered(state.parties).filter(p => p.ownerId === playerId && p.unitIds.some(id => combatUnit(state.units[id])))) {
    const ids = recruits.filter(unit => unit.location === party.location).slice(0, Math.max(0, 5 - party.unitIds.length)).map(unit => unit.id);
    if (validateReinforceParty(state, playerId, party.id, ids).ok) return reinforceParty(playerId, state.currentTurn, party.id, ids, commandId);
  }
  return null;
}

export function chooseMergeCommand(state, playerId, commandId) {
  const parties = ordered(state.parties).filter(p => p.ownerId === playerId && p.unitIds.every(id => !RULESET.unitTypes[state.units[id].typeId].civilian));
  const targets = [...parties].sort((a, b) => b.unitIds.length - a.unitIds.length || a.id.localeCompare(b.id));
  const sources = [...parties].sort((a, b) => a.unitIds.length - b.unitIds.length || a.id.localeCompare(b.id));
  for (const target of targets) for (const source of sources) {
    if (validateMergeParties(state, playerId, source.id, target.id).ok) return mergeParties(playerId, state.currentTurn, source.id, target.id, commandId);
  }
  return null;
}

// Count live units AND reserved production across all cities before committing
// shared funds or another queue slot. No private AI state or random look-ahead.
export function recruitmentNeeds(state, playerId) {
  const types = Object.keys(RULESET.aiRecruitment.composition), counts = Object.fromEntries(types.map(type => [type, 0]));
  let total = 0;
  for (const unit of Object.values(state.units)) if (unit.ownerId === playerId && combatUnit(unit)) { total++; if (Object.hasOwn(counts, unit.typeId)) counts[unit.typeId]++; }
  for (const city of cities(state, playerId)) for (const id of [city.production.currentItemId, ...city.production.queue]) {
    if (RULESET.items[id]?.category !== 'unit' || RULESET.unitTypes[id].civilian) continue;
    total++; if (Object.hasOwn(counts, id)) counts[id]++;
  }
  types.sort((a, b) => counts[a] / RULESET.aiRecruitment.composition[a] - counts[b] / RULESET.aiRecruitment.composition[b]);
  return { total, types };
}

function purchaseType(state, playerId, city, needs) {
  if (needs.total >= RULESET.aiRecruitment.maxCombatUnits || purchaseCount(state, playerId, city.id) >= RULESET.aiRecruitment.purchasesPerCityPerTurn) return null;
  const budget = state.kingdoms[playerId].stockpiles.gold - RULESET.aiRecruitment.goldReserve;
  return needs.types.find(type => RULESET.items[type].purchaseOptions.gold <= budget) ?? null;
}

export function chooseCityExitCommand(state, playerId, commandId) {
  const needs = recruitmentNeeds(state, playerId), recruits = waiting(state, playerId);
  const enemies = Object.values(state.parties).filter(p => p.ownerId !== playerId && occupiesMapTile(p) && hasActiveUnits(state, p));
  for (const city of cities(state, playerId)) {
    const party = occupant(state, city.centerHex);
    if (!party || party.ownerId !== playerId || !hasActiveUnits(state, party)) continue;
    if (!recruits.some(unit => unit.location === city.centerHex) && !purchaseType(state, playerId, city, needs)) continue;
    const nearestEnemy = key => enemies.length ? Math.min(...enemies.map(enemy => Hex.fromKey(key).distance(Hex.fromKey(enemy.location)))) : 0;
    const civilian = !party.unitIds.some(id => combatUnit(state.units[id]));
    const paths = [...getReachablePartyPaths(state, party)].filter(([key]) => !state.world.tiles[key].cityId);
    paths.sort(([a, pa], [b, pb]) => (civilian ? -1 : 1) * (nearestEnemy(a) - nearestEnemy(b)) || pa.cost - pb.cost || a.localeCompare(b));
    if (paths.length) return moveParty(playerId, state.currentTurn, party.id, paths[0][1].path, commandId);
  }
  return null;
}

export function chooseDeploymentCommand(state, playerId, commandId) {
  const recruits = waiting(state, playerId), locations = [...new Set(recruits.map(unit => unit.location))].sort();
  for (const location of locations) {
    if (cityEntryError(state, playerId, location) || occupant(state, location) || !state.world.tiles[location] || state.world.tiles[location].terrainId === 'void') continue;
    const ids = recruits.filter(unit => unit.location === location).slice(0, 5).map(unit => unit.id);
    return createParty(playerId, state.currentTurn, ids, location, commandId);
  }
  return null;
}

export function chooseSupplyCommand(state, playerId, commandId) {
  const defense = chooseCityDefenseCommand(state, playerId, commandId); if (defense) return defense;
  const needs = recruitmentNeeds(state, playerId);
  if (needs.total >= RULESET.aiRecruitment.maxCombatUnits) return null;
  const ownCities = cities(state, playerId), recruits = waiting(state, playerId);
  for (const city of ownCities) {
    const blocking = occupant(state, city.centerHex);
    if (blocking && blocking.ownerId !== playerId) continue;
    if (city.production.currentItemId || city.production.queue.length || recruits.filter(unit => unit.location === city.centerHex).length >= 5) continue;
    return setCityProduction(playerId, state.currentTurn, city.id, needs.types[0], [], commandId);
  }
  for (const city of ownCities) {
    if (occupant(state, city.centerHex) || recruits.filter(unit => unit.location === city.centerHex).length >= 5) continue;
    const type = purchaseType(state, playerId, city, needs);
    if (type) return purchaseCityItem(playerId, state.currentTurn, city.id, type, 'gold', commandId);
  }
  return null;
}

export function chooseCityDefenseCommand(state, playerId, commandId) {
  if (!hasCityRetaliation(state)) return null;
  const live = Object.values(state.units).filter(unit => unit.ownerId === playerId && combatUnit(unit));
  if (live.length < RULESET.aiCityDefense.minimumCombatUnits || !Object.values(state.parties).some(party => party.ownerId === playerId && occupiesMapTile(party) && party.unitIds.some(id => combatUnit(state.units[id])))) return null;
  const enemies = Object.values(state.parties).filter(party => party.ownerId !== playerId && occupiesMapTile(party) && party.unitIds.some(id => combatUnit(state.units[id])));
  const threatened = cities(state, playerId).filter(city => !city.buildings.includes('walls') && (!occupant(state, city.centerHex) || occupant(state, city.centerHex).ownerId === playerId)
    && enemies.some(party => Hex.fromKey(party.location).distance(Hex.fromKey(city.centerHex)) <= RULESET.aiCityDefense.threatRange));
  for (const city of threatened) if (state.kingdoms[playerId].stockpiles.gold - RULESET.aiRecruitment.goldReserve >= RULESET.items.walls.purchaseOptions.gold && purchaseCount(state, playerId, city.id) < RULESET.aiRecruitment.purchasesPerCityPerTurn) {
    return purchaseCityItem(playerId, state.currentTurn, city.id, 'walls', 'gold', commandId);
  }
  for (const city of threatened) if (!city.production.currentItemId && !city.production.queue.length) return setCityProduction(playerId, state.currentTurn, city.id, 'walls', [], commandId);
  return null;
}
