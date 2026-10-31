import { hasResearch, itemResearchError } from '../systems/research-system.js';
import { RULESET } from '../core/ruleset.js';
import { hasCityDefense } from '../models/city-defense.js';
import { validateProductionSelection } from '../systems/production-system.js';

export const productionPlan = city => city ? [city.production.currentItemId, ...city.production.queue].filter(id => id !== null) : [];

// The quick production buttons switch only the active item, not future orders.
// A queued building promoted to the front must not remain queued a second time.
export function queueForSelection(city, itemId) {
  return (city?.production.queue ?? []).filter(id => id !== itemId || RULESET.items[itemId]?.category !== 'building');
}

export function productionPlanError(state, city, items) {
  if (!city) return '所有都市がありません。';
  if (!Array.isArray(items) || !items.every(id => typeof id === 'string' && Object.hasOwn(RULESET.items, id))) return '不明な生産対象です。';
  if (!hasCityDefense(state) && items.includes('walls')) return '城壁は新規の都市争奪戦で建設できます。';
  for (const id of items) { const reason = itemResearchError(state, city.ownerId, id); if (reason) return reason; }
  return validateProductionSelection(city, items[0] ?? null, items.slice(1));
}

// Progress belongs to an item type, not each repeated Unit order. Use it once.
// These estimates neither run a turn nor sample RNG or alter the saved city.
export function productionForecast(city, items = productionPlan(city)) {
  const used = new Set(), rate = city?.yieldSummary.production ?? 0;
  let work = 0;
  return items.map((itemId, index) => {
    const item = RULESET.items[itemId];
    const progress = used.has(itemId) ? 0 : city.production.progressByItem[itemId] ?? 0;
    used.add(itemId); work += Math.max(0, item.productionCost - progress);
    return { index, itemId, progress, cost: item.productionCost, turns: rate > 0 ? Math.max(1, Math.ceil(work / rate)) : null };
  });
}

export class ProductionQueuePanel {
  constructor(root, { onApply }) {
    this.root = root; this.onApply = onApply; this.draft = null;
    this.notice = ''; this.selectedItemId = 'warrior';
  }
  canEdit() {
    return !!this.city && this.enabled && !this.state.gameResult && this.state.phase === 'PLAYER_ACTION'
      && this.city.ownerId === this.playerId && this.state.activePlayerId === this.playerId
      && this.state.kingdoms[this.playerId]?.controllerType !== 'ai';
  }
  redraw() { this.render(this.state, this.city, this.playerId, this.enabled); }
  change(edit) {
    if (!this.canEdit() || this.draft === null) return;
    edit(this.draft); this.notice = ''; this.redraw();
  }
  render(state, city, playerId, enabled) {
    const active = this.root.ownerDocument.activeElement;
    const focus = this.root.contains(active) ? active.dataset.queueFocus ?? active.id : null;
    if (this.draft !== null && (this.state !== state || this.city?.id !== city?.id || this.playerId !== playerId || !enabled)) {
      this.draft = null; this.notice = '都市またはゲーム状態が変わったため、未確定の編集を破棄しました。';
    }
    this.state = state; this.city = city; this.playerId = playerId; this.enabled = enabled;
    const doc = this.root.ownerDocument;
    const node = (tag, text, className) => {
      const el = doc.createElement(tag); if (text !== undefined) el.textContent = text;
      if (className) el.className = className; return el;
    };
    const button = (id, text, action, disabled = false) => {
      const el = node('button', text, 'secondary'); el.type = 'button'; el.id = id;
      el.disabled = disabled; el.onclick = action; return el;
    };
    this.root.replaceChildren(node('h3', '生産キュー'));
    const status = node('p', this.notice, 'hint'); status.id = 'production-queue-notice'; status.setAttribute('role', 'status');
    this.root.append(status);
    if (!city) { this.root.append(node('p', '生産・購入できる都市がありません。', 'hint')); return; }
    const editing = this.draft !== null, plan = editing ? this.draft : productionPlan(city);
    const list = node('ol', undefined, 'production-plan'); list.id = 'production-queue-list';
    for (const entry of productionForecast(city, plan)) {
      const item = RULESET.items[entry.itemId], row = node('li', undefined, 'production-plan-row');
      row.dataset.queueItem = entry.itemId; row.dataset.queueIndex = String(entry.index);
      row.append(node('strong', `${entry.index === 0 ? '生産対象' : `予約 ${entry.index}`} · ${item.name}`),
        node('span', `${entry.progress} / ${entry.cost} · ${entry.turns === null ? '生産量0のため完了見込みなし' : `全体ターン開始 ${entry.turns}回後が目安`}`, 'hint'));
      if (editing) {
        const controls = node('div', undefined, 'production-queue-actions');
        for (const [name, text, offset] of [['up', '前へ', -1], ['down', '後へ', 1], ['remove', '削除', 0]]) {
          const control = button('', text, () => this.change(items => {
            const i = entry.index;
            if (!offset) items.splice(i, 1);
            else if (i + offset >= 0 && i + offset < items.length) [items[i], items[i + offset]] = [items[i + offset], items[i]];
          }), !this.canEdit() || (offset !== 0 && (entry.index + offset < 0 || entry.index + offset >= plan.length)));
          control.removeAttribute('id'); control.dataset.queueAction = name; control.dataset.queueFocus = `${entry.index}-${name}`;
          control.setAttribute('aria-label', `${entry.index + 1}件目の${item.name}を${text}`); controls.append(control);
        }
        row.append(controls);
      }
      list.append(row);
    }
    this.root.append(list);
    if (!plan.length) this.root.append(node('p', editing ? '確定すると生産を停止します。途中の進捗は保持します。' : '生産対象・予約はありません。', 'hint'));
    const paused = Object.entries(city.production.progressByItem).filter(([id, progress]) => progress > 0 && !plan.includes(id));
    if (paused.length) this.root.append(node('p', `保持中の進捗: ${paused.map(([id, progress]) => `${RULESET.items[id].name} ${progress}/${RULESET.items[id].productionCost}`).join(' · ')}`, 'hint'));
    this.root.append(node('p', '完了時期は現在の生産量が続く場合の目安です。同種Unitの途中進捗は最初の1件だけに使います。', 'hint'));
    if (editing) {
      const label = node('label', '末尾に追加する対象'); label.htmlFor = 'production-queue-item';
      const select = node('select'); select.id = 'production-queue-item';
      for (const item of Object.values(RULESET.items)) {
        if (item.requiredTechnology && !hasResearch(state)) continue;
        if (item.itemId === 'walls' && !hasCityDefense(state)) continue;
        const locked = itemResearchError(state, playerId, item.itemId);
        const option = node('option', `${item.name} · 生産 ${item.productionCost}${locked ? ` · ${locked}` : ''}`); option.value = item.itemId;
        option.disabled = !!productionPlanError(state, city, [...plan, item.itemId]); select.append(option);
      }
      const choices = [...select.options].filter(option => !option.disabled);
      select.value = choices.some(option => option.value === this.selectedItemId) ? this.selectedItemId : choices[0]?.value ?? '';
      this.selectedItemId = select.value; select.onchange = () => { this.selectedItemId = select.value; };
      select.disabled = !this.canEdit() || !choices.length;
      this.root.append(label, select, button('production-queue-add', '末尾に追加', () => this.change(items => {
        if (!productionPlanError(state, city, [...items, select.value])) items.push(select.value);
      }), select.disabled));
      this.root.append(node('p', '編集中の内容は未確定です。セーブには現在確定済みのキューだけを保存します。', 'hint'));
      const error = productionPlanError(state, city, plan);
      if (error) this.root.append(node('p', error, 'hint'));
      const controls = node('div', undefined, 'production-queue-actions');
      controls.append(button('production-queue-apply', plan.length ? 'この内容で確定' : '生産を停止して確定', () => {
        if (!this.canEdit() || this.draft === null || productionPlanError(this.state, this.city, this.draft)) return;
        const items = [...this.draft], before = this.state; this.draft = null; this.notice = '';
        const result = this.onApply(this.city.id, items);
        if (!result?.ok && this.state === before) { this.draft = items; this.notice = result?.reason ?? '生産キューを確定できませんでした。'; }
        this.redraw();
      }, !this.canEdit() || !!error),
      button('production-queue-cancel', '編集を取り消す', () => { this.draft = null; this.notice = '編集を取り消しました。確定済みのキューは変更していません。'; this.redraw(); }),
      button('production-queue-clear', '全件を削除', () => this.change(items => items.splice(0)), !this.canEdit() || !plan.length));
      this.root.append(controls);
    } else {
      this.root.append(button('production-queue-edit', '生産キューを編集', () => {
        if (!this.canEdit()) return;
        this.draft = productionPlan(this.city); this.notice = ''; this.redraw();
      }, !this.canEdit()));
    }
    if (focus) {
      const target = [...this.root.querySelectorAll('button, select')].find(el => (el.dataset.queueFocus ?? el.id) === focus);
      (target && !target.disabled ? target : this.root.querySelector('#production-queue-apply, #production-queue-edit'))?.focus({ preventScroll: true });
    }
  }
}
