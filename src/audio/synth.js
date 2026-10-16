import { SCORE_BANK } from './scores.js';
import { renderPCM } from './vendor/audio.mjs';

export function renderFallbackPCM(id) {
  const score = SCORE_BANK[id];
  if (!score) return null;
  const pcm = renderPCM(score.project, { sampleRate: score.sampleRate, mode: score.mode });
  // Retain the same trailing-silence trim as the delivered SE and exact BGM loop.
  return { sampleRate: pcm.sampleRate, left: pcm.left.slice(0, score.frames), right: pcm.right.slice(0, score.frames) };
}
let worker, workerUnavailable = false, nextRequest = 0;
const pending = new Map();
function stopWorker() {
  workerUnavailable = true; worker?.terminate(); worker = null;
  for (const job of pending.values()) { clearTimeout(job.timer); job.reject(new Error('synth worker unavailable')); }
  pending.clear();
}
function renderInWorker(id) {
  if (workerUnavailable || typeof Worker !== 'function') return Promise.resolve(renderFallbackPCM(id));
  try {
    if (!worker) {
      worker = new Worker(new URL('./synth-worker.js', import.meta.url), { type: 'module' });
      worker.onmessage = ({ data }) => {
        const job = pending.get(data.request); if (!job) return;
        pending.delete(data.request); clearTimeout(job.timer);
        if (data.error) job.reject(new Error(data.error)); else job.resolve(data.pcm);
      };
      worker.onerror = stopWorker;
    }
    return new Promise((resolve, reject) => {
      const request = ++nextRequest, timer = setTimeout(stopWorker, 10000);
      pending.set(request, { resolve, reject, timer }); worker.postMessage({ request, id });
    }).catch(() => renderFallbackPCM(id));
  } catch { stopWorker(); return Promise.resolve(renderFallbackPCM(id)); }
}
export async function createSynthBuffer(context, id) {
  if (!SCORE_BANK[id]) return null;
  const pcm = await renderInWorker(id);
  if (!pcm) return null;
  const buffer = context.createBuffer(2, pcm.left.length, pcm.sampleRate);
  buffer.copyToChannel(pcm.left, 0); buffer.copyToChannel(pcm.right, 1);
  return buffer;
}
