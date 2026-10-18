import { RULESET } from './ruleset.js';
import { validateFormation } from '../models/party.js';

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

// Only known historical omissions are migrated. Nulls and broken references are
// errors, not invitations to regenerate a map, an army, or its random streams.
export function migrateAndValidateSave(state) {
  object(state, 'root');
  for (const name of ['kingdoms', 'cities', 'units', 'world', 'rng', 'nextIds']) object(state[name], name);
  integer(state.seed, 'seed', -Number.MAX_SAFE_INTEGER);
  defaultMissing(state, 'parties', {}); object(state.parties, 'parties');
  defaultMissing(state.rng, 'combat', { seed: (state.seed ^ 0x85ebca6b) >>> 0, state: (state.seed ^ 0x85ebca6b) >>> 0 });
  defaultMissing(state, 'turnOrder', Object.keys(state.kingdoms)); ids(state.turnOrder, 'turnOrder');
  defaultMissing(state, 'activePlayerIndex', state.turnOrder.indexOf(state.activePlayerId));
  defaultMissing(state.nextIds, 'party', 1);
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
    defaultMissing(unit, 'guardRange', 1);
  }
  for (const [id, party] of Object.entries(state.parties)) {
    object(party, `parties.${id}`);
    defaultMissing(party, 'guardOrders', {});
    for (const [key, value] of Object.entries({ attacksMaximum: 1, activationState: 'ready', hasMoved: false, hasAttacked: false, reactionCharges: 1 })) defaultMissing(party, key, value);
  }

  integer(state.currentTurn, 'currentTurn', 1);
  integer(state.lastProcessedTurn, 'lastProcessedTurn', 0, state.currentTurn);
  check(['PLAYER_ACTION', 'TURN_END'].includes(state.phase), 'phase');
  check(state.turnOrder.length > 0 && state.turnOrder.length === Object.keys(state.kingdoms).length, 'turnOrder');
  state.turnOrder.forEach((id) => reference(state.kingdoms, id, 'turnOrder'));
  integer(state.activePlayerIndex, 'activePlayerIndex', 0, state.turnOrder.length - 1);
  check(state.activePlayerId === state.turnOrder[state.activePlayerIndex], 'activePlayerId');
  for (const name of ['territory', 'combat']) {
    object(state.rng[name], `rng.${name}`);
    for (const key of ['seed', 'state']) integer(state.rng[name][key], `rng.${name}.${key}`, 0, 0xffffffff);
  }
  for (const name of ['unit', 'party', 'command']) integer(state.nextIds[name], `nextIds.${name}`, 1);
  for (const [kind, records] of [['unit', state.units], ['party', state.parties]]) {
    for (const id of Object.keys(records)) {
      const match = id.match(new RegExp(`^${kind}-(\\d+)$`));
      if (match) check(Number(match[1]) < state.nextIds[kind], `nextIds.${kind}`);
    }
  }
  const commandIds = new Set();
  for (const entry of array(state.commandLog, 'commandLog')) {
    object(entry, 'commandLog'); text(entry.commandId, 'commandLog.commandId');
    check(!commandIds.has(entry.commandId), 'commandLog.commandId'); commandIds.add(entry.commandId);
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
    if (tile.cityId !== null) {
      const city = reference(state.cities, tile.cityId, `world.tiles.${key}.cityId`);
      check(city.centerHex === key && city.ownerId === tile.ownerId, `world.tiles.${key}.cityId`);
    }
  }
  const location = (key, path) => { const tile = reference(tiles, key, path); check(tile.terrainId !== 'void', path); return tile; };
  for (const [id, kingdom] of Object.entries(state.kingdoms)) {
    object(kingdom, `kingdoms.${id}`); check(kingdom.id === id, `kingdoms.${id}.id`); text(kingdom.name, `kingdoms.${id}.name`);
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
  for (const [id, city] of Object.entries(state.cities)) {
    object(city, `cities.${id}`); check(city.id === id, `cities.${id}.id`); text(city.name, `cities.${id}.name`);
    check(reference(state.kingdoms, city.ownerId, `cities.${id}.ownerId`).cityIds.includes(id), `cities.${id}.ownerId`);
    const tile = location(city.centerHex, `cities.${id}.centerHex`);
    check(tile.cityId === id && tile.ownerId === city.ownerId, `cities.${id}.centerHex`);
    integer(city.population, `cities.${id}.population`, 1);
    fields(city, ['foodStorage', 'localCultureProgress'], `cities.${id}`);
    ids(city.workedTiles, `cities.${id}.workedTiles`);
    for (const key of city.workedTiles) check(location(key, `cities.${id}.workedTiles`).ownerId === city.ownerId, `cities.${id}.workedTiles.ownerId`);
    fields(city.yieldSummary, yields, `cities.${id}.yieldSummary`);
    object(city.yieldModifiers, `cities.${id}.yieldModifiers`);
    for (const [key, value] of Object.entries(city.yieldModifiers)) { check(yields.includes(key), `cities.${id}.yieldModifiers`); number(value, `cities.${id}.yieldModifiers.${key}`, -Number.MAX_SAFE_INTEGER); }
    ids(city.buildings, `cities.${id}.buildings`);
    city.buildings.forEach((item) => check(reference(RULESET.items, item, `cities.${id}.buildings`).category === 'building', `cities.${id}.buildings`));
    const production = object(city.production, `cities.${id}.production`);
    if (production.currentItemId !== null) reference(RULESET.items, production.currentItemId, `cities.${id}.production.currentItemId`);
    array(production.queue, `cities.${id}.production.queue`).forEach((item) => reference(RULESET.items, item, `cities.${id}.production.queue`));
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
    array(unit.statusEffects, `units.${id}.statusEffects`);
    integer(unit.guardRange, `units.${id}.guardRange`, 0, 4);
    if (unit.partyId !== null) check(array(reference(state.parties, unit.partyId, `units.${id}.partyId`).unitIds, `units.${id}.partyId.unitIds`).includes(id), `units.${id}.partyId`);
  }
  const occupied = new Set();
  for (const [id, party] of Object.entries(state.parties)) {
    check(party.id === id, `parties.${id}.id`); reference(state.kingdoms, party.ownerId, `parties.${id}.ownerId`);
    location(party.location, `parties.${id}.location`);
    check(!occupied.has(party.location), `parties.${id}.location: 占有が重複しています`); occupied.add(party.location);
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
    check(['ready', 'ended'].includes(party.activationState), `parties.${id}.activationState`);
    for (const key of ['hasMoved', 'hasAttacked']) check(typeof party[key] === 'boolean', `parties.${id}.${key}`);
  }
  return state;
}
