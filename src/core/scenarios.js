import { addKingdom, createInitialGameState } from './game-state.js';
import { createUnit } from '../models/unit.js';
import { createParty } from '../models/party.js';
import { updateDerivedCapabilities } from '../models/kingdom.js';

export const createDuelGameState = (seed = 117) => createDuel(seed, false);
export const createRangedDuelGameState = (seed = 117) => createDuel(seed, true);

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
