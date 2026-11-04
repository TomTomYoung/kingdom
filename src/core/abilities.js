// Prototype balance values, not the final class/spell catalogue.
export const ABILITIES = Object.freeze({
  heal: Object.freeze({
    id: 'heal', name: '治癒', minimumVersion: 1, unitTypes: Object.freeze(['warrior']),
    movementCost: 1, attackCost: 1, manaCost: 4, goldCost: 0, chargeCost: 1,
    initialCharges: 3, usesPerRound: 1, endsActivation: true,
    targetRule: 'own-party-active-unit', effect: 'heal', amount: 30,
  }),
  'arcane-bolt': Object.freeze({
    id: 'arcane-bolt', name: '魔弾', minimumVersion: 2, unitTypes: Object.freeze(['archer']),
    movementCost: 1, attackCost: 1, manaCost: 6, goldCost: 0, chargeCost: 1,
    initialCharges: 3, usesPerRound: 1, endsActivation: true,
    targetRule: 'enemy-party-active-unit', effect: 'magic-damage', range: 2, initialMagicStrength: 18,
  }),
  'arcane-wave': Object.freeze({
    id: 'arcane-wave', name: '魔力波', minimumVersion: 3, unitTypes: Object.freeze(['archer']),
    movementCost: 1, attackCost: 1, manaCost: 10, goldCost: 0, chargeCost: 1,
    initialCharges: 2, usesPerRound: 1, endsActivation: true,
    targetRule: 'enemy-party-row', effect: 'magic-damage', pattern: 'row', range: 2, multiplier: 0.6,
  }),
});
export const hasActiveAbilities = state => [1, 2, 3].includes(state.activeAbilityVersion);
export const abilityDefinition = id => Object.hasOwn(ABILITIES, id) ? ABILITIES[id] : null;
export const abilityAvailable = (state, id) => hasActiveAbilities(state) && !!abilityDefinition(id) && state.activeAbilityVersion >= ABILITIES[id].minimumVersion;

// Only new scenario setup and newly completed units call this. Loading never
// teaches an ability or replenishes a spent charge.
export function initializeUnitAbilities(state, unit) {
  if (!hasActiveAbilities(state)) return;
  for (const ability of Object.values(ABILITIES)) {
    if (!abilityAvailable(state, ability.id) || !ability.unitTypes.includes(unit.typeId)) continue;
    if (ability.initialMagicStrength !== undefined) unit.magicStrength = ability.initialMagicStrength;
    unit.abilityStates[ability.id] = { usesRemaining: ability.usesPerRound };
    unit.charges[ability.id] = ability.initialCharges;
  }
}

export function rechargeAbilities(state) {
  if (!hasActiveAbilities(state)) return;
  for (const unit of Object.values(state.units)) {
    for (const [id, abilityState] of Object.entries(unit.abilityStates)) {
      abilityState.usesRemaining = ABILITIES[id].usesPerRound;
    }
  }
}
