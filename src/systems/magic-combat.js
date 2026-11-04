import { FORMATION_COLUMNS, isActiveUnit } from '../models/party.js';
import { RULESET } from '../core/ruleset.js';
import { directHitContext } from './combat-attacks.js';
import { allocatePatternDamage } from './damage-grid.js';
import { applyPartyDamage, boundedDamage, rollDamage, rollHit } from './combat-system.js';
import { magicDamage } from './damage-mitigation.js';

const power = ({ caster, party }) => caster.magicStrength * (0.5 + party.cohesion / 200);
// A row spell is anchored to one living Unit. The selected Unit is primary;
// remaining row slots are fixed left-to-right before any Guard or HP changes.
export function magicTargeting(state, checked) {
  const { defender, target, caster, definition } = checked;
  const primarySlot = Object.keys(defender.formation).find(slot => defender.formation[slot] === target.id);
  if (definition.pattern !== 'row') return { ...directHitContext(state, defender, target, caster.accuracy),
    targets: [{ unit: target, slot: primarySlot }], slots: [primarySlot] };
  const row = primarySlot.split('-')[0];
  const slots = [primarySlot, ...FORMATION_COLUMNS.map(column => `${row}-${column}`).filter(slot => slot !== primarySlot)];
  const targets = slots.map(slot => ({ unit: state.units[defender.formation[slot]], slot })).filter(entry => isActiveUnit(entry.unit));
  return { row, slots, targets, hitChance: 1, cover: null, taunts: [] };
}

// Call only after ability validation. Costs and activation belong to the ability
// resolver; this leaf sends a fixed target pattern through the common damage grid.
export function resolveMagicStrike(state, checked, events, damageRoll = rollDamage, hitRoll = rollHit) {
  const { party, caster, target, defender, definition: d } = checked, targeting = magicTargeting(state, checked);
  const metadata = { attackerPartyId: party.id, defenderPartyId: defender.id, casterUnitId: caster.id,
    attackType: 'magic', attackId: d.id, abilityId: d.id, attackName: d.name, counter: false };
  const rawDamage = damageRoll(state, power(checked), 0), hit = d.pattern === 'row' || hitRoll(state, targeting.hitChance);
  for (const taunter of targeting.taunts) events.push({ type: 'CombatTaunt', ...metadata, tauntUnitId: taunter.id, targetUnitId: target.id });
  let targets = targeting.targets;
  if (!hit) {
    events.push({ type: 'CombatMiss', ...metadata, targetUnitId: target.id, hitChance: targeting.hitChance, failure: 'projectile' });
    if (!targeting.cover) return { rawDamage, damage: 0, hit };
    targets = [{ unit: targeting.cover }];
    events.push({ type: 'CombatCover', ...metadata, coverUnitId: targeting.cover.id, targetUnitId: target.id });
  }
  const allocations = allocatePatternDamage(state, defender, targets, rawDamage, events, d);
  const result = applyPartyDamage(state, defender, targets[0].unit, allocations, rawDamage, events, metadata, magicDamage);
  return { rawDamage, damage: result.damage, hit,
    ...(targeting.row ? { targetRow: targeting.row, targetUnitIds: targeting.targets.map(entry => entry.unit.id) } : {}) };
}

// Enumerate feasible integer raw damage and aim outcomes without touching RNG.
// Each recipient's own resistance is applied after Guard/Intercept allocation.
export function previewMagicStrike(state, checked) {
  const targeting = magicTargeting(state, checked), d = RULESET.combat;
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
    primaryTargetId: checked.target.id,
    ...(targeting.row ? { targetRow: targeting.row, targetSlots: targeting.slots, targetUnitIds: targeting.targets.map(entry => entry.unit.id) } : {}),
    counter: 'none', rawDamage: { min: minimum, max: maximum } };
}
