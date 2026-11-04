import { ABILITIES, abilityDefinition, hasActiveAbilities } from '../core/abilities.js';
import { isActiveUnit } from '../models/party.js';
import { isProtectionDisabled } from './damage-grid.js';
import { updateDerivedCapabilities } from '../models/kingdom.js';

const own = (records, id) => typeof id === 'string' && Object.hasOwn(records, id) ? records[id] : null;
const fail = reason => ({ ok: false, reason });

export function validateAbility(state, playerId, payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return fail('能力の対象と発動者を指定してください');
  const { partyId, casterUnitId, abilityId, targetUnitId } = payload;
  if (!hasActiveAbilities(state)) return fail('能力は新規の「AIとの増援戦」「AIとの都市争奪戦」で使えます');
  if (state.gameResult || state.phase !== 'PLAYER_ACTION') return fail('能力を使える行動フェーズではありません');
  if (state.activePlayerId !== playerId) return fail('現在の手番ではありません');
  const definition = abilityDefinition(abilityId);
  if (!definition) return fail('不明な能力です');
  const party = own(state.parties, partyId), caster = own(state.units, casterUnitId), target = own(state.units, targetUnitId);
  if (!party || party.ownerId !== playerId || party.status !== 'active') return fail('自国の活動中の部隊を指定してください');
  if (party.activationState !== 'ready' || party.restOrder) return fail('この部隊は行動終了しています');
  if (!isActiveUnit(caster) || caster.ownerId !== playerId || caster.partyId !== partyId || !party.unitIds.includes(casterUnitId)) return fail('発動者はこの部隊の活動中のUnitを指定してください');
  if (!definition.unitTypes.includes(caster.typeId) || !Object.hasOwn(caster.abilityStates ?? {}, abilityId)) return fail('このUnitは能力を習得していません');
  if (isProtectionDisabled(caster)) return fail('stun・break・fear中は能力を使えません');
  if (definition.targetRule !== 'own-party-active-unit' || !isActiveUnit(target) || target.ownerId !== playerId || target.partyId !== partyId || !party.unitIds.includes(targetUnitId)) return fail('対象は同じ部隊のHPが残る活動中のUnitを指定してください');
  if (target.currentHp >= target.maxHp) return fail('対象のHPは満タンです');
  if (!(caster.abilityStates[abilityId].usesRemaining > 0)) return fail('この全体ターンの使用回数を使い切っています');
  if (!(caster.charges?.[abilityId] >= definition.chargeCost)) return fail('有限チャージが不足しています（ターンでは回復しません）');
  if (party.movementRemaining < definition.movementCost) return fail('移動力が不足しています');
  if (party.attacksRemaining < definition.attackCost) return fail('攻撃回数が不足しています');
  const kingdom = state.kingdoms[playerId];
  if (kingdom.stockpiles.mana < definition.manaCost) return fail('manaが不足しています');
  if (kingdom.stockpiles.gold < definition.goldCost) return fail('goldが不足しています');
  return { ok: true, definition, party, caster, target, kingdom };
}

// Preview and resolution share the same validation and exact capped recovery.
// This ability never reads either random stream.
export function previewAbility(state, playerId, payload) {
  const checked = validateAbility(state, playerId, payload);
  if (!checked.ok) return checked;
  const { definition: d, target, caster } = checked;
  const recoveredHp = Math.min(d.amount, target.maxHp - target.currentHp);
  return { ok: true, abilityId: d.id, recoveredHp, remainingHp: target.currentHp + recoveredHp,
    costs: { movement: d.movementCost, attacks: d.attackCost, mana: d.manaCost, gold: d.goldCost, charges: d.chargeCost },
    chargesRemaining: caster.charges[d.id] - d.chargeCost, endsActivation: d.endsActivation };
}

export function resolveAbility(state, playerId, payload, events) {
  const checked = validateAbility(state, playerId, payload);
  if (!checked.ok) return checked;
  const { definition: d, party, caster, target, kingdom } = checked;
  const preview = previewAbility(state, playerId, payload);
  kingdom.stockpiles.mana -= d.manaCost; kingdom.stockpiles.gold -= d.goldCost;
  party.movementRemaining -= d.movementCost; party.attacksRemaining -= d.attackCost;
  caster.charges[d.id] -= d.chargeCost; caster.abilityStates[d.id].usesRemaining -= 1;
  target.currentHp = preview.remainingHp; target.hp = target.currentHp;
  if (d.endsActivation) { party.movementRemaining = 0; party.activationState = 'ended'; }
  // Reaction/Guard, morale, status effects and the legacy Unit action fields are
  // independent of this non-attack action. No revival or automatic charge refill.
  updateDerivedCapabilities(kingdom, state);
  events.push({ type: 'AbilityUsed', playerId, partyId: party.id, casterUnitId: caster.id, targetUnitId: target.id,
    abilityId: d.id, recoveredHp: preview.recoveredHp, remainingHp: target.currentHp,
    costs: preview.costs, chargesRemaining: preview.chargesRemaining });
  return { ok: true };
}

export function validateAbilitySave(state) {
  const invalid = path => { throw new Error(`セーブデータが不正です: ${path}`); };
  const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const count = (value, max) => Number.isSafeInteger(value) && value >= 0 && value <= max;
  const enabled = Object.hasOwn(state, 'activeAbilityVersion');
  if (enabled && !hasActiveAbilities(state)) invalid('activeAbilityVersion');
  for (const unit of Object.values(state.units)) {
    if (!enabled) {
      // Historical unused fields are preserved, but a new ability without its
      // feature version is a partial current save, not a legacy migration.
      if (Object.keys(ABILITIES).some(id => Object.hasOwn(unit.abilityStates ?? {}, id) || Object.hasOwn(unit.charges ?? {}, id))) invalid(`units.${unit.id}.ability: 版がありません`);
      continue;
    }
    if (!record(unit.abilityStates) || !record(unit.charges)) invalid(`units.${unit.id}.abilityStates/charges`);
    const ids = new Set([...Object.keys(unit.abilityStates), ...Object.keys(unit.charges)]);
    for (const id of ids) {
      const d = abilityDefinition(id), saved = unit.abilityStates[id];
      if (!d || !d.unitTypes.includes(unit.typeId) || !record(saved) || Object.keys(saved).length !== 1
        || !Object.hasOwn(saved, 'usesRemaining') || !count(saved.usesRemaining, d.usesPerRound)
        || !Object.hasOwn(unit.charges, id) || !count(unit.charges[id], d.initialCharges)) invalid(`units.${unit.id}.ability.${id}`);
    }
  }
  if (!enabled && (state.commandLog.some(c => c.type === 'UseAbility') || state.eventLog.some(e => e.type === 'AbilityUsed'))) invalid('activeAbilityVersion: 能力の履歴があります');
  if (enabled) {
    const identifier = value => typeof value === 'string' && value.trim().length > 0;
    for (const command of state.commandLog.filter(c => c.type === 'UseAbility')) {
      const p = command.payload;
      if (!record(p) || !abilityDefinition(p.abilityId) || Object.keys(p).length !== 4
        || !['partyId', 'casterUnitId', 'abilityId', 'targetUnitId'].every(key => identifier(p[key]))) invalid('commandLog.UseAbility');
    }
    for (const event of state.eventLog.filter(e => e.type === 'AbilityUsed')) {
      const d = abilityDefinition(event.abilityId);
      if (!d || !['playerId', 'partyId', 'casterUnitId', 'targetUnitId'].every(key => identifier(event[key]))
        || !count(event.turn, state.currentTurn) || event.turn === 0 || !record(event.costs)
        || !Number.isFinite(event.recoveredHp) || event.recoveredHp <= 0 || event.recoveredHp > d.amount
        || !Number.isFinite(event.remainingHp) || event.remainingHp < event.recoveredHp
        || !count(event.chargesRemaining, d.initialCharges - d.chargeCost)) invalid('eventLog.AbilityUsed');
      for (const [key, expected] of Object.entries({ movement: d.movementCost, attacks: d.attackCost, mana: d.manaCost, gold: d.goldCost, charges: d.chargeCost })) {
        if (event.costs[key] !== expected) invalid(`eventLog.AbilityUsed.costs.${key}`);
      }
    }
  }
}
