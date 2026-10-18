import { RULESET } from '../core/ruleset.js';

export function createUnit(id, ownerId, typeId, location) {
  const definition = RULESET.unitTypes[typeId] ?? RULESET.unitTypes.warrior;
  return {
    id, ownerId, typeId, location, partyId: null,
    scaleClass: definition.scaleClass, maxHp: definition.maxHp, currentHp: definition.maxHp, hp: definition.maxHp,
    meleeStrength: definition.meleeStrength, rangedStrength: definition.rangedStrength, magicStrength: definition.magicStrength,
    defenseStrength: definition.defenseStrength, resistance: definition.resistance, armor: definition.armor, range: definition.range,
    guardRate: definition.guardRate, guardRange: definition.guardRange ?? 1, guardCapacityMax: definition.guardCapacity, guardCapacityRemaining: definition.guardCapacity,
    moraleContribution: definition.moraleContribution, commandContribution: definition.commandContribution,
    loyalty: 100, supportUpkeep: 0, movement: 2, attacksRemaining: 1, charges: {}, abilityStates: {}, statusEffects: [], status: 'active',
  };
}
