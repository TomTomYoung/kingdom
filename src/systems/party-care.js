import { RULESET } from '../core/ruleset.js';
import { hasPartyRecovery, isActiveUnit, hasActiveUnits, occupiesMapTile } from '../models/party.js';
import { isCityDefended } from '../models/city-defense.js';
import { Hex } from '../world/hex.js';

const reject = reason => ({ ok: false, reason });
const wounded = (state, party) => party.unitIds.map(id => state.units[id]).filter(unit => isActiveUnit(unit) && unit.currentHp < unit.maxHp);
export const casualtyIds = (state, party) => party.unitIds.filter(id => state.units[id].currentHp === 0);

// Both orders require a safe, stationary activation. Recheck safety when a rest
// resolves: an enemy may have approached or captured the tile during its turn.
export function partyCareSafetyError(state, party) {
  const tile = state.world.tiles[party.location];
  if (!tile || tile.terrainId === 'void' || tile.ownerId !== null && tile.ownerId !== party.ownerId) return '休養・離脱は自国領または未所有の土地で行えます';
  const near = key => Hex.fromKey(party.location).distance(Hex.fromKey(key)) <= RULESET.partyRecovery.threatRange;
  if (Object.values(state.parties).some(other => other.ownerId !== party.ownerId && occupiesMapTile(other) && near(other.location) && other.unitIds.some(id => isActiveUnit(state.units[id]) && !RULESET.unitTypes[state.units[id].typeId].civilian))) return '敵軍が隣接しているため休養・離脱できません';
  if (Object.values(state.cities).some(city => city.ownerId !== party.ownerId && isCityDefended(state, city) && near(city.centerHex))) return '防御が残る敵都市の隣では休養・離脱できません';
  return null;
}

function ready(state, playerId, partyId) {
  if (!hasPartyRecovery(state)) return reject('この旧対局には休養・戦闘不能者の離脱がありません。新規開始で利用できます');
  if (state.gameResult || state.phase !== 'PLAYER_ACTION' || state.lastProcessedTurn !== state.currentTurn || state.activePlayerId !== playerId) return reject('現在の手番ではありません');
  const party = Object.hasOwn(state.parties, partyId) && state.parties[partyId];
  if (!party || party.ownerId !== playerId || !occupiesMapTile(party) || !hasActiveUnits(state, party)) return reject('自国の生存者がいる活動部隊を選択してください');
  if (party.activationState !== 'ready' || party.hasMoved || party.hasAttacked || party.movementRemaining !== party.movementMaximum || party.attacksRemaining !== party.attacksMaximum || party.restOrder) return reject('休養・離脱には移動・攻撃前の未使用の行動が必要です');
  const reason = partyCareSafetyError(state, party);
  return reason ? reject(reason) : { ok: true };
}

export function previewPartyRest(state, playerId, partyId) {
  const check = ready(state, playerId, partyId); if (!check.ok) return check;
  const party = state.parties[partyId], units = wounded(state, party);
  if (!units.length) return reject('回復できる負傷者がいません。HP0のUnitは回復しません');
  const city = state.cities[state.world.tiles[party.location].cityId];
  const amount = city?.ownerId === playerId ? RULESET.partyRecovery.cityHp : RULESET.partyRecovery.fieldHp;
  return { ok: true, amount, cityId: city?.ownerId === playerId ? city.id : null,
    recovery: units.map(unit => ({ unitId: unit.id, hp: Math.min(amount, unit.maxHp - unit.currentHp), remainingHp: Math.min(unit.maxHp, unit.currentHp + amount) })) };
}

export function validateRemoveCasualties(state, playerId, partyId) {
  const check = ready(state, playerId, partyId); if (!check.ok) return check;
  const unitIds = casualtyIds(state, state.parties[partyId]);
  return unitIds.length ? { ok: true, unitIds } : reject('離脱させる戦闘不能者がいません');
}

function endActions(party) {
  party.movementRemaining = 0; party.attacksRemaining = 0; party.reactionCharges = 0; party.activationState = 'ended';
}

export function resolvePartyRest(state, playerId, partyId, events) {
  const check = previewPartyRest(state, playerId, partyId); if (!check.ok) return check;
  const party = state.parties[partyId];
  party.restOrder = { turn: state.currentTurn, location: party.location }; endActions(party);
  events.push({ type: 'PartyRestStarted', partyId, location: party.location, recovery: check.recovery });
  return { ok: true };
}

export function cancelPartyRest(party, events, reason) {
  if (!party.restOrder) return;
  delete party.restOrder;
  events.push({ type: 'PartyRestCancelled', partyId: party.id, reason });
}

export function processPartyRest(state, party, events) {
  if (!hasPartyRecovery(state) || !party.restOrder) return;
  const order = party.restOrder;
  if (order.turn >= state.currentTurn) return;
  const reason = order.turn !== state.currentTurn - 1 || order.location !== party.location || !occupiesMapTile(party) || !hasActiveUnits(state, party)
    ? '部隊の状態が変わったため' : partyCareSafetyError(state, party);
  if (reason) { cancelPartyRest(party, events, reason); return; }
  const city = state.cities[state.world.tiles[party.location].cityId];
  const amount = city?.ownerId === party.ownerId ? RULESET.partyRecovery.cityHp : RULESET.partyRecovery.fieldHp;
  const recovery = wounded(state, party).map(unit => {
    const hp = Math.min(amount, unit.maxHp - unit.currentHp);
    unit.currentHp += hp; unit.hp = unit.currentHp;
    return { unitId: unit.id, hp, remainingHp: unit.currentHp };
  });
  delete party.restOrder;
  events.push({ type: 'PartyRestCompleted', partyId: party.id, recovery });
}

export function resolveRemoveCasualties(state, playerId, partyId, events) {
  const check = validateRemoveCasualties(state, playerId, partyId); if (!check.ok) return check;
  const party = state.parties[partyId], removed = new Set(check.unitIds);
  const formation = Object.fromEntries(Object.entries(party.formation).filter(([, id]) => removed.has(id)));
  party.unitIds = party.unitIds.filter(id => !removed.has(id));
  party.formation = Object.fromEntries(Object.entries(party.formation).filter(([, id]) => !removed.has(id)));
  party.guardOrders = Object.fromEntries(Object.entries(party.guardOrders).filter(([id, order]) => !removed.has(id) && !removed.has(order.targetUnitId)));
  for (const id of removed) state.units[id].partyId = null;
  if (!isActiveUnit(state.units[party.leaderUnitId])) {
    const previousLeaderUnitId = party.leaderUnitId;
    party.leaderUnitId = party.unitIds.map(id => state.units[id]).filter(isActiveUnit).sort((a, b) => b.commandContribution - a.commandContribution || a.id.localeCompare(b.id))[0].id;
    events.push({ type: 'PartyLeaderChanged', partyId, previousLeaderUnitId, leaderUnitId: party.leaderUnitId });
  }
  endActions(party);
  events.push({ type: 'PartyCasualtiesRemoved', partyId, unitIds: check.unitIds, location: party.location, formation });
  return { ok: true };
}
