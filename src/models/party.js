export const FORMATION_ROWS = Object.freeze(['front', 'middle', 'rear']);
export const FORMATION_COLUMNS = Object.freeze(['left', 'center', 'right']);
export const FORMATION_SLOTS = Object.freeze(FORMATION_ROWS.flatMap((row) => FORMATION_COLUMNS.map((column) => `${row}-${column}`)));

export function createParty(id, ownerId, unitIds, location, leaderUnitId = unitIds[0]) {
  return {
    id, ownerId, unitIds: [...unitIds], leaderUnitId, location,
    formation: Object.fromEntries(unitIds.map((unitId, index) => [FORMATION_SLOTS[index], unitId])),
    movementRemaining: 2, movementMaximum: 2, attacksRemaining: 1, attacksMaximum: 1,
    activationState: 'ready', hasMoved: false, hasAttacked: false, reactionCharges: 1,
    morale: 100, cohesion: 100, status: 'active',
  };
}

export function validateFormation(party, formation) {
  const entries = Object.entries(formation);
  if (entries.some(([slot]) => !FORMATION_SLOTS.includes(slot))) return '不明なFormation slotです';
  const assigned = entries.map(([, unitId]) => unitId);
  if (new Set(assigned).size !== assigned.length) return '同じUnitを複数のslotへ配置できません';
  if (assigned.length !== party.unitIds.length || assigned.some((unitId) => !party.unitIds.includes(unitId))) return 'Party内の全Unitを一度ずつ配置してください';
  return null;
}
