import { renderFallbackPCM } from './synth.js';
self.onmessage = ({ data: { request, id } }) => {
  try {
    const pcm = renderFallbackPCM(id);
    self.postMessage({ request, pcm }, pcm ? [pcm.left.buffer, pcm.right.buffer] : []);
  } catch (error) { self.postMessage({ request, error: error.message }); }
};
