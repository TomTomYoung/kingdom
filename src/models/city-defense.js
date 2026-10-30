import { RULESET } from '../core/ruleset.js';

export const hasCityDefense = state => [1, 2].includes(state.cityDefenseVersion);
export const hasCityRetaliation = state => state.cityDefenseVersion === 2;
export function initializeCityDefense(state, city) {
  if (hasCityDefense(state)) city.defense = { hp: RULESET.cityDefense.maximumHp, wallHp: city.buildings.includes('walls') ? RULESET.cityDefense.wallHp : 0, lastDamagedTurn: null };
  if (hasCityRetaliation(state)) city.defense.counterattacksRemaining = RULESET.cityDefense.counterattacksPerRound;
  return city;
}
export const isCityDefended = (state, city) => hasCityDefense(state) && !!city && (city.defense.hp > 0 || city.defense.wallHp > 0);
export function cityEntryError(state, ownerId, location) {
  const city = state.cities[state.world.tiles[location]?.cityId];
  return city?.ownerId !== ownerId && isCityDefended(state, city) ? '敵都市の城壁と耐久を0にしてから進入してください' : null;
}
export function cityDefenseLabel(state, city) {
  if (!hasCityDefense(state) || !city) return '';
  return `都市耐久 ${city.defense.hp}/${RULESET.cityDefense.maximumHp} · 城壁 ${city.defense.wallHp}/${city.buildings.includes('walls') ? RULESET.cityDefense.wallHp : 0}${hasCityRetaliation(state) ? ` · 反撃 ${city.defense.counterattacksRemaining}/${RULESET.cityDefense.counterattacksPerRound}` : ''}`;
}
