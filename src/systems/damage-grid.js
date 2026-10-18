import { isActiveUnit } from '../models/party.js';

const rows = ['front', 'middle', 'rear'], columns = ['left', 'center', 'right'];
const coordinate = (slot) => { const [row, column] = slot.split('-'); return [rows.indexOf(row), columns.indexOf(column)]; };
export function slotDistance(party, firstId, secondId) {
  const slotOf = (id) => Object.keys(party.formation).find((slot) => party.formation[slot] === id);
  const first = slotOf(firstId), second = slotOf(secondId); if (!first || !second) return Infinity;
  const a = coordinate(first), b = coordinate(second); return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
}

// Empty slots expose the next living unit in each lane. Normal attacks prefer
// the frontmost depth, then the center lane; formation never automatically moves.
export function exposedUnits(state, party, vector = 'front') {
  const lanes = ['left', 'right'].includes(vector) ? rows.map((row) => columns.map((column) => `${row}-${column}`)) : columns.map((column) => rows.map((row) => `${row}-${column}`));
  if (vector === 'rear' || vector === 'right') lanes.forEach((lane) => lane.reverse());
  return lanes.map((lane, laneIndex) => {
    const depth = lane.findIndex((slot) => isActiveUnit(state.units[party.formation[slot]]));
    return depth < 0 ? null : { unit: state.units[party.formation[lane[depth]]], slot: lane[depth], depth, laneIndex };
  }).filter(Boolean).sort((a, b) => a.depth - b.depth || Math.abs(a.laneIndex - 1) - Math.abs(b.laneIndex - 1) || a.laneIndex - b.laneIndex);
}

export function validateGuardOrder(state, party, guardId, targetId, mode) {
  if (!['off', 'share', 'intercept'].includes(mode)) return '護衛方式が不正です';
  if (!party.unitIds.includes(guardId)) return 'この部隊の護衛Unitを選んでください';
  if (mode === 'off') return null;
  if (!party.unitIds.includes(targetId) || targetId === guardId) return '同じ部隊の別Unitを護衛対象にしてください';
  const guard = state.units[guardId], target = state.units[targetId];
  if (!isActiveUnit(guard) || !isActiveUnit(target)) return '活動中のUnitだけを護衛に設定できます';
  if (!(guard.guardRate > 0) || !(guard.guardCapacityMax > 0)) return 'このUnitには護衛能力がありません';
  if (slotDistance(party, guardId, targetId) > (guard.guardRange ?? 1)) return '護衛範囲外です。配置を近づけてください';
  return null;
}

export function allocateSingleDamage(state, party, primary, incoming, events) {
  const orders = Object.entries(party.guardOrders ?? {}).filter(([id, order]) => {
    const guard = state.units[id];
    if (order.targetUnitId !== primary.id || validateGuardOrder(state, party, id, primary.id, order.mode)) return false;
    if (guard.statusEffects.some((effect) => ['stun', 'break', 'fear'].includes(String(typeof effect === 'string' ? effect : effect?.type ?? effect?.id).toLowerCase()))) return false;
    return order.mode === 'intercept' ? party.reactionCharges > 0 : order.mode === 'share' && guard.guardCapacityRemaining > 0;
  }).sort(([a, x], [b, y]) => Number(y.mode === 'intercept') - Number(x.mode === 'intercept') || slotDistance(party, a, primary.id) - slotDistance(party, b, primary.id) || a.localeCompare(b));
  if (!orders.length) return [{ unit: primary, amount: incoming, role: 'primary' }];
  const [guardId, order] = orders[0], guard = state.units[guardId];
  if (order.mode === 'intercept') {
    party.reactionCharges -= 1;
    events.push({ type: 'CombatIntercept', partyId: party.id, guardUnitId: guardId, targetUnitId: primary.id, rawDamage: incoming, reactionCharges: party.reactionCharges });
    return [{ unit: guard, amount: incoming, role: 'intercept' }];
  }
  const shared = Math.min(Math.floor(incoming * Math.min(0.7, guard.guardRate)), Math.floor(guard.guardCapacityRemaining));
  if (!shared) return [{ unit: primary, amount: incoming, role: 'primary' }];
  guard.guardCapacityRemaining -= shared;
  events.push({ type: 'CombatGuard', partyId: party.id, guardUnitId: guardId, targetUnitId: primary.id, amount: shared, capacityRemaining: guard.guardCapacityRemaining });
  return [{ unit: primary, amount: incoming - shared, role: 'primary' }, { unit: guard, amount: shared, role: 'guard' }];
}
