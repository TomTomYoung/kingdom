import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker as NodeWorker } from 'node:worker_threads';

const context = { createBuffer: (channels, length, sampleRate) => ({ length, sampleRate, channels: [], copyToChannel(data, channel) { this.channels[channel] = data; } }) };

test('module worker renders concurrent scores and transfers the stereo PCM', async () => {
  const original = globalThis.Worker, instances = [];
  globalThis.Worker = class {
    constructor(url) {
      this.worker = new NodeWorker(new URL(`data:text/javascript,${encodeURIComponent(`
        import { parentPort } from 'node:worker_threads';
        globalThis.self = globalThis;
        self.postMessage = (data, transfer) => parentPort.postMessage(data, transfer);
        const ready = import(${JSON.stringify(String(url))});
        parentPort.on('message', async (data) => { await ready; self.onmessage({ data }); });
      `)}`));
      this.worker.on('message', (data) => this.onmessage?.({ data }));
      this.worker.on('error', (error) => this.onerror?.(error));
      instances.push(this);
    }
    postMessage(data) { this.worker.postMessage(data); }
    terminate() { return this.worker.terminate(); }
  };
  try {
    const { createSynthBuffer, renderFallbackPCM } = await import('../src/audio/synth.js?worker-success');
    const ids = ['se-save', 'se-load'];
    const buffers = await Promise.all(ids.map((id) => createSynthBuffer(context, id)));
    assert.equal(instances.length, 1);
    for (let i = 0; i < ids.length; i++) {
      const expected = renderFallbackPCM(ids[i]);
      assert.deepEqual(buffers[i].channels, [expected.left, expected.right]);
      assert.equal(buffers[i].sampleRate, 44100);
    }
  } finally { globalThis.Worker = original; await Promise.all(instances.map((worker) => worker.terminate())); }
});

test('blocked worker falls back to the same renderer without rejecting playback', async () => {
  const original = globalThis.Worker;
  let terminated = false;
  globalThis.Worker = class {
    constructor() { queueMicrotask(() => this.onerror(new Error('worker blocked'))); }
    postMessage() {}
    terminate() { terminated = true; }
  };
  try {
    const { createSynthBuffer, renderFallbackPCM } = await import('../src/audio/synth.js?worker-failure');
    const buffer = await createSynthBuffer(context, 'se-save');
    assert.equal(terminated, true);
    assert.deepEqual(buffer.channels[0], renderFallbackPCM('se-save').left);
  } finally { globalThis.Worker = original; }
});
