import { ABILITIES, hasActiveAbilities } from '../core/abilities.js';
import { previewAbility, validateAbility, abilityTargets } from '../systems/ability-system.js';
import { unitName } from './inspection.js';

const rowNames = { front: '前列', middle: '中列', rear: '後列' };
const node = (tag, text) => { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; return el; };
export class AbilityPanel {
  constructor(root, callbacks) { this.root = root; this.callbacks = callbacks; this.clear(); }
  clear() { this.partyId = null; this.casterId = null; this.abilityId = null; this.targetId = null; }
  selectAbility(state, party, playerId, abilityId) {
    const definition = ABILITIES[abilityId];
    for (const casterUnitId of party.unitIds) for (const target of abilityTargets(state, party, definition)) {
      if (!validateAbility(state, playerId, { partyId: party.id, casterUnitId, abilityId, targetUnitId: target.id }).ok) continue;
      this.partyId = party.id; this.casterId = casterUnitId; this.abilityId = abilityId; this.targetId = target.id;
      return true;
    }
    return false;
  }
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
    const d = ABILITIES[this.abilityId], targets = abilityTargets(state, party, d);
    if (!targets.some(u => u.id === this.targetId)) this.targetId = (d.effect === 'heal' ? targets.find(u => u.currentHp > 0 && u.currentHp < u.maxHp) : null)?.id ?? targets[0]?.id ?? null;
    const select = (id, title, values, selected, change) => {
      const label = node('label', title), el = node('select'); label.htmlFor = id; el.id = id; el.disabled = !canAct;
      for (const [value, text] of values) { const option = node('option', text); option.value = value; option.selected = value === selected; el.append(option); }
      el.onchange = () => { change(el.value); this.render(state, party, playerId, canAct); };
      root.append(label, el);
    };
    select('ability-caster', '発動者', casters.map(u => [u.id, `${unitName(u)} ${u.id} · HP ${u.currentHp}`]), this.casterId, id => { this.casterId = id; });
    select('ability-kind', '能力', abilities.map(a => [a.id, a.name]), this.abilityId, id => { this.abilityId = id; });
    select('ability-target', d.effect === 'heal' ? '対象' : d.pattern === 'row' ? '範囲の基準となる敵Unit（同じ横列）' : '敵の対象', targets.map(u => [u.id, `${unitName(u)} ${u.id} · HP ${u.currentHp}/${u.maxHp}${d.effect === 'heal' ? '' : ` · 抵抗 ${u.resistance}`}`]), this.targetId, id => { this.targetId = id; });
    const costs = node('p', `費用: mana ${d.manaCost} · Gold ${d.goldCost} · 移動力 ${d.movementCost} · 攻撃回数 ${d.attackCost} · チャージ ${d.chargeCost}。使用後は行動終了。`); costs.className = 'hint'; root.append(costs);
    const charges = node('p', `残りチャージ ${caster.charges[d.id]}/${d.initialCharges}（ターン・休養では補充されません） · この全体ターンの残り使用回数 ${caster.abilityStates[d.id].usesRemaining}/${d.usesPerRound}`); charges.id = 'ability-charges'; root.append(charges);
    const payload = { partyId: party.id, casterUnitId: caster.id, abilityId: d.id, targetUnitId: this.targetId };
    const preview = previewAbility(state, playerId, payload);
    const status = node('div');
    if (!preview.ok) status.append(node('p', preview.reason));
    else if (d.effect === 'heal') status.append(node('p', `回復予測: ${this.targetId} HP ${state.units[this.targetId].currentHp} → ${preview.remainingHp}（+${preview.recoveredHp}）。HP0は復活しません。`));
    else {
      status.append(node('p', `魔法戦闘力 ${caster.magicStrength} · 射程 ${d.range} · ${preview.targetRow ? '範囲内に必中' : `対象への命中率 ${Math.round(preview.hitChance * 100)}%`} · 反撃なし`));
      if (preview.targetRow) {
        status.append(node('p', `${rowNames[preview.targetRow]}: ${preview.targetUnitIds.join('、')}（主対象 ${preview.primaryTargetId}）`));
        status.append(node('p', `各対象に基礎被害の${Math.round(d.multiplier * 100)}%。主対象の護衛を処理し、直撃と肩代わりを合算して抵抗で軽減します。遮蔽・挑発による命中補正はありません。`));
      } else status.append(node('p', '被害予測（命中失敗・遮蔽・護衛を含む）。装甲ではなく、被害を受ける各Unitの抵抗を適用します。'));
      for (const [id, range] of Object.entries(preview.damage).filter(([, r]) => r.max > 0)) status.append(node('p', `${id}: HP損失 ${range.min}〜${range.max}${preview.guards.includes(id) ? ' · 護衛' : ''}${preview.intercepts.includes(id) ? ' · 割り込み' : ''}${preview.covers.includes(id) ? ' · 遮蔽' : ''}${preview.targetRow && preview.targetUnitIds.includes(id) ? ' · 範囲内' : ''}`));
      if (preview.taunts.length) status.append(node('p', `挑発: ${preview.taunts.join('、')}。指定対象への命中率に影響します。`));
    }
    status.id = 'ability-preview'; status.setAttribute('aria-live', 'polite'); root.append(status);
    const button = node('button', `${d.name}を使う`); button.id = 'use-ability'; button.type = 'button'; button.disabled = !canAct || !preview.ok; button.setAttribute('aria-describedby', 'ability-preview ability-charges'); button.onclick = () => this.callbacks.onUse(payload); root.append(button);
    const log = node('ol'); log.id = 'ability-log';
    for (const e of state.eventLog.filter(e => e.type === 'AbilityUsed' && e.partyId === party.id).slice(-6).reverse()) {
      log.append(node('li', `ターン ${e.turn}: ${e.casterUnitId}の${ABILITIES[e.abilityId]?.name ?? e.abilityId} → ${ABILITIES[e.abilityId]?.pattern === 'row' ? `${rowNames[e.targetRow]} ${e.targetUnitIds.join('、')}` : e.targetUnitId} ${e.abilityId === 'heal' ? `HP +${e.recoveredHp}（${e.remainingHp}）` : `総被害 ${e.damage}${e.hit ? '' : ' · 指定対象への命中失敗'}`} · mana ${e.costs.mana} · 残りチャージ ${e.chargesRemaining}`));
    }
    if (log.childElementCount) root.append(log);
    if (focus) document.getElementById(focus)?.focus({ preventScroll: true });
  }
}
