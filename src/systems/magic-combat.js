import { RULESET } from '../core/ruleset.js';
import { directHitContext } from './combat-attacks.js';
import { allocateSingleDamage } from './damage-grid.js';
import { applyPartyDamage, boundedDamage, rollDamage, rollHit } from './combat-system.js';
import { magicDamage } from './damage-mitigation.js';

const power = ({ caster, party }) => caster.magicStrength * (0.5 + party.cohesion / 200);
const aim = (state, c) => directHitContext(state, c.defender, c.target, c.caster.accuracy);

// Call only after ability validation. Costs and activation belong to the ability
// resolver; this leaf handles one projectile through the common damage grid.
export function resolveMagicStrike(state, checked, events, damageRoll = rollDamage, hitRoll = rollHit) {
  const { party, caster, target, defender, definition: d } = checked, targeting = aim(state, checked);
  const metadata = { attackerPartyId: party.id, defenderPartyId: defender.id, casterUnitId: caster.id,
    attackType: 'magic', attackId: d.id, abilityId: d.id, attackName: d.name, counter: false };
  const rawDamage = damageRoll(state, power(checked), 0), hit = hitRoll(state, targeting.hitChance);
  for (const taunter of targeting.taunts) events.push({ type: 'CombatTaunt', ...metadata, tauntUnitId: taunter.id, targetUnitId: target.id });
  let primary = target;
  if (!hit) {
    events.push({ type: 'CombatMiss', ...metadata, targetUnitId: target.id, hitChance: targeting.hitChance, failure: 'projectile' });
    if (!targeting.cover) return { rawDamage, damage: 0, hit };
    primary = targeting.cover;
    events.push({ type: 'CombatCover', ...metadata, coverUnitId: primary.id, targetUnitId: target.id });
  }
  const allocations = new Map();
  for (const part of allocateSingleDamage(state, defender, primary, rawDamage, events)) {
    if (part.amount > 0) allocations.set(part.unit.id, { unit: part.unit, amount: part.amount, roles: new Set([part.role]) });
  }
  const result = applyPartyDamage(state, defender, primary, allocations, rawDamage, events, metadata, magicDamage);
  return { rawDamage, damage: result.damage, hit };
}

// Enumerate feasible integer raw damage and aim outcomes without touching RNG.
// Each recipient's own resistance is applied after Guard/Intercept allocation.
export function previewMagicStrike(state, checked) {
  const targeting = aim(state, checked), d = RULESET.combat;
  const minimum = boundedDamage(power(checked), 0, d.randomMinimum), maximum = boundedDamage(power(checked), 0, d.randomMaximum);
  const ids = checked.defender.unitIds, damage = Object.fromEntries(ids.map(id => [id, { min: Infinity, max: 0 }]));
  const guards = new Set(), intercepts = new Set(), totalDamage = { min: Infinity, max: 0 };
  const hits = targeting.hitChance <= 0 ? [false] : targeting.hitChance >= 1 ? [true] : [false, true];
  for (let raw = minimum; raw <= maximum; raw++) for (const hit of hits) {
    const clone = { units: structuredClone(Object.fromEntries(ids.map(id => [id, state.units[id]]))) };
    const defender = structuredClone(checked.defender), events = [];
    const result = resolveMagicStrike(clone, { ...checked, defender, target: clone.units[checked.target.id] }, events, () => raw, () => hit);
    totalDamage.min = Math.min(totalDamage.min, result.damage); totalDamage.max = Math.max(totalDamage.max, result.damage);
    for (const event of events) {
      if (event.type === 'CombatGuard') guards.add(event.guardUnitId);
      if (event.type === 'CombatIntercept') intercepts.add(event.guardUnitId);
    }
    for (const id of ids) {
      const lost = state.units[id].currentHp - clone.units[id].currentHp;
      damage[id].min = Math.min(damage[id].min, lost); damage[id].max = Math.max(damage[id].max, lost);
    }
  }
  return { damage, totalDamage, hitChance: targeting.hitChance, guards: [...guards], intercepts: [...intercepts],
    covers: targeting.cover ? [targeting.cover.id] : [], taunts: targeting.taunts.map(u => u.id),
    primaryTargetId: checked.target.id, counter: 'none', rawDamage: { min: minimum, max: maximum } };
}
