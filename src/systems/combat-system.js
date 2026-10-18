import { RULESET } from '../core/ruleset.js';
import { SeededRng } from '../core/rng.js';
import { Hex } from '../world/hex.js';
import { isActiveUnit as isActive } from '../models/party.js';
import { allocateSingleDamage, exposedUnits } from './damage-grid.js';

export function partyCombatStrength(state, party, kind = 'melee', distance = 1) {
  const units = party.unitIds.map((id) => state.units[id]).filter((unit) => isActive(unit) && (kind !== 'ranged' || (unit.rangedStrength > 0 && unit.range >= distance)));
  if (!units.length) return 0;
  const property = kind === 'defense' ? 'defenseStrength' : `${kind}Strength`;
  const base = units.reduce((sum, unit) => sum + (unit[property] ?? 0), 0) / units.length;
  const cohesionModifier = 0.5 + party.cohesion / 200;
  return base * cohesionModifier;
}

export function selectPrimaryTarget(state, party) { return exposedUnits(state, party)[0]?.unit ?? null; }

function boundedDamage(attackStrength, defenseStrength, random) {
  const rules = RULESET.combat;
  return Math.round(Math.min(rules.maximumDamage, Math.max(rules.minimumDamage, rules.baseDamage * Math.exp(rules.strengthExponent * (attackStrength - defenseStrength)) * random)));
}

function rollDamage(state, attackStrength, defenseStrength) {
  const rules = RULESET.combat, rng = SeededRng.fromJSON(state.rng.combat);
  const random = rules.randomMinimum + rng.next() * (rules.randomMaximum - rules.randomMinimum);
  state.rng.combat = rng.toJSON();
  return boundedDamage(attackStrength, defenseStrength, random);
}

function applyDamage(unit, amount) {
  const mitigated = Math.min(unit.currentHp, Math.max(1, amount - (unit.armor ?? 0)));
  unit.currentHp = Math.max(0, unit.currentHp - mitigated); unit.hp = unit.currentHp;
  if (unit.currentHp === 0) unit.status = unit.scaleClass === 'individual' ? 'downed' : 'shattered';
  return mitigated;
}

function inheritLeadership(state, party, events) {
  if (isActive(state.units[party.leaderUnitId])) return;
  const successor = party.unitIds.map((id) => state.units[id]).filter(isActive).sort((a, b) => b.commandContribution - a.commandContribution || a.id.localeCompare(b.id))[0];
  if (successor) { const previousLeaderUnitId = party.leaderUnitId; party.leaderUnitId = successor.id; party.morale = Math.max(0, party.morale - 10); events.push({ type: 'PartyLeaderChanged', partyId: party.id, previousLeaderUnitId, leaderUnitId: successor.id }); }
  else { party.status = 'defeated'; party.activationState = 'ended'; party.movementRemaining = 0; party.attacksRemaining = 0; party.reactionCharges = 0; events.push({ type: 'PartyDefeated', partyId: party.id }); }
}

function strike(state, sourceParty, targetParty, kind, events, counter = false, distance = 1, damageRoll = rollDamage) {
  const target = selectPrimaryTarget(state, targetParty); if (!target) return null;
  const rawDamage = damageRoll(state, partyCombatStrength(state, sourceParty, kind, distance), partyCombatStrength(state, targetParty, 'defense'));
  const allocations = allocateSingleDamage(state, targetParty, target, rawDamage, events);
  let total = 0;
  for (const { unit, amount, role } of allocations) {
    if (amount <= 0) continue;
    const damage = applyDamage(unit, amount); total += damage;
    events.push({ type: 'CombatDamage', attackerPartyId: sourceParty.id, defenderPartyId: targetParty.id, targetUnitId: unit.id, primaryTargetUnitId: target.id, attackType: kind, rawDamage, allocatedDamage: amount, damage, role, counter, remainingHp: unit.currentHp });
  }
  targetParty.morale = Math.max(0, targetParty.morale - Math.ceil(total * RULESET.combat.moraleDamageRate));
  inheritLeadership(state, targetParty, events);
  return { target, damage: total };
}

export function validatePartyAttack(state, attacker, defender, attackType) {
  if (!attacker || !defender || attacker.ownerId === defender.ownerId) return { ok: false, reason: '自国部隊と敵部隊を指定してください' };
  if (state.phase !== 'PLAYER_ACTION' || attacker.ownerId !== state.activePlayerId) return { ok: false, reason: '現在の手番ではありません' };
  if (!['melee', 'ranged'].includes(attackType)) return { ok: false, reason: '未対応の攻撃種別です' };
  if (attacker.status !== 'active' || attacker.activationState === 'ended') return { ok: false, reason: '攻撃可能なPartyではありません' };
  if (attacker.attacksRemaining < 1) return { ok: false, reason: '攻撃回数が残っていません' };
  if (defender.status !== 'active') return { ok: false, reason: '戦闘可能な敵Partyではありません' };
  const distance = Hex.fromKey(attacker.location).distance(Hex.fromKey(defender.location));
  const rangedUnits = attacker.unitIds.map((id) => state.units[id]).filter((unit) => isActive(unit) && unit.rangedStrength > 0);
  if (attackType === 'ranged' && !rangedUnits.length) return { ok: false, reason: '遠隔攻撃が可能なUnitがいません' };
  const range = attackType === 'melee' ? 1 : Math.max(...rangedUnits.map((unit) => unit.range ?? 1));
  if (distance < 1 || distance > range) return { ok: false, reason: '攻撃射程外です' };
  if (!selectPrimaryTarget(state, attacker) || !selectPrimaryTarget(state, defender)) return { ok: false, reason: '戦闘可能なUnitがいません' };
  return { ok: true, distance };
}

export function resolvePartyAttack(state, attacker, defender, attackType, events, damageRoll = rollDamage) {
  const validation = validatePartyAttack(state, attacker, defender, attackType);
  if (!validation.ok) return validation;
  const { distance } = validation;
  attacker.attacksRemaining -= 1; attacker.hasAttacked = true; attacker.movementRemaining = 0; attacker.activationState = 'ended';
  strike(state, attacker, defender, attackType, events, false, distance, damageRoll);
  if (attackType === 'melee' && defender.status === 'active' && selectPrimaryTarget(state, defender)) strike(state, defender, attacker, 'melee', events, true, 1, damageRoll);
  return { ok: true };
}

// Enumerate integer outgoing damage and counter extrema without reading or
// advancing the combat RNG. HP-zero/leadership/Guard thresholds are included.
export function previewPartyAttack(state, attackerId, defenderId, attackType = 'melee') {
  const attacker = state.parties[attackerId], defender = state.parties[defenderId];
  const validity = validatePartyAttack(state, attacker, defender, attackType);
  if (!validity.ok) return validity;
  const attack = partyCombatStrength(state, attacker, attackType, validity.distance), defense = partyCombatStrength(state, defender, 'defense');
  const minimum = boundedDamage(attack, defense, RULESET.combat.randomMinimum), maximum = boundedDamage(attack, defense, RULESET.combat.randomMaximum);
  const ids = [...attacker.unitIds, ...defender.unitIds], damage = Object.fromEntries(ids.map(id => [id, { min: Infinity, max: 0 }]));
  const guards = new Set(), intercepts = new Set(); let counters = 0, simulations = 0;
  for (let raw = minimum; raw <= maximum; raw++) for (const factor of [RULESET.combat.randomMinimum, RULESET.combat.randomMaximum]) {
    const clone = { ...state, units: structuredClone(state.units), parties: structuredClone(state.parties), rng: structuredClone(state.rng) }, events = [];
    let first = true;
    resolvePartyAttack(clone, clone.parties[attackerId], clone.parties[defenderId], attackType, events, (_state, a, d) => { if (first) { first = false; return raw; } return boundedDamage(a, d, factor); });
    simulations++; if (events.some(event => event.counter)) counters++;
    for (const event of events) { if (event.type === 'CombatGuard') guards.add(event.guardUnitId); if (event.type === 'CombatIntercept') intercepts.add(event.guardUnitId); }
    for (const id of ids) { const amount = state.units[id].currentHp - clone.units[id].currentHp; damage[id].min = Math.min(damage[id].min, amount); damage[id].max = Math.max(damage[id].max, amount); }
  }
  return { ok: true, damage, guards: [...guards], intercepts: [...intercepts], counter: counters === 0 ? 'none' : counters === simulations ? 'certain' : 'possible' };
}
