import { attackParty, moveParty, endTurn } from './commands.js';
import { chooseCityExitCommand, chooseDeploymentCommand, chooseSupplyCommand, chooseReinforcementCommand, chooseMergeCommand } from './ai-economy.js';
import { RuleSystem } from './rule-system.js';
import { validatePartyAttack } from '../systems/combat-system.js';
import { participatingUnits } from '../systems/combat-attacks.js';
import { terrainMovementCost, validatePartyPath } from '../systems/movement-system.js';
import { occupiesMapTile, hasActiveUnits } from '../models/party.js';
import { Hex } from '../world/hex.js';

export const AI_TURN_COMMAND_LIMIT = 128;
const ordered = records => Object.values(records).sort((a, b) => a.id.localeCompare(b.id));
const attackTypeAt = (state, party, enemy) => ['ranged', 'melee'].find(kind => validatePartyAttack(state, party, enemy, kind).ok);

// Search the whole map for a firing position, then take the affordable prefix.
// This permits detours around Void and occupied tiles without reading any RNG.
export function approachPath(state, party, enemies) {
  if (party.movementRemaining <= 0 || party.activationState !== 'ready' || !participatingUnits(state, party, 'melee').length) return null;
  const occupied = new Set(Object.values(state.parties).filter(other => other.id !== party.id && occupiesMapTile(other)).map(other => other.location));
  const queue = [{ key: party.location, cost: 0, path: [] }], costs = new Map([[party.location, 0]]), visited = new Set();
  while (queue.length) {
    queue.sort((a, b) => a.cost - b.cost || a.key.localeCompare(b.key));
    const current = queue.shift(); if (visited.has(current.key)) continue; visited.add(current.key);
    if (current.path.length && enemies.some(enemy => attackTypeAt(state, { ...party, location: current.key }, enemy))) {
      const prefix = []; let budget = party.movementRemaining;
      for (const key of current.path) {
        const cost = terrainMovementCost(state.world.tiles[key].terrainId);
        if (cost > budget) break; prefix.push(key); budget -= cost;
      }
      return prefix.length && validatePartyPath(state, party, prefix).ok ? prefix : null;
    }
    const hex = Hex.fromKey(current.key);
    for (let direction = 0; direction < 6; direction++) {
      const key = hex.neighbor(direction).key, tile = state.world.tiles[key];
      if (!tile || tile.terrainId === 'void' || occupied.has(key) || visited.has(key)) continue;
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
    if (recruits) {
      const command = chooseMergeCommand(state, this.playerId, id);
      if (command) return command;
    }
    for (const party of own) {
      const path = approachPath(state, party, enemies);
      if (path) return moveParty(this.playerId, state.currentTurn, party.id, path, id);
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
