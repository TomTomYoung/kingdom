import { COMMAND_TYPES, purchaseCityItem, setCityProduction } from './commands.js';
import { RULESET } from './ruleset.js';
import { isActiveUnit, occupiesMapTile } from '../models/party.js';
import { hasResearch, itemResearchError } from '../systems/research-system.js';
import { Hex } from '../world/hex.js';

// An opt-in saved version, separate from research. Never upgrade old AI saves.
export const hasInfrastructureAi = state => state.aiInfrastructureVersion === 1 && hasResearch(state);
const military = unit => isActiveUnit(unit) && !RULESET.unitTypes[unit.typeId].civilian;
const ordered = records => Object.values(records).sort((a, b) => a.id.localeCompare(b.id));
const isOrder = command => [COMMAND_TYPES.SET_CITY_PRODUCTION, COMMAND_TYPES.PURCHASE_CITY_ITEM].includes(command.type);

export function infrastructureOrdersThisTurn(state, playerId) {
  return state.commandLog.filter(command => command.playerId === playerId && command.turn === state.currentTurn
    && isOrder(command) && RULESET.items[command.payload.itemId]?.requiredTechnology).length;
}

// Deterministic, deliberately small vertical-slice policy. Low food/production
// take priority; otherwise accelerate unfinished research, then build capacity.
export function infrastructurePriority(city, kingdom) {
  const policy = RULESET.aiInfrastructure, candidates = [];
  if (city.yieldSummary.food <= policy.lowFood) candidates.push('granary');
  if (city.yieldSummary.production <= policy.lowProduction) candidates.push('workshop');
  if (Object.keys(RULESET.technologies).some(id => !kingdom.research.completedTechnologyIds.includes(id))) candidates.push('library');
  return [...new Set([...candidates, 'workshop', 'granary', 'library'])];
}

export function chooseInfrastructureCommand(state, playerId, commandId) {
  const kingdom = state.kingdoms[playerId], policy = RULESET.aiInfrastructure;
  if (!hasInfrastructureAi(state) || state.gameResult || state.phase !== 'PLAYER_ACTION' || state.activePlayerId !== playerId
    || kingdom?.controllerType !== 'ai' || kingdom.aiPolicy !== 'reinforcements') return null;
  if (infrastructureOrdersThisTurn(state, playerId) >= policy.ordersPerKingdomPerTurn) return null;
  const live = Object.values(state.units).filter(unit => unit.ownerId === playerId && military(unit));
  if (live.length < policy.minimumCombatUnits) return null;
  const armies = Object.values(state.parties).filter(party => occupiesMapTile(party) && party.unitIds.some(id => military(state.units[id])));
  if (!armies.some(party => party.ownerId === playerId)) return null;
  const cities = ordered(state.cities).filter(city => city.ownerId === playerId);
  const enemies = armies.filter(party => party.ownerId !== playerId);
  // Any threatened city suspends discretionary spending kingdom-wide. Even a
  // walled city needs reinforcements, not a library in a different safe city.
  if (cities.some(city => enemies.some(party => Hex.fromKey(party.location).distance(Hex.fromKey(city.centerHex)) <= policy.threatRange)
    || Object.values(state.units).some(unit => unit.ownerId !== playerId && isActiveUnit(unit) && unit.location === city.centerHex))) return null;
  for (const city of cities) {
    const pending = [city.production.currentItemId, ...city.production.queue];
    const itemId = infrastructurePriority(city, kingdom).find(id => !city.buildings.includes(id) && !pending.includes(id) && !itemResearchError(state, playerId, id));
    if (!itemId) continue;
    const price = RULESET.items[itemId].purchaseOptions.gold;
    const purchases = state.commandLog.filter(command => command.playerId === playerId && command.turn === state.currentTurn
      && command.type === COMMAND_TYPES.PURCHASE_CITY_ITEM && command.payload.cityId === city.id).length;
    // Retain the old reserve AND enough for one emergency warrior. Purchases
    // use the existing per-city military/wall purchase cap, also after reload.
    const reserve = RULESET.aiRecruitment.goldReserve + RULESET.items.warrior.purchaseOptions.gold;
    if (kingdom.stockpiles.gold - price >= reserve && purchases < RULESET.aiRecruitment.purchasesPerCityPerTurn) {
      return purchaseCityItem(playerId, state.currentTurn, city.id, itemId, 'gold', commandId);
    }
    // Never displace a military order, discard a queue or duplicate a building.
    if (!city.production.currentItemId && !city.production.queue.length && city.yieldSummary.production > 0) {
      return setCityProduction(playerId, state.currentTurn, city.id, itemId, [], commandId);
    }
  }
  return null;
}
