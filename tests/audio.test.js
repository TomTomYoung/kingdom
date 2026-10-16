import test from 'node:test';
import assert from 'node:assert/strict';
import { GameAudio, readAudioSettings, soundForResult } from '../src/ui/audio.js';
import { RuleSystem } from '../src/core/rule-system.js';
import { HumanController } from '../src/core/human-controller.js';
import { createInitialGameState } from '../src/core/game-state.js';

const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
function fixture(fetcher = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) })) {
  const nodes = [], settings = new Map();
  const context = { state: 'suspended', destination: {}, resume: async () => { context.state = 'running'; },
    createGain: () => ({ gain: { value: 1 }, connect() {}, disconnect() {} }),
    decodeAudioData: async () => ({ duration: 12 }),
    createBufferSource: () => { const node = { started: false, stopped: false, connect() {}, disconnect() {}, start() { this.started = true; }, stop() { this.stopped = true; this.onended?.(); } }; nodes.push(node); return node; } };
  const assets = { entries: new Map(['bgm-overworld', 'bgm-battle', 'se-ui-confirm'].map((id) => [id, { url: `https://example.test/${id}` }])) };
  const audio = new GameAudio(assets, { contextFactory: () => context, fetcher, storage: { getItem: (key) => settings.get(key), setItem: (key, value) => settings.set(key, value) } });
  return { audio, context, nodes, settings };
}
const flush = () => new Promise((resolve) => setImmediate(resolve));

test('real command results choose purchase, rejection, completion, movement and culture notifications', () => {
  const controller = new HumanController('kingdom-1');
  let state = createInitialGameState(117); state = RuleSystem.execute(state, controller.startTurn(state)).state;
  let command = controller.purchaseItem(state, 'city-1', 'warrior'), result = RuleSystem.execute(state, command);
  assert.equal(soundForResult(result, command), 'se-purchase'); state = result.state;
  command = controller.purchaseItem(state, 'city-1', 'monument'); result = RuleSystem.execute(state, command);
  assert.equal(result.ok, false); assert.equal(soundForResult(result, command), 'se-ui-error');
  command = controller.setProduction(state, 'city-1', 'warrior'); result = RuleSystem.execute(state, command);
  assert.equal(soundForResult(result, command), 'se-ui-confirm'); state = result.state;
  state.cities['city-1'].production.progressByItem.warrior = 11;
  state.cities['city-1'].localCultureProgress = 10;
  command = controller.endTurn(state); result = RuleSystem.execute(state, command);
  assert.ok(result.events.some((e) => e.type === 'ItemCompleted')); assert.ok(result.events.some((e) => e.type === 'TerritoryExpanded'));
  assert.equal(soundForResult(result, command), 'se-production-complete');
  result.events = result.events.filter((e) => e.type !== 'ItemCompleted');
  assert.equal(soundForResult(result, command), 'se-territory-expand');
  assert.equal(soundForResult({ ok: true, events: [{ type: 'PartyMoved' }] }, { type: 'MoveParty' }), 'se-party-move');
});

test('settings survive denied storage and clamp invalid values', () => {
  assert.deepEqual(readAudioSettings({ getItem() { throw Error(); } }), { muted: true, volume: 0.5 });
  assert.deepEqual(readAudioSettings({ getItem: () => '{"muted":false,"volume":2}' }), { muted: false, volume: 1 });
  assert.deepEqual(readAudioSettings({ getItem: () => 'null' }), { muted: true, volume: 0.5 });
});

test('initially silent, user unlock starts one loop and mute cancels all playback', async () => {
  const { audio, nodes } = fixture();
  assert.equal(await audio.unlock(), false); assert.equal(nodes.length, 0);
  await audio.setMuted(false); await flush();
  await Promise.all([audio.startMusic(), audio.startMusic(), audio.startMusic()]);
  assert.equal(nodes.filter((node) => node.loop && !node.stopped).length, 1);
  assert.equal(audio.music.loopEnd, 12);
  await audio.play('se-ui-confirm');
  audio.setVolume(0.25); assert.equal(audio.master.gain.value, 0.25);
  await audio.setMuted(true);
  assert.ok(nodes.every((node) => node.stopped)); assert.equal(audio.master.gain.value, 0);
});

test('mute or tab hiding during download cannot start a stale effect or loop', async () => {
  const pending = deferred();
  const { audio, nodes } = fixture(() => pending.promise);
  await audio.setMuted(false);
  const effect = audio.play('se-ui-confirm');
  audio.setHidden(true);
  pending.resolve({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) });
  assert.equal(await effect, false); await flush(); assert.equal(nodes.length, 0);
  audio.setHidden(false); await flush(); assert.equal(nodes.length, 1);
  await audio.setMuted(true); assert.ok(nodes[0].stopped);
});

test('switching tracks during download starts only the newest requested music', async () => {
  const pending = deferred();
  const { audio, nodes } = fixture((url) => url.endsWith('overworld') ? pending.promise : Promise.resolve({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) }));
  await audio.setMuted(false);
  await audio.setMusic('bgm-battle');
  pending.resolve({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) }); await flush();
  assert.equal(nodes.filter((node) => node.started && !node.stopped).length, 1);
  assert.equal(audio.bgmId, 'bgm-battle');
});

test('failed audio download is nonfatal and rapid clicks have at most four effects', async () => {
  let fail = true;
  const { audio, nodes } = fixture(async () => { if (fail) throw Error('offline'); return { ok: true, arrayBuffer: async () => new ArrayBuffer(4) }; });
  await audio.setMuted(false); assert.equal(await audio.play('se-ui-confirm'), false);
  fail = false;
  await Promise.all(Array.from({ length: 12 }, () => audio.play('se-ui-confirm')));
  assert.equal(audio.effects.size, 4); assert.equal(nodes.filter((node) => !node.loop && !node.stopped).length, 4);
});
