import { validateReinforceParty, validateMergeParties, validateSplitParty } from '../systems/party-reorganization.js';
import { isActiveUnit } from '../models/party.js';
import { RULESET } from '../core/ruleset.js';
import { Hex } from '../world/hex.js';
import { partyName, unitName } from './inspection.js';

const node = (tag, text) => { const element = document.createElement(tag); if (text !== undefined) element.textContent = text; return element; };
export class ReorganizationPanel {
  constructor(root, callbacks) { this.root = root; this.callbacks = callbacks; this.clear(); }
  clear() { this.partyId = null; this.recruits = new Set(); this.split = new Set(); this.targetId = ''; this.destination = ''; }
  render(state, party, playerId) {
    const root = this.root, focused = root.contains(document.activeElement) ? document.activeElement.id : null;
    root.hidden = !party || party.ownerId !== playerId || party.status !== 'active';
    if (root.hidden) { root.replaceChildren(); this.clear(); return; }
    if (this.partyId !== party.id) { this.clear(); this.partyId = party.id; }
    const waiting = Object.values(state.units).filter(unit => unit.ownerId === playerId && unit.partyId === null && unit.location === party.location && isActiveUnit(unit));
    this.recruits = new Set([...this.recruits].filter(id => waiting.some(unit => unit.id === id)));
    this.split = new Set([...this.split].filter(id => party.unitIds.includes(id)));
    const rerender = () => this.render(state, party, playerId);
    root.replaceChildren(node('h3', '部隊の再編'));
    const hint = node('p', '補充・合流・分割を行うと、関係する全部隊の移動・攻撃・割り込みがこのターン終了します。未終了かつ移動力1以上が必要です。'); hint.className = 'hint'; root.append(hint);
    const section = title => { const fieldset = node('fieldset'); fieldset.append(node('legend', title)); root.append(fieldset); return fieldset; };
    const checkboxes = (parent, units, selected, kind) => {
      for (const unit of units) {
        const label = node('label'), input = node('input'); input.type = 'checkbox'; input.id = `${kind}-${unit.id}`; input.dataset[kind] = unit.id;
        input.checked = selected.has(unit.id); input.onchange = () => { if (input.checked) selected.add(unit.id); else selected.delete(unit.id); rerender(); };
        label.append(input, node('span', `${unitName(unit)} ${unit.id} · HP ${unit.currentHp}/${unit.maxHp}`)); label.className = 'reorg-unit'; parent.append(label);
      }
    };
    const action = (parent, id, text, validation, onClick) => {
      const button = node('button', text); button.type = 'button'; button.id = id; button.disabled = !validation.ok; button.onclick = onClick;
      const status = node('p', validation.ok ? '実行すると関係部隊の行動を終了します。' : validation.reason); status.className = 'hint'; status.id = `${id}-status`; button.setAttribute('aria-describedby', status.id); parent.append(button, status);
    };
    const reinforce = section(`同じセルの待機兵を補充 · 空き ${5 - party.unitIds.length}体`);
    checkboxes(reinforce, waiting, this.recruits, 'reinforceUnit');
    if (!waiting.length) reinforce.append(node('p', '補充できる待機兵がいません。'));
    const ids = [...this.recruits];
    action(reinforce, 'reinforce-party', `選択した${ids.length}体を補充`, validateReinforceParty(state, playerId, party.id, ids), () => this.callbacks.onReinforce(party.id, ids));

    const merge = section('隣接部隊へ合流'), neighbors = Object.values(state.parties).filter(other => other.id !== party.id && other.ownerId === playerId && other.status === 'active' && Hex.fromKey(party.location).distance(Hex.fromKey(other.location)) === 1);
    if (!neighbors.some(other => other.id === this.targetId)) this.targetId = '';
    const target = node('select'); target.id = 'merge-target'; target.setAttribute('aria-label', '合流先の部隊');
    const option = (select, value, text) => { const entry = node('option', text); entry.value = value; select.append(entry); };
    option(target, '', '合流先を選択');
    for (const other of neighbors) option(target, other.id, `${partyName(other)} · ${other.unitIds.length}体 · (${other.location})`);
    target.value = this.targetId; target.onchange = () => { this.targetId = target.value; rerender(); }; merge.append(target);
    action(merge, 'merge-parties', '選択部隊を合流先へ移す', validateMergeParties(state, playerId, party.id, this.targetId), () => this.callbacks.onMerge(party.id, this.targetId));

    const split = section('一部のUnitを隣接セルへ分割'); checkboxes(split, party.unitIds.map(id => state.units[id]), this.split, 'splitUnit');
    const destination = node('select'); destination.id = 'split-destination'; destination.setAttribute('aria-label', '分割先のセル'); option(destination, '', '分割先を選択');
    for (let direction = 0; direction < 6; direction++) {
      const key = Hex.fromKey(party.location).neighbor(direction).key, tile = state.world.tiles[key];
      if (tile) option(destination, key, `${RULESET.terrain[tile.terrainId].name} (${key})`);
    }
    destination.value = this.destination; this.destination = destination.value;
    destination.onchange = () => { this.destination = destination.value; if (this.destination) this.callbacks.onLocation(this.destination); rerender(); }; split.append(destination);
    const separate = [...this.split];
    action(split, 'split-party', `選択した${separate.length}体で分割`, validateSplitParty(state, playerId, party.id, separate, this.destination), () => this.callbacks.onSplit(party.id, separate, this.destination));
    if (focused) document.getElementById(focused)?.focus({ preventScroll: true });
  }
}
