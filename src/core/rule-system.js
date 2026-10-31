import { resolveSelectResearch, itemResearchError } from '../systems/research-system.js';
import { resolveCityBombardment } from '../systems/city-bombardment.js';
import { resolvePartyRest, resolveRemoveCasualties, cancelPartyRest, partyCareSafetyError } from '../systems/party-care.js';
import { hasCityDefense, cityEntryError } from '../models/city-defense.js';
import { resolveCityAttack } from '../systems/city-siege.js';
import { cloneGameState } from './game-state.js';
import { COMMAND_TYPES } from './commands.js';
import { RULESET } from './ruleset.js';
import { processTurnStart } from './turn-engine.js';
import { completeItem, validateProductionSelection } from '../systems/production-system.js';
import { getTerritoryCandidates, tilePurchaseCost } from '../systems/territory-system.js';
import { claimTileForCity } from '../systems/city-territory.js';
import { updateDerivedCapabilities } from '../models/kingdom.js';
import { createParty, validateFormation, isActiveUnit, hasActiveUnits, occupiesMapTile } from '../models/party.js';
import { validateCommand } from './command-validation.js';
import { validatePartyPath } from '../systems/movement-system.js';
import { validateGuardOrder } from '../systems/damage-grid.js';
import { resolvePartyAttack } from '../systems/combat-system.js';
import { resolveScenario } from '../systems/scenario-system.js';
import { resolveReinforceParty, resolveMergeParties, resolveSplitParty } from '../systems/party-reorganization.js';
import { resolveCaptureCity } from '../systems/city-capture.js';
import { resolveFoundCity } from '../systems/founding-system.js';

const fail = (reason) => ({ ok: false, reason });
function context(state, command) {
  const malformed = validateCommand(state, command); if (malformed) return fail(malformed);
  if (state.commandLog.some((entry) => entry.commandId === command.commandId)) return fail('処理済みのCommandです');
  if (!state.kingdoms[command.playerId]) return fail('不明なプレイヤーです');
  if (state.activePlayerId !== command.playerId) return fail('現在の手番ではありません');
  if (command.turn !== state.currentTurn) return fail('ターンが一致しません');
  return null;
}
function cityFor(state, command) {
  const city = Object.hasOwn(state.cities, command.payload.cityId) && state.cities[command.payload.cityId];
  return city?.ownerId === command.playerId ? city : null;
}

export class RuleSystem {
  static execute(original, command) {
    const invalid = context(original, command); if (invalid) return { ...invalid, state: original, events: [] };
    const state = cloneGameState(original); const events = [];
    const reject = (reason) => ({ ok: false, reason, state: original, events: [] });
    const city = command.payload?.cityId ? cityFor(state, command) : null;
    if (command.payload?.cityId && !city && ![COMMAND_TYPES.CAPTURE_CITY, COMMAND_TYPES.ATTACK_CITY].includes(command.type)) return reject('この都市を操作できません');

    if (command.type === COMMAND_TYPES.START_TURN) {
      if (state.lastProcessedTurn === state.currentTurn) return reject('このターンは開始処理済みです');
      processTurnStart(state, events);
    } else if (command.type === COMMAND_TYPES.SELECT_RESEARCH) {
      const reason = resolveSelectResearch(state, command.playerId, command.payload.technologyId, events);
      if (reason) return reject(reason);
    } else if (command.type === COMMAND_TYPES.SET_CITY_PRODUCTION) {
      if (state.phase !== 'PLAYER_ACTION') return reject('行動フェーズではありません');
      if (command.payload.itemId !== null && !Object.hasOwn(RULESET.items, command.payload.itemId)) return reject('不明な生産対象です');
      if (!command.payload.queue.every((id) => Object.hasOwn(RULESET.items, id))) return reject('キューに不明な生産対象があります');
      if (!hasCityDefense(state) && [command.payload.itemId, ...command.payload.queue].includes('walls')) return reject('城壁は新規の都市争奪戦で建設できます');
      for (const itemId of [command.payload.itemId, ...command.payload.queue]) {
        const reason = itemResearchError(state, command.playerId, itemId); if (reason) return reject(reason);
      }
      const productionError = validateProductionSelection(city, command.payload.itemId, command.payload.queue);
      if (productionError) return reject(productionError);
      city.production.currentItemId = command.payload.itemId; city.production.queue = [...command.payload.queue];
      events.push({ type: 'ProductionSet', cityId: city.id, itemId: command.payload.itemId, queue: [...command.payload.queue] });
    } else if (command.type === COMMAND_TYPES.PURCHASE_CITY_ITEM) {
      const item = Object.hasOwn(RULESET.items, command.payload.itemId) && RULESET.items[command.payload.itemId]; if (!item) return reject('不明な購入対象です');
      if (item.itemId === 'walls' && !hasCityDefense(state)) return reject('城壁は新規の都市争奪戦で建設できます');
      const researchError = itemResearchError(state, command.playerId, item.itemId); if (researchError) return reject(researchError);
      const cost = Object.hasOwn(item.purchaseOptions ?? {}, command.payload.currency) ? item.purchaseOptions[command.payload.currency] : undefined; if (cost === undefined) return reject('この対象は指定通貨で購入できません');
      const kingdom = state.kingdoms[command.playerId]; if ((kingdom.stockpiles[command.payload.currency] ?? 0) < cost) return reject(`${command.payload.currency}が不足しています`);
      if (item.category === 'building' && city.buildings.includes(item.itemId)) return reject('建設済みです');
      kingdom.stockpiles[command.payload.currency] -= cost; completeItem(state, city, item.itemId, 'purchase', events); updateDerivedCapabilities(kingdom, state);
    } else if (command.type === COMMAND_TYPES.PURCHASE_TILE) {
      const tile = Object.hasOwn(state.world.tiles, command.payload.tileKey) && state.world.tiles[command.payload.tileKey];
      if (!tile || tile.terrainId === 'void') return reject('購入できないタイルです');
      if (tile.ownerId !== null) return reject('所有済みまたは他国領です');
      const candidates = getTerritoryCandidates(state, city); if (!candidates.some(({ key }) => key === tile.key)) return reject('この都市の領土に隣接していません');
      const cost = tilePurchaseCost(state, city, tile); const kingdom = state.kingdoms[command.playerId]; if (kingdom.stockpiles.gold < cost) return reject('goldが不足しています');
      kingdom.stockpiles.gold -= cost; claimTileForCity(state, city, tile); events.push({ type: 'TerritoryExpanded', cityId: city.id, tileKey: tile.key, source: 'gold', cost }); updateDerivedCapabilities(kingdom, state);
    } else if (command.type === COMMAND_TYPES.CREATE_PARTY) {
      if (state.phase !== 'PLAYER_ACTION') return reject('行動フェーズではありません');
      const unitIds = command.payload.unitIds;
      if (!Array.isArray(unitIds) || unitIds.length === 0 || unitIds.length > 5 || new Set(unitIds).size !== unitIds.length) return reject('Partyは重複しない1〜5名で編成してください');
      const units = unitIds.map((id) => Object.hasOwn(state.units, id) && state.units[id]);
      if (units.some((unit) => !unit || unit.ownerId !== command.playerId)) return reject('自国のUnitだけを編成できます');
      if (units.some((unit) => !isActiveUnit(unit))) return reject('戦闘可能なUnitだけを編成できます');
      if (units.some((unit) => unit.partyId !== null)) return reject('既にPartyへ所属するUnitが含まれます');
      if (units.some((unit) => unit.location !== command.payload.location)) return reject('同じ場所にいるUnitだけを編成できます');
      const tile = Object.hasOwn(state.world.tiles, command.payload.location) && state.world.tiles[command.payload.location];
      if (!tile || tile.terrainId === 'void') return reject('Partyを編成できない場所です');
      if (Object.values(state.parties).some((party) => occupiesMapTile(party) && party.location === tile.key)) return reject('他のPartyが占有しています。先に移動してください');
      const entryError = cityEntryError(state, command.playerId, tile.key); if (entryError) return reject(entryError);
      const partyId = `party-${state.nextIds.party++}`;
      state.parties[partyId] = createParty(partyId, command.playerId, unitIds, command.payload.location);
      units.forEach((unit) => { unit.partyId = partyId; });
      events.push({ type: 'PartyCreated', partyId, unitIds: [...unitIds], location: command.payload.location });
    } else if ([COMMAND_TYPES.REINFORCE_PARTY, COMMAND_TYPES.MERGE_PARTIES, COMMAND_TYPES.SPLIT_PARTY].includes(command.type)) {
      const p = command.payload;
      const result = command.type === COMMAND_TYPES.REINFORCE_PARTY ? resolveReinforceParty(state, command.playerId, p.partyId, p.unitIds, events)
        : command.type === COMMAND_TYPES.MERGE_PARTIES ? resolveMergeParties(state, command.playerId, p.sourcePartyId, p.targetPartyId, events)
        : resolveSplitParty(state, command.playerId, p.partyId, p.unitIds, p.location, events);
      if (!result.ok) return reject(result.reason);
    } else if ([COMMAND_TYPES.REST_PARTY, COMMAND_TYPES.REMOVE_CASUALTIES].includes(command.type)) {
      const resolver = command.type === COMMAND_TYPES.REST_PARTY ? resolvePartyRest : resolveRemoveCasualties;
      const result = resolver(state, command.playerId, command.payload.partyId, events);
      if (!result.ok) return reject(result.reason);
    } else if (command.type === COMMAND_TYPES.BOMBARD_PARTY) {
      const p = command.payload, result = resolveCityBombardment(state, command.playerId, p.cityId, p.defenderPartyId, events);
      if (!result.ok) return reject(result.reason);
    } else if (command.type === COMMAND_TYPES.ATTACK_CITY) {
      const p = command.payload, result = resolveCityAttack(state, command.playerId, p.partyId, p.cityId, p.attackType, events);
      if (!result.ok) return reject(result.reason);
    } else if (command.type === COMMAND_TYPES.CAPTURE_CITY) {
      const captured = resolveCaptureCity(state, command.playerId, command.payload.partyId, command.payload.cityId, events);
      if (!captured.ok) return reject(captured.reason);
    } else if (command.type === COMMAND_TYPES.FOUND_CITY) {
      const founded = resolveFoundCity(state, command.playerId, command.payload.partyId, command.payload.settlerUnitId, events);
      if (!founded.ok) return reject(founded.reason);
    } else if (command.type === COMMAND_TYPES.SET_FORMATION) {
      if (state.phase !== 'PLAYER_ACTION') return reject('行動フェーズではありません');
      const party = state.parties[command.payload.partyId];
      if (!party || party.ownerId !== command.playerId) return reject('このPartyを操作できません');
      if (party.status !== 'active' || !hasActiveUnits(state, party)) return reject('編成を変更できるPartyではありません');
      const formationError = validateFormation(party, command.payload.formation);
      if (formationError) return reject(formationError);
      party.formation = { ...command.payload.formation };
      events.push({ type: 'FormationChanged', partyId: party.id, formation: { ...party.formation } });
    } else if (command.type === COMMAND_TYPES.SET_GUARD_ORDER) {
      const { partyId, guardUnitId, targetUnitId, mode } = command.payload;
      const party = Object.hasOwn(state.parties, partyId) && state.parties[partyId];
      if (!party || party.ownerId !== command.playerId || party.status !== 'active') return reject('この部隊の護衛は変更できません');
      const guardError = validateGuardOrder(state, party, guardUnitId, targetUnitId, mode);
      if (guardError) return reject(guardError);
      party.guardOrders ??= {};
      if (mode === 'off') delete party.guardOrders[guardUnitId];
      else party.guardOrders[guardUnitId] = { targetUnitId, mode };
      events.push({ type: 'GuardOrderChanged', partyId, guardUnitId, targetUnitId, mode });
    } else if (command.type === COMMAND_TYPES.MOVE_PARTY) {
      if (state.phase !== 'PLAYER_ACTION') return reject('行動フェーズではありません');
      const party = state.parties[command.payload.partyId];
      if (!party || party.ownerId !== command.playerId) return reject('このPartyを操作できません');
      const movement = validatePartyPath(state, party, command.payload.path);
      if (!movement.ok) return reject(movement.reason);
      party.location = movement.destination; party.movementRemaining -= movement.cost; party.hasMoved = true;
      party.unitIds.forEach((unitId) => { state.units[unitId].location = movement.destination; });
      events.push({ type: 'PartyMoved', partyId: party.id, path: [...command.payload.path], cost: movement.cost, movementRemaining: party.movementRemaining });
    } else if (command.type === COMMAND_TYPES.ATTACK_PARTY) {
      if (state.phase !== 'PLAYER_ACTION') return reject('行動フェーズではありません');
      const attacker = state.parties[command.payload.attackerPartyId]; const defender = state.parties[command.payload.defenderPartyId];
      if (!attacker || attacker.ownerId !== command.playerId) return reject('このPartyを操作できません');
      if (!defender || defender.ownerId === command.playerId) return reject('敵Partyを指定してください');
      const combat = resolvePartyAttack(state, attacker, defender, command.payload.attackType, events, undefined, command.payload.targeting);
      if (!combat.ok) return reject(combat.reason);
    } else if (command.type === COMMAND_TYPES.END_TURN) {
      if (state.phase !== 'PLAYER_ACTION') return reject('行動フェーズではありません');
      events.push({ type: 'PlayerTurnEnded', turn: command.turn, playerId: command.playerId });
      const roundComplete = state.activePlayerIndex === state.turnOrder.length - 1;
      resolveScenario(state, events, { roundComplete });
      if (!state.gameResult) {
        state.activePlayerIndex = (state.activePlayerIndex + 1) % state.turnOrder.length; state.activePlayerId = state.turnOrder[state.activePlayerIndex];
        if (roundComplete) { state.phase = 'TURN_END'; state.currentTurn += 1; events.push({ type: 'TurnEnded', turn: command.turn }); processTurnStart(state, events); }
      }
    } else return reject('不明なCommandです');

    if (state.partyRecoveryVersion === 1) for (const party of Object.values(state.parties)) {
      if (party.restOrder) { const reason = partyCareSafetyError(state, party); if (reason) cancelPartyRest(party, events, reason); }
    }
    if (state.partyRecoveryVersion === 1 && events.some(event => ['CombatDamage', 'PartyCasualtiesRemoved'].includes(event.type))) {
      for (const kingdom of Object.values(state.kingdoms)) updateDerivedCapabilities(kingdom, state);
    }
    resolveScenario(state, events);
    state.commandLog.push(structuredClone(command)); state.eventLog.push(...events.map((event) => ({ turn: state.currentTurn, ...event })));
    return { ok: true, state, events };
  }
}
