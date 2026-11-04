// Prototype balance values, not the final class/spell catalogue.
export const ABILITIES = Object.freeze({
  heal: Object.freeze({
    id: 'heal', name: '治癒', unitTypes: Object.freeze(['warrior']),
    movementCost: 1, attackCost: 1, manaCost: 4, goldCost: 0, chargeCost: 1,
    initialCharges: 3, usesPerRound: 1, endsActivation: true,
    targetRule: 'own-party-active-unit', effect: 'heal', amount: 30,
  }),
});
export const hasActiveAbilities = state => state.activeAbilityVersion === 1;
export const abilityDefinition = id => Object.hasOwn(ABILITIES, id) ? ABILITIES[id] : null;

// Only new scenario setup and newly completed units call this. Loading never
// teaches an ability or replenishes a spent charge.
export function initializeUnitAbilities(state, unit) {
  if (!hasActiveAbilities(state)) return;
  for (const ability of Object.values(ABILITIES)) {
    if (!ability.unitTypes.includes(unit.typeId)) continue;
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
