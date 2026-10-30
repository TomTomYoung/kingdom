import { hasCityObjective } from './city-capture.js';
import { hasActiveUnits } from '../models/party.js';

// Optional objectives: historical sandboxes never acquire victory rules on load.
export function scenarioOutcome(state, { roundComplete = false } = {}) {
  const objective = state.scenarioObjective;
  if (!objective) return null;
  const cities = hasCityObjective(state);
  const survivors = objective.participantIds.filter(ownerId => cities
    ? Object.values(state.cities).some(city => city.ownerId === ownerId)
    : Object.values(state.parties).some(party => party.ownerId === ownerId && party.status === 'active' && hasActiveUnits(state, party)));
  if (survivors.length < 2) return { outcome: survivors.length === 1 ? 'victory' : 'draw', winnerId: survivors[0] ?? null, reason: cities ? 'cities-controlled' : 'elimination', turn: state.currentTurn };
  if (roundComplete && state.currentTurn >= objective.turnLimit) return { outcome: 'draw', winnerId: null, reason: 'turn-limit', turn: state.currentTurn };
  return null;
}

export function resolveScenario(state, events, options) {
  if (!state.scenarioObjective || state.gameResult) return;
  const result = scenarioOutcome(state, options);
  if (!result) return;
  state.gameResult = result; state.phase = 'GAME_OVER';
  events.push({ type: 'ScenarioFinished', ...result });
}

export function validateScenarioSave(state) {
  const invalid = detail => { throw new Error(`セーブデータが不正です: scenario.${detail}`); };
  const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const hasObjective = Object.hasOwn(state, 'scenarioObjective'), hasResult = Object.hasOwn(state, 'gameResult');
  if (!hasObjective && !hasResult) {
    if (state.phase === 'GAME_OVER' || ['ai-skirmish', 'ai-reinforcements', 'ai-conquest'].includes(state.scenarioId)) invalid('missing objective');
    return;
  }
  const objective = state.scenarioObjective;
  if (!hasObjective || !hasResult || !record(objective) || !['eliminate-parties', 'control-cities'].includes(objective.type)) invalid('objective');
  if (state.scenarioId === 'ai-conquest' && objective.type !== 'control-cities' || ['ai-skirmish', 'ai-reinforcements'].includes(state.scenarioId) && objective.type !== 'eliminate-parties') invalid('objective type');
  const ids = objective.participantIds;
  if (!Array.isArray(ids) || ids.length !== 2 || new Set(ids).size !== 2 || ids.some(id => typeof id !== 'string' || !Object.hasOwn(state.kingdoms, id))
    || state.turnOrder.length !== 2 || state.turnOrder.some(id => !ids.includes(id))) invalid('participantIds');
  if (!Number.isSafeInteger(objective.turnLimit) || objective.turnLimit < 1 || objective.turnLimit > 1000 || state.currentTurn > objective.turnLimit) invalid('turnLimit');
  if (state.gameResult === null) {
    if (state.phase === 'GAME_OVER' || scenarioOutcome(state)) invalid('unfinished result');
    return;
  }
  const result = state.gameResult;
  if (!record(result) || state.phase !== 'GAME_OVER' || !['elimination', 'cities-controlled', 'turn-limit'].includes(result.reason)) invalid('result');
  if (result.reason === 'turn-limit' && state.activePlayerIndex !== state.turnOrder.length - 1) invalid('incomplete round');
  const expected = scenarioOutcome(state, { roundComplete: result.reason === 'turn-limit' });
  if (!expected || Object.keys(expected).some(key => result[key] !== expected[key])) invalid('result mismatch');
}
