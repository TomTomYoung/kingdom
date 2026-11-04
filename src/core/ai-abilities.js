import { ABILITIES, abilityAvailable, hasActiveAbilities } from './abilities.js';
import { useAbility } from './commands.js';
import { previewAbility, abilityTargets } from '../systems/ability-system.js';

// Called after capture, city fire, casualty removal and safe rest. Prefer an
// injured Unit at half HP or below; stable IDs break ties without reading RNG.
export function chooseAbilityCommand(state, playerId, commandId) {
  if (!hasActiveAbilities(state)) return null;
  const candidates = [];
  for (const party of Object.values(state.parties).filter(p => p.ownerId === playerId)) {
    for (const casterUnitId of party.unitIds) for (const abilityId of Object.keys(ABILITIES).filter(id => ABILITIES[id].effect === 'heal')) for (const targetUnitId of party.unitIds) {
      const target = state.units[targetUnitId];
      if (target.currentHp > target.maxHp / 2) continue;
      const payload = { partyId: party.id, casterUnitId, abilityId, targetUnitId }, preview = previewAbility(state, playerId, payload);
      if (preview.ok) candidates.push({ ...payload, recovery: preview.recoveredHp, ratio: target.currentHp / target.maxHp });
    }
  }
  candidates.sort((a, b) => a.ratio - b.ratio || b.recovery - a.recovery || a.partyId.localeCompare(b.partyId)
    || a.targetUnitId.localeCompare(b.targetUnitId) || a.casterUnitId.localeCompare(b.casterUnitId) || a.abilityId.localeCompare(b.abilityId));
  if (!candidates.length) {
    const spells = [];
    for (const party of Object.values(state.parties).filter(p => p.ownerId === playerId)) {
      for (const casterUnitId of party.unitIds) for (const d of Object.values(ABILITIES).filter(d => d.effect === 'magic-damage' && abilityAvailable(state, d.id))) {
        if (!Object.hasOwn(state.units[casterUnitId].abilityStates, d.id)) continue;
        for (const target of abilityTargets(state, party, d)) {
          const payload = { partyId: party.id, casterUnitId, abilityId: d.id, targetUnitId: target.id }, preview = previewAbility(state, playerId, payload);
          if (preview.ok && preview.totalDamage.max > 0) spells.push({ ...payload, score: preview.totalDamage.max * preview.hitChance });
        }
      }
    }
    spells.sort((a, b) => b.score - a.score || a.partyId.localeCompare(b.partyId) || a.targetUnitId.localeCompare(b.targetUnitId) || a.casterUnitId.localeCompare(b.casterUnitId));
    candidates.push(...spells);
  }
  const choice = candidates[0];
  return choice ? useAbility(playerId, state.currentTurn, choice.partyId, choice.casterUnitId, choice.abilityId, choice.targetUnitId, commandId) : null;
}
