import { createSynthBuffer } from '../audio/synth.js';

const SETTINGS_KEY = 'kingdom-audio-v1';
export function readAudioSettings(storage) {
  try {
    const saved = JSON.parse(storage?.getItem(SETTINGS_KEY) ?? '{}');
    return { muted: saved?.muted !== false, volume: Number.isFinite(saved?.volume) ? Math.max(0, Math.min(1, saved.volume)) : 0.5 };
  } catch { return { muted: true, volume: 0.5 }; }
}

// Use only events returned by this successful command, never the historical log.
// Each action gets one notification so purchases do not also play completion SE.
export function soundForResult(result, command) {
  if (!result.ok) return 'se-ui-error';
  const events = result.events ?? [];
  if (events.some((e) => (e.type === 'ItemCompleted' && e.source === 'purchase') || (e.type === 'TerritoryExpanded' && e.source === 'gold'))) return 'se-purchase';
  if (events.some((e) => e.type === 'ItemCompleted' && e.source === 'production')) return 'se-production-complete';
  if (events.some((e) => e.type === 'PartyMoved')) return 'se-party-move';
  if (events.some((e) => e.type === 'TerritoryExpanded' && e.source === 'culture')) return 'se-territory-expand';
  if (command.type === 'EndTurn' || command.type === 'StartTurn') return 'se-turn-start';
  return 'se-ui-confirm';
}

export class GameAudio {
  constructor(assets, { storage, contextFactory, fetcher = fetch, synthesizer = createSynthBuffer, timeoutMs = 8000, onStatus = () => {} } = {}) {
    this.assets = assets;
    this.storage = storage;
    this.contextFactory = contextFactory ?? (() => new (globalThis.AudioContext ?? globalThis.webkitAudioContext)());
    this.fetcher = fetcher;
    this.synthesizer = synthesizer;
    this.timeoutMs = timeoutMs;
    this.cacheVersion = 0;
    this.failures = new Map();
    this.recovered = new Set();
    this.onStatus = onStatus;
    Object.assign(this, readAudioSettings(storage));
    this.buffers = new Map();
    this.effects = new Set();
    this.bgmId = 'bgm-overworld';
    this.generation = 0;
    this.hidden = false;
  }

  persist() { try { this.storage?.setItem(SETTINGS_KEY, JSON.stringify({ muted: this.muted, volume: this.volume })); } catch { /* Audio still works without storage. */ } }
  gain() { if (this.master) this.master.gain.value = this.muted || this.hidden ? 0 : this.volume; }
  setVolume(value) { if (!Number.isFinite(value)) return; this.volume = Math.max(0, Math.min(1, value)); this.gain(); this.persist(); }

  // Must be called synchronously from a pointer/keyboard action; no autoplay.
  async unlock() {
    if (this.muted || this.hidden) return false;
    try {
      if (!this.context) {
        this.context = this.contextFactory();
        this.master = this.context.createGain();
        this.master.connect(this.context.destination);
        this.gain();
      }
      if (this.context.state !== 'running') await this.context.resume();
      if (this.muted || this.hidden) return false;
      void this.startMusic();
      return true;
    } catch { this.onStatus('この環境では音声を再生できません'); return false; }
  }

  async setMuted(muted) {
    this.muted = muted;
    this.gain(); this.persist();
    if (muted) { this.stop(); return false; }
    return this.unlock();
  }

  reportStatus() {
    if (this.failures.size) {
      const [id, reason] = this.failures.entries().next().value;
      this.onStatus(`音声を再生できません: ${id}（${reason}）。「音声を再読み込み」で再試行できます。`);
    } else if (this.recovered.size) this.onStatus('音声ファイルを読み込めなかったため、内蔵の音符データで再生しています。');
    else this.onStatus('');
  }

  async buffer(id) {
    if (!this.context) return null;
    if (!this.buffers.has(id)) {
      const context = this.context, cacheVersion = this.cacheVersion;
      const task = (async () => {
        let reason;
        const entry = this.assets.entries.get(id);
        if (entry) {
          const controller = new AbortController();
          let timer;
          try {
            // Also settle fetch/decode promises that ignore abort (or never finish).
            const loaded = (async () => {
              const response = await this.fetcher(entry.url, { signal: controller.signal });
              if (!response.ok) throw new Error(`HTTP ${response.status ?? 'error'}`);
              const bytes = await response.arrayBuffer();
              try { return await context.decodeAudioData(bytes); }
              catch { throw new Error('音声形式のデコード失敗'); }
            })();
            const timeout = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('読み込みタイムアウト')); }, this.timeoutMs); });
            const buffer = await Promise.race([loaded, timeout]);
            if (cacheVersion === this.cacheVersion) { this.failures.delete(id); this.recovered.delete(id); this.reportStatus(); }
            return buffer;
          } catch (error) { reason = error.message || '通信失敗'; }
          finally { clearTimeout(timer); }
        } else reason = '素材一覧の読み込み失敗';
        try {
          const buffer = this.synthesizer && await this.synthesizer(context, id);
          if (buffer) { if (cacheVersion === this.cacheVersion) { this.failures.delete(id); this.recovered.add(id); this.reportStatus(); } return buffer; }
        } catch (error) { reason += ` / 内蔵音源: ${error.message}`; }
        if (cacheVersion === this.cacheVersion) { this.failures.set(id, reason); this.reportStatus(); }
        return null;
      })();
      this.buffers.set(id, task);
      // Keep failure result until an explicit retry; do not repeat bad requests on
      // every pointer action. Successful synth buffers are cached the same way.
    }
    return this.buffers.get(id);
  }

  async retry() {
    this.stop(); this.cacheVersion += 1; this.buffers.clear(); this.failures.clear(); this.recovered.clear();
    this.reportStatus();
    return this.unlock();
  }

  async play(id) {
    if (this.muted || this.hidden || this.context?.state !== 'running') return false;
    const generation = this.generation;
    const buffer = await this.buffer(id);
    if (!buffer || generation !== this.generation || this.muted || this.hidden || this.context.state !== 'running') return false;
    // Limit rapid-click overlap, including sounds pending on their first download.
    if (this.effects.size >= 4) { const oldest = this.effects.values().next().value; oldest.stop(); this.effects.delete(oldest); }
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.master);
    source.onended = () => { this.effects.delete(source); source.disconnect(); };
    this.effects.add(source); source.start();
    return true;
  }

  async setMusic(id) {
    if (this.bgmId !== id) { this.stop(); this.bgmId = id; }
    return this.startMusic();
  }

  async startMusic() {
    if (this.muted || this.hidden || !this.bgmId || this.music || this.context?.state !== 'running') return;
    const generation = this.generation, id = this.bgmId;
    const buffer = await this.buffer(id);
    if (!buffer || generation !== this.generation || this.music || this.muted || this.hidden || id !== this.bgmId || this.context.state !== 'running') return;
    const source = this.context.createBufferSource(), gain = this.context.createGain();
    source.buffer = buffer; source.loop = true;
    source.loopStart = 0; source.loopEnd = buffer.duration;
    gain.gain.value = 0.4; source.connect(gain); gain.connect(this.master);
    source.onended = () => { source.disconnect(); gain.disconnect(); };
    this.music = source; source.start();
  }

  stop() {
    this.generation += 1;
    if (this.music) { this.music.stop(); this.music = null; }
    for (const source of this.effects) source.stop();
    this.effects.clear();
  }

  setHidden(hidden) {
    this.hidden = hidden; this.gain();
    if (hidden) this.stop();
    else void this.startMusic();
  }
}
