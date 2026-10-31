export const COMMAND_TYPES = Object.freeze({ SELECT_RESEARCH: 'SelectResearch', START_TURN: 'StartTurn', SET_CITY_PRODUCTION: 'SetCityProduction', PURCHASE_CITY_ITEM: 'PurchaseCityItem', PURCHASE_TILE: 'PurchaseTile', END_TURN: 'EndTurn', CREATE_PARTY: 'CreateParty', SET_FORMATION: 'SetFormation', MOVE_PARTY: 'MoveParty', ATTACK_PARTY: 'AttackParty', SET_GUARD_ORDER: 'SetGuardOrder', FOUND_CITY: 'FoundCity', REINFORCE_PARTY: 'ReinforceParty', MERGE_PARTIES: 'MergeParties', SPLIT_PARTY: 'SplitParty', CAPTURE_CITY: 'CaptureCity', ATTACK_CITY: 'AttackCity', BOMBARD_PARTY: 'BombardParty', REST_PARTY: 'RestParty', REMOVE_CASUALTIES: 'RemoveCasualties' });
export function command(type, playerId, turn, payload = {}, commandId) { return { commandId, type, playerId, turn, phase: type === COMMAND_TYPES.START_TURN ? 'TURN_START' : 'PLAYER_ACTION', payload }; }
export const startTurn = (playerId, turn, commandId) => command(COMMAND_TYPES.START_TURN, playerId, turn, {}, commandId);
export const setCityProduction = (playerId, turn, cityId, itemId, queue = [], commandId) => command(COMMAND_TYPES.SET_CITY_PRODUCTION, playerId, turn, { cityId, itemId, queue }, commandId);
export const purchaseCityItem = (playerId, turn, cityId, itemId, currency = 'gold', commandId) => command(COMMAND_TYPES.PURCHASE_CITY_ITEM, playerId, turn, { cityId, itemId, currency }, commandId);
export const purchaseTile = (playerId, turn, cityId, tileKey, commandId) => command(COMMAND_TYPES.PURCHASE_TILE, playerId, turn, { cityId, tileKey }, commandId);
export const endTurn = (playerId, turn, commandId) => command(COMMAND_TYPES.END_TURN, playerId, turn, {}, commandId);

export const createParty = (playerId, turn, unitIds, location, commandId) => command(COMMAND_TYPES.CREATE_PARTY, playerId, turn, { unitIds, location }, commandId);
export const setFormation = (playerId, turn, partyId, formation, commandId) => command(COMMAND_TYPES.SET_FORMATION, playerId, turn, { partyId, formation }, commandId);
export const moveParty = (playerId, turn, partyId, path, commandId) => command(COMMAND_TYPES.MOVE_PARTY, playerId, turn, { partyId, path }, commandId);
export const attackParty = (playerId, turn, attackerPartyId, defenderPartyId, attackType = 'melee', commandId, targeting = {}) => command(COMMAND_TYPES.ATTACK_PARTY, playerId, turn, { attackerPartyId, defenderPartyId, attackType, targeting }, commandId);

export const setGuardOrder = (playerId, turn, partyId, guardUnitId, targetUnitId, mode, commandId) => command(COMMAND_TYPES.SET_GUARD_ORDER, playerId, turn, { partyId, guardUnitId, targetUnitId, mode }, commandId);

export const foundCity = (playerId, turn, partyId, settlerUnitId, commandId) => command(COMMAND_TYPES.FOUND_CITY, playerId, turn, { partyId, settlerUnitId }, commandId);

export const reinforceParty = (playerId, turn, partyId, unitIds, commandId) => command(COMMAND_TYPES.REINFORCE_PARTY, playerId, turn, { partyId, unitIds }, commandId);
export const mergeParties = (playerId, turn, sourcePartyId, targetPartyId, commandId) => command(COMMAND_TYPES.MERGE_PARTIES, playerId, turn, { sourcePartyId, targetPartyId }, commandId);
export const splitParty = (playerId, turn, partyId, unitIds, location, commandId) => command(COMMAND_TYPES.SPLIT_PARTY, playerId, turn, { partyId, unitIds, location }, commandId);

export const captureCity = (playerId, turn, partyId, cityId, commandId) => command(COMMAND_TYPES.CAPTURE_CITY, playerId, turn, { partyId, cityId }, commandId);

export const attackCity = (playerId, turn, partyId, cityId, attackType = 'melee', commandId) => command(COMMAND_TYPES.ATTACK_CITY, playerId, turn, { partyId, cityId, attackType }, commandId);

export const restParty = (playerId, turn, partyId, commandId) => command(COMMAND_TYPES.REST_PARTY, playerId, turn, { partyId }, commandId);
export const removeCasualties = (playerId, turn, partyId, commandId) => command(COMMAND_TYPES.REMOVE_CASUALTIES, playerId, turn, { partyId }, commandId);

export const bombardParty = (playerId, turn, cityId, defenderPartyId, commandId) => command(COMMAND_TYPES.BOMBARD_PARTY, playerId, turn, { cityId, defenderPartyId }, commandId);

export const selectResearch = (playerId, turn, technologyId, commandId) => command(COMMAND_TYPES.SELECT_RESEARCH, playerId, turn, { technologyId }, commandId);
