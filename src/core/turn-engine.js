import { RULESET } from './ruleset.js';
import { calculateCityYields } from '../systems/yield-system.js';
import { applyProduction } from '../systems/production-system.js';
import { expandTerritory } from '../systems/territory-system.js';
import { updateDerivedCapabilities } from '../models/kingdom.js';

export function processTurnStart(state, events) {
  if (state.lastProcessedTurn === state.currentTurn) return;
  for (const kingdom of Object.values(state.kingdoms)) {
    const paid = Math.min(kingdom.stockpiles.popularSupport, kingdom.supportUpkeep);
    kingdom.stockpiles.popularSupport = Math.min(RULESET.popularSupportCap, kingdom.stockpiles.popularSupport - paid + kingdom.supportIncome);
    events.push({ type: 'PopularSupportResolved', kingdomId: kingdom.id, income: kingdom.supportIncome, upkeepPaid: paid });
    for (const cityId of kingdom.cityIds) {
      const city = state.cities[cityId]; const breakdown = calculateCityYields(state, city);
      events.push({ type: 'YieldCollected', cityId, breakdown });
      city.foodStorage += city.yieldSummary.food;
      const foodCost = RULESET.growthFoodBase + city.population * RULESET.growthFoodPerPopulation;
      if (city.foodStorage >= foodCost) { city.foodStorage -= foodCost; city.population += 1; kingdom.humanResources.native += 1; events.push({ type: 'CityGrew', cityId, population: city.population }); }
      applyProduction(state, city, city.yieldSummary.production, events);
      kingdom.stockpiles.gold += city.yieldSummary.gold; kingdom.stockpiles.mana += city.yieldSummary.mana;
      kingdom.progress.science += city.yieldSummary.science; kingdom.progress.culture += city.yieldSummary.culture;
      city.localCultureProgress += city.yieldSummary.culture;
      while (city.localCultureProgress >= RULESET.cultureExpansionCost) {
        if (!expandTerritory(state, city, events)) break;
        city.localCultureProgress -= RULESET.cultureExpansionCost;
      }
    }
    for (const party of Object.values(state.parties).filter(({ ownerId }) => ownerId === kingdom.id)) { party.movementRemaining = party.movementMaximum; party.attacksRemaining = party.attacksMaximum; party.activationState = 'ready'; party.hasMoved = false; party.hasAttacked = false; party.reactionCharges = 1; for (const unitId of party.unitIds) state.units[unitId].guardCapacityRemaining = state.units[unitId].guardCapacityMax; }
    updateDerivedCapabilities(kingdom, state);
  }
  state.lastProcessedTurn = state.currentTurn; state.phase = 'PLAYER_ACTION';
}
