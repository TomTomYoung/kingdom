import { hasCityDefense, hasCityBombardment, cityDefenseLabel } from '../models/city-defense.js';
import { RULESET } from '../core/ruleset.js';
import { hasActiveUnits } from '../models/party.js';
import { cityBombardmentError, previewCityBombardment } from '../systems/city-bombardment.js';
import { partyName, unitName } from './inspection.js';

export class CityBombardmentPanel {
  constructor(root, { onTarget, onFire }) {
    this.root = root;
    root.innerHTML = '<h2>都市砲撃</h2><p id="bombard-city" class="hint"></p><label for="bombard-target">砲撃する敵部隊</label><select id="bombard-target"></select><p id="bombard-status" class="hint" role="status"></p><div id="bombard-preview" class="hint" aria-live="polite"></div><button id="bombard-party">選択都市から砲撃</button><p id="bombard-rules" class="hint"></p><details open><summary>都市砲撃ログ（直近8件）</summary><div id="bombard-log" class="hint"></div></details>';
    this.get = selector => root.querySelector(selector);
    this.get('#bombard-target').onchange = event => onTarget(event.target.value || null);
    this.get('#bombard-party').onclick = () => {
      const [state, playerId, cityId, , enabled] = this.last;
      const targetId = this.get('#bombard-target').value;
      if (enabled && previewCityBombardment(state, playerId, cityId, targetId).ok) onFire(cityId, targetId);
    };
  }
  render(state, playerId, cityId, targetId, enabled) {
    this.last = [state, playerId, cityId, targetId, enabled];
    this.root.hidden = !hasCityDefense(state); if (this.root.hidden) return;
    const city = state.cities[cityId], available = hasCityBombardment(state);
    this.get('#bombard-city').textContent = city ? `${city.name} · ${cityDefenseLabel(state, city)}` : '所有都市がありません。';
    const selector = this.get('#bombard-target'); selector.replaceChildren();
    const add = (value, text) => { const option = document.createElement('option'); option.value = value; option.textContent = text; selector.append(option); };
    add('', '敵部隊を選択してください');
    for (const party of Object.values(state.parties).filter(p => p.ownerId !== playerId && p.status === 'active' && hasActiveUnits(state, p))) {
      add(party.id, `${state.kingdoms[party.ownerId].name} · ${partyName(party)} · (${party.location})`);
    }
    // Selection is shared with the map and ordinary combat, never stored in GameState.
    selector.value = [...selector.options].some(o => o.value === targetId) ? targetId : '';
    selector.disabled = !available || !city;
    const error = cityBombardmentError(state, playerId, cityId);
    const preview = previewCityBombardment(state, playerId, cityId, selector.value);
    this.get('#bombard-party').disabled = !enabled || !preview.ok;
    this.get('#bombard-status').textContent = error ?? (preview.ok ? `射程内（距離 ${preview.distance}） · 砲撃回数1を使います。敵からの反撃はありません。` : preview.reason);
    this.get('#bombard-rules').textContent = available
      ? `射程${RULESET.cityBombardment.range}、各都市は全体ターンに${RULESET.cityBombardment.attacksPerRound}回。都市耐久と城壁HPが必要です。駐屯部隊の行動や自動反撃回数は消費しません。被害予測は乱数を参照しません。`
      : 'この旧保存には能動的な都市砲撃を追加しません。使用する場合は都市争奪戦を新規開始してください。';
    const forecast = this.get('#bombard-preview'); forecast.replaceChildren();
    const line = text => { const p = document.createElement('p'); p.textContent = text; return p; };
    if (preview.ok) {
      forecast.append(line(`主対象: ${unitName(state.units[preview.primaryTargetId])} ${preview.primaryTargetId}`));
      for (const [id, loss] of Object.entries(preview.damage)) if (loss.max > 0) {
        forecast.append(line(`${id}: HP −${loss.min === loss.max ? loss.min : `${loss.min}〜${loss.max}`}${preview.guards.includes(id) ? '（肩代わり）' : preview.intercepts.includes(id) ? '（割り込み）' : ''}`));
      }
      if (preview.defeat !== 'none') forecast.append(line(preview.defeat === 'certain' ? '敵部隊は敗北する見込みです。' : '敵部隊が敗北する可能性があります。'));
    }
    const log = this.get('#bombard-log'); log.replaceChildren();
    for (const e of state.eventLog.filter(e => e.type === 'CityBombarded').slice(-8).reverse()) {
      log.append(line(`T${e.turn} ${state.cities[e.cityId]?.name ?? e.cityId} → ${e.partyId}: ${e.losses.map(l => `${l.unitId} HP −${l.damage} → ${l.remainingHp}`).join(' / ')}${e.guards.length ? '（肩代わり）' : e.intercepts.length ? '（割り込み）' : ''}${e.defeated ? ' · 部隊敗北' : ''}`));
    }
    if (!log.childNodes.length) log.textContent = 'まだ都市砲撃の記録はありません。';
  }
}
