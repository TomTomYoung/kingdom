import { RULESET } from '../core/ruleset.js';

// Mitigation is selected by trusted attack definitions, never a command payload.
// Allocation and Guard capacity are resolved before this per-recipient step.
export const physicalDamage = (amount, unit) => Math.max(1, amount - (unit.armor ?? 0));
export const magicDamage = (amount, unit) => Math.max(1, Math.round(amount * Math.exp(-RULESET.combat.strengthExponent * unit.resistance)));
