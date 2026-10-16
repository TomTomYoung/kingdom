// Copy the pinned, unchanged AIMusic engine and embed the existing editable scores.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
const [musicArg] = process.argv.slice(2);
if (!musicArg) throw Error('Usage: node tools/assets/build-audio-fallback.mjs AIMUSIC_ROOT');
const lock = JSON.parse(fs.readFileSync('tools/assets/tool-lock.json')).tools.AIMusic;
fs.mkdirSync('src/audio/vendor', { recursive: true });
for (const name of ['core.mjs', 'audio.mjs']) {
  const key = `src/${name}`, bytes = fs.readFileSync(path.join(musicArg, key));
  const sha = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  if (sha !== lock.files[key]) throw Error(`Pinned AIMusic file differs: ${key}`);
  fs.writeFileSync(`src/audio/vendor/${name}`, bytes);
}
const manifest = JSON.parse(fs.readFileSync('assets/manifest.json'));
const records = Object.fromEntries(manifest.assets.filter((asset) => ['se', 'bgm'].includes(asset.category)).map((asset) => {
  const source = asset.files.find((file) => file.path.endsWith('project.music.json'));
  const bytes = fs.readFileSync(source.path);
  if (createHash('sha256').update(bytes).digest('hex') !== source.sha256) throw Error(`Score hash differs: ${asset.id}`);
  return [asset.id, { title: asset.title, mode: asset.loop ? 'loop' : 'tail', sampleRate: asset.sampleRate, frames: Math.round(asset.seconds * asset.sampleRate), source: source.path, sourceSHA256: source.sha256, project: JSON.parse(bytes) }];
}));
fs.writeFileSync('src/audio/scores.js', '// Generated from the adopted AIMusic scores; run build-audio-fallback.mjs to update.\nexport const SCORE_BANK = ' + JSON.stringify(records) + ';\n');
console.log(`Bundled ${Object.keys(records).length} scores; pinned AIMusic ${lock.commit}`);
