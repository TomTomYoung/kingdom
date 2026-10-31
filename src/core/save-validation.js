import { validateResearchSave } from '../systems/research-system.js';
import { partyCareSafetyError } from '../systems/party-care.js';
import { validateScenarioSave } from '../systems/scenario-system.js';
import { RULESET } from './ruleset.js';
import { validateFormation, occupiesMapTile, hasActiveUnits } from '../models/party.js';
import { assignLegacyCityTerritories } from '../systems/city-territory.js';
import { calculateCityYields } from '../systems/yield-system.js';
import { updateDerivedCapabilities } from '../models/kingdom.js';

const invalid = (path) => { throw new Error(`セーブデータが不正です: ${path}`); };
const check = (condition, path) => { if (!condition) invalid(path); };
const object = (value, path) => { check(value !== null && typeof value === 'object' && !Array.isArray(value), path); return value; };
const number = (value, path, min = 0, max = Number.MAX_SAFE_INTEGER) => check(Number.isFinite(value) && value >= min && value <= max, path);
const integer = (value, path, min = 0, max = Number.MAX_SAFE_INTEGER) => { number(value, path, min, max); check(Number.isSafeInteger(value), path); };
const text = (value, path) => check(typeof value === 'string' && value.length > 0, path);
const array = (value, path) => { check(Array.isArray(value), path); return value; };
const ids = (value, path) => { array(value, path).forEach((id) => text(id, path)); check(new Set(value).size === value.length, path); };
const reference = (records, id, path) => { text(id, path); check(Object.hasOwn(records, id), path); return object(records[id], path); };
const fields = (value, names, path) => { object(value, path); for (const name of names) number(value[name], `${path}.${name}`); };
const defaultMissing = (value, key, fallback) => { if (!Object.hasOwn(value, key)) value[key] = fallback; };
const yields = ['food', 'production', 'gold', 'science', 'mana', 'religion', 'culture'];
function yieldRecord(value, path, negative = false) {
  object(value, path);
  for (const [key, amount] of Object.entries(value)) {
    check(yields.includes(key), path);
    number(amount, `${path}.${key}`, negative ? -Number.MAX_SAFE_INTEGER : 0);
  }
}

// Only known historical omissions are migrated. Nulls and broken references are
// errors, not invitations to regenerate a map, an army, or its random streams.
export function migrateAndValidateSave(state) {
  object(state, 'root');
  const recovery = Object.hasOwn(state, 'partyRecoveryVersion');
  if (recovery) check(state.partyRecoveryVersion === 1, 'partyRecoveryVersion');
  const legacyTerritory = !Object.hasOwn(state, 'cityTerritoryVersion');
  if (!legacyTerritory) check(state.cityTerritoryVersion === 1, 'cityTerritoryVersion');
  for (const name of ['kingdoms', 'cities', 'units', 'world', 'rng', 'nextIds']) object(state[name], name);
  integer(state.seed, 'seed', -Number.MAX_SAFE_INTEGER);
  defaultMissing(state, 'parties', {}); object(state.parties, 'parties');
  defaultMissing(state.rng, 'combat', { seed: (state.seed ^ 0x85ebca6b) >>> 0, state: (state.seed ^ 0x85ebca6b) >>> 0 });
  defaultMissing(state, 'turnOrder', Object.keys(state.kingdoms)); ids(state.turnOrder, 'turnOrder');
  defaultMissing(state, 'activePlayerIndex', state.turnOrder.indexOf(state.activePlayerId));
  defaultMissing(state.nextIds, 'party', 1);
  if (!Object.hasOwn(state.nextIds, 'city')) {
    const numbers = Object.keys(state.cities).map(id => /^city-(\d+)$/.exec(id)).filter(Boolean).map(match => Number(match[1]));
    state.nextIds.city = numbers.reduce((next, value) => Math.max(next, value + 1), 1);
  }
  for (const [id, unit] of Object.entries(state.units)) {
    object(unit, `units.${id}`);
    const definition = reference(RULESET.unitTypes, unit.typeId, `units.${id}.typeId`);
    defaultMissing(unit, 'partyId', null);
    defaultMissing(unit, 'currentHp', unit.hp ?? definition.maxHp);
    defaultMissing(unit, 'maxHp', definition.maxHp);
    defaultMissing(unit, 'hp', unit.currentHp);
    for (const name of ['scaleClass', 'meleeStrength', 'rangedStrength', 'magicStrength', 'defenseStrength', 'resistance', 'armor', 'range', 'guardRate', 'moraleContribution', 'commandContribution']) defaultMissing(unit, name, definition[name]);
    defaultMissing(unit, 'guardCapacityMax', definition.guardCapacity);
    defaultMissing(unit, 'guardCapacityRemaining', unit.guardCapacityMax);
    defaultMissing(unit, 'status', unit.currentHp > 0 ? 'active' : unit.scaleClass === 'individual' ? 'downed' : 'shattered');
    defaultMissing(unit, 'statusEffects', []);
    // Old saves predate probabilistic aiming; keep their neutral combat values.
    for (const [key, fallback] of Object.entries({ accuracy: 1, evasion: 0, tauntStrength: 0, coverPower: 0 })) defaultMissing(unit, key, fallback);
    defaultMissing(unit, 'guardRange', 1);
  }
  for (const [id, party] of Object.entries(state.parties)) {
    object(party, `parties.${id}`);
    defaultMissing(party, 'guardOrders', {});
    for (const [key, value] of Object.entries({ attacksMaximum: 1, activationState: 'ready', hasMoved: false, hasAttacked: false, reactionCharges: 1 })) defaultMissing(party, key, value);
  }

  integer(state.currentTurn, 'currentTurn', 1);
  integer(state.lastProcessedTurn, 'lastProcessedTurn', 0, state.currentTurn);
  check(['PLAYER_ACTION', 'TURN_END', 'GAME_OVER'].includes(state.phase), 'phase');
  check(state.turnOrder.length > 0 && state.turnOrder.length === Object.keys(state.kingdoms).length, 'turnOrder');
  state.turnOrder.forEach((id) => reference(state.kingdoms, id, 'turnOrder'));
  integer(state.activePlayerIndex, 'activePlayerIndex', 0, state.turnOrder.length - 1);
  check(state.activePlayerId === state.turnOrder[state.activePlayerIndex], 'activePlayerId');
  for (const name of ['territory', 'combat']) {
    object(state.rng[name], `rng.${name}`);
    for (const key of ['seed', 'state']) integer(state.rng[name][key], `rng.${name}.${key}`, 0, 0xffffffff);
  }
  for (const name of ['city', 'unit', 'party', 'command']) integer(state.nextIds[name], `nextIds.${name}`, 1);
  for (const [kind, records] of [['city', state.cities], ['unit', state.units], ['party', state.parties]]) {
    for (const id of Object.keys(records)) {
      const match = id.match(new RegExp(`^${kind}-(\\d+)$`));
      if (match) check(Number(match[1]) < state.nextIds[kind], `nextIds.${kind}`);
    }
  }
  const commandIds = new Set();
  for (const entry of array(state.commandLog, 'commandLog')) {
    object(entry, 'commandLog'); text(entry.commandId, 'commandLog.commandId');
    check(!commandIds.has(entry.commandId), 'commandLog.commandId'); commandIds.add(entry.commandId);
    if (!recovery) check(!['RestParty', 'RemoveCasualties'].includes(entry.type), 'commandLog: 休養・離脱の版がありません');
    text(entry.type, 'commandLog.type'); object(entry.payload, 'commandLog.payload');
    reference(state.kingdoms, entry.playerId, 'commandLog.playerId'); integer(entry.turn, 'commandLog.turn', 1, state.currentTurn);
  }
  for (const entry of array(state.eventLog, 'eventLog')) { object(entry, 'eventLog'); text(entry.type, 'eventLog.type'); integer(entry.turn, 'eventLog.turn', 1, state.currentTurn); }

  const tiles = object(state.world.tiles, 'world.tiles');
  integer(state.world.radius, 'world.radius', 0);
  check(Object.keys(tiles).length > 0, 'world.tiles');
  array(state.world.riverEdges, 'world.riverEdges');
  object(state.world.rng, 'world.rng');
  for (const key of ['seed', 'state']) integer(state.world.rng[key], `world.rng.${key}`, 0, 0xffffffff);
  for (const [key, tile] of Object.entries(tiles)) {
    object(tile, `world.tiles.${key}`);
    for (const coordinate of ['q', 'r', 's']) integer(tile[coordinate], `world.tiles.${key}.${coordinate}`, -state.world.radius, state.world.radius);
    check(tile.q + tile.r + tile.s === 0 && key === `${tile.q},${tile.r},${tile.s}` && key === tile.key, `world.tiles.${key}.coordinates`);
    reference(RULESET.terrain, tile.terrainId, `world.tiles.${key}.terrainId`);
    if (tile.ownerId !== null) reference(state.kingdoms, tile.ownerId, `world.tiles.${key}.ownerId`);
    if (legacyTerritory) {
      // A partial new representation is damaged, not a historical save.
      check(!Object.hasOwn(tile, 'territoryCityId'), `world.tiles.${key}.territoryCityId: 都市領土の版がありません`);
    } else {
      check(Object.hasOwn(tile, 'territoryCityId'), `world.tiles.${key}.territoryCityId`);
      if (tile.ownerId === null) check(tile.territoryCityId === null, `world.tiles.${key}.territoryCityId`);
      else {
        const territoryCity = reference(state.cities, tile.territoryCityId, `world.tiles.${key}.territoryCityId`);
        check(territoryCity.ownerId === tile.ownerId, `world.tiles.${key}.territoryCityId.ownerId`);
      }
    }
    if (tile.cityId !== null) {
      const city = reference(state.cities, tile.cityId, `world.tiles.${key}.cityId`);
      check(city.centerHex === key && city.ownerId === tile.ownerId, `world.tiles.${key}.cityId`);
      if (!legacyTerritory) check(tile.territoryCityId === tile.cityId, `world.tiles.${key}.territoryCityId: 都市中心の所属が一致しません`);
    }
  }
  const location = (key, path) => { const tile = reference(tiles, key, path); check(tile.terrainId !== 'void', path); return tile; };
  for (const [id, kingdom] of Object.entries(state.kingdoms)) {
    object(kingdom, `kingdoms.${id}`); check(kingdom.id === id, `kingdoms.${id}.id`); text(kingdom.name, `kingdoms.${id}.name`);
    defaultMissing(kingdom, 'controllerType', 'human');
    check(['human', 'ai'].includes(kingdom.controllerType), `kingdoms.${id}.controllerType`);
    if (Object.hasOwn(kingdom, 'aiPolicy')) check(['tactical', 'reinforcements'].includes(kingdom.aiPolicy), `kingdoms.${id}.aiPolicy`);
    for (const [name, records] of [['cityIds', state.cities], ['unitIds', state.units]]) {
      ids(kingdom[name], `kingdoms.${id}.${name}`);
      for (const entityId of kingdom[name]) check(reference(records, entityId, `kingdoms.${id}.${name}`).ownerId === id, `kingdoms.${id}.${name}.ownerId`);
    }
    fields(kingdom.stockpiles, ['gold', 'mana', 'popularSupport'], `kingdoms.${id}.stockpiles`);
    fields(kingdom.progress, ['science', 'culture'], `kingdoms.${id}.progress`);
    fields(kingdom.humanResources, ['native', 'military', 'governance', 'specialists', 'heroes', 'affiliates', 'migrants'], `kingdoms.${id}.humanResources`);
    fields(kingdom.derived, ['militaryPower', 'governanceCapacity', 'governanceLoad'], `kingdoms.${id}.derived`);
    fields(kingdom, ['institutions', 'supportIncome', 'supportUpkeep'], `kingdoms.${id}`);
  }
  const defended = Object.hasOwn(state, 'cityDefenseVersion');
  if (defended) check([1, 2, 3].includes(state.cityDefenseVersion) && state.scenarioObjective?.type === 'control-cities', 'cityDefenseVersion');
  const worked = new Set();
  for (const [id, city] of Object.entries(state.cities)) {
    object(city, `cities.${id}`); check(city.id === id, `cities.${id}.id`); text(city.name, `cities.${id}.name`);
    check(reference(state.kingdoms, city.ownerId, `cities.${id}.ownerId`).cityIds.includes(id), `cities.${id}.ownerId`);
    const tile = location(city.centerHex, `cities.${id}.centerHex`);
    check(tile.cityId === id && tile.ownerId === city.ownerId, `cities.${id}.centerHex`);
    integer(city.population, `cities.${id}.population`, 1);
    fields(city, ['foodStorage', 'localCultureProgress'], `cities.${id}`);
    ids(city.workedTiles, `cities.${id}.workedTiles`);
    check(city.workedTiles.length <= city.population, `cities.${id}.workedTiles: 作業人数が人口を超えています`);
    for (const key of city.workedTiles) {
      const workedTile = location(key, `cities.${id}.workedTiles`);
      check(workedTile.ownerId === city.ownerId, `cities.${id}.workedTiles.ownerId`);
      if (!legacyTerritory) {
        check(workedTile.territoryCityId === id, `cities.${id}.workedTiles.territoryCityId`);
        check(!worked.has(key), `cities.${id}.workedTiles: 作業タイルが重複しています`);
        worked.add(key);
      }
    }
    fields(city.yieldSummary, yields, `cities.${id}.yieldSummary`);
    // Historical saves may omit the display snapshot. If supplied, validate
    // the shape now used by the city panel, without rewriting past collection.
    if (Object.hasOwn(city, 'lastYieldBreakdown')) {
      const path = `cities.${id}.lastYieldBreakdown`, breakdown = object(city.lastYieldBreakdown, path);
      if (Object.hasOwn(breakdown, 'tiles')) for (const entry of array(breakdown.tiles, `${path}.tiles`)) {
        object(entry, `${path}.tiles`); reference(tiles, entry.tileKey, `${path}.tiles.tileKey`);
        reference(RULESET.terrain, entry.terrainId, `${path}.tiles.terrainId`);
        yieldRecord(entry.yields, `${path}.tiles.yields`);
      }
      if (Object.hasOwn(breakdown, 'buildings')) for (const entry of array(breakdown.buildings, `${path}.buildings`)) {
        object(entry, `${path}.buildings`);
        check(reference(RULESET.items, entry.buildingId, `${path}.buildings.buildingId`).category === 'building', `${path}.buildings.buildingId`);
        yieldRecord(entry.yields, `${path}.buildings.yields`);
      }
      for (const key of ['center', 'total', 'modifiers']) if (Object.hasOwn(breakdown, key)) yieldRecord(breakdown[key], `${path}.${key}`, key === 'modifiers');
    }
    object(city.yieldModifiers, `cities.${id}.yieldModifiers`);
    for (const [key, value] of Object.entries(city.yieldModifiers)) { check(yields.includes(key), `cities.${id}.yieldModifiers`); number(value, `cities.${id}.yieldModifiers.${key}`, -Number.MAX_SAFE_INTEGER); }
    ids(city.buildings, `cities.${id}.buildings`);
    city.buildings.forEach((item) => check(reference(RULESET.items, item, `cities.${id}.buildings`).category === 'building', `cities.${id}.buildings`));
    if (defended) {
      const path = `cities.${id}.defense`, defense = object(city.defense, path);
      integer(defense.hp, `${path}.hp`, 0, RULESET.cityDefense.maximumHp);
      integer(defense.wallHp, `${path}.wallHp`, 0, city.buildings.includes('walls') ? RULESET.cityDefense.wallHp : 0);
      if ([2, 3].includes(state.cityDefenseVersion)) integer(defense.counterattacksRemaining, `${path}.counterattacksRemaining`, 0, RULESET.cityDefense.counterattacksPerRound);
      else check(!Object.hasOwn(defense, 'counterattacksRemaining'), `${path}.counterattacksRemaining: 都市反撃の版がありません`);
      if (state.cityDefenseVersion === 3) integer(defense.bombardmentsRemaining, `${path}.bombardmentsRemaining`, 0, RULESET.cityBombardment.attacksPerRound);
      else check(!Object.hasOwn(defense, 'bombardmentsRemaining'), `${path}.bombardmentsRemaining: 都市砲撃の版がありません`);
      if (defense.lastDamagedTurn !== null) integer(defense.lastDamagedTurn, `${path}.lastDamagedTurn`, 1, state.currentTurn);
    } else check(!Object.hasOwn(city, 'defense') && !city.buildings.includes('walls'), `cities.${id}.defense: 都市防御の版がありません`);
    const production = object(city.production, `cities.${id}.production`);
    if (production.currentItemId !== null) reference(RULESET.items, production.currentItemId, `cities.${id}.production.currentItemId`);
    array(production.queue, `cities.${id}.production.queue`).forEach((item) => reference(RULESET.items, item, `cities.${id}.production.queue`));
    if (!defended) check(![production.currentItemId, ...production.queue, ...Object.keys(production.progressByItem ?? {})].includes('walls'), `cities.${id}.production: 城壁は都市防御の版が必要です`);
    object(production.progressByItem, `cities.${id}.production.progressByItem`);
    for (const [item, progress] of Object.entries(production.progressByItem)) number(progress, `cities.${id}.production.progressByItem.${item}`, 0, reference(RULESET.items, item, `cities.${id}.production.progressByItem`).productionCost);
  }
  for (const [id, unit] of Object.entries(state.units)) {
    check(unit.id === id, `units.${id}.id`);
    check(reference(state.kingdoms, unit.ownerId, `units.${id}.ownerId`).unitIds.includes(id), `units.${id}.ownerId`);
    location(unit.location, `units.${id}.location`);
    number(unit.maxHp, `units.${id}.maxHp`, Number.MIN_VALUE);
    number(unit.currentHp, `units.${id}.currentHp`, 0, unit.maxHp);
    check(unit.hp === unit.currentHp, `units.${id}.hp`);
    check(['active', 'downed', 'shattered'].includes(unit.status), `units.${id}.status`);
    check(['individual', 'detachment', 'construct', 'monster', 'swarm'].includes(unit.scaleClass), `units.${id}.scaleClass`);
    fields(unit, ['meleeStrength', 'rangedStrength', 'magicStrength', 'defenseStrength', 'resistance', 'armor', 'range', 'guardRate', 'guardCapacityMax', 'moraleContribution', 'commandContribution'], `units.${id}`);
    number(unit.guardCapacityRemaining, `units.${id}.guardCapacityRemaining`, 0, unit.guardCapacityMax);
    for (const key of ['accuracy', 'evasion', 'tauntStrength', 'coverPower']) number(unit[key], `units.${id}.${key}`, 0, 1);
    for (const effect of array(unit.statusEffects, `units.${id}.statusEffects`)) {
      const path = `units.${id}.statusEffects`;
      if (typeof effect === 'string') text(effect, path);
      else {
        object(effect, path);
        check(Object.hasOwn(effect, 'type') || Object.hasOwn(effect, 'id'), path);
        for (const key of ['type', 'id']) if (Object.hasOwn(effect, key)) text(effect[key], `${path}.${key}`);
      }
    }
    integer(unit.guardRange, `units.${id}.guardRange`, 0, 4);
    if (unit.partyId !== null) check(array(reference(state.parties, unit.partyId, `units.${id}.partyId`).unitIds, `units.${id}.partyId.unitIds`).includes(id), `units.${id}.partyId`);
  }
  const occupied = new Set();
  for (const [id, party] of Object.entries(state.parties)) {
    check(party.id === id, `parties.${id}.id`); reference(state.kingdoms, party.ownerId, `parties.${id}.ownerId`);
    location(party.location, `parties.${id}.location`);
    if (occupiesMapTile(party)) {
      check(!occupied.has(party.location), `parties.${id}.location: 占有が重複しています`); occupied.add(party.location);
    }
    ids(party.unitIds, `parties.${id}.unitIds`); check(party.unitIds.length >= 1 && party.unitIds.length <= 5, `parties.${id}.unitIds`);
    for (const unitId of party.unitIds) {
      const unit = reference(state.units, unitId, `parties.${id}.unitIds`);
      check(unit.partyId === id && unit.ownerId === party.ownerId && unit.location === party.location, `parties.${id}.unitIds.${unitId}`);
    }
    check(party.unitIds.includes(party.leaderUnitId), `parties.${id}.leaderUnitId`);
    check(!validateFormation(party, party.formation), `parties.${id}.formation`);
    object(party.guardOrders, `parties.${id}.guardOrders`);
    for (const [guardId, order] of Object.entries(party.guardOrders)) {
      object(order, `parties.${id}.guardOrders.${guardId}`);
      check(party.unitIds.includes(guardId) && party.unitIds.includes(order.targetUnitId) && guardId !== order.targetUnitId, `parties.${id}.guardOrders.${guardId}`);
      check(['share', 'intercept'].includes(order.mode), `parties.${id}.guardOrders.${guardId}.mode`);
    }
    fields(party, ['movementMaximum', 'attacksMaximum', 'reactionCharges', 'morale', 'cohesion'], `parties.${id}`);
    number(party.movementRemaining, `parties.${id}.movementRemaining`, 0, party.movementMaximum);
    integer(party.attacksRemaining, `parties.${id}.attacksRemaining`, 0, party.attacksMaximum);
    check(['active', 'defeated'].includes(party.status), `parties.${id}.status`);
    if (party.status === 'defeated') check(!hasActiveUnits(state, party), `parties.${id}.status: 敗北部隊に活動中のUnitがあります`);
    check(['ready', 'ended'].includes(party.activationState), `parties.${id}.activationState`);
    for (const key of ['hasMoved', 'hasAttacked']) check(typeof party[key] === 'boolean', `parties.${id}.${key}`);
    if (Object.hasOwn(party, 'restOrder')) {
      const path = `parties.${id}.restOrder`;
      check(recovery, `${path}: 休養の版がありません`);
      const order = object(party.restOrder, path);
      check(order.turn === state.currentTurn && state.lastProcessedTurn === state.currentTurn, `${path}.turn`);
      check(order.location === party.location, `${path}.location`);
      check(party.status === 'active' && hasActiveUnits(state, party) && party.activationState === 'ended', path);
      check(!party.hasMoved && !party.hasAttacked && party.movementRemaining === 0 && party.attacksRemaining === 0 && party.reactionCharges === 0, `${path}.actions`);
      check(party.unitIds.some(unitId => state.units[unitId].status === 'active' && state.units[unitId].currentHp > 0 && state.units[unitId].currentHp < state.units[unitId].maxHp), `${path}.wounded`);
    }
  }
  for (const party of Object.values(state.parties)) if (party.restOrder) check(!partyCareSafetyError(state, party), `parties.${party.id}.restOrder.safety`);
  if (legacyTerritory) {
    // Validate the whole historical save before repairing its known K-05
    // snapshots. Never collect income, progress production, or consume RNG.
    for (const kingdom of Object.values(state.kingdoms)) {
      if (Object.values(tiles).some(tile => tile.ownerId === kingdom.id)) check(kingdom.cityIds.length > 0, `kingdoms.${kingdom.id}.cityIds`);
    }
    assignLegacyCityTerritories(state);
    state.cityTerritoryVersion = 1;
    for (const kingdom of Object.values(state.kingdoms)) {
      if (kingdom.cityIds.length < 2) continue;
      for (const cityId of kingdom.cityIds) {
        calculateCityYields(state, state.cities[cityId]);
        fields(state.cities[cityId].yieldSummary, yields, `cities.${cityId}.yieldSummary`);
      }
      updateDerivedCapabilities(kingdom, state);
      fields(kingdom.derived, ['militaryPower', 'governanceCapacity', 'governanceLoad'], `kingdoms.${kingdom.id}.derived`);
    }
  }
  if (['ai-reinforcements', 'ai-conquest'].includes(state.scenarioId)) check(Object.values(state.kingdoms).some(kingdom => kingdom.controllerType === 'ai' && kingdom.aiPolicy === 'reinforcements'), 'scenario.aiPolicy');
  validateResearchSave(state);
  validateScenarioSave(state);
  return state;
}
