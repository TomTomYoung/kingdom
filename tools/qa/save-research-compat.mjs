// Compare real saves and their continuation against a checked-out pre-research revision.
// node tools/qa/save-research-compat.mjs /path/to/baseline /path/to/report.json
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
// Real pre-research states, including v3 fire and retained v2/v1 AI paths.
for (const seed of seeds) {
  let state = oldScenarios.createAiConquestGameState(seed), c = new OldController(state.activePlayerId);
  state = OldRules.execute(state, c.startTurn(state)).state;
  for (const city of Object.values(state.cities)) {
    city.buildings.push('walls'); city.defense.wallHp = 60;
  }
  const p = state.parties['party-1']; p.location = '3,-3,0';
  state.world.tiles[p.location].terrainId = 'plains'; p.unitIds.forEach(id => { state.units[id].location = p.location; });
  verify(state, 'conquest', seed, 'v3-walled-human');
  const spent = structuredClone(state); spent.cities['city-1'].defense.bombardmentsRemaining = 0; verify(spent, 'conquest', seed, 'v3-spent-fire');
  state.cityDefenseVersion = 2; for (const city of Object.values(state.cities)) delete city.defense.bombardmentsRemaining;
  verify(state, 'conquest', seed, 'v2-walled-human');
  verify(OldRules.execute(state, c.endTurn(state)).state, 'conquest', seed, 'v2-walled-ai');
  const damaged = structuredClone(state); damaged.cities['city-2'].defense.wallHp = 7;
  damaged.cities['city-2'].defense.hp = 45; damaged.cities['city-2'].defense.counterattacksRemaining = 0;
  damaged.cities['city-2'].defense.lastDamagedTurn = state.currentTurn;
  verify(damaged, 'conquest', seed, 'v2-damaged-and-spent-counter');
  const v1 = structuredClone(state); v1.cityDefenseVersion = 1;
  for (const city of Object.values(v1.cities)) delete city.defense.counterattacksRemaining;
  verify(v1, 'conquest', seed, 'v1-walled');
  const ancient = structuredClone(state); delete ancient.cityDefenseVersion;
  for (const city of Object.values(ancient.cities)) { delete city.defense; city.buildings = []; }
  verify(ancient, 'conquest', seed, 'capture-only');
}
const report = { verifiedAt: new Date().toISOString(), baselineRevision: '009e5841fe5bb41f3230b8fd3b8547cbba18b0d5', seeds, scenarios: Object.keys(scenarios), snapshots: records.length, continuationCommands: records.reduce((n, record) => n + record.continuationCommands, 0), checks: ['real baseline-source saves restore identically', 'serialized contents are unchanged', 'four continued Human/AI Commands match the baseline state and decisions', 'old absent recovery version remains absent', 'no research version, progress or AI decisions added to legacy games'], records };
await fs.mkdir(path.dirname(path.resolve(output)), { recursive: true });
await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify({ snapshots: report.snapshots, continuationCommands: report.continuationCommands, checks: report.checks }, null, 2));
