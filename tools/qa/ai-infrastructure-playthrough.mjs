// Peaceful development fixture: two immobile five-member garrisons, normal
// research/yields/production. This tests investment, not combat balance.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createAiReinforcementGameState } from '../../src/core/scenarios.js';
import { restoreGameState, serializeGameState } from '../../src/core/game-state.js';
import { RuleSystem } from '../../src/core/rule-system.js';
import { HumanController } from '../../src/core/human-controller.js';
import { runAiTurn, AI_TURN_COMMAND_LIMIT } from '../../src/core/ai-controller.js';
const games = []; let commands = 0, saveRoundTrips = 0;
for (const seed of [1, 2, 7, 19, 42, 81, 117, 999]) {
  let state = createAiReinforcementGameState(seed); state.scenarioId = 'ai-infrastructure-development-qa';
  delete state.scenarioObjective; delete state.gameResult;
  for (const [index, k] of Object.values(state.kingdoms).entries()) {
    k.controllerType = 'ai'; k.aiPolicy = 'reinforcements';
    const p = state.parties[`party-${index + 1}`], location = state.cities[k.cityIds[0]].centerHex;
    p.location = location; p.unitIds.forEach(id => { state.units[id].location = location; }); p.movementRemaining = p.movementMaximum = 0;
  }
  const c = new HumanController(state.activePlayerId), started = RuleSystem.execute(state, c.startTurn(state)); assert.equal(started.ok, true); state = started.state;
  while (state.currentTurn <= 80) {
    const copy = restoreGameState(serializeGameState(state)); assert.deepEqual(copy, state); saveRoundTrips++;
    const first = runAiTurn(state), repeated = runAiTurn(copy); assert.equal(first.ok, true, first.reason); assert.deepEqual(first, repeated);
    assert.ok(first.commands.length <= AI_TURN_COMMAND_LIMIT + 1); commands += first.commands.length; state = first.state;
  }
  for (const city of Object.values(state.cities)) for (const id of ['library', 'workshop', 'granary']) assert.ok(city.buildings.includes(id), `${seed}/${city.id}/${id}`);
  for (const k of Object.values(state.kingdoms)) assert.equal(k.research.completedTechnologyIds.length, 3);
  games.push({ seed, turn: state.currentTurn, cities: Object.values(state.cities).map(c => ({ id: c.id, buildings: c.buildings })), investmentCommands: state.commandLog.filter(c => ['library','workshop','granary'].includes(c.payload.itemId)).length });
}
const report = { verifiedAt: new Date().toISOString(), fixture: 'Two immobile garrisons; normal economy and AI, no combat or turn deadline', roundsPerSeed: 80, games, commands, saveRoundTrips };
if (process.argv[2]) await fs.writeFile(process.argv[2], JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
