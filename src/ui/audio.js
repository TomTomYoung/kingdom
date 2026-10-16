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
  constructor(assets, { storage, contextFactory, fetcher = fetch, onStatus = () => {} } = {}) {
    this.assets = assets;
    this.storage = storage;
    this.contextFactory = contextFactory ?? (() => new (globalThis.AudioContext ?? globalThis.webkitAudioContext)());
    this.fetcher = fetcher;
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

  async buffer(id) {
    if (!this.context || !this.assets.entries.has(id)) return null;
    if (!this.buffers.has(id)) {
      const context = this.context;
      const task = (async () => {
        const response = await this.fetcher(this.assets.entries.get(id).url);
        if (!response.ok) throw new Error('audio unavailable');
        return context.decodeAudioData(await response.arrayBuffer());
      })().catch(() => { this.buffers.delete(id); this.onStatus('一部の音声を読み込めませんでした'); return null; });
      this.buffers.set(id, task);
    }
    return this.buffers.get(id);
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
