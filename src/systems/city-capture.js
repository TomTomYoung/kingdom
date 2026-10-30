import { hasCityBombardment, hasCityRetaliation, hasCityDefense, isCityDefended } from '../models/city-defense.js';
import { RULESET } from '../core/ruleset.js';
import { occupiesMapTile } from '../models/party.js';
import { participatingUnits } from './combat-attacks.js';
import { emptyYields } from './yield-system.js';
import { updateDerivedCapabilities } from '../models/kingdom.js';

export const hasCityObjective = state => state.scenarioObjective?.type === 'control-cities';
const reject = reason => ({ ok: false, reason });

export function validateCaptureCity(state, playerId, partyId, cityId) {
  if (!hasCityObjective(state)) return reject('都市占領は都市争奪戦で行えます');
  if (state.gameResult || state.phase !== 'PLAYER_ACTION' || state.activePlayerId !== playerId) return reject('現在は占領を実行できません');
  const city = Object.hasOwn(state.cities, cityId) && state.cities[cityId];
  const party = Object.hasOwn(state.parties, partyId) && state.parties[partyId];
  if (!city || city.ownerId === playerId) return reject('敵国の都市を選択してください');
  if (!party || party.ownerId !== playerId || party.status !== 'active' || !participatingUnits(state, party).length) return reject('生存する軍事Unitを含む自国部隊が必要です');
  if (party.activationState !== 'ready' || party.attacksRemaining < 1) return reject('占領には未終了の行動と攻撃回数1が必要です');
  if (isCityDefended(state, city)) return reject('都市占領には城壁と都市耐久を0にする必要があります');
  if (party.location !== city.centerHex) return reject('敵都市の中心へ部隊を移動してください');
  if (Object.values(state.parties).some(other => other.id !== party.id && occupiesMapTile(other) && other.location === city.centerHex)) return reject('都市中心を他の活動部隊が占有しています');
  return { ok: true };
}

export function resolveCaptureCity(state, playerId, partyId, cityId, events) {
  const validity = validateCaptureCity(state, playerId, partyId, cityId); if (!validity.ok) return validity;
  const city = state.cities[cityId], party = state.parties[partyId], previousOwnerId = city.ownerId;
  state.kingdoms[previousOwnerId].cityIds = state.kingdoms[previousOwnerId].cityIds.filter(id => id !== cityId);
  state.kingdoms[playerId].cityIds.push(cityId); city.ownerId = playerId;
  if (hasCityDefense(state)) city.defense = { hp: RULESET.cityDefense.capturedHp, wallHp: 0, lastDamagedTurn: state.currentTurn };
  if (hasCityRetaliation(state)) city.defense.counterattacksRemaining = 0;
  if (hasCityBombardment(state)) city.defense.bombardmentsRemaining = 0;
  const territoryKeys = [];
  for (const tile of Object.values(state.world.tiles)) if (tile.territoryCityId === cityId) { tile.ownerId = playerId; territoryKeys.push(tile.key); }
  // Capturing neither collects income nor refunds/reuses the old owner's orders.
  city.production = { currentItemId: null, queue: [], progressByItem: {} };
  city.workedTiles = []; city.yieldSummary = emptyYields();
  city.lastYieldBreakdown = { tiles: [], buildings: [], center: {}, modifiers: {}, total: emptyYields() };
  party.movementRemaining = 0; party.attacksRemaining = 0; party.reactionCharges = 0; party.activationState = 'ended'; party.hasAttacked = true;
  for (const owner of [previousOwnerId, playerId]) updateDerivedCapabilities(state.kingdoms[owner], state);
  events.push({ type: 'CityCaptured', cityId, partyId, previousOwnerId, ownerId: playerId, territoryKeys });
  return { ok: true };
}
