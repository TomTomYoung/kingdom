import { RULESET } from '../core/ruleset.js';
import { SeededRng } from '../core/rng.js';
import { Hex } from '../world/hex.js';
import { isActiveUnit as isActive } from '../models/party.js';
import { allocateSingleDamage } from './damage-grid.js';
import { attackDefinition, automaticTarget, participatingUnits, resolveTargeting } from './combat-attacks.js';

export function partyCombatStrength(state, party, kind = 'melee', distance = 1, definition) {
  const units = participatingUnits(state, party, kind, distance, definition);
  if (!units.length) return 0;
  const property = kind === 'defense' ? 'defenseStrength' : `${kind}Strength`;
  const base = units.reduce((sum, unit) => sum + (unit[property] ?? 0), 0) / units.length;
  return base * (0.5 + party.cohesion / 200);
}

export function selectPrimaryTarget(state, party) { return automaticTarget(state, party); }

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

function rollHit(state, chance) {
  const rng = SeededRng.fromJSON(state.rng.combat), hit = rng.next() < chance;
  state.rng.combat = rng.toJSON(); return hit;
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

function strike(state, sourceParty, targetParty, kind, events, counter = false, distance = 1, damageRoll = rollDamage, options = {}, hitRoll = rollHit) {
  const targeting = resolveTargeting(state, sourceParty, targetParty, kind, options, distance);
  if (!targeting.ok) return null;
  const { definition } = targeting;
  if (!participatingUnits(state, sourceParty, kind, distance, definition).length) return null;
  const metadata = { attackerPartyId: sourceParty.id, defenderPartyId: targetParty.id, attackType: kind, attackId: definition.id, attackName: definition.name, counter };
  const rawDamage = damageRoll(state, partyCombatStrength(state, sourceParty, kind, distance, definition), partyCombatStrength(state, targetParty, 'defense'));
  for (const taunter of targeting.taunts) events.push({ type: 'CombatTaunt', ...metadata, tauntUnitId: taunter.id, targetUnitId: targeting.primary.id });
  let targets = targeting.targets;
  if (definition.targeting === 'unit-or-slot' && !hitRoll(state, targeting.hitChance)) {
    events.push({ type: 'CombatMiss', ...metadata, targetUnitId: targeting.primary.id, hitChance: targeting.hitChance, failure: definition.failure });
    if (definition.failure === 'precise' || !targeting.cover) return { target: targeting.primary, damage: 0 };
    events.push({ type: 'CombatCover', ...metadata, coverUnitId: targeting.cover.id, targetUnitId: targeting.primary.id });
    targets = [{ unit: targeting.cover, slot: Object.keys(targetParty.formation).find(slot => targetParty.formation[slot] === targeting.cover.id) }];
  }
  // Allocate the complete fixed pattern, then combine direct and Guard damage.
  // One recipient pays armor once, and a zero allocation never creates damage.
  const allocations = new Map(), primary = targets[0].unit;
  for (const [depth, { unit }] of targets.entries()) {
    const amount = Math.floor(rawDamage * definition.multiplier * (definition.decay ?? 1) ** depth);
    if (amount <= 0) continue;
    const parts = depth === 0 ? allocateSingleDamage(state, targetParty, unit, amount, events) : [{ unit, amount, role: 'area' }];
    for (const part of parts) {
      if (part.amount <= 0) continue;
      const accumulated = allocations.get(part.unit.id) ?? { unit: part.unit, amount: 0, roles: new Set() };
      accumulated.amount += part.amount; accumulated.roles.add(part.role); allocations.set(part.unit.id, accumulated);
    }
  }
  let total = 0;
  for (const { unit, amount, roles } of allocations.values()) {
    const damage = applyDamage(unit, amount); total += damage;
    const role = roles.has('intercept') ? 'intercept' : roles.has('guard') ? 'guard' : roles.has('primary') ? 'primary' : 'area';
    events.push({ type: 'CombatDamage', ...metadata, targetUnitId: unit.id, primaryTargetUnitId: primary.id, targetSlot: Object.keys(targetParty.formation).find(slot => targetParty.formation[slot] === unit.id), rawDamage, allocatedDamage: amount, damage, role, roles: [...roles], remainingHp: unit.currentHp });
  }
  targetParty.morale = Math.max(0, targetParty.morale - Math.ceil(total * RULESET.combat.moraleDamageRate));
  inheritLeadership(state, targetParty, events);
  return { target: primary, damage: total };
}

export function validatePartyAttack(state, attacker, defender, attackType, options = {}) {
  const checked = attackDefinition(attackType, options); if (!checked.ok) return checked;
  if (!attacker || !defender || attacker.ownerId === defender.ownerId) return { ok: false, reason: '自国部隊と敵部隊を指定してください' };
  if (state.phase !== 'PLAYER_ACTION' || attacker.ownerId !== state.activePlayerId) return { ok: false, reason: '現在の手番ではありません' };
  if (!['melee', 'ranged'].includes(attackType)) return { ok: false, reason: '未対応の攻撃種別です' };
  if (attacker.status !== 'active' || attacker.activationState === 'ended') return { ok: false, reason: '攻撃可能なPartyではありません' };
  if (attacker.attacksRemaining < 1) return { ok: false, reason: '攻撃回数が残っていません' };
  if (defender.status !== 'active') return { ok: false, reason: '戦闘可能な敵Partyではありません' };
  const distance = Hex.fromKey(attacker.location).distance(Hex.fromKey(defender.location));
  if (distance < 1 || (attackType === 'melee' && distance > 1)) return { ok: false, reason: '攻撃射程外です' };
  const capable = participatingUnits(state, attacker, attackType, distance, checked.definition);
  if (!capable.length) return { ok: false, reason: attackType === 'ranged' ? '射程内にこの遠隔攻撃が可能なUnitがいません' : '戦闘可能なUnitがいません' };
  const targeting = resolveTargeting(state, attacker, defender, attackType, options, distance);
  if (!targeting.ok) return targeting;
  return { ok: true, distance, targeting };
}

// Sixth-argument damageRoll remains compatible with existing deterministic tests.
export function resolvePartyAttack(state, attacker, defender, attackType, events, damageRoll = rollDamage, options = {}, hitRoll = rollHit) {
  const validation = validatePartyAttack(state, attacker, defender, attackType, options);
  if (!validation.ok) return validation;
  attacker.attacksRemaining -= 1; attacker.hasAttacked = true; attacker.movementRemaining = 0; attacker.activationState = 'ended';
  strike(state, attacker, defender, attackType, events, false, validation.distance, damageRoll, options, hitRoll);
  if (attackType === 'melee' && defender.status === 'active' && selectPrimaryTarget(state, defender)) strike(state, defender, attacker, 'melee', events, true, 1, damageRoll);
  return { ok: true };
}

// Enumerate feasible raw damage, aim outcomes and counter extrema. Clone
// battle data without reading or cloning the future combat random stream.
export function previewPartyAttack(state, attackerId, defenderId, attackType = 'melee', options = {}) {
  const attacker = state.parties[attackerId], defender = state.parties[defenderId];
  const validity = validatePartyAttack(state, attacker, defender, attackType, options);
  if (!validity.ok) return validity;
  const { targeting } = validity;
  const attack = partyCombatStrength(state, attacker, attackType, validity.distance, targeting.definition), defense = partyCombatStrength(state, defender, 'defense');
  const minimum = boundedDamage(attack, defense, RULESET.combat.randomMinimum), maximum = boundedDamage(attack, defense, RULESET.combat.randomMaximum);
  const ids = [...attacker.unitIds, ...defender.unitIds], damage = Object.fromEntries(ids.map(id => [id, { min: Infinity, max: 0 }]));
  const guards = new Set(), intercepts = new Set(); let counters = 0, simulations = 0;
  const hits = targeting.hitChance <= 0 ? [false] : targeting.hitChance >= 1 ? [true] : [false, true];
  for (let raw = minimum; raw <= maximum; raw++) for (const hit of hits) for (const factor of [RULESET.combat.randomMinimum, RULESET.combat.randomMaximum]) {
    const clone = { phase: state.phase, activePlayerId: state.activePlayerId, units: structuredClone(state.units), parties: structuredClone(state.parties), rng: {} }, events = [];
    let first = true;
    resolvePartyAttack(clone, clone.parties[attackerId], clone.parties[defenderId], attackType, events, (_state, a, d) => { if (first) { first = false; return raw; } return boundedDamage(a, d, factor); }, options, () => hit);
    simulations++; if (events.some(event => event.counter)) counters++;
    for (const event of events) { if (event.type === 'CombatGuard') guards.add(event.guardUnitId); if (event.type === 'CombatIntercept') intercepts.add(event.guardUnitId); }
    for (const id of ids) { const amount = state.units[id].currentHp - clone.units[id].currentHp; damage[id].min = Math.min(damage[id].min, amount); damage[id].max = Math.max(damage[id].max, amount); }
  }
  return { ok: true, damage, guards: [...guards], intercepts: [...intercepts], counter: counters === 0 ? 'none' : counters === simulations ? 'certain' : 'possible', targetSlots: targeting.slots, primaryTargetId: targeting.primary.id, hitChance: targeting.hitChance, covers: targeting.cover ? [targeting.cover.id] : [], taunts: targeting.taunts.map(unit => unit.id), attackName: targeting.definition.name };
}
