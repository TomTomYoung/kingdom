import { RULESET } from '../core/ruleset.js';
import { Hex } from '../world/hex.js';
import { initializeCityDefense } from '../models/city-defense.js';
import { createCity } from '../models/city.js';
import { isActiveUnit, hasActiveUnits, occupiesMapTile } from '../models/party.js';
import { updateDerivedCapabilities } from '../models/kingdom.js';
import { claimTileForCity } from './city-territory.js';

const reject = reason => ({ ok: false, reason });

// Placement rules shared with the expansion planner; no actions or RNG are spent.
export function validateCitySite(state, playerId, location, partyId = null) {
  const tile = Object.hasOwn(state.world.tiles, location) && state.world.tiles[location];
  if (!tile || !RULESET.founding.terrainIds.includes(tile.terrainId)) return reject('この地形には都市を建設できません');
  if (tile.ownerId !== null || tile.territoryCityId !== null || tile.cityId !== null) return reject('都市建設には未所有の土地が必要です');
  if (Object.values(state.parties).some(other => other.id !== partyId && occupiesMapTile(other) && other.location === tile.key)) return reject('他の部隊が占有しています');
  if (Object.values(state.units).some(other => other.ownerId !== playerId && isActiveUnit(other) && other.location === tile.key)) return reject('敵Unitがいる土地には都市を建設できません');
  const center = Hex.fromKey(tile.key);
  if (Object.values(state.cities).some(city => center.distance(Hex.fromKey(city.centerHex)) < RULESET.founding.minimumCityDistance)) return reject(`既存の都市から${RULESET.founding.minimumCityDistance}ヘクス以上離してください`);
  return { ok: true, tileKey: tile.key };
}

// Shared by the command and UI. Previewing a site never allocates IDs or RNG.
export function validateFoundCity(state, playerId, partyId, settlerUnitId) {
  if (state.phase !== 'PLAYER_ACTION' || state.activePlayerId !== playerId) return reject('現在の手番ではありません');
  const party = Object.hasOwn(state.parties, partyId) && state.parties[partyId];
  if (!party || party.ownerId !== playerId || party.status !== 'active') return reject('自国の活動中の部隊を選択してください');
  const unit = Object.hasOwn(state.units, settlerUnitId) && state.units[settlerUnitId];
  if (!unit || unit.ownerId !== playerId || unit.typeId !== 'settler' || !isActiveUnit(unit)
    || unit.partyId !== party.id || !party.unitIds.includes(unit.id) || unit.location !== party.location) return reject('部隊内の活動中の開拓者を選択してください');
  if (party.activationState !== 'ready' || party.movementRemaining < RULESET.founding.minimumMovement) return reject('都市建設には移動力1以上と未終了の行動が必要です');
  const site = validateCitySite(state, playerId, party.location, party.id);
  if (!site.ok) return site;
  const tile = state.world.tiles[site.tileKey];
  const sequence = state.nextIds.city;
  if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence >= Number.MAX_SAFE_INTEGER || Object.hasOwn(state.cities, `city-${sequence}`)) return reject('都市IDを発行できません');
  return { ok: true, tileKey: tile.key, cityId: `city-${sequence}` };
}

export function resolveFoundCity(state, playerId, partyId, settlerUnitId, events) {
  const validation = validateFoundCity(state, playerId, partyId, settlerUnitId);
  if (!validation.ok) return validation;
  const party = state.parties[partyId], kingdom = state.kingdoms[playerId];
  const city = createCity(playerId, validation.tileKey, validation.cityId, `開拓都市${state.nextIds.city}`);
  city.population = RULESET.founding.initialPopulation;
  // Leave collection snapshots empty. The next global turn start collects once.
  state.nextIds.city += 1;
  initializeCityDefense(state, city);
  state.cities[city.id] = city; kingdom.cityIds.push(city.id);
  const center = Hex.fromKey(city.centerHex), tile = state.world.tiles[center.key], claimedTileKeys = [];
  for (const hex of [center, ...Array.from({ length: 6 }, (_, direction) => center.neighbor(direction))]) {
    const candidate = state.world.tiles[hex.key];
    if (candidate?.ownerId === null && candidate.territoryCityId === null && candidate.cityId === null && candidate.terrainId !== 'void') {
      claimTileForCity(state, city, candidate); claimedTileKeys.push(candidate.key);
    }
  }
  tile.cityId = city.id;
  delete state.units[settlerUnitId];
  kingdom.unitIds = kingdom.unitIds.filter(id => id !== settlerUnitId);
  party.unitIds = party.unitIds.filter(id => id !== settlerUnitId);
  party.formation = Object.fromEntries(Object.entries(party.formation).filter(([, id]) => id !== settlerUnitId));
  party.guardOrders = Object.fromEntries(Object.entries(party.guardOrders).filter(([id, order]) => id !== settlerUnitId && order.targetUnitId !== settlerUnitId));
  if (!party.unitIds.length) delete state.parties[party.id];
  else {
    if (party.leaderUnitId === settlerUnitId) {
      const successor = party.unitIds.map(id => state.units[id]).filter(isActiveUnit).sort((a, b) => b.commandContribution - a.commandContribution || a.id.localeCompare(b.id))[0];
      party.leaderUnitId = successor?.id ?? party.unitIds[0];
      events.push({ type: 'PartyLeaderChanged', partyId, previousLeaderUnitId: settlerUnitId, leaderUnitId: party.leaderUnitId });
    }
    party.movementRemaining = 0; party.attacksRemaining = 0; party.activationState = 'ended';
    if (!hasActiveUnits(state, party)) { party.status = 'defeated'; party.reactionCharges = 0; }
  }
  events.push({ type: 'CityFounded', cityId: city.id, ownerId: playerId, partyId, settlerUnitId, tileKey: tile.key, claimedTileKeys });
  updateDerivedCapabilities(kingdom, state);
  return { ok: true };
}
