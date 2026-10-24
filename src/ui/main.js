import { createDuelGameState, createRangedDuelGameState } from '../core/scenarios.js';
import { CombatPanel } from './combat-panel.js';
import { createInitialGameState, restoreGameState, serializeGameState } from '../core/game-state.js';
import { HumanController } from '../core/human-controller.js';
import { RuleSystem } from '../core/rule-system.js';
import { RULESET } from '../core/ruleset.js';
import { getTerritoryCandidates, tilePurchaseCost } from '../systems/territory-system.js';
import { getReachablePartyPaths, terrainMovementCost } from '../systems/movement-system.js';
import { AssetStore } from './assets.js';
import { GameAudio, soundForResult } from './audio.js';
import { FormationPanel } from './formation.js';
import { MapView } from './map-view.js';
import { InspectionView, partyName, unitName } from './inspection.js';

const $ = (selector) => document.querySelector(selector);
const controller = new HumanController('kingdom-1'), assets = new AssetStore();
let storage;
try { storage = window.localStorage; } catch { /* The game is playable without persistence. */ }
const audio = new GameAudio(assets, { storage, onStatus: (text) => { $('#audio-status').textContent = text; } });
function newGame(mode = 'single') { controller.playerId = 'kingdom-1'; const initial = mode === 'ranged-duel' ? createRangedDuelGameState(117) : mode === 'duel' ? createDuelGameState(117) : createInitialGameState(117, { startingParty: true }); return RuleSystem.execute(initial, controller.startTurn(initial)).state; }
let state = newGame(), selectedPartyId = 'party-1', selectedUnitId = 'unit-1', selectedTileKey = '0,0,0', hoveredKey = null, reachable = new Map(), selectedEnemyId = null;
const capital = () => state.cities[state.kingdoms[controller.playerId].cityIds[0]];
const labels = { food: '食料', production: '生産', gold: 'Gold', science: '科学', mana: 'Mana', religion: '宗教', culture: '文化', popularSupport: '人心' };
const assetId = (name) => `icon-${name === 'popularSupport' ? 'popular-support' : name}`;
const show = (message) => { $('#message').textContent = message; };

const map = new MapView($('#map'), $('#minimap'), assets, {
  onInspect: ({ tile, marker }) => {
    if (marker?.kind === 'party') return selectParty(marker.id, false);
    if (marker?.kind === 'unit') return selectUnit(marker.id, false);
    selectedTileKey = tile.key; renderInspection(); drawMap();
  },
  onMove: moveTo,
  onHover: (key) => { if (key !== hoveredKey) { hoveredKey = key; updateHover(); drawMap(); } },
  onCameraChange: (camera) => { $('#map-zoom').textContent = `${camera.zoom * 100}%`; $('#zoom-in').disabled = camera.zoom === 3; $('#zoom-out').disabled = camera.zoom === 1; },
});
const inspection = new InspectionView($('#cell-content'), $('#unit-content'), assets, {
  onMove: moveTo, onParty: selectParty, onUnit: selectUnit, onCreate: createParty,
  onPurchase: (key) => run(controller.purchaseTile(state, capital().id, key), `セルをGold ${tilePurchaseCost(state, capital(), state.world.tiles[key])}で購入しました`),
  onFocus: (key) => map.focus(key),
});
const formationPanel = new FormationPanel($('#formation'), assets, {
  onChange: (partyId, formation) => run(controller.setFormation(state, partyId, formation), '部隊の配置を変更しました'),
  onSelect: (unitId) => { selectedUnitId = unitId; renderInspection(); void audio.play('se-ui-select'); },
  onCancel: () => { void audio.play('se-ui-cancel'); },
});

const combatPanel = new CombatPanel($('#combat-panel'), {
  onTarget: (id) => { if (id) selectParty(id); else { selectedEnemyId = null; render(); } },
  onAttack: (id, type, targeting) => run(controller.attackParty(state, selectedPartyId, id, type, targeting), '戦闘を解決しました。HP・護衛・反撃は戦闘ログで確認できます。'),
  onGuard: (partyId, guardId, targetId, mode) => run(controller.setGuardOrder(state, partyId, guardId, targetId, mode), '護衛設定を変更しました'),
});

function run(command, success) {
  const result = RuleSystem.execute(state, command); void audio.play(soundForResult(result, command));
  if (!result.ok) { show(result.reason); return result; }
  const previousPlayer = state.activePlayerId;
  state = result.state;
  if (state.activePlayerId !== previousPlayer) {
    controller.playerId = state.activePlayerId; selectedPartyId = Object.values(state.parties).find(p => p.ownerId === controller.playerId && p.status === 'active')?.id ?? null;
    selectedUnitId = state.parties[selectedPartyId]?.leaderUnitId ?? null; selectedEnemyId = null; selectedTileKey = state.parties[selectedPartyId]?.location ?? capital().centerHex;
    formationPanel.clear(); inspection.clear(); hoveredKey = null;
  }
  show(typeof success === 'function' ? success() : success); render();
  if (result.events.some(event => event.type === 'CombatDamage')) map.playCombat(result.events);
  if (state.activePlayerId !== previousPlayer) map.focus(selectedTileKey);
  return result;
}
function reject(message) { show(message); void audio.play('se-ui-error'); }
function selectParty(id, focus = true) {
  const party = state.parties[id]; if (!party) return;
  if (party.ownerId !== controller.playerId) {
    selectedEnemyId = id; selectedUnitId = party.leaderUnitId; selectedTileKey = party.location;
    void audio.play('se-ui-select'); render(); if (focus) map.focus(party.location); return;
  }
  if (selectedPartyId !== id) formationPanel.clear();
  selectedPartyId = id; selectedTileKey = party.location;
  if (!party.unitIds.includes(selectedUnitId)) selectedUnitId = party.leaderUnitId;
  void audio.play('se-ui-select'); render(); if (focus) map.focus(party.location);
}
function selectUnit(id, focus = true) {
  const unit = state.units[id]; if (!unit) return;
  if (unit.ownerId !== controller.playerId) {
    selectedEnemyId = unit.partyId; selectedUnitId = id; selectedTileKey = unit.location;
    void audio.play('se-ui-select'); render(); if (focus) map.focus(unit.location); return;
  }
  if (selectedPartyId !== unit.partyId) formationPanel.clear();
  selectedUnitId = id; selectedPartyId = unit.partyId; selectedTileKey = unit.location;
  void audio.play('se-ui-select'); render(); if (focus) map.focus(unit.location);
}
function deselect() {
  selectedPartyId = null; selectedUnitId = null; selectedEnemyId = null; formationPanel.clear();
  void audio.play('se-ui-cancel'); show('部隊・Unitの選択を解除しました。セルはクリックで確認できます。'); render();
}
function createParty(unitIds, location) {
  const result = run(controller.createParty(state, unitIds, location), '部隊を編成しました');
  if (result.ok) { inspection.clear(); selectParty(result.events.find((e) => e.type === 'PartyCreated').partyId); }
  return result;
}
function moveTo(key) {
  const party = state.parties[selectedPartyId];
  if (!party || party.ownerId !== controller.playerId) return reject('先に自国の部隊を選択してください。待機Unitは部隊に編成すると移動できます。');
  const route = getReachablePartyPaths(state, party).get(key);
  if (!route) return reject(key === party.location ? '部隊の現在位置です。' : '移動できません。残り移動力・地形・他部隊の占有を確認してください。');
  const result = run(controller.moveParty(state, party.id, route.path), `${partyName(party)}を移動しました（移動力 ${route.cost}）`);
  if (result.ok) { selectedTileKey = key; render(); map.focus(key); }
}
function drawMap() {
  map.setState(state, { playerId: controller.playerId, selectedPartyId, selectedUnitId, selectedTileKey, hoveredKey, reachable, targetPartyId: selectedEnemyId, candidates: new Set(getTerritoryCandidates(state, capital()).map((t) => t.key)) });
}
function renderInspection() {
  inspection.render({ state, playerId: controller.playerId, tileKey: selectedTileKey, unitId: selectedUnitId, partyId: selectedPartyId, reachable });
  const tile = state.world.tiles[selectedTileKey], route = reachable.get(selectedTileKey);
  $('#map-selection-name').textContent = tile ? `${RULESET.terrain[tile.terrainId].name} (${tile.q}, ${tile.r}, ${tile.s})` : 'セルを選択してください';
  $('#map-move').disabled = !route; $('#map-move').textContent = route ? `ここへ移動 · 移動力 ${route.cost}` : 'ここへ移動';
}
function updateHover() {
  const tile = state.world.tiles[hoveredKey];
  $('#tile-info').textContent = tile ? `${RULESET.terrain[tile.terrainId].name} (${tile.q}, ${tile.r}, ${tile.s}) · ${reachable.has(tile.key) ? `移動力 ${reachable.get(tile.key).cost}で到達可能` : `進入コスト ${terrainMovementCost(tile.terrainId) ?? '通行不可'}`} · クリックで詳細` : '左クリック：セル・駒を確認 ／ 右クリック：選択部隊を移動 ／ ドラッグ：地図を移動';
}
function stat(name, value) {
  const node = document.createElement('div'); node.className = 'stat';
  const label = document.createElement('small'), number = document.createElement('b'); label.textContent = labels[name]; number.textContent = value;
  node.append(assets.icon(assetId(name)), label, number); return node;
}
function renderRoster() {
  const root = $('#unit-roster'); root.replaceChildren();
  const append = (text, attribute, id, selected, onClick) => {
    const button = document.createElement('button'); button.className = 'secondary roster-entry'; button.textContent = text; button.dataset[attribute] = id;
    button.setAttribute('aria-pressed', String(selected)); button.onclick = onClick; root.append(button);
  };
  for (const party of Object.values(state.parties).filter((p) => p.ownerId === controller.playerId)) append(`${partyName(party)}${party.status === 'defeated' ? '（敗北記録・占有なし）' : ''} · ${party.unitIds.length}体 · 移動 ${party.movementRemaining}/${party.movementMaximum} · (${party.location})`, 'selectParty', party.id, selectedPartyId === party.id, () => selectParty(party.id));
  for (const unit of Object.values(state.units).filter((u) => u.ownerId === controller.playerId && !u.partyId)) append(`待機 ${unitName(unit)} ${unit.id} · HP ${unit.currentHp}/${unit.maxHp} · (${unit.location})`, 'selectUnit', unit.id, selectedUnitId === unit.id, () => selectUnit(unit.id));
  if (!root.childNodes.length) root.textContent = 'Unitがいません。都市でUnitを生産・購入してください。';
}
function render() {
  const k = state.kingdoms[controller.playerId], city = capital();
  if (!state.parties[selectedPartyId]) selectedPartyId = null;
  if (!state.units[selectedUnitId]) selectedUnitId = null;
  if (!state.world.tiles[selectedTileKey]) selectedTileKey = city.centerHex;
  const party = state.parties[selectedPartyId];
  reachable = party?.ownerId === controller.playerId && state.activePlayerId === controller.playerId ? getReachablePartyPaths(state, party) : new Map();
  $('#active-kingdom').textContent = `${k.name}の手番`;
  $('#turn').textContent = state.currentTurn; $('#seed').textContent = `固定シード ${state.seed} · ${Object.keys(state.world.tiles).length}セル`;
  $('#city-name').textContent = city.name; $('#population').textContent = `人口 ${city.population}`;
  $('#resources').replaceChildren(...Object.entries({ ...k.stockpiles, science: k.progress.science, culture: k.progress.culture }).map(([name, value]) => stat(name, value)));
  $('#military').textContent = k.derived.militaryPower; $('#governance').textContent = k.derived.governanceCapacity; $('#load-value').textContent = k.derived.governanceLoad;
  $('#yields').replaceChildren(...Object.entries(city.yieldSummary).map(([name, value]) => { const node = document.createElement('span'); node.append(assets.icon(assetId(name)), `${labels[name]} +${value}`); return node; }));
  const foodCost = RULESET.growthFoodBase + city.population * RULESET.growthFoodPerPopulation;
  $('#food-label').textContent = `${city.foodStorage} / ${foodCost}`; $('#food-bar').style.width = `${Math.min(100, city.foodStorage / foodCost * 100)}%`;
  $('#culture-label').textContent = `${city.localCultureProgress} / ${RULESET.cultureExpansionCost}`; $('#culture-bar').style.width = `${Math.min(100, city.localCultureProgress / RULESET.cultureExpansionCost * 100)}%`;
  $('#city-art').replaceChildren(assets.icon('building-city', 'unit-art')); $('#buildings').replaceChildren();
  if (city.buildings.includes('monument')) $('#buildings').append(assets.icon('building-monument', 'unit-art'), 'モニュメント建設済み');
  const item = city.production.currentItemId && RULESET.items[city.production.currentItemId];
  $('#production-status').textContent = item ? `${item.name}: ${city.production.progressByItem[item.itemId] ?? 0} / ${item.productionCost}` : '生産対象を選択してください';
  document.querySelectorAll('[data-produce]').forEach((button) => { const item = RULESET.items[button.dataset.produce]; button.replaceChildren(assets.icon(item.category === 'unit' ? `unit-${item.itemId}` : 'building-monument', 'unit-art'), `${item.name}を生産`); });
  $('#party-status').replaceChildren();
  if (party) { $('#party-status').append(assets.icon(`unit-${state.units[party.leaderUnitId]?.typeId ?? 'warrior'}`, 'unit-art'), `${partyName(party)} · ${party.unitIds.length}体`); $('#party-detail').textContent = `移動力 ${party.movementRemaining}/${party.movementMaximum} · 攻撃回数 ${party.attacksRemaining}/${party.attacksMaximum}`; }
  else { $('#party-status').textContent = selectedUnitId ? `${unitName(state.units[selectedUnitId])} ${selectedUnitId} · 待機中` : '部隊・Unitを選択してください'; $('#party-detail').textContent = '地図の駒または上の一覧から選べます。'; }
  $('#deselect-party').disabled = !party && !selectedUnitId; $('#focus-party').disabled = !party && !selectedUnitId;
  $('#map-mode').textContent = party ? `${partyName(party)} 選択中` : selectedUnitId ? '待機Unit 選択中' : 'セル確認';
  renderRoster(); formationPanel.render(state, party); renderInspection(); updateHover(); drawMap();
  combatPanel.render(state, selectedPartyId, selectedEnemyId);
  void audio.setMusic(state.parties[selectedEnemyId]?.status === 'active' ? 'bgm-battle' : 'bgm-overworld');
  document.querySelectorAll('[data-produce],[data-buy]').forEach(button => { const id = button.dataset.produce ?? button.dataset.buy; button.disabled = RULESET.items[id].category === 'building' && city.buildings.includes(id); });
}

const gesture = () => { void audio.unlock(); };
document.addEventListener('pointerdown', gesture, { capture: true });
document.addEventListener('keydown', (event) => { gesture(); if (event.key === 'Escape') deselect(); });
document.querySelectorAll('[data-produce]').forEach((button) => { button.onclick = () => run(controller.setProduction(state, capital().id, button.dataset.produce), `${RULESET.items[button.dataset.produce].name}の生産を開始しました`); });
document.querySelectorAll('[data-buy]').forEach((button) => { const item = RULESET.items[button.dataset.buy]; button.textContent = `${item.name}を購入 · ${item.purchaseOptions.gold}`; button.onclick = () => run(controller.purchaseItem(state, capital().id, button.dataset.buy), item.category === 'unit' ? `${item.name}を購入しました。首都の待機Unitに追加しました` : `${item.name}を建設しました。生産キューを更新しました`); });
$('#deselect-party').onclick = deselect;
$('#map-move').onclick = () => moveTo(selectedTileKey);
$('#zoom-in').onclick = () => map.zoomBy(1); $('#zoom-out').onclick = () => map.zoomBy(-1);
$('#focus-city').onclick = () => { selectedTileKey = capital().centerHex; renderInspection(); drawMap(); map.focus(selectedTileKey); };
$('#focus-party').onclick = () => map.focus(state.parties[selectedPartyId]?.location ?? state.units[selectedUnitId]?.location);
$('#next-party').onclick = () => {
  const parties = Object.values(state.parties).filter((p) => p.ownerId === controller.playerId && p.status === 'active');
  if (!parties.length) return reject('操作できる部隊がいません。待機Unitから部隊を作成してください。');
  const index = parties.findIndex((p) => p.id === selectedPartyId); selectParty(parties[(index + 1) % parties.length].id);
};
$('#end-turn').onclick = () => run(controller.endTurn(state), () => `${state.kingdoms[state.activePlayerId].name}の手番です（ターン ${state.currentTurn}）`);
$('#save').onclick = () => {
  try { if (!storage) throw new Error(); storage.setItem('kingdom-m1-save', serializeGameState(state)); show('ブラウザへセーブしました'); void audio.play('se-save'); }
  catch { reject('セーブできませんでした。ブラウザの保存設定を確認してください。'); }
};
$('#load').onclick = () => {
  const before = state, selection = { selectedPartyId, selectedUnitId, selectedTileKey, hoveredKey, selectedEnemyId, playerId: controller.playerId };
  try {
    const save = storage?.getItem('kingdom-m1-save'); if (!save) return reject('セーブデータがありません');
    const restored = restoreGameState(save);
    if (!restored.turnOrder.every(id => restored.cities[restored.kingdoms[id].cityIds[0]])) throw new Error('このセーブは現在の画面に対応していません');
    state = restored; controller.playerId = state.activePlayerId; selectedEnemyId = null; $('#game-mode').value = state.scenarioId === 'ranged-duel' ? 'ranged-duel' : state.turnOrder.length > 1 ? 'duel' : 'single'; selectedPartyId = null; selectedUnitId = null; selectedTileKey = capital().centerHex; hoveredKey = null;
    formationPanel.clear(); inspection.clear(); combatPanel.reset(); map.camera.zoom = 1; render(); map.focus(selectedTileKey); show('セーブをロードしました'); void audio.play('se-load');
  } catch (error) { state = before; ({ selectedPartyId, selectedUnitId, selectedTileKey, hoveredKey, selectedEnemyId } = selection); controller.playerId = selection.playerId; render(); reject(error.message || 'セーブをロードできませんでした'); }
};
$('#reset').onclick = () => {
  state = newGame($('#game-mode').value); selectedEnemyId = null; selectedPartyId = 'party-1'; selectedUnitId = 'unit-1'; selectedTileKey = state.parties[selectedPartyId].location; hoveredKey = null;
  formationPanel.clear(); inspection.clear(); combatPanel.reset(); map.camera.zoom = 1; audio.stop(); void audio.startMusic(); render(); map.focus(selectedTileKey); show(state.turnOrder.length > 1 ? '二国対戦を開始しました。敵部隊を選んで攻撃できます。ターン終了で操作する王国を交代します。' : '331セルの新規マップで開始しました。最初の部隊を操作できます。'); void audio.play('se-turn-start');
};
function updateAudioControls() {
  $('#audio-toggle').textContent = audio.muted ? '音声をオン' : '音声をオフ'; $('#audio-toggle').setAttribute('aria-pressed', String(!audio.muted));
  $('#volume').value = Math.round(audio.volume * 100); $('#volume-value').textContent = `${Math.round(audio.volume * 100)}%`;
}
$('#audio-toggle').onclick = () => { void audio.setMuted(!audio.muted); updateAudioControls(); };
$('#audio-retry').onclick = () => { void audio.retry(); };
$('#volume').oninput = (event) => { audio.setVolume(Number(event.target.value) / 100); updateAudioControls(); };
document.addEventListener('visibilitychange', () => audio.setHidden(document.hidden)); window.addEventListener('pagehide', () => audio.stop()); window.addEventListener('resize', () => map.draw());
updateAudioControls(); render();
let repaint;
void assets.load({ onProgress: () => { cancelAnimationFrame(repaint); repaint = requestAnimationFrame(render); } }).then(() => {
  render(); $('#asset-status').textContent = assets.failed.size ? '一部の画像を読み込めませんでした。簡易表示で続行します。' : ''; void audio.startMusic();
});
