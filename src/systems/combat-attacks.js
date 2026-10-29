import { RULESET } from '../core/ruleset.js';
import { FORMATION_ROWS, FORMATION_COLUMNS, FORMATION_SLOTS, isActiveUnit } from '../models/party.js';
import { exposedUnits, isProtectionDisabled } from './damage-grid.js';

// Only trusted definitions decide damage weights and participating unit types.
export const ATTACK_DEFINITIONS = Object.freeze(Object.fromEntries([
  ['normal', { name: '通常攻撃', targeting: 'auto', multiplier: 1 }],
  ['aimed', { name: '狙い射ち', targeting: 'unit-or-slot', unitTypes: ['archer'], failure: 'projectile', multiplier: 1 }],
  ['precise', { name: '精密射撃', targeting: 'unit-or-slot', unitTypes: ['archer'], failure: 'precise', accuracyBonus: 0.05, multiplier: 1 }],
  ['row', { name: '横列への一斉射撃', targeting: 'row', unitTypes: ['archer'], multiplier: 0.5 }],
  ['column', { name: '縦列砲撃', targeting: 'column', unitTypes: ['ballista'], multiplier: 0.65 }],
  ['area', { name: '十字砲撃', targeting: 'area', unitTypes: ['ballista'], multiplier: 0.5 }],
  ['pierce', { name: '貫通射撃', targeting: 'pierce', unitTypes: ['ballista'], multiplier: 1, decay: 0.6 }],
].map(([id, definition]) => [id, Object.freeze({ id, ...definition, ...(definition.unitTypes ? { unitTypes: Object.freeze(definition.unitTypes) } : {}) })])));

const reject = (reason) => ({ ok: false, reason });
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const activeStrength = (unit, key) => isActiveUnit(unit) && !isProtectionDisabled(unit) ? unit[key] ?? 0 : 0;

export function attackDefinition(attackType, options = {}) {
  if (!record(options)) return reject('照準はオブジェクトで指定してください');
  const id = Object.hasOwn(options, 'attackId') ? options.attackId : 'normal';
  if (typeof id !== 'string' || !Object.hasOwn(ATTACK_DEFINITIONS, id)) return reject('不明な攻撃内容です');
  const definition = ATTACK_DEFINITIONS[id];
  if (id !== 'normal' && attackType !== 'ranged') return reject('この攻撃内容には遠隔攻撃を指定してください');
  const fields = { auto: [], 'unit-or-slot': ['targetUnitId', 'targetSlot'], row: ['targetRow'], column: ['targetColumn'], area: ['targetSlot'], pierce: ['targetColumn'] };
  if (Object.keys(options).some(key => key !== 'attackId' && !fields[definition.targeting].includes(key))) return reject('この攻撃内容では使えない照準項目があります');
  return { ok: true, definition };
}

export function participatingUnits(state, party, kind = 'melee', distance = 1, definition = ATTACK_DEFINITIONS.normal) {
  return party.unitIds.map(id => state.units[id]).filter(unit => isActiveUnit(unit)
    && (kind === 'defense' || !RULESET.unitTypes[unit.typeId]?.civilian)
    && (!definition.unitTypes || definition.unitTypes.includes(unit.typeId))
    && (kind !== 'ranged' || (unit.rangedStrength > 0 && unit.range >= distance)));
}

export function automaticTarget(state, party) {
  return exposedUnits(state, party).sort((a, b) => activeStrength(b.unit, 'tauntStrength') - activeStrength(a.unit, 'tauntStrength'))[0]?.unit ?? null;
}

// Target slots and recipients are fixed before any HP changes or Guard allocation.
export function resolveTargeting(state, attacker, defender, attackType, options = {}, distance = 1) {
  const checked = attackDefinition(attackType, options); if (!checked.ok) return checked;
  const { definition } = checked;
  const unitAt = (slot) => state.units[defender.formation[slot]];
  const livingAt = (slot) => isActiveUnit(unitAt(slot));
  let slots;
  switch (definition.targeting) {
    case 'auto': {
      const unit = automaticTarget(state, defender);
      slots = unit ? [Object.keys(defender.formation).find(slot => defender.formation[slot] === unit.id)] : [];
      break;
    }
    case 'unit-or-slot': {
      const byUnit = Object.hasOwn(options, 'targetUnitId'), bySlot = Object.hasOwn(options, 'targetSlot');
      if (byUnit === bySlot) return reject('Unitまたは配置枠のどちらか一つを照準に指定してください');
      const slot = byUnit ? (typeof options.targetUnitId === 'string' && defender.unitIds.includes(options.targetUnitId) ? Object.keys(defender.formation).find(key => defender.formation[key] === options.targetUnitId) : null) : options.targetSlot;
      if (!FORMATION_SLOTS.includes(slot) || !livingAt(slot)) return reject('照準には活動中の敵Unitを指定してください');
      slots = [slot]; break;
    }
    case 'row':
      if (!FORMATION_ROWS.includes(options.targetRow)) return reject('照準の行が不正です');
      slots = ['center', 'left', 'right'].map(column => `${options.targetRow}-${column}`); break;
    case 'column': case 'pierce':
      if (!FORMATION_COLUMNS.includes(options.targetColumn)) return reject('照準の列が不正です');
      slots = FORMATION_ROWS.map(row => `${row}-${options.targetColumn}`); break;
    case 'area': {
      if (!FORMATION_SLOTS.includes(options.targetSlot)) return reject('照準の枠が不正です');
      const [row, column] = options.targetSlot.split('-'), r = FORMATION_ROWS.indexOf(row), c = FORMATION_COLUMNS.indexOf(column);
      // The selected center is the primary when occupied; empty centers remain legal.
      slots = [options.targetSlot, ...FORMATION_SLOTS.filter(slot => {
        const [otherRow, otherColumn] = slot.split('-');
        return Math.abs(FORMATION_ROWS.indexOf(otherRow) - r) + Math.abs(FORMATION_COLUMNS.indexOf(otherColumn) - c) === 1;
      })]; break;
    }
    default: return reject('不明な照準です');
  }
  const targets = slots.filter(livingAt).map(slot => ({ slot, unit: unitAt(slot) }));
  if (!targets.length) return reject('攻撃範囲に活動中の敵Unitがいません');
  const primary = targets[0].unit;
  let cover = null, taunts = [], hitChance = 1;
  if (definition.targeting === 'unit-or-slot') {
    const [row, column] = targets[0].slot.split('-');
    cover = FORMATION_ROWS.slice(0, FORMATION_ROWS.indexOf(row)).map(r => unitAt(`${r}-${column}`)).find(unit => activeStrength(unit, 'coverPower') > 0) ?? null;
    const taunter = exposedUnits(state, defender).map(entry => entry.unit).filter(unit => unit.id !== primary.id && activeStrength(unit, 'tauntStrength') > 0).sort((a, b) => b.tauntStrength - a.tauntStrength || a.id.localeCompare(b.id))[0];
    taunts = taunter ? [taunter] : [];
    const units = participatingUnits(state, attacker, attackType, distance, definition);
    const accuracy = units.length ? units.reduce((sum, unit) => sum + (unit.accuracy ?? 1), 0) / units.length : 0;
    hitChance = Math.max(0, Math.min(1, accuracy + (definition.accuracyBonus ?? 0) - (primary.evasion ?? 0) - (cover?.coverPower ?? 0) - (taunter?.tauntStrength ?? 0)));
  } else if (definition.targeting === 'auto' && activeStrength(primary, 'tauntStrength') > 0) taunts = [primary];
  return { ok: true, definition, slots, targets, primary, cover, taunts, hitChance };
}
