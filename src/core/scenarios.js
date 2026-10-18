import { addKingdom, createInitialGameState } from './game-state.js';
import { createUnit } from '../models/unit.js';
import { createParty } from '../models/party.js';
import { updateDerivedCapabilities } from '../models/kingdom.js';

export function createDuelGameState(seed = 117) {
  const state = createInitialGameState(seed);
  state.scenarioId = 'duel';
  state.world.tiles['4,-4,0'].terrainId = 'plains';
  addKingdom(state, { id: 'kingdom-2', name: '夕映王国', cityId: 'city-2', cityName: '黄昏都', centerHex: '4,-4,0' });
  for (const [index, location] of ['1,-1,0', '2,-2,0'].entries()) {
    const owner = `kingdom-${index + 1}`, partyId = `party-${state.nextIds.party++}`, ids = [];
    state.world.tiles[location].terrainId = 'plains';
    for (let i = 0; i < 3; i++) {
      const id = `unit-${state.nextIds.unit++}`, unit = createUnit(id, owner, 'warrior', location);
      unit.partyId = partyId; state.units[id] = unit; state.kingdoms[owner].unitIds.push(id); ids.push(id);
    }
    const party = createParty(partyId, owner, ids, location);
    party.formation = { 'front-center': ids[0], 'front-left': ids[1], 'rear-center': ids[2] };
    party.guardOrders[ids[1]] = { targetUnitId: ids[0], mode: 'share' };
    state.parties[partyId] = party;
  }
  for (const kingdom of Object.values(state.kingdoms)) updateDerivedCapabilities(kingdom, state);
  return state;
}
