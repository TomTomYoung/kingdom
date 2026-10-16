import { createInitialGameState, restoreGameState, serializeGameState } from '../core/game-state.js';
import { HumanController } from '../core/human-controller.js';
import { RuleSystem } from '../core/rule-system.js';
import { RULESET } from '../core/ruleset.js';
import { Hex } from '../world/hex.js';
import { getTerritoryCandidates, tilePurchaseCost } from '../systems/territory-system.js';
import { validatePartyPath } from '../systems/movement-system.js';
import { AssetStore } from './assets.js';
import { GameAudio, soundForResult } from './audio.js';
import { FormationPanel } from './formation.js';
import { isActiveUnit } from '../models/party.js';

const $ = (selector) => document.querySelector(selector);
const canvas = $('#map'), ctx = canvas.getContext('2d');
const controller = new HumanController('kingdom-1');
const assets = new AssetStore();
let storage;
try { storage = window.localStorage; } catch { /* The game is playable without persistence. */ }
const audio = new GameAudio(assets, { storage, onStatus: (text) => { $('#audio-status').textContent = text; } });
let state = createInitialGameState(117), selectedPartyId = null, hoveredKey = null;
state = RuleSystem.execute(state, controller.startTurn(state)).state;
const labels = { food: '食料', production: '生産', gold: 'Gold', science: '科学', mana: 'Mana', religion: '宗教', culture: '文化', popularSupport: '人心' };
const assetId = (name) => `icon-${name === 'popularSupport' ? 'popular-support' : name}`;
const show = (message) => { $('#message').textContent = message; };
const formationPanel = new FormationPanel($('#formation'), assets, {
  onChange: (partyId, formation) => run(controller.setFormation(state, partyId, formation), '部隊の配置を変更しました'),
  onSelect: () => { void audio.play('se-ui-select'); },
  onCancel: () => { void audio.play('se-ui-cancel'); },
});

function run(command, success) {
  const result = RuleSystem.execute(state, command);
  void audio.play(soundForResult(result, command));
  if (!result.ok) { show(result.reason); return result; }
  state = result.state;
  show(success);
  render();
  return result;
}
function reject(message) { show(message); void audio.play('se-ui-error'); }
function hexPoint(hex, size, center) { return { x: center.x + size * Math.sqrt(3) * (hex.q + hex.r / 2), y: center.y + size * 1.5 * hex.r }; }
function pathHex(x, y, size) {
  ctx.beginPath();
  for (let i = 0; i < 6; i += 1) {
    const angle = Math.PI / 180 * (60 * i - 30), px = x + size * Math.cos(angle), py = y + size * Math.sin(angle);
    if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
  }
  ctx.closePath();
}
function drawMap() {
  const rect = canvas.getBoundingClientRect(), ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(rect.width * ratio); canvas.height = Math.round(rect.height * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.imageSmoothingEnabled = false;
  const scale = rect.width >= 940 && rect.height >= 920 ? 2 : 1;
  const size = 38 * scale, center = { x: rect.width / 2, y: rect.height / 2 };
  const city = state.cities['city-1'], selected = state.parties[selectedPartyId];
  const candidates = new Set(getTerritoryCandidates(state, city).map((t) => t.key));
  for (const tile of Object.values(state.world.tiles)) {
    const p = hexPoint(tile, size, center);
    pathHex(p.x, p.y, size - 2);
    ctx.fillStyle = RULESET.terrain[tile.terrainId].color;
    // This fallback stays visible when a specific image or the manifest fails.
    ctx.globalAlpha = assets.images.has(`terrain-${tile.terrainId}`) ? 0.18 : 1;
    ctx.fill(); ctx.globalAlpha = 1;
    assets.draw(ctx, `terrain-${tile.terrainId}`, p.x, p.y, scale);
    const reachable = selected && tile.key !== selected.location && validatePartyPath(state, selected, [tile.key]).ok;
    pathHex(p.x, p.y, size - 2);
    ctx.strokeStyle = reachable ? '#a4d9d2' : tile.ownerId ? '#e2c472' : !selected && candidates.has(tile.key) ? '#8b9868' : '#37453e';
    ctx.lineWidth = reachable || tile.ownerId ? 2 : 1;
    ctx.setLineDash(reachable ? [5, 3] : []); ctx.stroke(); ctx.setLineDash([]);
    if (tile.key === hoveredKey) { ctx.strokeStyle = '#fff1be'; ctx.lineWidth = 3; ctx.stroke(); }
    if (tile.cityId) {
      if (!assets.draw(ctx, 'building-city', p.x, p.y - 7 * scale, scale)) {
        ctx.fillStyle = '#ffe2a0'; ctx.font = '700 24px serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('城', p.x, p.y);
      }
      const tileCity = state.cities[tile.cityId];
      if (tileCity?.buildings.includes('monument')) assets.draw(ctx, 'building-monument', p.x + 15 * scale, p.y + 6 * scale, scale);
    }
  }
  for (const party of Object.values(state.parties)) {
    const p = hexPoint(Hex.fromKey(party.location), size, center);
    const atCity = Boolean(state.world.tiles[party.location]?.cityId);
    const x = p.x - (atCity ? 14 : 0) * scale, y = p.y + (atCity ? 8 : 0) * scale;
    ctx.beginPath(); ctx.ellipse(x, y + 19 * scale, 22 * scale, 8 * scale, 0, 0, Math.PI * 2);
    ctx.fillStyle = party.ownerId === controller.playerId ? '#355c69' : '#803f47'; ctx.fill();
    ctx.strokeStyle = party.id === selectedPartyId ? '#fff1b5' : '#a3b8ac'; ctx.lineWidth = party.id === selectedPartyId ? 3 : 1; ctx.stroke();
    ctx.globalAlpha = party.status === 'defeated' ? 0.45 : 1;
    if (!assets.draw(ctx, 'unit-warrior', x, y, scale)) {
      ctx.fillStyle = '#bd9262'; ctx.fillRect(x - 10, y - 10, 20, 20);
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#101d1b'; ctx.fillRect(x + 10 * scale, y + 7 * scale, 17 * scale, 17 * scale);
    ctx.fillStyle = '#fff0c9'; ctx.font = `700 ${12 * scale}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(party.unitIds.length, x + 18 * scale, y + 16 * scale);
    const units = party.unitIds.map((id) => state.units[id]);
    const maximum = units.reduce((sum, unit) => sum + unit.maxHp, 0);
    const hp = units.reduce((sum, unit) => sum + unit.currentHp, 0);
    ctx.fillStyle = '#111b19'; ctx.fillRect(x - 18 * scale, y + 27 * scale, 36 * scale, 4 * scale);
    ctx.fillStyle = '#a3c77c'; ctx.fillRect(x - 18 * scale, y + 27 * scale, 36 * scale * Math.max(0, Math.min(1, hp / (maximum || 1))), 4 * scale);
  }
  canvas._layout = { size, center };
}

function stat(name, value) {
  const node = document.createElement('div'); node.className = 'stat';
  const label = document.createElement('small'), number = document.createElement('b');
  label.textContent = labels[name]; number.textContent = value;
  node.append(assets.icon(assetId(name)), label, number);
  return node;
}
function render() {
  const k = state.kingdoms['kingdom-1'], city = state.cities['city-1'];
  if (!state.parties[selectedPartyId]) selectedPartyId = null;
  $('#turn').textContent = state.currentTurn; $('#seed').textContent = `固定シード ${state.seed}`;
  $('#city-name').textContent = city.name; $('#population').textContent = `人口 ${city.population}`;
  $('#resources').replaceChildren(...Object.entries({ ...k.stockpiles, science: k.progress.science, culture: k.progress.culture }).map(([name, value]) => stat(name, value)));
  $('#military').textContent = k.derived.militaryPower; $('#governance').textContent = k.derived.governanceCapacity; $('#load-value').textContent = k.derived.governanceLoad;
  $('#yields').replaceChildren(...Object.entries(city.yieldSummary).map(([name, value]) => {
    const node = document.createElement('span'); node.append(assets.icon(assetId(name)), `${labels[name]} +${value}`); return node;
  }));
  const foodCost = RULESET.growthFoodBase + city.population * RULESET.growthFoodPerPopulation;
  $('#food-label').textContent = `${city.foodStorage} / ${foodCost}`; $('#food-bar').style.width = `${Math.min(100, city.foodStorage / foodCost * 100)}%`;
  $('#culture-label').textContent = `${city.localCultureProgress} / ${RULESET.cultureExpansionCost}`; $('#culture-bar').style.width = `${Math.min(100, city.localCultureProgress / RULESET.cultureExpansionCost * 100)}%`;
  $('#city-art').replaceChildren(assets.icon('building-city', 'unit-art'));
  $('#buildings').replaceChildren();
  if (city.buildings.includes('monument')) $('#buildings').append(assets.icon('building-monument', 'unit-art'), 'モニュメント建設済み');
  const item = city.production.currentItemId && RULESET.items[city.production.currentItemId];
  $('#production-status').textContent = item ? `${item.name}: ${city.production.progressByItem[item.itemId] ?? 0} / ${item.productionCost}` : '生産対象を選択してください';
  document.querySelectorAll('[data-produce]').forEach((button) => {
    const item = RULESET.items[button.dataset.produce];
    button.replaceChildren(assets.icon(item.category === 'unit' ? 'unit-warrior' : 'building-monument', 'unit-art'), `${item.name}を生産`);
  });
  const party = state.parties[selectedPartyId];
  $('#party-status').replaceChildren();
  if (party) {
    $('#party-status').append(assets.icon('unit-warrior', 'unit-art'), `選択中 ${party.id} · ${party.unitIds.length}名`);
    $('#party-detail').textContent = `移動力 ${party.movementRemaining}/${party.movementMaximum} · 攻撃回数 ${party.attacksRemaining}/${party.attacksMaximum}`;
  } else {
    $('#party-status').textContent = `${Object.keys(state.parties).length} Party · ${k.unitIds.filter((id) => !state.units[id].partyId).length} 未編成Unit`;
    $('#party-detail').textContent = '部隊を選ぶと移動先を確認できます。';
  }
  $('#deselect-party').disabled = !party;
  formationPanel.render(state, party);
  $('#map-mode').textContent = party ? '部隊移動' : '領土購入';
  updateHover(); drawMap();
}
function deselect() {
  if (!selectedPartyId) return;
  selectedPartyId = null; void audio.play('se-ui-cancel'); show('選択を解除しました。領土を購入できます。'); render();
}
function tileAt(event) {
  const layout = canvas._layout; if (!layout) return null;
  const rect = canvas.getBoundingClientRect(), x = event.clientX - rect.left - layout.center.x, y = event.clientY - rect.top - layout.center.y;
  const q = (Math.sqrt(3) / 3 * x - y / 3) / layout.size, r = (2 / 3 * y) / layout.size;
  return state.world.tiles[Hex.round(q, r, -q - r).key] ?? null;
}
function updateHover() {
  const tile = state.world.tiles[hoveredKey], selected = state.parties[selectedPartyId];
  if (!tile) { $('#tile-info').textContent = selected ? '点線のタイルへ移動できます。選択解除はボタンまたはEsc。' : 'タイルにカーソルを合わせると、地形と購入価格を確認できます。'; return; }
  const name = RULESET.terrain[tile.terrainId].name;
  if (selected) {
    const move = validatePartyPath(state, selected, [tile.key]);
    $('#tile-info').textContent = `${name} · ${move.ok ? `移動力 ${move.cost} を消費` : move.reason}`;
  } else {
    const candidate = getTerritoryCandidates(state, state.cities['city-1']).some((t) => t.key === tile.key);
    $('#tile-info').textContent = `${name} · ${tile.ownerId ? '所有済み' : candidate ? `購入 Gold ${tilePurchaseCost(state, state.cities['city-1'], tile)}` : '購入できません'}`;
  }
}

// Re-enable a saved preference only after the first user gesture.
const gesture = () => { void audio.unlock(); };
document.addEventListener('pointerdown', gesture, { capture: true });
document.addEventListener('keydown', (event) => { gesture(); if (event.key === 'Escape') deselect(); });
document.querySelectorAll('[data-produce]').forEach((button) => { button.onclick = () => run(controller.setProduction(state, 'city-1', button.dataset.produce), `${RULESET.items[button.dataset.produce].name}の生産を開始しました`); });
document.querySelectorAll('[data-buy]').forEach((button) => {
  const item = RULESET.items[button.dataset.buy];
  button.textContent = `${item.name}を購入 · ${item.purchaseOptions.gold}`;
  button.onclick = () => run(controller.purchaseItem(state, 'city-1', button.dataset.buy), `${item.name}を購入しました`);
});
$('#form-party').onclick = () => {
  const city = state.cities['city-1'];
  const units = state.kingdoms['kingdom-1'].unitIds.filter((id) => !state.units[id].partyId && isActiveUnit(state.units[id]) && state.units[id].location === city.centerHex).slice(0, 5);
  if (!units.length) return reject('首都に未編成のUnitがいません');
  const result = run(controller.createParty(state, units, city.centerHex), 'Partyを編成しました');
  if (result.ok) { selectedPartyId = result.events.find((event) => event.type === 'PartyCreated').partyId; render(); }
};
$('#deselect-party').onclick = deselect;
$('#end-turn').onclick = () => run(controller.endTurn(state), '新しいターンを開始しました');
$('#save').onclick = () => {
  try { if (!storage) throw new Error(); storage.setItem('kingdom-m1-save', serializeGameState(state)); show('ブラウザへセーブしました'); void audio.play('se-save'); }
  catch { reject('セーブできませんでした。ブラウザの保存設定を確認してください。'); }
};
$('#load').onclick = () => {
  const before = state, previousSelection = selectedPartyId, previousHover = hoveredKey;
  try {
    const save = storage?.getItem('kingdom-m1-save'); if (!save) return reject('セーブデータがありません');
    const restored = restoreGameState(save);
    // The current UI supports a single kingdom/city. Check before replacing state.
    if (!restored.kingdoms?.['kingdom-1'] || !restored.cities?.['city-1'] || !restored.world?.tiles) throw new Error('このセーブは現在の画面に対応していません');
    state = restored; selectedPartyId = null; hoveredKey = null; formationPanel.clear(); render(); show('セーブをロードしました'); void audio.play('se-load');
  } catch (error) { state = before; selectedPartyId = previousSelection; hoveredKey = previousHover; render(); reject(error.message || 'セーブをロードできませんでした'); }
};
$('#reset').onclick = () => {
  state = createInitialGameState(117); state = RuleSystem.execute(state, controller.startTurn(state)).state;
  selectedPartyId = null; hoveredKey = null; formationPanel.clear(); audio.stop(); void audio.startMusic(); render(); show('固定シードで新規開始しました'); void audio.play('se-turn-start');
};
canvas.onclick = (event) => {
  const tile = tileAt(event); if (!tile) return;
  const party = Object.values(state.parties).find((entry) => entry.location === tile.key);
  if (party) {
    if (selectedPartyId === party.id) return deselect();
    selectedPartyId = party.id; void audio.play('se-ui-select'); show(`${party.id}を選択しました`); return render();
  }
  if (selectedPartyId) return run(controller.moveParty(state, selectedPartyId, [tile.key]), 'Partyを移動しました');
  const cost = tilePurchaseCost(state, state.cities['city-1'], tile);
  run(controller.purchaseTile(state, 'city-1', tile.key), `タイルをGold ${cost}で購入しました`);
};
canvas.onpointermove = (event) => { const key = tileAt(event)?.key ?? null; if (key !== hoveredKey) { hoveredKey = key; updateHover(); drawMap(); } };
canvas.onpointerleave = () => { hoveredKey = null; updateHover(); drawMap(); };
function updateAudioControls() {
  $('#audio-toggle').textContent = audio.muted ? '音声をオン' : '音声をオフ';
  $('#audio-toggle').setAttribute('aria-pressed', String(!audio.muted));
  $('#volume').value = Math.round(audio.volume * 100); $('#volume-value').textContent = `${Math.round(audio.volume * 100)}%`;
}
$('#audio-toggle').onclick = () => { void audio.setMuted(!audio.muted); updateAudioControls(); };
$('#audio-retry').onclick = () => { void audio.retry(); };
$('#volume').oninput = (event) => { audio.setVolume(Number(event.target.value) / 100); updateAudioControls(); };
document.addEventListener('visibilitychange', () => audio.setHidden(document.hidden));
window.addEventListener('pagehide', () => audio.stop());
window.addEventListener('resize', drawMap);
updateAudioControls(); render();
let repaint;
void assets.load({ onProgress: () => { cancelAnimationFrame(repaint); repaint = requestAnimationFrame(render); } }).then(() => {
  render();
  $('#asset-status').textContent = assets.failed.size ? '一部の画像を読み込めませんでした。簡易表示で続行します。' : '';
  void audio.startMusic();
});
