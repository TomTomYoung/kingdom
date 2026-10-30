// Compare real saves and their continuation against a checked-out pre-editor revision.
// node tools/qa/save-production-queue-compat.mjs /path/to/baseline /path/to/report.json
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { restoreGameState, serializeGameState } from '../../src/core/game-state.js';
import { RuleSystem } from '../../src/core/rule-system.js';
import { HumanController } from '../../src/core/human-controller.js';
import { executeAiStep } from '../../src/core/ai-controller.js';
const [baseline, output] = process.argv.slice(2);
if (!baseline || !output) throw new Error('Pass the baseline checkout directory and output JSON path.');
const oldImport = file => import(pathToFileURL(path.resolve(baseline, file)).href);
const oldState = await oldImport('src/core/game-state.js');
const oldScenarios = await oldImport('src/core/scenarios.js');
const { RuleSystem: OldRules } = await oldImport('src/core/rule-system.js');
const { HumanController: OldController } = await oldImport('src/core/human-controller.js');
const { executeAiStep: oldAiStep } = await oldImport('src/core/ai-controller.js');
const scenarios = {
  single: seed => oldState.createInitialGameState(seed),
  party: seed => oldState.createInitialGameState(seed, { startingParty: true }),
  duel: oldScenarios.createDuelGameState,
  ranged: oldScenarios.createRangedDuelGameState,
  cities: oldScenarios.createTwoCityGameState,
  settlement: oldScenarios.createSettlementGameState,
  skirmish: oldScenarios.createAiSkirmishGameState,
  reinforcements: oldScenarios.createAiReinforcementGameState,
  conquest: oldScenarios.createAiConquestGameState,
};
const seeds = [1, 7, 42, 117], records = [];
function verify(state, scenario, seed, stage) {
  const text = oldState.serializeGameState(state), restored = restoreGameState(text);
  assert.deepEqual(restored, state, `${scenario}/${seed}/${stage}: restore`);
  assert.equal(serializeGameState(restored), text, `${scenario}/${seed}/${stage}: byte-for-byte serialization`);
  let previous = structuredClone(state), current = restored;
  for (let step = 0; step < 4; step++) {
    const player = previous.activePlayerId;
    let a, b;
    if (previous.kingdoms[player].controllerType === 'ai') {
      a = oldAiStep(previous); b = executeAiStep(current);
      assert.deepEqual(b.command, a.command);
    } else {
      const old = new OldController(player), now = new HumanController(player), cityId = previous.kingdoms[player].cityIds[0];
      const first = step === 0 && cityId;
      a = OldRules.execute(previous, first ? old.setProduction(previous, cityId, 'archer', ['warrior', 'warrior']) : old.endTurn(previous));
      b = RuleSystem.execute(current, first ? now.setProduction(current, cityId, 'archer', ['warrior', 'warrior']) : now.endTurn(current));
    }
    assert.equal(a.ok, true, a.reason); assert.equal(b.ok, true, b.reason);
    assert.deepEqual(b.state, a.state, `${scenario}/${seed}/${stage}: continuation ${step}`);
    previous = a.state; current = b.state;
  }
  records.push({ scenario, seed, stage, continuationCommands: 4 });
}
for (const seed of seeds) for (const [scenario, create] of Object.entries(scenarios)) {
  let state = create(seed); const controller = new OldController(state.activePlayerId);
  const started = OldRules.execute(state, controller.startTurn(state)); assert.equal(started.ok, true, started.reason); state = started.state;
  verify(state, scenario, seed, 'turn-start');
  const queued = OldRules.execute(state, controller.setProduction(state, 'city-1', 'warrior', ['archer', 'monument', 'warrior']));
  assert.equal(queued.ok, true, queued.reason); state = queued.state;
  Object.assign(state.cities['city-1'].production.progressByItem, { warrior: 7, archer: 3, monument: 9 });
  verify(state, scenario, seed, 'partial-queue');
  const legacy = structuredClone(state); delete legacy.partyRecoveryVersion;
  verify(legacy, scenario, seed, 'legacy-without-recovery');
  const ended = OldRules.execute(state, controller.endTurn(state)); assert.equal(ended.ok, true, ended.reason);
  verify(ended.state, scenario, seed, 'handoff-or-next-round');
}
const report = { verifiedAt: new Date().toISOString(), baselineRevision: '8534535422972c04f958a437fee8df5dbf12c9ef', seeds, scenarios: Object.keys(scenarios), snapshots: records.length, continuationCommands: records.reduce((n, record) => n + record.continuationCommands, 0), checks: ['real baseline-source saves restore identically', 'serialized contents are unchanged', 'four continued Human/AI Commands match the baseline state and decisions', 'old absent recovery version remains absent'], records };
await fs.mkdir(path.dirname(path.resolve(output)), { recursive: true });
await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify({ snapshots: report.snapshots, continuationCommands: report.continuationCommands, checks: report.checks }, null, 2));
