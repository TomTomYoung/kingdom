import { RULESET } from './ruleset.js';
import { COMMAND_TYPES, createParty, reinforceParty, setFormation, setGuardOrder, moveParty, foundCity, purchaseCityItem, setCityProduction } from './commands.js';
import { isActiveUnit, occupiesMapTile } from '../models/party.js';
import { validateCitySite, validateFoundCity } from '../systems/founding-system.js';
import { validateReinforceParty } from '../systems/party-reorganization.js';
import { terrainMovementCost, validatePartyPath, getReachablePartyPaths } from '../systems/movement-system.js';
import { validateGuardOrder } from '../systems/damage-grid.js';
import { Hex } from '../world/hex.js';

export const hasExpansionAi = state => state.aiExpansionVersion === 1;
const ordered = records => Object.values(records).sort((a, b) => a.id.localeCompare(b.id));
const military = unit => isActiveUnit(unit) && !RULESET.unitTypes[unit.typeId].civilian;
const settler = unit => isActiveUnit(unit) && unit.typeId === 'settler';
const healthy = unit => military(unit) && unit.currentHp / unit.maxHp > 0.5;
const distance = (a, b) => Hex.fromKey(a).distance(Hex.fromKey(b));
const plan = city => [city.production.currentItemId, ...city.production.queue];
const citiesFor = (state, playerId) => ordered(state.cities).filter(c => c.ownerId === playerId);
const occupant = (state, key) => ordered(state.parties).find(p => occupiesMapTile(p) && p.location === key);
const active = (state, playerId) => hasExpansionAi(state) && !state.gameResult && state.phase === 'PLAYER_ACTION'
  && state.activePlayerId === playerId && state.kingdoms[playerId]?.controllerType === 'ai' && state.kingdoms[playerId].aiPolicy === 'reinforcements';
export const isExpansionParty = (state, party) => hasExpansionAi(state) && occupiesMapTile(party) && party.unitIds.some(id => settler(state.units[id]));

// One waiting escort is reserved while a settler is alive at that location or
// is being trained there. The reservation is derived, never private AI state.
export function reservedEscortIds(state, playerId) {
  const ids = new Set(); if (!hasExpansionAi(state)) return ids;
  const locations = new Set(ordered(state.units).filter(u => u.ownerId === playerId && settler(u) && (u.partyId === null || !state.parties[u.partyId]?.unitIds.some(id => military(state.units[id])))).map(u => u.location));
  for (const city of citiesFor(state, playerId)) if (plan(city).includes('settler')) locations.add(city.centerHex);
  for (const key of locations) {
    const unit = ordered(state.units).find(u => u.ownerId === playerId && u.partyId === null && u.location === key && healthy(u));
    if (unit) ids.add(unit.id);
  }
  return ids;
}

function safety(state, playerId) {
  const armies = ordered(state.parties).filter(p => p.ownerId !== playerId && occupiesMapTile(p) && p.unitIds.some(id => military(state.units[id])));
  const hostileCities = ordered(state.cities).filter(c => c.ownerId !== playerId);
  const enemyUnits = new Set(ordered(state.units).filter(u => u.ownerId !== playerId && isActiveUnit(u)).map(u => u.location));
  const hazards = [...armies.map(p => p.location), ...hostileCities.map(c => c.centerHex)];
  const clearance = key => hazards.length ? Math.min(...hazards.map(h => distance(key, h))) : Infinity;
  const passable = key => { const tile = state.world.tiles[key]; return tile && tile.terrainId !== 'void' && (tile.ownerId === null || tile.ownerId === playerId) && !enemyUnits.has(key); };
  return { clearance, passable, safe: key => passable(key) && clearance(key) > RULESET.aiExpansion.threatRange, armies, enemyUnits };
}

// Score only land the new city would actually receive. The score is independent
// of the expedition position; repeated planning therefore does not chase a
// moving distance score. The whole visible map is used (fog is not implemented).
export function settlementSiteScore(state, key, playerId) {
  const land = Hex.range(Hex.fromKey(key), 1).map(h => state.world.tiles[h.key]).filter(t => t && t.ownerId === null && t.territoryCityId === null && t.terrainId !== 'void');
  const value = land.reduce((sum, t) => { const y = RULESET.terrain[t.terrainId].yields; return sum + 3 * y.food + 2 * y.production + y.gold + y.science; }, 0);
  const nearest = Math.min(...citiesFor(state, playerId).map(c => distance(c.centerHex, key)));
  return value - 2 * nearest;
}

export function findSettlementSite(state, playerId, party) {
  const cities = citiesFor(state, playerId), policy = RULESET.aiExpansion;
  if (!cities.length || cities.length >= policy.maxCities || party.movementMaximum < 1) return null;
  const guard = safety(state, playerId), occupied = new Set(ordered(state.parties).filter(p => p.id !== party.id && occupiesMapTile(p)).map(p => p.location));
  const queue = [{ key: party.location, cost: 0, path: [] }], costs = new Map([[party.location, 0]]), visited = new Set(), choices = [];
  while (queue.length) {
    queue.sort((a, b) => a.cost - b.cost || a.key.localeCompare(b.key));
    const current = queue.shift(); if (visited.has(current.key)) continue; visited.add(current.key);
    if (guard.safe(current.key) && validateCitySite(state, playerId, current.key, party.id).ok
      && cities.some(c => distance(c.centerHex, current.key) <= policy.maxSiteDistance)) {
      choices.push({ ...current, score: settlementSiteScore(state, current.key, playerId) });
    }
    for (let direction = 0; direction < 6; direction++) {
      const key = Hex.fromKey(current.key).neighbor(direction).key;
      if (visited.has(key) || occupied.has(key) || !guard.safe(key)) continue;
      const step = terrainMovementCost(state.world.tiles[key].terrainId), cost = current.cost + step;
      if (step > party.movementMaximum || cost > policy.maxPathCost || cost >= (costs.get(key) ?? Infinity)) continue;
      costs.set(key, cost); queue.push({ key, cost, path: [...current.path, key] });
    }
  }
  return choices.sort((a, b) => b.score - a.score || a.cost - b.cost || a.key.localeCompare(b.key))[0] ?? null;
}

function retreatCommand(state, playerId, party, commandId) {
  const guard = safety(state, playerId), cities = citiesFor(state, playerId);
  const home = key => cities.length ? Math.min(...cities.map(c => distance(key, c.centerHex))) : Infinity;
  const endangered = guard.clearance(party.location) <= RULESET.aiExpansion.threatRange;
  const paths = [...getReachablePartyPaths(state, party)].filter(([, route]) => route.path.every(key => guard.passable(key)));
  paths.sort(([a, pa], [b, pb]) => (endangered ? guard.clearance(b) - guard.clearance(a) : 0) || home(a) - home(b) || pa.cost - pb.cost || a.localeCompare(b));
  const candidate = paths.find(([key, route]) => endangered
    ? guard.clearance(key) > guard.clearance(party.location) && route.path.every(k => guard.clearance(k) >= guard.clearance(party.location))
    : guard.safe(key) && home(key) < home(party.location) && route.path.every(k => guard.safe(k)));
  return candidate ? moveParty(playerId, state.currentTurn, party.id, candidate[1].path, commandId) : null;
}

// Existing expeditions are handled before general recruitment/deployment, so
// neither the settler nor its escort is redirected into the assault AI.
export function chooseExpeditionCommand(state, playerId, commandId) {
  if (!active(state, playerId)) return null;
  const ownUnits = ordered(state.units).filter(u => u.ownerId === playerId);
  for (const party of ordered(state.parties).filter(p => p.ownerId === playerId && isExpansionParty(state, p))) {
    if (party.activationState !== 'ready' || party.movementRemaining < 1) continue;
    const escorts = party.unitIds.filter(id => military(state.units[id]));
    if (!escorts.length) {
      const escort = ownUnits.find(u => u.partyId === null && u.location === party.location && healthy(u));
      if (escort && validateReinforceParty(state, playerId, party.id, [escort.id]).ok) return reinforceParty(playerId, state.currentTurn, party.id, [escort.id], commandId);
    }
    if (!escorts.length || !safety(state, playerId).safe(party.location)) {
      const retreat = retreatCommand(state, playerId, party, commandId); if (retreat) return retreat; continue;
    }
    // A newly formed two-member expedition places the civilian behind its
    // escort and enables shared protection through the ordinary Commands.
    if (party.unitIds.length === 2 && escorts.length === 1) {
      const civilian = party.unitIds.find(id => settler(state.units[id])), escort = escorts[0];
      if (party.formation['front-center'] !== escort || party.formation['middle-center'] !== civilian) {
        return setFormation(playerId, state.currentTurn, party.id, { 'front-center': escort, 'middle-center': civilian }, commandId);
      }
      if (!validateGuardOrder(state, party, escort, civilian, 'share')
        && (party.guardOrders[escort]?.targetUnitId !== civilian || party.guardOrders[escort]?.mode !== 'share')) {
        return setGuardOrder(playerId, state.currentTurn, party.id, escort, civilian, 'share', commandId);
      }
    }
    const site = findSettlementSite(state, playerId, party); if (!site) continue;
    if (site.key === party.location) {
      const unit = party.unitIds.find(id => settler(state.units[id]));
      if (validateFoundCity(state, playerId, party.id, unit).ok) return foundCity(playerId, state.currentTurn, party.id, unit, commandId);
      continue;
    }
    const prefix = []; let budget = party.movementRemaining;
    for (const key of site.path) { const cost = terrainMovementCost(state.world.tiles[key].terrainId); if (cost > budget) break; prefix.push(key); budget -= cost; }
    if (prefix.length && validatePartyPath(state, party, prefix).ok) return moveParty(playerId, state.currentTurn, party.id, prefix, commandId);
  }
  for (const unit of ownUnits.filter(u => u.partyId === null && settler(u))) {
    if (!safety(state, playerId).safe(unit.location)) continue;
    const blocking = occupant(state, unit.location);
    if (blocking) {
      if (blocking.ownerId === playerId && blocking.unitIds.some(id => healthy(state.units[id])) && validateReinforceParty(state, playerId, blocking.id, [unit.id]).ok) {
        return reinforceParty(playerId, state.currentTurn, blocking.id, [unit.id], commandId);
      }
      // Clear a full friendly garrison only when the waiting expedition already
      // has its own escort. Generic recruitment may be capped and unable to do so.
      if (blocking.ownerId === playerId && ownUnits.some(u => u.partyId === null && u.location === unit.location && healthy(u))) {
        const guard = safety(state, playerId);
        const exits = [...getReachablePartyPaths(state, blocking)].filter(([key, route]) => !state.world.tiles[key].cityId && route.path.every(k => guard.safe(k)))
          .sort(([a, pa], [b, pb]) => pa.cost - pb.cost || a.localeCompare(b));
        if (exits.length) return moveParty(playerId, state.currentTurn, blocking.id, exits[0][1].path, commandId);
      }
      continue;
    }
    const escort = ownUnits.find(u => u.partyId === null && u.location === unit.location && healthy(u));
    if (escort) return createParty(playerId, state.currentTurn, [escort.id, unit.id], unit.location, commandId);
  }
  return null;
}

export function chooseExpansionSupplyCommand(state, playerId, commandId) {
  if (!active(state, playerId)) return null;
  const policy = RULESET.aiExpansion, cities = citiesFor(state, playerId), units = ordered(state.units).filter(u => u.ownerId === playerId);
  if (!cities.length || cities.length >= policy.maxCities || units.filter(military).length < policy.minimumCombatUnits) return null;
  if (!ordered(state.parties).some(p => p.ownerId === playerId && occupiesMapTile(p) && p.unitIds.some(id => military(state.units[id])))) return null;
  const guard = safety(state, playerId);
  if (cities.some(c => guard.armies.some(p => distance(c.centerHex, p.location) <= policy.threatRange) || guard.enemyUnits.has(c.centerHex))) return null;
  const livingSettlers = units.filter(settler), pending = cities.some(c => plan(c).includes('settler'));
  // One concurrent settler, including reservations, and one new expedition per round.
  const orderedThisTurn = state.commandLog.some(c => c.playerId === playerId && c.turn === state.currentTurn
    && [COMMAND_TYPES.PURCHASE_CITY_ITEM, COMMAND_TYPES.SET_CITY_PRODUCTION].includes(c.type)
    && (c.payload.itemId === 'settler' || c.payload.queue?.includes('settler')));
  const totalMilitary = units.filter(military).length + cities.flatMap(plan).filter(id => RULESET.items[id]?.category === 'unit' && !RULESET.unitTypes[id].civilian).length;
  for (const city of cities) {
    const idle = !city.production.currentItemId && !city.production.queue.length && city.yieldSummary.production > 0;
    const escort = units.some(u => u.partyId === null && u.location === city.centerHex && healthy(u));
    const blocking = occupant(state, city.centerHex);
    if (blocking && blocking.ownerId !== playerId) continue;
    const purchases = state.commandLog.filter(c => c.playerId === playerId && c.turn === state.currentTurn && c.type === COMMAND_TYPES.PURCHASE_CITY_ITEM && c.payload.cityId === city.id).length;
    const canBuy = itemId => purchases < RULESET.aiRecruitment.purchasesPerCityPerTurn
      && state.kingdoms[playerId].stockpiles.gold - RULESET.items[itemId].purchaseOptions.gold >= RULESET.aiRecruitment.goldReserve + RULESET.items.warrior.purchaseOptions.gold;
    if (livingSettlers.length || pending) {
      // Recovery of a waiting expedition whose escort was lost or unavailable.
      if (livingSettlers.some(u => u.partyId === null && u.location === city.centerHex) && !escort && !blocking && totalMilitary < RULESET.aiRecruitment.maxCombatUnits
        && !plan(city).some(id => RULESET.items[id]?.category === 'unit' && !RULESET.unitTypes[id].civilian)) {
        if (canBuy('warrior')) return purchaseCityItem(playerId, state.currentTurn, city.id, 'warrior', 'gold', commandId);
        if (idle) return setCityProduction(playerId, state.currentTurn, city.id, 'warrior', [], commandId);
      }
      continue;
    }
    if (orderedThisTurn || !guard.safe(city.centerHex)) continue;
    const existingEscort = blocking?.ownerId === playerId && blocking.unitIds.length < 5 && blocking.unitIds.some(id => healthy(state.units[id]));
    if (!escort && !existingEscort && totalMilitary >= RULESET.aiRecruitment.maxCombatUnits) continue;
    const probe = { id: blocking?.id ?? null, location: city.centerHex, movementMaximum: 2 };
    if (!findSettlementSite(state, playerId, probe)) continue;
    if ((escort || existingEscort) && canBuy('settler')) return purchaseCityItem(playerId, state.currentTurn, city.id, 'settler', 'gold', commandId);
    // A reserved warrior behind the settler guarantees recruitment capacity for
    // an escort without replacing any existing orders or reusing progress.
    if (idle) return setCityProduction(playerId, state.currentTurn, city.id, 'settler', escort || existingEscort ? [] : ['warrior'], commandId);
  }
  return null;
}
