import { RULESET } from '../core/ruleset.js';
import { hasCityBombardment } from '../models/city-defense.js';
import { hasActiveUnits, occupiesMapTile } from '../models/party.js';
import { Hex } from '../world/hex.js';
import { allocateSingleDamage } from './damage-grid.js';
import { selectPrimaryTarget, partyCombatStrength, applyPartyDamage, boundedDamage, rollDamage } from './combat-system.js';

const reject = reason => ({ ok: false, reason });
export function cityBombardmentError(state, playerId, cityId) {
  if (!hasCityBombardment(state)) return '都市砲撃は新規の都市争奪戦で利用できます。旧保存のルールは変更しません。';
  if (state.gameResult || state.phase !== 'PLAYER_ACTION' || state.activePlayerId !== playerId) return '現在は都市砲撃を実行できません';
  const city = Object.hasOwn(state.cities, cityId) && state.cities[cityId];
  if (!city || city.ownerId !== playerId) return '自国の都市を選択してください';
  if (!city.buildings.includes('walls') || city.defense.wallHp <= 0 || city.defense.hp <= 0) return '都市砲撃には都市耐久と城壁HPが残っている城壁が必要です';
  if (city.defense.bombardmentsRemaining < 1) return 'この都市の砲撃回数は使用済みです。次の全体ターン開始で回復します';
  if (Object.values(state.parties).some(p => p.ownerId !== playerId && occupiesMapTile(p) && hasActiveUnits(state, p) && p.location === city.centerHex)) return '敵の活動部隊が都市中心を占有しています';
  return null;
}

export function validateCityBombardment(state, playerId, cityId, defenderPartyId) {
  const error = cityBombardmentError(state, playerId, cityId); if (error) return reject(error);
  const city = state.cities[cityId], party = Object.hasOwn(state.parties, defenderPartyId) && state.parties[defenderPartyId];
  if (!party || party.ownerId === playerId || !occupiesMapTile(party) || !hasActiveUnits(state, party)) return reject('生存する敵部隊を選択してください');
  const distance = Hex.fromKey(city.centerHex).distance(Hex.fromKey(party.location));
  if (distance < 1 || distance > RULESET.cityBombardment.range) return reject(`都市砲撃の射程外です（距離1〜${RULESET.cityBombardment.range}）`);
  return { ok: true, distance };
}

// Shared protection and HP resolver, independent of garrison actions and the
// city's melee counter. Preview supplies an integer damage instead of RNG.
function fire(state, city, party, events, damageRoll) {
  const primary = selectPrimaryTarget(state, party);
  const rawDamage = damageRoll(state, RULESET.cityBombardment.strength, partyCombatStrength(state, party, 'defense'));
  city.defense.bombardmentsRemaining--;
  const protection = [], allocations = new Map();
  for (const part of allocateSingleDamage(state, party, primary, rawDamage, protection)) {
    if (part.amount > 0) allocations.set(part.unit.id, { unit: part.unit, amount: part.amount, roles: new Set([part.role]) });
  }
  const metadata = { attackerCityId: city.id, defenderPartyId: party.id, attackType: 'ranged', attackId: 'city-bombardment', attackName: '都市砲撃', counter: false };
  events.push(...protection.map(event => ({ ...event, attackerCityId: city.id })));
  const damageEvents = [], result = applyPartyDamage(state, party, primary, allocations, rawDamage, damageEvents, metadata);
  events.push(...damageEvents);
  events.push({ type: 'CityBombarded', cityId: city.id, partyId: party.id, primaryTargetUnitId: primary.id, damage: result.damage, remainingBombardments: city.defense.bombardmentsRemaining,
    losses: damageEvents.filter(e => e.type === 'CombatDamage').map(e => ({ unitId: e.targetUnitId, damage: e.damage, remainingHp: e.remainingHp })),
    guards: protection.filter(e => e.type === 'CombatGuard').map(e => e.guardUnitId), intercepts: protection.filter(e => e.type === 'CombatIntercept').map(e => e.guardUnitId), defeated: party.status === 'defeated' });
}

export function resolveCityBombardment(state, playerId, cityId, defenderPartyId, events, damageRoll = rollDamage) {
  const valid = validateCityBombardment(state, playerId, cityId, defenderPartyId); if (!valid.ok) return valid;
  fire(state, state.cities[cityId], state.parties[defenderPartyId], events, damageRoll);
  return { ok: true };
}

export function previewCityBombardment(state, playerId, cityId, defenderPartyId) {
  const valid = validateCityBombardment(state, playerId, cityId, defenderPartyId); if (!valid.ok) return valid;
  const city = state.cities[cityId], party = state.parties[defenderPartyId];
  const defense = partyCombatStrength(state, party, 'defense'), rules = RULESET.combat;
  const minimum = boundedDamage(RULESET.cityBombardment.strength, defense, rules.randomMinimum);
  const maximum = boundedDamage(RULESET.cityBombardment.strength, defense, rules.randomMaximum);
  const damage = Object.fromEntries(party.unitIds.map(id => [id, { min: Infinity, max: 0 }]));
  const guards = new Set(), intercepts = new Set(); let defeats = 0;
  // Enumerate the bounded integer range: rounding, Guard capacity and HP caps
  // can introduce breakpoints. No RNG field is even read for a prediction.
  for (let raw = minimum; raw <= maximum; raw++) {
    const clone = { currentTurn: state.currentTurn, units: Object.fromEntries(party.unitIds.map(id => [id, structuredClone(state.units[id])])) };
    const copy = structuredClone(party), events = [];
    fire(clone, structuredClone(city), copy, events, () => raw);
    if (copy.status === 'defeated') defeats++;
    for (const e of events) { if (e.type === 'CombatGuard') guards.add(e.guardUnitId); if (e.type === 'CombatIntercept') intercepts.add(e.guardUnitId); }
    for (const id of party.unitIds) {
      const loss = state.units[id].currentHp - clone.units[id].currentHp;
      damage[id].min = Math.min(damage[id].min, loss); damage[id].max = Math.max(damage[id].max, loss);
    }
  }
  return { ...valid, damage, guards: [...guards], intercepts: [...intercepts], primaryTargetId: selectPrimaryTarget(state, party).id,
    counter: 'none', defeat: defeats === 0 ? 'none' : defeats === maximum - minimum + 1 ? 'certain' : 'possible' };
}
