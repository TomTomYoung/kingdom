import { ABILITIES, hasActiveAbilities } from '../core/abilities.js';
import { previewAbility } from '../systems/ability-system.js';
import { unitName } from './inspection.js';

const node = (tag, text) => { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; return el; };
export class AbilityPanel {
  constructor(root, callbacks) { this.root = root; this.callbacks = callbacks; this.clear(); }
  clear() { this.partyId = null; this.casterId = null; this.abilityId = null; this.targetId = null; }
  render(state, party, playerId, canAct) {
    const root = this.root, focus = root.contains(document.activeElement) ? document.activeElement.id : null;
    root.replaceChildren(); root.hidden = !party || party.ownerId !== playerId;
    if (root.hidden) { this.clear(); return; }
    if (this.partyId !== party.id) { this.clear(); this.partyId = party.id; }
    root.append(node('h3', '能力'));
    if (!hasActiveAbilities(state)) { root.append(node('p', '新規の「AIとの増援戦」「AIとの都市争奪戦」で能力を使えます。')); return; }
    const casters = party.unitIds.map(id => state.units[id]).filter(u => Object.keys(u.abilityStates).length);
    if (!casters.length) { root.append(node('p', 'この部隊には能力を習得したUnitがいません。')); return; }
    if (!casters.some(u => u.id === this.casterId)) this.casterId = casters[0].id;
    const caster = state.units[this.casterId], abilities = Object.keys(caster.abilityStates).map(id => ABILITIES[id]);
    if (!abilities.some(a => a.id === this.abilityId)) this.abilityId = abilities[0].id;
    if (!party.unitIds.includes(this.targetId)) this.targetId = party.unitIds.find(id => state.units[id].currentHp > 0 && state.units[id].currentHp < state.units[id].maxHp) ?? party.unitIds[0];
    const select = (id, title, values, selected, change) => {
      const label = node('label', title), el = node('select'); label.htmlFor = id; el.id = id; el.disabled = !canAct;
      for (const [value, text] of values) { const option = node('option', text); option.value = value; option.selected = value === selected; el.append(option); }
      el.onchange = () => { change(el.value); this.render(state, party, playerId, canAct); };
      root.append(label, el);
    };
    select('ability-caster', '発動者', casters.map(u => [u.id, `${unitName(u)} ${u.id} · HP ${u.currentHp}`]), this.casterId, id => { this.casterId = id; });
    select('ability-kind', '能力', abilities.map(a => [a.id, a.name]), this.abilityId, id => { this.abilityId = id; });
    select('ability-target', '対象', party.unitIds.map(id => { const u = state.units[id]; return [id, `${unitName(u)} ${id} · HP ${u.currentHp}/${u.maxHp}`]; }), this.targetId, id => { this.targetId = id; });
    const d = ABILITIES[this.abilityId];
    const costs = node('p', `費用: mana ${d.manaCost} · Gold ${d.goldCost} · 移動力 ${d.movementCost} · 攻撃回数 ${d.attackCost} · チャージ ${d.chargeCost}。使用後は行動終了。`); costs.className = 'hint'; root.append(costs);
    const charges = node('p', `残りチャージ ${caster.charges[d.id]}/${d.initialCharges}（ターン・休養では補充されません） · この全体ターンの残り使用回数 ${caster.abilityStates[d.id].usesRemaining}/${d.usesPerRound}`); charges.id = 'ability-charges'; root.append(charges);
    const payload = { partyId: party.id, casterUnitId: caster.id, abilityId: d.id, targetUnitId: this.targetId };
    const preview = previewAbility(state, playerId, payload);
    const status = node('p', preview.ok ? `回復予測: ${this.targetId} HP ${state.units[this.targetId].currentHp} → ${preview.remainingHp}（+${preview.recoveredHp}）。HP0は復活しません。` : preview.reason);
    status.id = 'ability-preview'; status.setAttribute('aria-live', 'polite'); root.append(status);
    const button = node('button', `${d.name}を使う`); button.id = 'use-ability'; button.type = 'button'; button.disabled = !canAct || !preview.ok; button.setAttribute('aria-describedby', 'ability-preview ability-charges'); button.onclick = () => this.callbacks.onUse(payload); root.append(button);
    const log = node('ol'); log.id = 'ability-log';
    for (const e of state.eventLog.filter(e => e.type === 'AbilityUsed' && e.partyId === party.id).slice(-6).reverse()) {
      log.append(node('li', `ターン ${e.turn}: ${e.casterUnitId}の${ABILITIES[e.abilityId]?.name ?? e.abilityId} → ${e.targetUnitId} HP +${e.recoveredHp}（${e.remainingHp}） · mana ${e.costs.mana} · 残りチャージ ${e.chargesRemaining}`));
    }
    if (log.childElementCount) root.append(log);
    if (focus) document.getElementById(focus)?.focus({ preventScroll: true });
  }
}
