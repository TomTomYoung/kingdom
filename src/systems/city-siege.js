import { canCityCounterattack, resolveCityCounterattack } from './city-retaliation.js';
import { RULESET } from '../core/ruleset.js';
import { Hex } from '../world/hex.js';
import { hasCityDefense, isCityDefended } from '../models/city-defense.js';
import { participatingUnits } from './combat-attacks.js';
import { partyCombatStrength, boundedDamage, rollDamage } from './combat-system.js';

const reject = reason => ({ ok: false, reason });
export function validateCityAttack(state, playerId, partyId, cityId, attackType) {
  if (!hasCityDefense(state)) return reject('攻城は新規の都市争奪戦で行えます');
  if (state.gameResult || state.phase !== 'PLAYER_ACTION' || state.activePlayerId !== playerId) return reject('現在は攻城を実行できません');
  const city = Object.hasOwn(state.cities, cityId) && state.cities[cityId], party = Object.hasOwn(state.parties, partyId) && state.parties[partyId];
  if (!city || city.ownerId === playerId) return reject('敵国の都市を選択してください');
  if (!party || party.ownerId !== playerId || party.status !== 'active' || party.activationState !== 'ready' || party.attacksRemaining < 1) return reject('攻撃回数の残る自国の活動部隊が必要です');
  if (!['melee', 'ranged'].includes(attackType)) return reject('未対応の攻城種別です');
  if (!isCityDefended(state, city)) return reject('都市防御は崩壊済みです。中心へ進入して占領してください');
  const distance = Hex.fromKey(party.location).distance(Hex.fromKey(city.centerHex));
  if (attackType === 'melee' && distance > 1) return reject('近接攻城は隣接する都市に行えます');
  const units = participatingUnits(state, party, attackType, distance);
  if (!units.length) return reject('射程内に攻城可能な軍事Unitがいません');
  return { ok: true, distance, units };
}
function siegeMultiplier(city, attackType, units) {
  // Only participating ranged ballistae contribute; a distant archer cannot
  // borrow a ballista's range or grant the whole party its wall bonus.
  return city.defense.wallHp > 0 && attackType === 'ranged' ? 1 + RULESET.cityDefense.ballistaWallBonus * units.filter(unit => unit.typeId === 'ballista').length / units.length : 1;
}
function damageParts(city, raw, multiplier) {
  const damage = Math.floor(raw * multiplier), wallDamage = Math.min(city.defense.wallHp, damage);
  return { wallDamage, cityDamage: Math.min(city.defense.hp, damage - wallDamage) };
}
export function previewCityAttack(state, playerId, partyId, cityId, attackType = 'melee') {
  const valid = validateCityAttack(state, playerId, partyId, cityId, attackType); if (!valid.ok) return valid;
  const city = state.cities[cityId], party = state.parties[partyId], strength = partyCombatStrength(state, party, attackType, valid.distance), multiplier = siegeMultiplier(city, attackType, valid.units);
  const ranges = [RULESET.combat.randomMinimum, RULESET.combat.randomMaximum].map(random => damageParts(city, boundedDamage(strength, RULESET.cityDefense.strength, random), multiplier));
  const retaliation = previewRetaliation(state, party, city, attackType, strength);
  return { ...retaliation, ok: true, wallDamage: { min: ranges[0].wallDamage, max: ranges[1].wallDamage }, cityDamage: { min: ranges[0].cityDamage, max: ranges[1].cityDamage }, participantIds: valid.units.map(unit => unit.id), multiplier };
}
export function resolveCityAttack(state, playerId, partyId, cityId, attackType, events, damageRoll = rollDamage) {
  const valid = validateCityAttack(state, playerId, partyId, cityId, attackType); if (!valid.ok) return valid;
  const party = state.parties[partyId], city = state.cities[cityId], multiplier = siegeMultiplier(city, attackType, valid.units);
  const rawDamage = damageRoll(state, partyCombatStrength(state, party, attackType, valid.distance), RULESET.cityDefense.strength);
  const { wallDamage, cityDamage } = damageParts(city, rawDamage, multiplier);
  city.defense.wallHp -= wallDamage; city.defense.hp -= cityDamage; city.defense.lastDamagedTurn = state.currentTurn;
  party.attacksRemaining = 0; party.movementRemaining = 0; party.hasAttacked = true; party.activationState = 'ended';
  events.push({ type: 'CityDamaged', cityId, partyId, attackType, rawDamage, multiplier, wallDamage, cityDamage, remainingHp: city.defense.hp, remainingWallHp: city.defense.wallHp });
  if (!isCityDefended(state, city)) events.push({ type: 'CityBreached', cityId, partyId });
  // The attacker may use its remaining intercept during the immediate counter;
  // the siege activation closes all reactions after that exchange.
  resolveCityCounterattack(state, city, party, attackType, events, damageRoll);
  party.reactionCharges = 0;
  return { ok: true };
}
export function recoverCityDefense(state, city, events) {
  if (!hasCityDefense(state) || (city.defense.lastDamagedTurn !== null && city.defense.lastDamagedTurn >= state.currentTurn - 1)) return;
  const besieged = Object.values(state.parties).some(party => party.ownerId !== city.ownerId && party.status === 'active' && participatingUnits(state, party).length && Hex.fromKey(party.location).distance(Hex.fromKey(city.centerHex)) <= 1);
  if (besieged) return;
  const rules = RULESET.cityDefense, hp = Math.min(rules.recoveryHp, rules.maximumHp - city.defense.hp), wallHp = Math.min(rules.recoveryWallHp, (city.buildings.includes('walls') ? rules.wallHp : 0) - city.defense.wallHp);
  if (!hp && !wallHp) return;
  city.defense.hp += hp; city.defense.wallHp += wallHp;
  events.push({ type: 'CityDefenseRecovered', cityId: city.id, hp, wallHp });
}

function previewRetaliation(state, party, city, attackType, strength) {
  const damage = Object.fromEntries(party.unitIds.map(id => [id, { min: 0, max: 0 }]));
  if (!canCityCounterattack(state, city, attackType)) return { counter: 'none', damage, guards: [], intercepts: [] };
  for (const range of Object.values(damage)) range.min = Infinity;
  const minimum = boundedDamage(strength, RULESET.cityDefense.strength, RULESET.combat.randomMinimum), maximum = boundedDamage(strength, RULESET.cityDefense.strength, RULESET.combat.randomMaximum);
  const guards = new Set(), intercepts = new Set(); let counters = 0, simulations = 0;
  for (let raw = minimum; raw <= maximum; raw++) for (const random of [RULESET.combat.randomMinimum, RULESET.combat.randomMaximum]) {
    const clone = { cityDefenseVersion: state.cityDefenseVersion, phase: state.phase, activePlayerId: state.activePlayerId, currentTurn: state.currentTurn,
      cities: { [city.id]: structuredClone(city) }, parties: { [party.id]: structuredClone(party) }, units: structuredClone(state.units) }, events = [];
    let first = true;
    resolveCityAttack(clone, party.ownerId, party.id, city.id, attackType, events, (_state, attack, defense) => { if (first) { first = false; return raw; } return boundedDamage(attack, defense, random); });
    simulations++; if (events.some(event => event.type === 'CityCounterattacked')) counters++;
    for (const event of events) { if (event.type === 'CombatGuard') guards.add(event.guardUnitId); if (event.type === 'CombatIntercept') intercepts.add(event.guardUnitId); }
    for (const id of party.unitIds) { const loss = state.units[id].currentHp - clone.units[id].currentHp; damage[id].min = Math.min(damage[id].min, loss); damage[id].max = Math.max(damage[id].max, loss); }
  }
  return { counter: counters === 0 ? 'none' : counters === simulations ? 'certain' : 'possible', damage, guards: [...guards], intercepts: [...intercepts] };
}
