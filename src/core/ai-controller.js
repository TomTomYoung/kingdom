import { previewPartyRest, validateRemoveCasualties } from '../systems/party-care.js';
import { RULESET } from './ruleset.js';
import { hasCityRetaliation, hasCityDefense, isCityDefended, cityEntryError } from '../models/city-defense.js';
import { previewCityAttack, validateCityAttack } from '../systems/city-siege.js';
import { restParty, removeCasualties, attackCity, captureCity, attackParty, moveParty, endTurn } from './commands.js';
import { chooseCityExitCommand, chooseDeploymentCommand, chooseSupplyCommand, chooseReinforcementCommand, chooseMergeCommand } from './ai-economy.js';
import { RuleSystem } from './rule-system.js';
import { validatePartyAttack } from '../systems/combat-system.js';
import { participatingUnits } from '../systems/combat-attacks.js';
import { terrainMovementCost, validatePartyPath } from '../systems/movement-system.js';
import { isActiveUnit, occupiesMapTile, hasActiveUnits } from '../models/party.js';
import { hasCityObjective, validateCaptureCity } from '../systems/city-capture.js';
import { Hex } from '../world/hex.js';

export const AI_TURN_COMMAND_LIMIT = 128;
const ordered = records => Object.values(records).sort((a, b) => a.id.localeCompare(b.id));
function cityAttackTypeAt(state, party, city) {
  const planned = { ...state, parties: { ...state.parties, [party.id]: party } };
  return ['ranged', 'melee'].find(kind => {
    if (!validateCityAttack(planned, party.ownerId, party.id, city.id, kind).ok) return false;
    if (kind !== 'melee' || !hasCityRetaliation(state)) return true;
    const preview = previewCityAttack(planned, party.ownerId, party.id, city.id, kind);
    return !party.unitIds.filter(id => isActiveUnit(state.units[id])).every(id => preview.damage[id].min >= state.units[id].currentHp);
  });
}
const attackTypeAt = (state, party, enemy) => ['ranged', 'melee'].find(kind => validatePartyAttack(state, party, enemy, kind).ok);

// Search the whole map for a firing position, then take the affordable prefix.
// This permits detours around Void and occupied tiles without reading any RNG.
export function approachPath(state, party, enemies) {
  return pathToward(state, party, key => enemies.some(enemy => attackTypeAt(state, { ...party, location: key }, enemy)));
}

export function pathToward(state, party, isGoal, { preserveGoal = false } = {}) {
  if (party.movementRemaining <= 0 || party.activationState !== 'ready' || !participatingUnits(state, party, 'melee').length) return null;
  const occupied = new Set(Object.values(state.parties).filter(other => other.id !== party.id && occupiesMapTile(other)).map(other => other.location));
  const queue = [{ key: party.location, cost: 0, path: [] }], costs = new Map([[party.location, 0]]), visited = new Set();
  while (queue.length) {
    queue.sort((a, b) => a.cost - b.cost || a.key.localeCompare(b.key));
    const current = queue.shift(); if (visited.has(current.key)) continue; visited.add(current.key);
    if (current.path.length && isGoal(current.key)) {
      const prefix = []; let budget = party.movementRemaining;
      for (const key of current.path) {
        const cost = terrainMovementCost(state.world.tiles[key].terrainId);
        if (cost > budget) break; prefix.push(key); budget -= cost;
      }
      if (!prefix.length) return preserveGoal ? [] : null;
      return validatePartyPath(state, party, prefix).ok ? prefix : null;
    }
    const hex = Hex.fromKey(current.key);
    for (let direction = 0; direction < 6; direction++) {
      const key = hex.neighbor(direction).key, tile = state.world.tiles[key];
      if (!tile || tile.terrainId === 'void' || occupied.has(key) || cityEntryError(state, party.ownerId, key) || visited.has(key)) continue;
      const stepCost = terrainMovementCost(tile.terrainId), cost = current.cost + stepCost;
      if (stepCost > party.movementMaximum || cost >= (costs.get(key) ?? Infinity)) continue;
      costs.set(key, cost); queue.push({ key, cost, path: [...current.path, key] });
    }
  }
  return null;
}

export class AIController {
  constructor(playerId) { this.playerId = playerId; }
  nextCommand(state, { forceEnd = false } = {}) {
    if (state.gameResult || state.phase !== 'PLAYER_ACTION' || state.activePlayerId !== this.playerId || state.kingdoms[this.playerId]?.controllerType !== 'ai') return null;
    const id = `ai-${this.playerId}-${state.currentTurn}-${state.commandLog.length + 1}`;
    const finish = () => endTurn(this.playerId, state.currentTurn, id);
    if (forceEnd) return finish();
    const conquest = hasCityObjective(state);
    const enemyCities = conquest ? ordered(state.cities).filter(city => city.ownerId !== this.playerId) : [];
    if (conquest) for (const party of ordered(state.parties)) for (const city of enemyCities) {
      if (validateCaptureCity(state, this.playerId, party.id, city.id).ok) return captureCity(this.playerId, state.currentTurn, party.id, city.id, id);
    }
    for (const party of ordered(state.parties).filter(p => p.ownerId === this.playerId)) {
      if (validateRemoveCasualties(state, this.playerId, party.id).ok) return removeCasualties(this.playerId, state.currentTurn, party.id, id);
      if (party.unitIds.some(id => isActiveUnit(state.units[id]) && state.units[id].currentHp / state.units[id].maxHp <= RULESET.partyRecovery.aiRestHpRatio) && previewPartyRest(state, this.playerId, party.id).ok) return restParty(this.playerId, state.currentTurn, party.id, id);
    }
    const recruits = state.kingdoms[this.playerId].aiPolicy === 'reinforcements';
    if (recruits) {
      const command = chooseReinforcementCommand(state, this.playerId, id) ?? chooseCityExitCommand(state, this.playerId, id) ?? chooseDeploymentCommand(state, this.playerId, id);
      if (command) return command;
    }
    const parties = ordered(state.parties), enemies = parties.filter(p => p.ownerId !== this.playerId && p.status === 'active' && hasActiveUnits(state, p));
    const own = parties.filter(p => p.ownerId === this.playerId && p.status === 'active' && p.activationState === 'ready' && p.attacksRemaining > 0 && hasActiveUnits(state, p));
    for (const party of own) for (const enemy of enemies) {
      const kind = attackTypeAt(state, party, enemy);
      if (kind) return attackParty(this.playerId, state.currentTurn, party.id, enemy.id, kind, id);
    }
    if (hasCityDefense(state)) for (const party of own) for (const city of enemyCities) {
      const kind = cityAttackTypeAt(state, party, city);
      if (kind) return attackCity(this.playerId, state.currentTurn, party.id, city.id, kind, id);
    }
    if (recruits) {
      const command = chooseMergeCommand(state, this.playerId, id);
      if (command) return command;
    }
    for (const party of own) {
      const path = (conquest ? pathToward(state, party, key => enemyCities.some(city => isCityDefended(state, city) ? cityAttackTypeAt(state, { ...party, location: key }, city) : city.centerHex === key), { preserveGoal: true }) : null) ?? approachPath(state, party, enemies);
      if (path?.length) return moveParty(this.playerId, state.currentTurn, party.id, path, id);
    }
    if (recruits) {
      const command = chooseSupplyCommand(state, this.playerId, id);
      if (command) return command;
    }
    return finish();
  }
}

// A single validated command is also the UI's scheduling boundary.
export function executeAiStep(state, options) {
  const command = new AIController(state.activePlayerId).nextCommand(state, options);
  return command ? { ...RuleSystem.execute(state, command), command } : { ok: false, reason: 'AIの手番ではありません', state, events: [], command: null };
}

export function runAiTurn(original, { commandLimit = AI_TURN_COMMAND_LIMIT } = {}) {
  if (!Number.isSafeInteger(commandLimit) || commandLimit < 1 || commandLimit > AI_TURN_COMMAND_LIMIT) throw new Error('AIの命令数上限が不正です');
  let state = original; const playerId = state.activePlayerId, turn = state.currentTurn, commands = [], events = [];
  while (!state.gameResult && state.phase === 'PLAYER_ACTION' && state.activePlayerId === playerId && state.currentTurn === turn && state.kingdoms[playerId]?.controllerType === 'ai') {
    const result = executeAiStep(state, { forceEnd: commands.length >= commandLimit });
    if (!result.ok) return { ...result, commands, events };
    state = result.state; commands.push(result.command); events.push(...result.events);
  }
  return { ok: true, state, commands, events };
}
