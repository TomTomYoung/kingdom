import { attackParty, createParty, endTurn, foundCity, moveParty, purchaseCityItem, purchaseTile, setCityProduction, setFormation, setGuardOrder, startTurn } from './commands.js';
export class HumanController {
  constructor(playerId) { this.playerId = playerId; }
  nextId(state) { return `${this.playerId}-${state.currentTurn}-${state.commandLog.length + 1}`; }
  startTurn(state) { return startTurn(this.playerId, state.currentTurn, this.nextId(state)); }
  setProduction(state, cityId, itemId, queue = []) { return setCityProduction(this.playerId, state.currentTurn, cityId, itemId, queue, this.nextId(state)); }
  purchaseItem(state, cityId, itemId) { return purchaseCityItem(this.playerId, state.currentTurn, cityId, itemId, 'gold', this.nextId(state)); }
  purchaseTile(state, cityId, tileKey) { return purchaseTile(this.playerId, state.currentTurn, cityId, tileKey, this.nextId(state)); }
  createParty(state, unitIds, location) { return createParty(this.playerId, state.currentTurn, unitIds, location, this.nextId(state)); }
  setFormation(state, partyId, formation) { return setFormation(this.playerId, state.currentTurn, partyId, formation, this.nextId(state)); }
  moveParty(state, partyId, path) { return moveParty(this.playerId, state.currentTurn, partyId, path, this.nextId(state)); }
  attackParty(state, attackerPartyId, defenderPartyId, attackType = 'melee', targeting = {}) { return attackParty(this.playerId, state.currentTurn, attackerPartyId, defenderPartyId, attackType, this.nextId(state), targeting); }
  setGuardOrder(state, partyId, guardUnitId, targetUnitId, mode) { return setGuardOrder(this.playerId, state.currentTurn, partyId, guardUnitId, targetUnitId, mode, this.nextId(state)); }
  foundCity(state, partyId, settlerUnitId) { return foundCity(this.playerId, state.currentTurn, partyId, settlerUnitId, this.nextId(state)); }
  endTurn(state) { return endTurn(this.playerId, state.currentTurn, this.nextId(state)); }
}
