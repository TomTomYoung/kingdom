// Add three operation sounds with the same pinned AIMusic renderer as v001.
// Never overwrite existing deliveries. Original score, MIDI and reports remain editable.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const [musicArg, outputArg] = process.argv.slice(2);
if (!musicArg || !outputArg) throw Error('Usage: node tools/assets/render-ui-audio.mjs AIMUSIC_ROOT NEW_OUTPUT_ROOT');
const musicRoot = path.resolve(musicArg), root = path.resolve(outputArg);
if (fs.existsSync(path.join(root, 'assets'))) throw Error('Choose a fresh output directory');
const lock = JSON.parse(fs.readFileSync(new URL('./tool-lock.json', import.meta.url))).tools.AIMusic;
for (const [file, expected] of Object.entries(lock.files)) {
  const bytes = fs.readFileSync(path.join(musicRoot, file));
  if (createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex') !== expected) throw Error(`AIMusic differs from pinned commit: ${file}`);
}
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
function write(file, bytes) { const target = path.join(root, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, bytes, { flag: 'wx' }); return { path: file, bytes: Buffer.byteLength(bytes), sha256: hash(bytes) }; }
const json = (file, value) => write(file, JSON.stringify(value, null, 2) + '\n');
const specs = [
  { id: 'se-territory-expand', title: '文化による領土拡張', instrument: 'bell', volume: 0.56, notes: [[60, 0, 0.22], [67, 0.32, 0.25], [72, 0.68, 0.35], [76, 1.02, 0.3]] },
  { id: 'se-save', title: '保存', instrument: 'pluck', volume: 0.68, notes: [[76, 0, 0.24], [60, 0.34, 0.38]] },
  { id: 'se-load', title: '復元', instrument: 'pluck', volume: 0.68, notes: [[60, 0, 0.2], [67, 0.30, 0.22], [76, 0.62, 0.4]] },
];
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'kingdom-ui-audio-')), records = [];
for (const spec of specs) {
  const project = { format: 'aimusic-project', version: 1, id: spec.id, title: spec.title, tempo: 240, bars: 1, beatsPerBar: 3, master: 0.76,
    tracks: [{ id: 'notification', name: spec.title, instrument: spec.instrument, volume: spec.volume, pan: 0, mute: false, solo: false,
      notes: spec.notes.map(([pitch, start, duration], i) => ({ id: `note-${i}`, pitch, start: Math.round(start * 480), duration: Math.round(duration * 480), velocity: 90 })) }] };
  const job = { format: 'aimusic-job', version: 1, project, batches: [], render: { sampleRate: 44100, mode: 'tail' } };
  const dir = `assets/audio/${spec.id}/v001`, jobPath = `assets/jobs/${spec.id}.v001.music.json`;
  const files = [json(jobPath, job)], work = path.join(temp, spec.id);
  execFileSync(process.execPath, [path.join(musicRoot, 'scripts/render.mjs'), path.join(root, jobPath), work]);
  const report = JSON.parse(fs.readFileSync(path.join(work, 'report.json')));
  if (report.silent || !Number.isFinite(report.peak) || report.peak > 0.93) throw Error(`Invalid PCM: ${spec.id}`);
  const source = fs.readFileSync(path.join(work, 'song.wav'));
  let last = 0;
  for (let i = 44; i < source.length; i += 4) if (Math.abs(source.readInt16LE(i)) > 1 || Math.abs(source.readInt16LE(i + 2)) > 1) last = (i - 44) / 4;
  const frames = Math.min(report.frames, last + 1 + 882), audio = Buffer.from(source.subarray(0, 44 + frames * 4));
  audio.writeUInt32LE(audio.length - 8, 4); audio.writeUInt32LE(frames * 4, 40);
  files.push(write(`${dir}/project.music.json`, fs.readFileSync(path.join(work, 'project.music.json'))), write(`${dir}/song.mid`, fs.readFileSync(path.join(work, 'song.mid'))), json(`${dir}/source-render-report.json`, report));
  const delivery = write(`${dir}/audio.wav`, audio);
  files.push(delivery, json(`${dir}/delivery-report.json`, { assetId: spec.id, sourceTool: 'AIMusic', toolCommit: lock.commit, sampleRate: 44100, channels: 2, seconds: frames / 44100,
    derivation: { operation: 'trim trailing silence only', startFrame: 0, endFrame: frames, thresholdPCM16: 1, tailPaddingFrames: 882, pcmSamplesUnchanged: true, originalWAV: report.files.find((file) => file.file === 'song.wav') }, listeningReviewed: false, integrated: false, delivery }));
  records.push({ id: spec.id, title: spec.title, category: 'se', revision: 'v001', tool: 'AIMusic', toolCommit: lock.commit, status: 'rendered-analysis-checked', integrated: false, listeningReviewed: false, seconds: frames / 44100, sampleRate: 44100, channels: 2, loop: false, files, checks: report });
  console.log(`${spec.id}: ${(frames / 44100).toFixed(3)}s`);
}
json('assets/ui-audio-pack.json', { created: '2026-10-17', authoringScript: 'tools/assets/render-ui-audio.mjs', assets: records });
