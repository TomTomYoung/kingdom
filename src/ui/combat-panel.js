import { previewPartyAttack } from '../systems/combat-system.js';
import { validateGuardOrder } from '../systems/damage-grid.js';
import { partyName, unitName } from './inspection.js';

const node = (tag, text, className) => { const element = document.createElement(tag); if (text !== undefined) element.textContent = text; if (className) element.className = className; return element; };
function select(id, values, selected) {
  const element = node('select'); element.id = id;
  for (const [value, label] of values) { const option = node('option', label); option.value = value; option.selected = value === selected; element.append(option); }
  return element;
}
function field(label, control) { const element = node('label', label); element.htmlFor = control.id; element.append(control); return element; }
function eventText(event) {
  if (event.type === 'CombatDamage') return `${event.counter ? '反撃' : '攻撃'}: ${event.targetUnitId} HP −${event.damage} → ${event.remainingHp}${event.role === 'guard' ? '（肩代わり）' : event.role === 'intercept' ? '（割り込み）' : ''}`;
  if (event.type === 'CombatGuard') return `${event.guardUnitId} が ${event.targetUnitId} を護衛: ${event.amount}を肩代わり、残り容量${event.capacityRemaining}`;
  if (event.type === 'CombatIntercept') return `${event.guardUnitId} が ${event.targetUnitId} への攻撃に割り込み、残り反応${event.reactionCharges}`;
  if (event.type === 'PartyLeaderChanged') return `${event.partyId}: ${event.leaderUnitId} が指揮を継承`;
  if (event.type === 'PartyDefeated') return `${event.partyId} が敗北`;
  return null;
}

export class CombatPanel {
  constructor(root, callbacks) { this.root = root; this.callbacks = callbacks; this.attackType = 'melee'; this.guardId = null; }
  render(state, partyId, targetId) {
    const root = this.root, party = state.parties[partyId], target = state.parties[targetId];
    root.replaceChildren(node('h2', '戦闘と護衛'));
    const enemies = Object.values(state.parties).filter(p => p.ownerId !== state.activePlayerId);
    if (!enemies.length) root.append(node('p', '敵部隊はいません。二国対戦を新規開始すると、交互操作で戦闘できます。', 'hint'));
    else {
      const targetControl = select('combat-target', [['', '敵部隊を選択'], ...enemies.map(p => [p.id, `${state.kingdoms[p.ownerId].name} · ${partyName(p)}${p.status === 'defeated' ? '（敗北）' : ''}`])], targetId ?? '');
      targetControl.onchange = () => this.callbacks.onTarget(targetControl.value); root.append(field('攻撃対象', targetControl));
    }
    if (party?.ownerId === state.activePlayerId) {
      root.append(node('p', `${partyName(party)} · 攻撃 ${party.attacksRemaining}/${party.attacksMaximum} · 割り込み残数 ${party.reactionCharges}`, 'hint'));
      if (target) {
        root.append(node('h3', `${partyName(target)}の配置とHP`));
        const grid = node('div', undefined, 'enemy-grid');
        for (const row of ['front', 'middle', 'rear']) for (const column of ['left', 'center', 'right']) {
          const unit = state.units[target.formation[`${row}-${column}`]], cell = node('div', unit ? `${unitName(unit)} ${unit.id}\nHP ${unit.currentHp}/${unit.maxHp}` : '空');
          if (unit?.currentHp === 0) cell.className = 'defeated'; grid.append(cell);
        }
        root.append(grid);
        const type = select('attack-type', [['melee', '近接（反撃あり）'], ['ranged', '遠隔（標準反撃なし）']], this.attackType);
        type.onchange = () => { this.attackType = type.value; this.render(state, partyId, targetId); }; root.append(field('攻撃方式', type));
        const preview = previewPartyAttack(state, partyId, targetId, this.attackType), forecast = node('div', undefined, 'combat-forecast'); forecast.id = 'combat-forecast';
        if (preview.ok) {
          forecast.append(node('p', `予測HP損失 · 反撃${{ none: 'なし', certain: 'あり', possible: 'の可能性あり' }[preview.counter]}`));
          for (const [id, range] of Object.entries(preview.damage).filter(([, range]) => range.max > 0)) forecast.append(node('p', `${state.units[id].ownerId === state.activePlayerId ? '自軍' : '敵軍'} ${id}: ${range.min}〜${range.max}${preview.guards.includes(id) ? ' · 護衛' : ''}${preview.intercepts.includes(id) ? ' · 割り込み' : ''}`));
          forecast.append(node('small', '攻撃すると攻撃回数を1消費し、この部隊の行動を終了します。'));
        } else forecast.append(node('p', preview.reason));
        const attack = node('button', '攻撃する'); attack.id = 'attack-party'; attack.disabled = !preview.ok;
        attack.onclick = () => this.callbacks.onAttack(targetId, this.attackType); root.append(forecast, attack);
      } else root.append(node('p', '自軍部隊を選び、敵の駒か上の一覧で攻撃対象を指定してください。', 'hint'));
      if (party.unitIds.length > 1 && party.status === 'active') {
        root.append(node('h3', '護衛の設定'));
        if (!party.unitIds.includes(this.guardId)) this.guardId = Object.keys(party.guardOrders ?? {})[0] ?? party.unitIds[0];
        const guard = select('guard-unit', party.unitIds.map(id => [id, `${id} · 容量 ${state.units[id].guardCapacityRemaining}/${state.units[id].guardCapacityMax}`]), this.guardId);
        guard.onchange = () => { this.guardId = guard.value; this.render(state, partyId, targetId); };
        const order = party.guardOrders?.[this.guardId];
        const protect = select('guard-target', party.unitIds.filter(id => id !== this.guardId).map(id => [id, id]), order?.targetUnitId);
        const mode = select('guard-mode', [['off', '護衛なし'], ['share', '肩代わり'], ['intercept', '割り込み（反応1）']], order?.mode ?? 'off');
        root.append(field('護衛するUnit', guard), field('守るUnit', protect), field('護衛方式', mode));
        const apply = node('button', '護衛設定を適用', 'secondary'); apply.id = 'set-guard';
        apply.onclick = () => this.callbacks.onGuard(party.id, guard.value, protect.value, mode.value); root.append(apply);
        const guardUnit = state.units[this.guardId];
        root.append(node('p', `このUnitの護衛範囲は縦横${guardUnit.guardRange ?? 1}枠以内、肩代わり${Math.round(guardUnit.guardRate * 100)}%、容量${guardUnit.guardCapacityRemaining}/${guardUnit.guardCapacityMax}です。割り込みは攻撃全体を受け、部隊の反応を1使います。範囲外や戦闘不能では発動しません。`, 'hint'));
        for (const [id, rule] of Object.entries(party.guardOrders ?? {})) {
          const inactive = validateGuardOrder(state, party, id, rule.targetUnitId, rule.mode);
          root.append(node('p', `${id} → ${rule.targetUnitId}: ${rule.mode === 'share' ? '肩代わり' : '割り込み'}${inactive ? `（${inactive}）` : ''}`, 'guard-order'));
        }
      }
    } else root.append(node('p', '現在の手番の部隊を選んでください。', 'hint'));
    const log = node('ol', undefined, 'combat-log'); log.id = 'combat-log';
    for (const event of state.eventLog.filter(event => eventText(event)).slice(-18).reverse()) log.append(node('li', `T${event.turn} ${eventText(event)}`));
    root.append(node('h3', '戦闘ログ'), log.childNodes.length ? log : node('p', 'まだ戦闘はありません。', 'hint'));
  }
}
