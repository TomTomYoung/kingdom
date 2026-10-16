/** Versioned score model. Pure, detached, atomic and independent of audio/DOM. */
export const VERSION = '0.1.0';
export const PPQ = 480;
export const LIMITS = Object.freeze({ tracks: 8, notes: 4096, bars: 32, seconds: 180,
  commands: 256, history: 30, historyBytes: 16000000, receipts: 1000, receiptBytes: 4000000 });
export const INSTRUMENTS = Object.freeze({
  pluck: { name: 'プラック', midi: 24 }, bell: { name: 'ベル', midi: 10 },
  flute: { name: 'フルート', midi: 73 }, pulse: { name: 'パルス', midi: 80 },
  pad: { name: 'パッド', midi: 89 }, bass: { name: 'ベース', midi: 38 },
  kick: { name: 'キック', drum: 36 }, snare: { name: 'スネア', drum: 38 },
  hat: { name: 'ハイハット', drum: 42 }
});
export class MusicError extends Error {
  constructor(code, message) { super(message); this.name = 'MusicError'; this.code = code; }
}
export function check(ok, code, message) { if (!ok) throw new MusicError(code, message); }
export function record(value, required, optional = []) {
  check(value && typeof value === 'object' && !Array.isArray(value), 'INVALID_INPUT', 'オブジェクトが必要です');
  check(required.every(k => Object.hasOwn(value, k)), 'INVALID_INPUT', `必須項目: ${required.join(', ')}`);
  const allowed = new Set([...required, ...optional]);
  check(Object.keys(value).every(k => allowed.has(k)), 'INVALID_INPUT', '未知の項目が含まれています');
}
export function int(n, lo, hi, label = '値') {
  check(Number.isSafeInteger(n) && n >= lo && n <= hi, 'INVALID_INPUT', `${label}: 整数 ${lo}〜${hi}`); return n;
}
export function number(n, lo, hi, label = '値') {
  check(typeof n === 'number' && Number.isFinite(n) && n >= lo && n <= hi, 'INVALID_INPUT', `${label}: ${lo}〜${hi}`); return n;
}
export function id(s) { check(typeof s === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(s), 'INVALID_ID', 'IDは英数字・ハイフン・下線の1〜64文字です'); return s; }
function text(s) { check(typeof s === 'string' && s.trim().length > 0 && s.length <= 100, 'INVALID_INPUT', '名前は1〜100文字です'); }
const bool = v => check(typeof v === 'boolean', 'INVALID_INPUT', '真偽値が必要です');
export const totalTicks = p => p.bars * p.beatsPerBar * PPQ;
export const scoreSeconds = p => totalTicks(p) / PPQ * 60 / p.tempo;
export const audibleTracks = p => p.tracks.filter(t => !t.mute && (!p.tracks.some(s => s.solo) || t.solo));
export function validateProject(p) {
  record(p, ['format','version','id','title','tempo','beatsPerBar','bars','master','tracks']);
  check(p.format === 'aimusic-project' && p.version === 1, 'UNSUPPORTED_VERSION', 'aimusic-project version 1が必要です');
  id(p.id); text(p.title); int(p.tempo, 40, 240, 'テンポ');
  check([3,4].includes(p.beatsPerBar), 'INVALID_INPUT', '拍子は3/4または4/4です');
  int(p.bars, 1, LIMITS.bars, '小節数'); number(p.master, 0, 1, 'マスター音量');
  check(scoreSeconds(p) <= LIMITS.seconds, 'RESOURCE_LIMIT', '曲の長さは180秒までです');
  check(Array.isArray(p.tracks) && p.tracks.length <= LIMITS.tracks, 'RESOURCE_LIMIT', 'トラックは8本までです');
  const ids = new Set(), noteIds = new Set(); let count = 0;
  for (const t of p.tracks) {
    record(t, ['id','name','instrument','volume','pan','mute','solo','notes']); id(t.id); text(t.name);
    check(!ids.has(t.id), 'DUPLICATE_ID', 'トラックIDが重複しています'); ids.add(t.id);
    check(Object.hasOwn(INSTRUMENTS, t.instrument), 'INVALID_INSTRUMENT', '未対応の音色です');
    number(t.volume,0,1,'音量'); number(t.pan,-1,1,'パン'); bool(t.mute); bool(t.solo);
    check(Array.isArray(t.notes), 'INVALID_INPUT', 'notesは配列です'); count += t.notes.length;
    check(count <= LIMITS.notes, 'RESOURCE_LIMIT', 'ノートは全体で4096個までです');
    for (const n of t.notes) {
      record(n,['id','pitch','start','duration','velocity']); id(n.id);
      check(!noteIds.has(n.id), 'DUPLICATE_ID', 'ノートIDは曲全体で一意です'); noteIds.add(n.id);
      int(n.pitch,21,108,'MIDI音高'); int(n.start,0,totalTicks(p)-1,'開始tick');
      int(n.duration,1,totalTicks(p),'長さtick'); int(n.velocity,1,127,'強さ');
      check(n.start+n.duration <= totalTicks(p), 'OUT_OF_BOUNDS', 'ノートが曲の末尾を超えています');
      if (INSTRUMENTS[t.instrument].drum) check(n.pitch === INSTRUMENTS[t.instrument].drum, 'INVALID_DRUM', '打楽器の音高は音色ごとに固定です');
    }
    const sorted = [...t.notes].sort((a,b)=>a.pitch-b.pitch||a.start-b.start);
    for(let i=1;i<sorted.length;i++) check(sorted[i].pitch !== sorted[i-1].pitch || sorted[i].start >= sorted[i-1].start+sorted[i-1].duration,
      'NOTE_OVERLAP','同じトラック・音高のノートは重ねられません');
  }
  return p;
}
export function blankProject(projectId = 'untitled') {
  return { format:'aimusic-project',version:1,id:id(projectId),title:'新しい曲',tempo:112,beatsPerBar:4,bars:8,master:0.65,tracks:[] };
}
export function newTrack(trackId, name = 'メロディ', instrument = 'pluck') {
  return { id:trackId,name,instrument,volume:0.55,pan:0,mute:false,solo:false,notes:[] };
}
export const COMMANDS = Object.freeze(['project.update','track.add','track.update','track.remove','notes.add','note.update','notes.remove','notes.transform']);
function apply(p,c) {
  check(c && COMMANDS.includes(c.type), 'UNKNOWN_COMMAND', '未知の操作です');
  if(c.type === 'project.update') { record(c,['type','changes']); record(c.changes,[],['title','tempo','beatsPerBar','bars','master']); Object.assign(p,c.changes); return; }
  if(c.type === 'track.add') { record(c,['type','track']); p.tracks.push(structuredClone(c.track)); return; }
  record(c,['type','trackId'], c.type === 'track.remove' ? [] : c.type === 'notes.add' ? ['notes'] : c.type === 'note.update' ? ['noteId','changes'] : c.type === 'track.update' ? ['changes'] : c.type === 'notes.remove' ? ['noteIds'] : ['noteIds','transpose','shift']);
  const t=p.tracks.find(t=>t.id===c.trackId); check(t,'TRACK_NOT_FOUND','トラックがありません');
  if(c.type === 'track.remove') { p.tracks=p.tracks.filter(x=>x.id!==t.id); return; }
  if(c.type === 'track.update') { record(c.changes,[],['name','instrument','volume','pan','mute','solo']); Object.assign(t,c.changes); return; }
  if(c.type === 'notes.add') { check(Array.isArray(c.notes)&&c.notes.length>0&&c.notes.length<=LIMITS.notes,'INVALID_INPUT','追加ノートの配列が必要です'); t.notes.push(...structuredClone(c.notes)); return; }
  if(c.type === 'note.update') {
    const n=t.notes.find(n=>n.id===c.noteId); check(n,'NOTE_NOT_FOUND','ノートがありません');
    record(c.changes,[],['pitch','start','duration','velocity']); Object.assign(n,c.changes); return;
  }
  check(Array.isArray(c.noteIds)&&c.noteIds.length>0&&new Set(c.noteIds).size===c.noteIds.length,'INVALID_INPUT','一意なnoteIdsが必要です');
  const chosen=new Set(c.noteIds); check(c.noteIds.every(n=>t.notes.some(x=>x.id===n)),'NOTE_NOT_FOUND','ノートがありません');
  if(c.type === 'notes.remove') { t.notes=t.notes.filter(n=>!chosen.has(n.id)); return; }
  int(c.transpose??0,-87,87,'移調'); int(c.shift??0,-61440,61440,'移動tick');
  for(const n of t.notes) if(chosen.has(n.id)) { n.pitch+=c.transpose??0; n.start+=c.shift??0; }
}
const canonical = value => JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
export class MusicCore {
  #project; #revision=0; #undo=[]; #redo=[]; #receipts=new Map(); #receiptBytes=0;
  constructor(p=blankProject()) { this.#project=structuredClone(validateProject(p)); }
  getProject() { return structuredClone(this.#project); }
  getState() { return { version:VERSION,projectId:this.#project.id,revision:this.#revision,title:this.#project.title,tracks:this.#project.tracks.length,
    notes:this.#project.tracks.reduce((n,t)=>n+t.notes.length,0),seconds:scoreSeconds(this.#project),canUndo:!!this.#undo.length,canRedo:!!this.#redo.length,githubStored:false }; }
  assertContext(input) { check(input.projectId===this.#project.id && input.expectedRevision===this.#revision,'REVISION_CONFLICT','原稿が更新されています。状態を読み直してください'); }
  #trim() {
    while(this.#undo.length+this.#redo.length>LIMITS.history || [...this.#undo,...this.#redo].reduce((n,p)=>n+JSON.stringify(p).length*2,0)>LIMITS.historyBytes) {
      if(this.#undo.length)this.#undo.shift(); else this.#redo.shift();
    }
  }
  applyBatch(input) {
    record(input,['projectId','expectedRevision','operationId','commands']); id(input.projectId); id(input.operationId); int(input.expectedRevision,0,Number.MAX_SAFE_INTEGER);
    check(Array.isArray(input.commands)&&input.commands.length>0&&input.commands.length<=LIMITS.commands,'RESOURCE_LIMIT','操作数は1〜256です');
    const serialized=canonical(input), old=this.#receipts.get(input.operationId);
    if(old) { check(old.payload===serialized,'IDEMPOTENCY_CONFLICT','同じ操作IDで内容が変わっています'); return {...this.getState(),replayed:true}; }
    this.assertContext(input);
    check(this.#receipts.size<LIMITS.receipts && this.#receiptBytes+serialized.length*2<=LIMITS.receiptBytes,'RESOURCE_LIMIT','操作履歴の上限です。原稿を保存して開き直してください');
    const next=this.getProject(); for(const c of input.commands) apply(next,c); validateProject(next);
    this.#undo.push(this.#project); this.#redo=[]; this.#project=next; this.#revision++; this.#trim();
    this.#receipts.set(input.operationId,{payload:serialized}); this.#receiptBytes+=serialized.length*2;
    return {...this.getState(),replayed:false};
  }
  replaceProject(input) {
    record(input,['projectId','expectedRevision','replace','project']); this.assertContext(input); check(input.replace===true,'REPLACE_REQUIRED','明示した置き換えが必要です');
    const next=structuredClone(validateProject(input.project)); this.#project=next; this.#revision++; this.#undo=[]; this.#redo=[]; this.#receipts.clear(); this.#receiptBytes=0; return this.getState();
  }
  undo(input) { return this.#travel(input,this.#undo,this.#redo); }
  redo(input) { return this.#travel(input,this.#redo,this.#undo); }
  #travel(input,from,to) { record(input,['projectId','expectedRevision']); this.assertContext(input); check(from.length,'EMPTY_HISTORY','履歴がありません'); to.push(this.#project); this.#project=from.pop(); this.#revision++; this.#trim(); return this.getState(); }
}
