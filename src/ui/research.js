import { RULESET } from '../core/ruleset.js';
import { hasResearch, unassignedScience, researchSelectionError, researchForecast } from '../systems/research-system.js';

export class ResearchPanel {
  constructor(root, { onSelect }) { this.root = root; this.onSelect = onSelect; this.choice = null; }
  render(state, playerId, enabled) {
    const doc = this.root.ownerDocument, focus = this.root.contains(doc.activeElement) ? doc.activeElement.id : null;
    const node = (tag, text, className) => {
      const el = doc.createElement(tag); if (text !== undefined) el.textContent = text;
      if (className) el.className = className; return el;
    };
    const button = (id, text, action, disabled) => {
      const el = node('button', text); el.type = 'button'; el.id = id; el.disabled = disabled; el.onclick = action; return el;
    };
    const detailsOpen = this.root.querySelector('#research-history')?.open ?? false;
    this.root.replaceChildren(node('h2', '王国の研究'));
    if (!hasResearch(state)) {
      this.choice = null; this.root.append(node('p', '旧セーブの規則を維持しています。研究と新施設は新規開始した対局で利用できます。', 'hint')); return;
    }
    const kingdom = state.kingdoms[playerId], r = kingdom.research;
    const canAct = enabled && !state.gameResult && state.phase === 'PLAYER_ACTION' && state.activePlayerId === playerId && kingdom.controllerType === 'human';
    const current = r.currentTechnologyId, tech = RULESET.technologies[current];
    if (this.state !== state || this.playerId !== playerId) this.choice = current;
    this.state = state; this.playerId = playerId;
    const budget = node('p', `科学累計 ${kingdom.progress.science} · 未配分 ${unassignedScience(kingdom)}`, 'research-budget'); budget.id = 'research-budget';
    const status = node('p', '', 'research-status'); status.id = 'research-status'; status.setAttribute('role', 'status');
    const forecast = researchForecast(kingdom, state);
    status.textContent = tech ? `${tech.name}: ${forecast.progress} / ${forecast.cost} · ${forecast.turns === null ? '科学産出0のため完了見込みなし' : `全体ターン開始 ${forecast.turns}回後が目安`}` : '研究対象なし。途中進捗と未配分の科学は保持しています。';
    this.root.append(budget, status, node('p', '研究は王国共通です。科学は次の全体ターン開始に配分します。完了目安は現在の産出が続く場合です。', 'hint'));
    const label = node('label', '研究対象'); label.htmlFor = 'research-target';
    const select = node('select'); select.id = 'research-target'; select.disabled = !canAct;
    for (const t of Object.values(RULESET.technologies)) {
      const error = researchSelectionError(state, playerId, t.id);
      const option = node('option', `${t.name} · 科学 ${t.scienceCost}${error ? ` · ${error}` : ''}`);
      option.value = t.id; option.disabled = !!error; select.append(option);
    }
    const valid = [...select.options].filter(option => !option.disabled);
    this.choice = valid.some(o => o.value === this.choice) ? this.choice : valid[0]?.value ?? '';
    select.value = this.choice;
    select.onchange = () => { this.choice = select.value; this.render(state, playerId, enabled); };
    const controls = node('div', undefined, 'research-actions');
    controls.append(button('research-select', '研究対象にする', () => {
      if (canAct && select.value && select.value !== current) this.onSelect(select.value);
    }, !canAct || !this.choice || this.choice === current),
    button('research-pause', '研究を一時停止', () => { if (canAct && current) this.onSelect(null); }, !canAct || !current));
    this.root.append(label, select, controls);
    const list = node('ul', undefined, 'research-list'); list.id = 'research-list';
    for (const t of Object.values(RULESET.technologies)) {
      const complete = r.completedTechnologyIds.includes(t.id), progress = r.progressByTechnology[t.id] ?? 0;
      const entry = node('li'); entry.dataset.technology = t.id;
      const text = complete ? '研究済み' : current === t.id ? `研究中 ${progress}/${t.scienceCost}` : `未完了 ${progress}/${t.scienceCost}`;
      entry.append(node('strong', `${t.name} · ${text}`));
      for (const id of t.unlocks) {
        const item = RULESET.items[id], names = { science: '科学', food: '食料', production: '生産' };
        entry.append(node('span', `${item.name}を解禁 · ${Object.entries(item.yields).map(([key, n]) => `${names[key]} +${n}`).join('、')} · 生産 ${item.productionCost} / Gold ${item.purchaseOptions.gold}`, 'hint'));
      }
      if (t.prerequisites.length) entry.append(node('span', `前提: ${t.prerequisites.map(id => RULESET.technologies[id].name).join('、')}`, 'hint'));
      list.append(entry);
    }
    this.root.append(list, node('p', '研究名・費用・施設効果は暫定設定です。既存兵種や城壁の利用条件は変更していません。施設は解禁後に別途生産・購入します。', 'hint'));
    const details = node('details'); details.id = 'research-history'; details.open = detailsOpen;
    details.append(node('summary', '研究履歴'));
    const log = node('div'); log.id = 'research-log';
    const recent = state.eventLog.filter(e => e.kingdomId === playerId && ['ResearchSelected', 'ResearchProgressed', 'TechnologyCompleted'].includes(e.type)).slice(-6);
    for (const e of recent) {
      const name = RULESET.technologies[e.technologyId]?.name ?? '';
      const message = e.type === 'TechnologyCompleted' ? `${name}が完了` : e.type === 'ResearchProgressed' ? `${name}へ科学 ${e.amount}を配分` : e.technologyId === null ? '研究を一時停止' : `${name}を選択`;
      log.append(node('p', `ターン ${e.turn}: ${message}`, 'hint'));
    }
    if (!recent.length) log.append(node('p', '研究の履歴はありません。', 'hint'));
    details.append(log); this.root.append(details);
    if (focus) { const target = doc.getElementById(focus); if (target && !target.disabled) target.focus({ preventScroll: true }); }
  }
}
