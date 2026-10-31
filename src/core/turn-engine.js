import { applyResearch } from '../systems/research-system.js';
import { processPartyRest } from '../systems/party-care.js';
import { hasCityBombardment, hasCityRetaliation } from '../models/city-defense.js';
import { recoverCityDefense } from '../systems/city-siege.js';
import { RULESET } from './ruleset.js';
import { calculateCityYields } from '../systems/yield-system.js';
import { applyProduction } from '../systems/production-system.js';
import { expandTerritory } from '../systems/territory-system.js';
import { updateDerivedCapabilities } from '../models/kingdom.js';
import { isActiveUnit, hasActiveUnits } from '../models/party.js';

export function processTurnStart(state, events) {
  if (state.lastProcessedTurn === state.currentTurn) return;
  // Resolve all rest orders against the same round boundary before any city
  // expands territory; kingdom iteration order must not decide recovery.
  for (const party of Object.values(state.parties)) processPartyRest(state, party, events);
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
      recoverCityDefense(state, city, events);
      if (hasCityRetaliation(state)) city.defense.counterattacksRemaining = RULESET.cityDefense.counterattacksPerRound;
      if (hasCityBombardment(state)) city.defense.bombardmentsRemaining = RULESET.cityBombardment.attacksPerRound;
      applyProduction(state, city, city.yieldSummary.production, events);
      kingdom.stockpiles.gold += city.yieldSummary.gold; kingdom.stockpiles.mana += city.yieldSummary.mana;
      kingdom.progress.science += city.yieldSummary.science; kingdom.progress.culture += city.yieldSummary.culture;
      city.localCultureProgress += city.yieldSummary.culture;
      while (city.localCultureProgress >= RULESET.cultureExpansionCost) {
        if (!expandTerritory(state, city, events)) break;
        city.localCultureProgress -= RULESET.cultureExpansionCost;
      }
    }
    // Science has already been collected once above. Allocate its unassigned portion.
    applyResearch(state, kingdom, events);
    for (const party of Object.values(state.parties).filter(({ ownerId }) => ownerId === kingdom.id)) {
      const active = party.status === 'active' && hasActiveUnits(state, party);
      party.movementRemaining = active ? party.movementMaximum : 0;
      party.attacksRemaining = active ? party.attacksMaximum : 0;
      party.activationState = active ? 'ready' : 'ended';
      party.hasMoved = false; party.hasAttacked = false; party.reactionCharges = active ? 1 : 0;
      for (const unitId of party.unitIds) {
        const unit = state.units[unitId];
        if (unit) unit.guardCapacityRemaining = active && isActiveUnit(unit) ? unit.guardCapacityMax : 0;
      }
    }
    updateDerivedCapabilities(kingdom, state);
  }
  state.lastProcessedTurn = state.currentTurn; state.phase = 'PLAYER_ACTION';
}
