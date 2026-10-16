import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { renderFallbackPCM, createSynthBuffer } from '../src/audio/synth.js';
import { SCORE_BANK } from '../src/audio/scores.js';
import { encodeWAV } from '../src/audio/vendor/audio.mjs';
import { GameAudio } from '../src/ui/audio.js';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const manifest = JSON.parse(fs.readFileSync(new URL('../assets/manifest.json', import.meta.url)));

test('every fallback reproduces its original AIMusic PCM/WAV and keeps the delivered duration', () => {
  const audio = manifest.assets.filter((asset) => ['se', 'bgm'].includes(asset.category));
  assert.deepEqual(Object.keys(SCORE_BANK).sort(), audio.map((asset) => asset.id).sort());
  for (const asset of audio) {
    const score = SCORE_BANK[asset.id];
    assert.equal(hash(fs.readFileSync(new URL(`../${score.source}`, import.meta.url))), score.sourceSHA256);
    const pcm = renderFallbackPCM(asset.id);
    assert.equal(pcm.left.length, Math.round(asset.seconds * 44100));
    const reportFile = asset.files.find((file) => file.path.endsWith('delivery-report.json'));
    const report = JSON.parse(fs.readFileSync(new URL(`../${reportFile.path}`, import.meta.url)));
    const expected = asset.category === 'se' ? report.delivery.sha256 : report.derivation.originalWAV.sha256;
    assert.equal(hash(encodeWAV(pcm)), expected, asset.id);
  }
});

function setup(fetcher, decodeAudioData = async () => { throw Error('codec'); }) {
  const messages = [], sources = [], context = { state: 'running', destination: {}, resume: async () => {},
    createGain: () => ({ gain: { value: 0 }, connect() {}, disconnect() {} }),
    decodeAudioData,
    createBuffer: (channels, frames, rate) => ({ duration: frames / rate, numberOfChannels: channels, channels: [], copyToChannel(data, channel) { this.channels[channel] = data; } }),
    createBufferSource: () => { const node = { connect() {}, disconnect() {}, start() { this.started = true; }, stop() { this.stopped = true; this.onended?.(); } }; sources.push(node); return node; },
  };
  const audio = new GameAudio({ entries: new Map([['bgm-overworld', { url: 'https://example.test/bgm.ogg' }], ['se-save', { url: 'https://example.test/save.wav' }]]) }, { contextFactory: () => context, fetcher, timeoutMs: 15, onStatus: (message) => messages.push(message) });
  return { audio, context, sources, messages };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));
test('HTTP failures recover from bundled scores and only retry when explicitly requested', async () => {
  let requests = 0, works = false;
  const { audio, sources, messages } = setup(async () => { requests++; return { ok: works, status: 404, arrayBuffer: async () => new ArrayBuffer(4) }; }, async () => ({ duration: 4 }));
  await audio.setMuted(false); await audio.startMusic();
  assert.ok(sources.some((source) => source.loop && source.started));
  assert.ok(messages.at(-1).includes('内蔵')); assert.equal(audio.recovered.has('bgm-overworld'), true);
  const count = requests; await audio.startMusic(); assert.equal(requests, count);
  works = true; await audio.retry(); await audio.startMusic();
  assert.equal(messages.at(-1), ''); assert.equal(audio.recovered.size, 0);
  assert.equal(sources.filter((source) => source.loop && !source.stopped).length, 1);
});

test('a decode error, missing manifest and hanging fetch all recover without audio files', async () => {
  for (const kind of ['decode', 'manifest', 'timeout']) {
    const { audio } = setup(kind === 'timeout' ? () => new Promise(() => {}) : async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) }));
    if (kind === 'manifest') audio.assets.entries.clear();
    audio.bgmId = null; await audio.setMuted(false);
    assert.equal(await audio.play('se-save'), true, kind);
    assert.equal(audio.recovered.has('se-save'), true);
    await audio.setMuted(true);
  }
});

test('mute during fallback synthesis prevents late playback', async () => {
  let finish;
  const { audio, sources } = setup(async () => ({ ok: false, status: 404 }));
  audio.synthesizer = () => new Promise((resolve) => { finish = resolve; });
  audio.bgmId = null; await audio.setMuted(false);
  const pending = audio.play('se-save'); await tick(); await audio.setMuted(true);
  finish({ duration: 1 }); assert.equal(await pending, false); assert.equal(sources.length, 0);
});

test('Web Audio buffer receives stereo PCM at the original rate', async () => {
  const { context } = setup(async () => {});
  const buffer = await createSynthBuffer(context, 'se-load');
  assert.equal(buffer.numberOfChannels, 2);
  assert.equal(buffer.channels[0].length, SCORE_BANK['se-load'].frames);
  assert.ok(buffer.channels[0].some((sample) => sample !== 0));
});
