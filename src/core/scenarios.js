import { initializeCityDefense } from '../models/city-defense.js';
import { addCity, addKingdom, createInitialGameState } from './game-state.js';
import { createUnit } from '../models/unit.js';
import { createParty } from '../models/party.js';
import { updateDerivedCapabilities } from '../models/kingdom.js';

export const createDuelGameState = (seed = 117) => createDuel(seed, false);
export const createRangedDuelGameState = (seed = 117) => createDuel(seed, true);

export function createTwoCityGameState(seed = 117) {
  const state = createInitialGameState(seed, { startingParty: true });
  state.scenarioId = 'two-cities';
  state.world.tiles['4,-4,0'].terrainId = 'plains';
  addCity(state, { ownerId: 'kingdom-1', id: 'city-2', name: '東都', centerHex: '4,-4,0' });
  return state;
}

export function createSettlementGameState(seed = 117) {
  const state = createInitialGameState(seed, { startingParty: true });
  state.scenarioId = 'settlement';
  const id = `unit-${state.nextIds.unit++}`, party = state.parties['party-1'];
  state.units[id] = createUnit(id, party.ownerId, 'settler', party.location);
  state.units[id].partyId = party.id; party.unitIds.push(id);
  party.formation['rear-center'] = id; state.kingdoms[party.ownerId].unitIds.push(id);
  for (let q = 1; q <= 4; q++) state.world.tiles[`${q},0,${-q}`].terrainId = 'plains';
  updateDerivedCapabilities(state.kingdoms[party.ownerId], state);
  return state;
}

export function createAiSkirmishGameState(seed = 117) {
  const state = createDuel(seed, true);
  state.scenarioId = 'ai-skirmish'; state.kingdoms['kingdom-2'].controllerType = 'ai';
  const enemy = state.parties['party-2']; enemy.location = '6,-6,0';
  enemy.unitIds.forEach(id => { state.units[id].location = enemy.location; });
  for (let q = 1; q <= 6; q++) state.world.tiles[`${q},${-q},0`].terrainId = 'plains';
  state.scenarioObjective = { type: 'eliminate-parties', participantIds: [...state.turnOrder], turnLimit: 40 };
  state.gameResult = null;
  return state;
}

export function createAiReinforcementGameState(seed = 117) {
  const state = createAiSkirmishGameState(seed);
  state.scenarioId = 'ai-reinforcements';
  state.kingdoms['kingdom-2'].aiPolicy = 'reinforcements';
  return state;
}

export function createAiConquestGameState(seed = 117) {
  const state = createAiReinforcementGameState(seed);
  state.scenarioId = 'ai-conquest'; state.scenarioObjective.type = 'control-cities';
  state.cityDefenseVersion = 3; Object.values(state.cities).forEach(city => initializeCityDefense(state, city));
  return state;
}

function createDuel(seed, ranged) {
  const state = createInitialGameState(seed);
  state.scenarioId = ranged ? 'ranged-duel' : 'duel';
  state.world.tiles['4,-4,0'].terrainId = 'plains';
  addKingdom(state, { id: 'kingdom-2', name: '夕映王国', cityId: 'city-2', cityName: '黄昏都', centerHex: '4,-4,0' });
  for (const [index, location] of ['1,-1,0', '2,-2,0'].entries()) {
    const owner = `kingdom-${index + 1}`, partyId = `party-${state.nextIds.party++}`, ids = [];
    state.world.tiles[location].terrainId = 'plains';
    const types = ranged ? ['warrior', 'warrior', 'archer', 'archer', 'ballista'] : ['warrior', 'warrior', 'warrior'];
    for (const type of types) {
      const id = `unit-${state.nextIds.unit++}`, unit = createUnit(id, owner, type, location);
      unit.partyId = partyId; state.units[id] = unit; state.kingdoms[owner].unitIds.push(id); ids.push(id);
    }
    const party = createParty(partyId, owner, ids, location);
    party.formation = ranged ? { 'front-center': ids[0], 'front-left': ids[1], 'middle-center': ids[2], 'rear-left': ids[3], 'rear-right': ids[4] } : { 'front-center': ids[0], 'front-left': ids[1], 'rear-center': ids[2] };
    party.guardOrders[ids[1]] = { targetUnitId: ids[0], mode: 'share' };
    state.parties[partyId] = party;
  }
  for (const kingdom of Object.values(state.kingdoms)) updateDerivedCapabilities(kingdom, state);
  return state;
}
