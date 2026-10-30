import { cityDefenseLabel } from '../models/city-defense.js';
import { RULESET } from '../core/ruleset.js';
import { isActiveUnit, occupiesMapTile } from '../models/party.js';
import { terrainMovementCost } from '../systems/movement-system.js';
import { getTerritoryCandidates, tilePurchaseCost } from '../systems/territory-system.js';

const resourceLabels = { food: '食料', production: '生産', gold: 'Gold', science: '科学', mana: 'Mana', religion: '宗教', culture: '文化' };
const stateLabels = { active: '活動中', downed: '戦闘不能', shattered: '壊滅', defeated: '敗北' };
export const unitName = (unit) => RULESET.items[unit.typeId]?.name ?? unit.typeId;
export const partyName = (party) => `部隊 ${party.id.replace(/^party-/, '')}`;
const node = (tag, text, className) => { const element = document.createElement(tag); if (text !== undefined) element.textContent = text; if (className) element.className = className; return element; };
function facts(entries) {
  const list = node('dl', undefined, 'detail-facts');
  for (const [label, value] of entries) list.append(node('dt', label), node('dd', String(value)));
  return list;
}
function button(text, callback, data = {}) {
  const element = node('button', text, 'secondary'); element.type = 'button'; element.onclick = callback; Object.assign(element.dataset, data); return element;
}

export class InspectionView {
  constructor(tileRoot, unitRoot, assets, callbacks) {
    this.tileRoot = tileRoot; this.unitRoot = unitRoot; this.assets = assets; this.callbacks = callbacks;
    this.draft = new Set(); this.draftLocation = null; this.lastUnitId = null;
  }
  clear() { this.draft.clear(); this.draftLocation = null; this.lastUnitId = null; }
  render(options) {
    const { state, playerId, tileKey, unitId, partyId, reachable, cityId } = options;
    const tile = state.world.tiles[tileKey], unit = state.units[unitId], party = state.parties[partyId];
    this.tileRoot.replaceChildren(); this.unitRoot.replaceChildren();
    if (!tile) { this.tileRoot.append(node('p', '地図のセルを選択すると、地形・産出・駐留部隊を確認できます。', 'hint')); }
    else {
      const terrain = RULESET.terrain[tile.terrainId], city = state.cities[tile.cityId];
      const parties = Object.values(state.parties).filter((p) => p.location === tile.key);
      const occupants = parties.filter(occupiesMapTile);
      const units = Object.values(state.units).filter((u) => u.location === tile.key);
      const eligible = units.filter((u) => !u.partyId && u.ownerId === playerId && isActiveUnit(u));
      if (this.draftLocation !== tile.key) { this.draft.clear(); this.draftLocation = tile.key; }
      this.draft = new Set([...this.draft].filter((id) => eligible.some((u) => u.id === id)));
      if (unitId !== this.lastUnitId && this.draft.size < 5 && eligible.some((u) => u.id === unitId)) this.draft.add(unitId);
      this.lastUnitId = unitId;
      const title = node('div', undefined, 'inspection-heading'); title.append(this.assets.icon(`terrain-${tile.terrainId}`, 'terrain-art'), node('div', `${terrain.name} · (${tile.q}, ${tile.r}, ${tile.s})`)); this.tileRoot.append(title);
      this.tileRoot.append(facts([['所有国', state.kingdoms[tile.ownerId]?.name ?? '未所有'], ['所属都市', state.cities[tile.territoryCityId]?.name ?? 'なし'], ['都市中心', city?.name ?? 'なし'], ['収集時の作業', Object.values(state.cities).filter(c => c.workedTiles.includes(tile.key)).map(c => c.name).join('、') || 'なし'], ['進入コスト', terrainMovementCost(tile.terrainId) ?? '進入不可']]));
      const yields = node('div', undefined, 'yield-row');
      for (const [name, value] of Object.entries(terrain.yields).filter(([, value]) => value > 0)) { const entry = node('span'); entry.append(this.assets.icon(`icon-${name}`), `${resourceLabels[name]} +${value}`); yields.append(entry); }
      this.tileRoot.append(node('h3', '地形の基本産出'), yields.childNodes.length ? yields : node('p', '産出なし', 'hint'));
      if (party) {
        const route = reachable.get(tile.key), move = button(route ? `${partyName(party)}をここへ移動 · 移動力 ${route.cost}` : 'ここへ移動', () => this.callbacks.onMove(tile.key)); move.id = 'move-party';
        move.disabled = !route || party.ownerId !== playerId || (state.activePlayerId !== playerId || state.phase !== 'PLAYER_ACTION' || state.kingdoms[playerId].controllerType === 'ai');
        this.tileRoot.append(move);
        this.tileRoot.append(node('p', route ? `${route.path.length}セルの経路。現在のターン内に移動します。` : tile.key === party.location ? 'この部隊の現在位置です。' : tile.terrainId === 'void' ? '虚無には進入できません。' : occupants.length ? '他の部隊が占有しています。' : 'このターンの移動範囲外です。ターン終了で移動力が回復します。', 'hint'));
      }
      if (city && cityDefenseLabel(state, city)) this.tileRoot.append(node('p', cityDefenseLabel(state, city), 'hint'));
      const selectedCity = state.cities[cityId] ?? state.cities[state.kingdoms[playerId].cityIds[0]], cost = selectedCity ? tilePurchaseCost(state, selectedCity, tile) : Infinity;
      const candidate = getTerritoryCandidates(state, selectedCity).some((t) => t.key === tile.key);
      const affordable = state.kingdoms[playerId].stockpiles.gold >= cost;
      const purchase = button(tile.ownerId ? '所有済み' : candidate ? `このセルを購入 · Gold ${cost}` : '購入できないセル', () => this.callbacks.onPurchase(tile.key)); purchase.id = 'purchase-tile';
      purchase.disabled = !candidate || !affordable || (state.activePlayerId !== playerId || state.phase !== 'PLAYER_ACTION' || state.kingdoms[playerId].controllerType === 'ai'); this.tileRoot.append(purchase);
      this.tileRoot.append(node('p', selectedCity ? `領土購入先: ${selectedCity.name}。この都市の領土に隣接する未所有セルを取得できます。` : '所有都市がないため領土を購入できません。', 'hint'));
      if (candidate && !affordable) this.tileRoot.append(node('p', `購入にはGold ${cost}が必要です。`, 'hint'));
      this.tileRoot.append(node('h3', `駐留部隊 ${occupants.length} · Unit記録 ${units.length}`));
      for (const p of parties) {
        const entry = button(`${partyName(p)} · ${p.unitIds.length}体 · ${occupiesMapTile(p) ? stateLabels[p.status] : '敗北記録（占有なし）'}`, () => this.callbacks.onParty(p.id), { cellParty: p.id });
        entry.setAttribute('aria-pressed', String(p.id === partyId)); this.tileRoot.append(entry);
      }
      const roster = node('div', undefined, 'cell-roster'), checkboxes = [];
      let updateDraft = () => {};
      for (const u of units) {
        const row = node('div', undefined, 'cell-unit');
        if (eligible.includes(u)) {
          const input = node('input'); input.type = 'checkbox'; input.checked = this.draft.has(u.id); input.dataset.formUnit = u.id; input.setAttribute('aria-label', `${unitName(u)} ${u.id}を編成に含める`);
          input.onchange = () => {
            if (input.checked && this.draft.size < 5) this.draft.add(u.id); else this.draft.delete(u.id);
            updateDraft();
          }; checkboxes.push(input); row.append(input);
        }
        const select = button(`${unitName(u)} ${u.id} · HP ${u.currentHp}/${u.maxHp} · ${u.partyId ? partyName(state.parties[u.partyId]) : isActiveUnit(u) ? '待機' : '戦闘不能の記録（占有なし）'}`, () => this.callbacks.onUnit(u.id), { inspectUnit: u.id });
        select.setAttribute('aria-pressed', String(u.id === unitId)); row.append(select); roster.append(row);
      }
      this.tileRoot.append(roster);
      if (!units.length) this.tileRoot.append(node('p', '駐留しているUnitはいません。', 'hint'));
      if (eligible.length) {
        const create = button('', () => this.callbacks.onCreate([...this.draft], tile.key)); create.id = 'form-party';
        const selectAll = button('待機Unitを最大5体選択', () => { this.draft = new Set(eligible.slice(0, 5).map((u) => u.id)); updateDraft(); }); selectAll.id = 'select-waiting';
        function updateButton() { create.textContent = `選択した${this.draft.size}体で部隊を作成`; create.disabled = !this.draft.size || occupants.length > 0 || (state.activePlayerId !== playerId || state.phase !== 'PLAYER_ACTION' || state.kingdoms[playerId].controllerType === 'ai'); }
        updateDraft = () => { for (const input of checkboxes) { input.checked = this.draft.has(input.dataset.formUnit); input.disabled = !input.checked && this.draft.size >= 5; } updateButton.call(this); };
        updateDraft(); this.tileRoot.append(selectAll, create);
        this.tileRoot.append(node('p', occupants.length ? 'このセルの部隊を先に移動すると、新しい部隊を作れます。' : 'チェックで1〜5体を選びます。待機Unitは部隊に編成すると移動できます。', 'hint'));
      }
    }
    if (!unit) { this.unitRoot.append(node('p', '地図の駒、駐留一覧、または部隊配置からUnitを選択してください。', 'hint')); return; }
    const unitParty = state.parties[unit.partyId], title = node('div', undefined, 'inspection-heading');
    title.append(this.assets.icon(`unit-${unit.typeId}`, 'unit-art'), node('div', `${unitName(unit)} · ${unit.id}`)); this.unitRoot.append(title);
    const slot = unitParty && Object.entries(unitParty.formation).find(([, id]) => id === unit.id)?.[0];
    const slotLabel = slot?.replace('front', '前列').replace('middle', '中列').replace('rear', '後列').replace('left', '左').replace('center', '中央').replace('right', '右').replace('-', '・');
    this.unitRoot.append(facts([
      ['状態', stateLabels[unit.status] ?? unit.status], ['HP', `${unit.currentHp} / ${unit.maxHp}`], ['所属国', state.kingdoms[unit.ownerId]?.name ?? unit.ownerId],
      ['所属部隊', unitParty ? `${partyName(unitParty)}${occupiesMapTile(unitParty) ? '' : ' · 敗北記録（占有なし）'}` : isActiveUnit(unit) ? '未編成・待機中' : '離脱済み・戦闘不能の記録'], ['位置', unit.location], ['配置', slotLabel ?? 'なし'], ['指揮者', unitParty?.leaderUnitId === unit.id ? 'このUnit' : unitParty?.leaderUnitId ?? 'なし'],
      ['近接 / 遠隔', `${unit.meleeStrength} / ${unit.rangedStrength}`], ['防御 / 装甲', `${unit.defenseStrength} / ${unit.armor}`], ['射程', unit.range], ['護衛容量', `${unit.guardCapacityRemaining} / ${unit.guardCapacityMax}`], ['肩代わり率', `${Math.round(unit.guardRate * 100)}%`],
      ['命中 / 回避', `${Math.round((unit.accuracy ?? 1) * 100)}% / ${Math.round((unit.evasion ?? 0) * 100)}%`], ['挑発 / 遮蔽', `${Math.round((unit.tauntStrength ?? 0) * 100)}% / ${Math.round((unit.coverPower ?? 0) * 100)}%`],
    ]));
    if (unitParty) {
      this.unitRoot.append(facts([['部隊の移動力', `${unitParty.movementRemaining} / ${unitParty.movementMaximum}`], ['部隊の攻撃回数', `${unitParty.attacksRemaining} / ${unitParty.attacksMaximum}`]]));
      this.unitRoot.append(button('所属部隊を選択', () => this.callbacks.onParty(unitParty.id)));
    } else if (unit.ownerId === playerId) {
      const deploy = button('このUnitで部隊を作成', () => this.callbacks.onCreate([unit.id], unit.location)); deploy.id = 'deploy-unit';
      deploy.disabled = !isActiveUnit(unit) || Object.values(state.parties).some((p) => occupiesMapTile(p) && p.location === unit.location) || (state.activePlayerId !== playerId || state.phase !== 'PLAYER_ACTION' || state.kingdoms[playerId].controllerType === 'ai');
      this.unitRoot.append(deploy);
    }
    this.unitRoot.append(button('地図でこのUnitを見る', () => this.callbacks.onFocus(unit.location)));
  }
}
