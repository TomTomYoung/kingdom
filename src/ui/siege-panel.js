import { hasCityDefense, cityDefenseLabel } from '../models/city-defense.js';
import { previewCityAttack } from '../systems/city-siege.js';

export class SiegePanel {
  constructor(root, { onTarget, onAttack }) {
    this.root = root; this.attackType = 'ranged';
    root.innerHTML = '<label for="siege-city">攻城する都市</label><select id="siege-city"></select><p id="siege-defense"></p><label for="siege-type">攻城方法</label><select id="siege-type"><option value="ranged">遠隔攻城</option><option value="melee">近接攻城</option></select><p id="siege-preview" class="hint" role="status"></p><button id="attack-city">都市を攻撃</button><p class="hint">攻城すると部隊の行動と割り込みは終了します。都市からの反撃はありません。防御が0になった後、次の手番以降に中心へ進入して占領します。</p><details open><summary>攻城ログ（直近8件）</summary><div id="siege-log" class="hint"></div></details>';
    this.get = selector => root.querySelector(selector);
    this.get('#siege-city').onchange = event => onTarget(event.target.value);
    this.get('#siege-type').onchange = event => { this.attackType = event.target.value; this.render(...this.last); };
    this.get('#attack-city').onclick = () => onAttack(this.get('#siege-city').value, this.attackType);
  }
  render(state, playerId, partyId, cityId, canAct) {
    this.last = [state, playerId, partyId, cityId, canAct];
    this.root.hidden = !hasCityDefense(state); if (this.root.hidden) return;
    const selector = this.get('#siege-city'); selector.replaceChildren();
    for (const city of Object.values(state.cities)) { const option = document.createElement('option'); option.value = city.id; option.textContent = `${city.name} · ${state.kingdoms[city.ownerId].name}`; selector.append(option); }
    selector.value = cityId ?? Object.values(state.cities).find(city => city.ownerId !== playerId)?.id ?? '';
    const city = state.cities[selector.value]; this.get('#siege-defense').textContent = cityDefenseLabel(state, city);
    const preview = previewCityAttack(state, playerId, partyId, city?.id, this.attackType);
    this.get('#attack-city').disabled = !canAct || !preview.ok;
    const range = values => values.min === values.max ? values.min : `${values.min}〜${values.max}`;
    this.get('#siege-preview').textContent = preview.ok ? `予測: 城壁 −${range(preview.wallDamage)} / 都市耐久 −${range(preview.cityDamage)}。参加 ${preview.participantIds.length}体${preview.multiplier > 1 ? ' · 弩砲の対城壁補正あり' : ''}` : preview.reason;
    const log = this.get('#siege-log'); log.replaceChildren();
    for (const event of state.eventLog.filter(event => ['CityDamaged', 'CityBreached', 'CityDefenseRecovered', 'CityCaptured'].includes(event.type)).slice(-8).reverse()) {
      const line = document.createElement('p'), name = state.cities[event.cityId]?.name ?? event.cityId;
      const text = event.type === 'CityDamaged' ? `攻城: 城壁 −${event.wallDamage} / 耐久 −${event.cityDamage}（残り ${event.remainingHp} / 城壁 ${event.remainingWallHp}）` : event.type === 'CityBreached' ? '防御崩壊: 進入・占領が可能です' : event.type === 'CityCaptured' ? '占領: 耐久25・城壁0で引き継ぎました' : `修復: 耐久 +${event.hp} / 城壁 +${event.wallHp}`;
      line.textContent = `T${event.turn} ${name} · ${text}`; log.append(line);
    }
    if (!log.childNodes.length) log.textContent = 'まだ攻城の記録はありません。';
  }
}
