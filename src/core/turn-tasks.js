import { RULESET } from './ruleset.js';
import { ABILITIES, abilityAvailable } from './abilities.js';
import { isActiveUnit, hasActiveUnits, occupiesMapTile } from '../models/party.js';
import { Hex } from '../world/hex.js';
import { validatePartyPath } from '../systems/movement-system.js';
import { validatePartyAttack } from '../systems/combat-system.js';
import { validateCityAttack } from '../systems/city-siege.js';
import { validateCityBombardment } from '../systems/city-bombardment.js';
import { validateCaptureCity } from '../systems/city-capture.js';
import { validateFoundCity } from '../systems/founding-system.js';
import { validateAbility, abilityTargets } from '../systems/ability-system.js';
import { previewPartyRest, validateRemoveCasualties } from '../systems/party-care.js';
import { validateReinforceParty, validateMergeParties, validateSplitParty } from '../systems/party-reorganization.js';
import { researchSelectionError } from '../systems/research-system.js';
import { cityEntryError } from '../models/city-defense.js';

export const hasTurnTasks = state => state.turnFlowVersion === 1;
const ordered = records => Object.values(records).sort((a, b) => a.id.localeCompare(b.id));

// Opt in at the playable-game boundary. Historical state factories and replay
// readers remain available without silently rewriting old command histories.
export function enableTurnFlow(state) {
  if (hasTurnTasks(state)) return state;
  state.turnFlowVersion = 1;
  state.lastSettledTurn = state.currentTurn - 1;
  resetTurnTasks(state);
  return state;
}
export function resetTurnTasks(state) {
  if (hasTurnTasks(state)) state.turnTasks = { turn: state.currentTurn, playerId: state.activePlayerId, skipped: [] };
}

// One decision per controllable entity, with its currently legal alternatives.
// Alternative moves/targets are not separate obligations to spend everything.
export function listTurnTasks(state, playerId = state.activePlayerId) {
  if (!hasTurnTasks(state) || state.gameResult || state.phase !== 'PLAYER_ACTION' || playerId !== state.activePlayerId) return [];
  const tasks = [], parties = ordered(state.parties), cities = ordered(state.cities), units = ordered(state.units);
  const add = (kind, id, label, actions) => {
    if (actions.length) tasks.push({ id: `${kind}:${id}`, kind, entityId: id, label, actions,
      skipped: state.turnTasks.skipped.includes(`${kind}:${id}`) });
  };
  for (const party of parties.filter(p => p.ownerId === playerId && p.status === 'active' && hasActiveUnits(state, p))) {
    const actions = [], neighbors = Array.from({ length: 6 }, (_, d) => Hex.fromKey(party.location).neighbor(d).key);
    if (neighbors.some(key => validatePartyPath(state, party, [key]).ok)) actions.push('移動');
    for (const [type, label] of [['melee', '近接攻撃'], ['ranged', '遠隔攻撃']]) {
      if (parties.some(p => p.ownerId !== playerId && validatePartyAttack(state, party, p, type).ok)) actions.push(label);
      if (cities.some(c => c.ownerId !== playerId && validateCityAttack(state, playerId, party.id, c.id, type).ok)) actions.push(type === 'melee' ? '近接攻城' : '遠隔攻城');
    }
    if (cities.some(c => validateCaptureCity(state, playerId, party.id, c.id).ok)) actions.push('都市占領');
    if (party.unitIds.some(id => validateFoundCity(state, playerId, party.id, id).ok)) actions.push('都市建設');
    for (const ability of Object.values(ABILITIES)) if (abilityAvailable(state, ability.id) && party.unitIds.some(casterUnitId =>
      Object.hasOwn(state.units[casterUnitId].abilityStates, ability.id) && abilityTargets(state, party, ability).some(target =>
        validateAbility(state, playerId, { partyId: party.id, casterUnitId, targetUnitId: target.id, abilityId: ability.id }).ok))) actions.push(ability.name);
    if (previewPartyRest(state, playerId, party.id).ok) actions.push('休養');
    if (validateRemoveCasualties(state, playerId, party.id).ok) actions.push('戦闘不能者の離脱');
    if (units.some(u => validateReinforceParty(state, playerId, party.id, [u.id]).ok)) actions.push('補充');
    if (parties.some(p => validateMergeParties(state, playerId, party.id, p.id).ok)) actions.push('合流');
    if (party.unitIds.some(id => neighbors.some(key => validateSplitParty(state, playerId, party.id, [id], key).ok))) actions.push('分割');
    add('party', party.id, `部隊 ${party.id}`, actions);
  }
  for (const unit of units.filter(u => u.ownerId === playerId && !u.partyId && isActiveUnit(u))) {
    if (!parties.some(p => occupiesMapTile(p) && p.location === unit.location) && !cityEntryError(state, playerId, unit.location))
      add('unit', unit.id, `待機 ${RULESET.items[unit.typeId].name} ${unit.id}`, ['部隊を編成']);
  }
  for (const city of cities.filter(c => c.ownerId === playerId)) {
    if (!city.production.currentItemId) add('production', city.id, `${city.name}の生産`, ['生産対象を選択']);
    if (parties.some(p => validateCityBombardment(state, playerId, city.id, p.id).ok)) add('bombardment', city.id, `${city.name}の砲撃`, ['都市砲撃']);
  }
  if (state.kingdoms[playerId].research?.currentTechnologyId === null && Object.keys(RULESET.technologies).some(id => !researchSelectionError(state, playerId, id)))
    add('research', playerId, '王国の研究', ['研究対象を選択']);
  return tasks;
}
export const pendingTurnTasks = (state, playerId) => listTurnTasks(state, playerId).filter(task => !task.skipped);

export function resolveTurnTask(state, playerId, taskId, skipped, events) {
  const task = listTurnTasks(state, playerId).find(task => task.id === taskId);
  if (!task || task.skipped === skipped) return '現在の手番に該当する未処理行動がありません';
  state.turnTasks.skipped = skipped ? [...state.turnTasks.skipped, taskId] : state.turnTasks.skipped.filter(id => id !== taskId);
  events.push({ type: skipped ? 'TurnActionSkipped' : 'TurnActionResumed', playerId, taskId });
  return null;
}

export function reopenActedTasks(state, command) {
  if (!hasTurnTasks(state) || ['SkipTurnAction', 'ResumeTurnAction', 'EndTurn', 'StartTurn'].includes(command.type)) return;
  const p = command.payload, affected = new Set();
  for (const key of ['partyId', 'attackerPartyId', 'sourcePartyId', 'targetPartyId']) if (p[key]) affected.add(`party:${p[key]}`);
  for (const id of p.unitIds ?? []) affected.add(`unit:${id}`);
  if (p.cityId) { affected.add(`production:${p.cityId}`); affected.add(`bombardment:${p.cityId}`); }
  if (command.type === 'SelectResearch') affected.add(`research:${command.playerId}`);
  const stillAvailable = new Set(listTurnTasks(state).map(task => task.id));
  state.turnTasks.skipped = state.turnTasks.skipped.filter(id => !affected.has(id) && stillAvailable.has(id));
}

export function validateTurnFlowSave(state) {
  const fail = () => { throw new Error('セーブデータが不正です: turnFlow / turnTasks'); };
  if (!Object.hasOwn(state, 'turnFlowVersion')) {
    if (Object.hasOwn(state, 'turnTasks') || Object.hasOwn(state, 'lastSettledTurn') || state.commandLog.some(c => ['SkipTurnAction', 'ResumeTurnAction'].includes(c.type))) fail();
    return;
  }
  const t = state.turnTasks;
  if (!hasTurnTasks(state) || !Number.isSafeInteger(state.lastSettledTurn) || state.lastSettledTurn !== state.currentTurn - 1
    || !t || t.turn !== state.currentTurn || t.playerId !== state.activePlayerId || !Array.isArray(t.skipped)
    || new Set(t.skipped).size !== t.skipped.length) fail();
  for (const id of t.skipped) {
    if (typeof id !== 'string') fail();
    const colon = id.indexOf(':'), kind = id.slice(0, colon), entityId = id.slice(colon + 1);
    const records = { party: state.parties, unit: state.units, production: state.cities, bombardment: state.cities, research: state.kingdoms }[kind];
    if (!records || !Object.hasOwn(records, entityId)) fail();
    if ((kind === 'research' ? entityId : records[entityId].ownerId) !== t.playerId) fail();
  }
  for (const c of state.commandLog) if (['SkipTurnAction', 'ResumeTurnAction'].includes(c.type) && typeof c.payload.taskId !== 'string') fail();
}
