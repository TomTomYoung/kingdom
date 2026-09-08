import { RULESET } from '../core/ruleset.js';
import { SeededRng } from '../core/rng.js';
import { Hex } from '../world/hex.js';

const ROW_ORDER = ['front', 'middle', 'rear'];
const COLUMN_ORDER = ['center', 'left', 'right'];
const isActive = (unit) => unit && unit.currentHp > 0 && unit.status === 'active';

export function partyCombatStrength(state, party, kind = 'melee') {
  const units = party.unitIds.map((id) => state.units[id]).filter(isActive);
  if (!units.length) return 0;
  const property = kind === 'defense' ? 'defenseStrength' : `${kind}Strength`;
  const base = units.reduce((sum, unit) => sum + (unit[property] ?? 0), 0) / units.length;
  const cohesionModifier = 0.5 + party.cohesion / 200;
  return base * cohesionModifier;
}

export function selectPrimaryTarget(state, party) {
  for (const row of ROW_ORDER) {
    for (const column of COLUMN_ORDER) {
      const unit = state.units[party.formation[`${row}-${column}`]];
      if (isActive(unit)) return unit;
    }
  }
  return null;
}

function rollDamage(state, attackStrength, defenseStrength) {
  const rules = RULESET.combat; const rng = SeededRng.fromJSON(state.rng.combat);
  const random = rules.randomMinimum + rng.next() * (rules.randomMaximum - rules.randomMinimum);
  state.rng.combat = rng.toJSON();
  return Math.round(Math.min(rules.maximumDamage, Math.max(rules.minimumDamage, rules.baseDamage * Math.exp(rules.strengthExponent * (attackStrength - defenseStrength)) * random)));
}

function applyDamage(unit, amount) {
  const mitigated = Math.max(1, amount - (unit.armor ?? 0));
  unit.currentHp = Math.max(0, unit.currentHp - mitigated); unit.hp = unit.currentHp;
  if (unit.currentHp === 0) unit.status = unit.scaleClass === 'individual' ? 'downed' : 'shattered';
  return mitigated;
}

function inheritLeadership(state, party, events) {
  if (isActive(state.units[party.leaderUnitId])) return;
  const successor = party.unitIds.map((id) => state.units[id]).filter(isActive).sort((a, b) => b.commandContribution - a.commandContribution || a.id.localeCompare(b.id))[0];
  if (successor) { const previousLeaderUnitId = party.leaderUnitId; party.leaderUnitId = successor.id; party.morale = Math.max(0, party.morale - 10); events.push({ type: 'PartyLeaderChanged', partyId: party.id, previousLeaderUnitId, leaderUnitId: successor.id }); }
  else { party.status = 'defeated'; party.activationState = 'ended'; events.push({ type: 'PartyDefeated', partyId: party.id }); }
}

function strike(state, sourceParty, targetParty, kind, events, counter = false) {
  const target = selectPrimaryTarget(state, targetParty); if (!target) return null;
  const rawDamage = rollDamage(state, partyCombatStrength(state, sourceParty, kind), partyCombatStrength(state, targetParty, 'defense'));
  const damage = applyDamage(target, rawDamage);
  targetParty.morale = Math.max(0, targetParty.morale - Math.ceil(damage * RULESET.combat.moraleDamageRate));
  events.push({ type: 'CombatDamage', attackerPartyId: sourceParty.id, defenderPartyId: targetParty.id, targetUnitId: target.id, attackType: kind, rawDamage, damage, counter, remainingHp: target.currentHp });
  inheritLeadership(state, targetParty, events);
  return { target, damage };
}

export function resolvePartyAttack(state, attacker, defender, attackType, events) {
  if (!['melee', 'ranged'].includes(attackType)) return { ok: false, reason: '未対応の攻撃種別です' };
  if (attacker.status !== 'active' || attacker.activationState === 'ended') return { ok: false, reason: '攻撃可能なPartyではありません' };
  if (attacker.attacksRemaining < 1) return { ok: false, reason: '攻撃回数が残っていません' };
  const distance = Hex.fromKey(attacker.location).distance(Hex.fromKey(defender.location));
  const range = attackType === 'melee' ? 1 : Math.max(...attacker.unitIds.map((id) => state.units[id].range ?? 1));
  if (distance < 1 || distance > range) return { ok: false, reason: '攻撃射程外です' };
  if (!selectPrimaryTarget(state, attacker) || !selectPrimaryTarget(state, defender)) return { ok: false, reason: '戦闘可能なUnitがいません' };
  attacker.attacksRemaining -= 1; attacker.hasAttacked = true; attacker.movementRemaining = 0; attacker.activationState = 'ended';
  strike(state, attacker, defender, attackType, events);
  if (attackType === 'melee' && defender.status === 'active' && selectPrimaryTarget(state, defender)) strike(state, defender, attacker, 'melee', events, true);
  return { ok: true };
}
