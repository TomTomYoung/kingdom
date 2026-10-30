import { RULESET } from '../core/ruleset.js';
import { hasCityRetaliation, isCityDefended } from '../models/city-defense.js';
import { allocateSingleDamage } from './damage-grid.js';
import { selectPrimaryTarget, partyCombatStrength, applyPartyDamage, rollDamage } from './combat-system.js';

export function canCityCounterattack(state, city, attackType) {
  return hasCityRetaliation(state) && attackType === 'melee' && isCityDefended(state, city) && city.defense.counterattacksRemaining > 0;
}
export function resolveCityCounterattack(state, city, party, attackType, events, damageRoll = rollDamage) {
  if (!canCityCounterattack(state, city, attackType)) return;
  const primary = selectPrimaryTarget(state, party); if (!primary) return;
  city.defense.counterattacksRemaining--;
  const rawDamage = damageRoll(state, RULESET.cityDefense.counterStrength, partyCombatStrength(state, party, 'defense'));
  const protection = [], parts = allocateSingleDamage(state, party, primary, rawDamage, protection), allocations = new Map();
  const metadata = { attackerCityId: city.id, defenderPartyId: party.id, attackType: 'melee', attackId: 'city-counter', attackName: '都市反撃', counter: true };
  events.push(...protection.map(event => ({ ...event, attackerCityId: city.id })));
  for (const part of parts) if (part.amount > 0) allocations.set(part.unit.id, { unit: part.unit, amount: part.amount, roles: new Set([part.role]) });
  const damageEvents = [], result = applyPartyDamage(state, party, primary, allocations, rawDamage, damageEvents, metadata);
  events.push(...damageEvents);
  events.push({ type: 'CityCounterattacked', cityId: city.id, partyId: party.id, damage: result.damage, remainingCounterattacks: city.defense.counterattacksRemaining,
    losses: damageEvents.filter(event => event.type === 'CombatDamage').map(event => ({ unitId: event.targetUnitId, damage: event.damage, remainingHp: event.remainingHp })),
    guards: protection.filter(event => event.type === 'CombatGuard').map(event => event.guardUnitId), intercepts: protection.filter(event => event.type === 'CombatIntercept').map(event => event.guardUnitId), defeated: party.status === 'defeated' });
}
