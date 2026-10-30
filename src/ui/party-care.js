import { hasPartyRecovery } from '../models/party.js';
import { RULESET } from '../core/ruleset.js';
import { previewPartyRest, validateRemoveCasualties } from '../systems/party-care.js';
import { partyName, unitName } from './inspection.js';

const node = (tag, text) => { const element = document.createElement(tag); if (text !== undefined) element.textContent = text; return element; };
const recoveryText = (state, values) => values.map(value => `${unitName(state.units[value.unitId])} ${value.unitId}: +${value.hp} → HP ${value.remainingHp}`).join(' / ');
export class PartyCarePanel {
  constructor(root, callbacks) { this.root = root; this.callbacks = callbacks; }
  render(state, party, playerId) {
    const root = this.root, focus = root.contains(document.activeElement) ? document.activeElement.id : null;
    root.replaceChildren(); root.hidden = !party || party.ownerId !== playerId;
    if (root.hidden) return;
    root.append(node('h3', '休養と戦闘不能者の離脱'));
    if (!hasPartyRecovery(state)) { root.append(node('p', 'この旧対局では休養・離脱は使えません。新規開始で利用できます。')); return; }
    const hint = node('p', `移動・攻撃前に一手番を使います。休養は次の全体ターン開始時にHP +${RULESET.partyRecovery.fieldHp}（自国都市の中心は+${RULESET.partyRecovery.cityHp}）。自国領か未所有地で、敵軍・防御の残る敵都市が隣接していない場所で行います。被害・敵接近で中止。HP0は回復しません。`); hint.className = 'hint'; root.append(hint);
    const preview = previewPartyRest(state, playerId, party.id), removal = validateRemoveCasualties(state, playerId, party.id);
    const status = node('p', party.restOrder ? `休養中: 全体ターン ${party.restOrder.turn + 1} の開始を待っています。途中で被害・敵接近があると回復しません。` : preview.ok ? `回復予定: ${recoveryText(state, preview.recovery)}` : preview.reason);
    status.id = 'rest-preview'; status.setAttribute('aria-live', 'polite'); root.append(status);
    const action = (id, label, check, describedBy, callback) => {
      const button = node('button', label); button.id = id; button.type = 'button'; button.disabled = !check.ok || state.kingdoms[playerId].controllerType === 'ai'; button.setAttribute('aria-describedby', describedBy); button.onclick = callback; root.append(button);
    };
    action('rest-party', '休養して行動終了', preview, 'rest-preview', () => this.callbacks.onRest(party.id));
    const casualties = node('p', removal.ok ? `${removal.unitIds.join('、')}を部隊から離脱させ、${removal.unitIds.length}枠を空けます。UnitのHP・位置・記録は保持します。補充は次の全体ターンからです。` : removal.reason); casualties.id = 'casualties-preview'; casualties.className = 'hint'; root.append(casualties);
    action('remove-casualties', '戦闘不能者を離脱させて行動終了', removal, 'casualties-preview', () => this.callbacks.onRemove(party.id));
    const log = node('ol'); log.id = 'party-care-log'; log.className = 'party-care-log';
    for (const event of state.eventLog.filter(event => event.partyId === party.id && ['PartyRestStarted', 'PartyRestCompleted', 'PartyRestCancelled', 'PartyCasualtiesRemoved'].includes(event.type)).slice(-6).reverse()) {
      const label = event.type === 'PartyRestStarted' ? '休養を開始' : event.type === 'PartyRestCompleted' ? `休養完了: ${recoveryText(state, event.recovery)}` : event.type === 'PartyRestCancelled' ? `休養中止: ${event.reason}` : `戦闘不能者の離脱: ${event.unitIds.join('、')}`;
      log.append(node('li', `ターン ${event.turn} · ${partyName(party)} · ${label}`));
    }
    if (log.childElementCount) root.append(log);
    if (focus) document.getElementById(focus)?.focus({ preventScroll: true });
  }
}
