import { createParty, FORMATION_SLOTS, hasActiveUnits, isActiveUnit, occupiesMapTile } from '../models/party.js';
import { Hex } from '../world/hex.js';
import { terrainMovementCost } from './movement-system.js';

const reject = reason => ({ ok: false, reason });
const ownedParty = (state, playerId, id) => Object.hasOwn(state.parties, id) && state.parties[id].ownerId === playerId ? state.parties[id] : null;
const unitSelection = ids => Array.isArray(ids) && ids.length > 0 && ids.every(id => typeof id === 'string' && id.length > 0) && new Set(ids).size === ids.length;
function ready(state, playerId, party) {
  if (state.gameResult || state.phase !== 'PLAYER_ACTION' || state.activePlayerId !== playerId) return reject('現在の手番ではありません');
  if (!party || party.status !== 'active' || !hasActiveUnits(state, party)) return reject('自国の活動中の部隊を選択してください');
  if (party.activationState !== 'ready' || party.movementRemaining < 1) return reject('再編には関係する全部隊の未終了の行動と移動力1以上が必要です');
  return { ok: true };
}
function step(state, party, location) {
  const tile = Object.hasOwn(state.world.tiles, location) && state.world.tiles[location];
  if (!tile || tile.terrainId === 'void') return reject('移動できる隣接セルを指定してください');
  if (Hex.fromKey(party.location).distance(Hex.fromKey(location)) !== 1) return reject('隣接するセルを指定してください');
  const cost = terrainMovementCost(tile.terrainId);
  if (party.movementRemaining < cost) return reject('移動先の地形に必要な移動力が不足しています');
  return { ok: true, cost };
}

export function validateReinforceParty(state, playerId, partyId, unitIds) {
  const party = ownedParty(state, playerId, partyId), check = ready(state, playerId, party); if (!check.ok) return check;
  if (!unitSelection(unitIds)) return reject('補充するUnitを重複なく選択してください');
  if (party.unitIds.length + unitIds.length > 5) return reject('部隊は戦闘不能者を含め最大5体です');
  if (unitIds.some(id => !Object.hasOwn(state.units, id) || !isActiveUnit(state.units[id]) || state.units[id].ownerId !== playerId || state.units[id].partyId !== null || state.units[id].location !== party.location)) return reject('同じセルの自国の活動中の待機Unitだけを補充できます');
  return { ok: true };
}

export function validateMergeParties(state, playerId, sourcePartyId, targetPartyId) {
  if (sourcePartyId === targetPartyId) return reject('別の合流先部隊を選択してください');
  const source = ownedParty(state, playerId, sourcePartyId), target = ownedParty(state, playerId, targetPartyId);
  for (const party of [source, target]) { const check = ready(state, playerId, party); if (!check.ok) return check; }
  if (source.unitIds.length + target.unitIds.length > 5) return reject('合流後の部隊は戦闘不能者を含め最大5体です');
  return step(state, source, target.location);
}

export function validateSplitParty(state, playerId, partyId, unitIds, location) {
  const party = ownedParty(state, playerId, partyId), check = ready(state, playerId, party); if (!check.ok) return check;
  if (!unitSelection(unitIds) || unitIds.length >= party.unitIds.length || unitIds.some(id => !party.unitIds.includes(id))) return reject('分割する部隊内のUnitを一部だけ、重複なく選択してください');
  const live = ids => ids.some(id => isActiveUnit(state.units[id]));
  if (!live(unitIds) || !live(party.unitIds.filter(id => !unitIds.includes(id)))) return reject('分割後の両部隊に活動中のUnitが必要です');
  const movement = step(state, party, location); if (!movement.ok) return movement;
  if (Object.values(state.parties).some(other => occupiesMapTile(other) && other.location === location)) return reject('分割先は他の活動部隊が占有しています');
  const sequence = state.nextIds.party;
  if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence >= Number.MAX_SAFE_INTEGER || Object.hasOwn(state.parties, `party-${sequence}`)) return reject('部隊IDを発行できません');
  return { ok: true, cost: movement.cost, newPartyId: `party-${sequence}` };
}

// Reorganization consumes the whole activation and reaction. A new identity or
// a merge must never refresh attacks, movement, guards, HP, morale or cohesion.
function endActions(party) { party.movementRemaining = 0; party.attacksRemaining = 0; party.reactionCharges = 0; party.activationState = 'ended'; }
function assignSlots(party, unitIds, preferred = {}) {
  for (const id of unitIds) {
    const original = FORMATION_SLOTS.find(slot => preferred[slot] === id);
    const slot = original && !party.formation[original] ? original : FORMATION_SLOTS.find(slot => !party.formation[slot]);
    party.formation[slot] = id;
  }
}
function keepMembers(party) {
  party.formation = Object.fromEntries(Object.entries(party.formation).filter(([, id]) => party.unitIds.includes(id)));
  party.guardOrders = Object.fromEntries(Object.entries(party.guardOrders).filter(([id, order]) => party.unitIds.includes(id) && party.unitIds.includes(order.targetUnitId)));
}
function repairLeader(state, party, events) {
  if (party.unitIds.includes(party.leaderUnitId) && isActiveUnit(state.units[party.leaderUnitId])) return;
  const previousLeaderUnitId = party.leaderUnitId;
  party.leaderUnitId = party.unitIds.map(id => state.units[id]).filter(isActiveUnit).sort((a, b) => b.commandContribution - a.commandContribution || a.id.localeCompare(b.id))[0].id;
  if (previousLeaderUnitId !== party.leaderUnitId) events.push({ type: 'PartyLeaderChanged', partyId: party.id, previousLeaderUnitId, leaderUnitId: party.leaderUnitId });
}

export function resolveReinforceParty(state, playerId, partyId, unitIds, events) {
  const check = validateReinforceParty(state, playerId, partyId, unitIds); if (!check.ok) return check;
  const party = state.parties[partyId];
  assignSlots(party, unitIds); party.unitIds.push(...unitIds);
  unitIds.forEach(id => { state.units[id].partyId = party.id; });
  repairLeader(state, party, events); endActions(party);
  events.push({ type: 'PartyReinforced', partyId, unitIds: [...unitIds], location: party.location });
  return { ok: true };
}

export function resolveMergeParties(state, playerId, sourcePartyId, targetPartyId, events) {
  const check = validateMergeParties(state, playerId, sourcePartyId, targetPartyId); if (!check.ok) return check;
  const source = state.parties[sourcePartyId], target = state.parties[targetPartyId];
  assignSlots(target, source.unitIds, source.formation); target.unitIds.push(...source.unitIds);
  target.guardOrders = { ...target.guardOrders, ...source.guardOrders };
  for (const id of source.unitIds) { state.units[id].partyId = target.id; state.units[id].location = target.location; }
  for (const key of ['morale', 'cohesion', 'movementMaximum', 'attacksMaximum']) target[key] = Math.min(target[key], source[key]);
  target.hasMoved = true; target.hasAttacked ||= source.hasAttacked;
  repairLeader(state, target, events); endActions(target); delete state.parties[source.id];
  events.push({ type: 'PartiesMerged', sourcePartyId, targetPartyId, unitIds: [...source.unitIds], location: target.location, cost: check.cost });
  return { ok: true };
}

export function resolveSplitParty(state, playerId, partyId, unitIds, location, events) {
  const check = validateSplitParty(state, playerId, partyId, unitIds, location); if (!check.ok) return check;
  const source = state.parties[partyId], child = createParty(check.newPartyId, playerId, unitIds, location);
  child.formation = Object.fromEntries(Object.entries(source.formation).filter(([, id]) => unitIds.includes(id)));
  child.guardOrders = Object.fromEntries(Object.entries(source.guardOrders).filter(([id, order]) => unitIds.includes(id) && unitIds.includes(order.targetUnitId)));
  for (const key of ['morale', 'cohesion', 'movementMaximum', 'attacksMaximum', 'hasAttacked']) child[key] = source[key];
  child.hasMoved = true; source.unitIds = source.unitIds.filter(id => !unitIds.includes(id)); keepMembers(source);
  for (const id of unitIds) { state.units[id].partyId = child.id; state.units[id].location = location; }
  repairLeader(state, source, events); repairLeader(state, child, events); endActions(source); endActions(child);
  state.parties[child.id] = child; state.nextIds.party++;
  events.push({ type: 'PartySplit', partyId, newPartyId: child.id, unitIds: [...unitIds], location, cost: check.cost });
  return { ok: true };
}
