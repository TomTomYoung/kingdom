import { FORMATION_SLOTS, hasActiveUnits, isActiveUnit } from '../models/party.js';

const rowLabels = { front: '前列', middle: '中列', rear: '後列' };
const columnLabels = { left: '左', center: '中央', right: '右' };

// UI selection is transient; only SetFormation may update the game state.
export class FormationPanel {
  constructor(element, assets, { onChange, onSelect, onCancel }) {
    this.element = element; this.assets = assets;
    this.onChange = onChange; this.onSelect = onSelect; this.onCancel = onCancel;
    this.partyId = null; this.sourceSlot = null;
  }

  clear() { this.partyId = null; this.sourceSlot = null; }

  render(state, party) {
    const root = this.element;
    const focused = root.contains(document.activeElement) ? document.activeElement.dataset.slot : null;
    root.hidden = !party;
    if (!party) { this.clear(); root.replaceChildren(); return; }
    if (this.partyId !== party.id || !party.formation[this.sourceSlot]) this.sourceSlot = null;
    this.partyId = party.id;
    const editable = party.ownerId === state.activePlayerId && state.phase === 'PLAYER_ACTION' && party.status === 'active' && hasActiveUnits(state, party);
    if (!editable) this.sourceSlot = null;
    const heading = document.createElement('h3'); heading.textContent = '部隊配置';
    const direction = document.createElement('p'); direction.className = 'formation-direction'; direction.textContent = '↑ 敵側';
    const grid = document.createElement('div'); grid.className = 'formation-grid'; grid.setAttribute('role', 'group'); grid.setAttribute('aria-label', '前列・中列・後列の3×3配置');
    for (const slot of FORMATION_SLOTS) {
      const [row, column] = slot.split('-'), unitId = party.formation[slot], unit = state.units[unitId];
      const button = document.createElement('button'); button.type = 'button'; button.className = 'formation-slot'; button.dataset.slot = slot;
      button.setAttribute('aria-pressed', String(this.sourceSlot === slot));
      const position = document.createElement('small'); position.textContent = `${rowLabels[row]}・${columnLabels[column]}`; button.append(position);
      const label = unit ? `${unit.id}${party.leaderUnitId === unitId ? '、指揮者' : ''}、HP ${unit.currentHp}/${unit.maxHp}${isActiveUnit(unit) ? '' : '、戦闘不能'}` : '空き';
      button.setAttribute('aria-label', `${position.textContent}、${label}`);
      if (unit) {
        button.append(this.assets.icon(`unit-${unit.typeId}`, 'unit-art'));
        const name = document.createElement('span'); name.className = 'formation-name'; name.textContent = `${party.leaderUnitId === unitId ? '指揮 ' : ''}${unit.id}`; button.append(name);
        const hp = document.createElement('span'); hp.className = 'formation-hp'; hp.textContent = `HP ${unit.currentHp}/${unit.maxHp}`; button.append(hp);
        if (!isActiveUnit(unit)) { const status = document.createElement('span'); status.textContent = '戦闘不能'; button.append(status); }
      } else { const empty = document.createElement('span'); empty.className = 'formation-empty'; empty.textContent = this.sourceSlot ? 'ここへ移動' : '空き'; button.append(empty); }
      button.disabled = !editable || (!unit && !this.sourceSlot);
      button.onclick = () => {
        if (this.sourceSlot === slot) { this.sourceSlot = null; this.onCancel(); this.render(state, party); return; }
        if (!this.sourceSlot) { this.sourceSlot = slot; this.onSelect(); this.render(state, party); return; }
        const formation = { ...party.formation }, source = this.sourceSlot;
        formation[slot] = party.formation[source];
        if (unitId) formation[source] = unitId; else delete formation[source];
        this.sourceSlot = null;
        const result = this.onChange(party.id, formation);
        if (!result.ok) this.render(state, party);
      };
      grid.append(button);
    }
    const hint = document.createElement('p'); hint.className = 'hint'; hint.id = 'formation-hint';
    hint.textContent = !editable ? 'この部隊の配置は変更できません。' : this.sourceSlot ? '移動先を選択してください。Unitがいる枠は入れ替えます。同じ枠で取消。' : 'Unitを選び、移動先を選択します。配置は自動で確定します。';
    grid.setAttribute('aria-describedby', hint.id);
    root.replaceChildren(heading, direction, grid, hint);
    if (focused) root.querySelector(`[data-slot="${focused}"]`)?.focus({ preventScroll: true });
  }
}
