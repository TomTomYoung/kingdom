import { Hex } from '../world/hex.js';
import { RULESET } from '../core/ruleset.js';
import { previewMagicStrike, resolveMagicStrike } from './magic-combat.js';
import { ABILITIES, abilityDefinition, abilityAvailable, hasActiveAbilities } from '../core/abilities.js';
import { isActiveUnit } from '../models/party.js';
import { isProtectionDisabled } from './damage-grid.js';
import { updateDerivedCapabilities } from '../models/kingdom.js';

const own = (records, id) => typeof id === 'string' && Object.hasOwn(records, id) ? records[id] : null;
const fail = reason => ({ ok: false, reason });
const costs = d => ({ movement: d.movementCost, attacks: d.attackCost, mana: d.manaCost, gold: d.goldCost, charges: d.chargeCost });
export function abilityTargets(state, party, definition) {
  if (!party || !definition) return [];
  return definition.targetRule === 'own-party-active-unit' ? party.unitIds.map(id => state.units[id])
    : Object.values(state.units).filter(unit => isActiveUnit(unit) && unit.ownerId !== party.ownerId
      && state.parties[unit.partyId]?.status === 'active' && state.parties[unit.partyId].unitIds.includes(unit.id));
}


export function validateAbility(state, playerId, payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return fail('能力の対象と発動者を指定してください');
  const { partyId, casterUnitId, abilityId, targetUnitId } = payload;
  if (!hasActiveAbilities(state)) return fail('能力は新規の「AIとの増援戦」「AIとの都市争奪戦」で使えます');
  if (state.gameResult || state.phase !== 'PLAYER_ACTION') return fail('能力を使える行動フェーズではありません');
  if (state.activePlayerId !== playerId) return fail('現在の手番ではありません');
  const definition = abilityDefinition(abilityId);
  if (!definition) return fail('不明な能力です');
  if (!abilityAvailable(state, abilityId)) return fail('この能力は新規の増援戦・都市争奪戦で使えます。旧保存の能力は維持します');
  const party = own(state.parties, partyId), caster = own(state.units, casterUnitId), target = own(state.units, targetUnitId);
  if (!party || party.ownerId !== playerId || party.status !== 'active') return fail('自国の活動中の部隊を指定してください');
  if (party.activationState !== 'ready' || party.restOrder) return fail('この部隊は行動終了しています');
  if (!isActiveUnit(caster) || caster.ownerId !== playerId || caster.partyId !== partyId || !party.unitIds.includes(casterUnitId)) return fail('発動者はこの部隊の活動中のUnitを指定してください');
  if (!definition.unitTypes.includes(caster.typeId) || !Object.hasOwn(caster.abilityStates ?? {}, abilityId)) return fail('このUnitは能力を習得していません');
  if (isProtectionDisabled(caster)) return fail('stun・break・fear中は能力を使えません');
  let defender = null;
  if (definition.targetRule === 'own-party-active-unit') {
    if (!isActiveUnit(target) || target.ownerId !== playerId || target.partyId !== partyId || !party.unitIds.includes(targetUnitId)) return fail('対象は同じ部隊のHPが残る活動中のUnitを指定してください');
    if (target.currentHp >= target.maxHp) return fail('対象のHPは満タンです');
  } else {
    defender = own(state.parties, target?.partyId);
    if (!isActiveUnit(target) || target.ownerId === playerId || !defender || defender.ownerId === playerId || defender.status !== 'active' || !defender.unitIds.includes(targetUnitId)) return fail('対象は敵の活動中の部隊に所属する生存Unitを指定してください');
    if (!(caster.magicStrength > 0)) return fail('発動者の魔法戦闘力が必要です');
    const distance = Hex.fromKey(party.location).distance(Hex.fromKey(defender.location));
    if (distance < 1 || distance > definition.range) return fail(`魔弾の射程は1〜${definition.range}ヘクスです`);
  }
  if (!(caster.abilityStates[abilityId].usesRemaining > 0)) return fail('この全体ターンの使用回数を使い切っています');
  if (!(caster.charges?.[abilityId] >= definition.chargeCost)) return fail('有限チャージが不足しています（ターンでは回復しません）');
  if (party.movementRemaining < definition.movementCost) return fail('移動力が不足しています');
  if (party.attacksRemaining < definition.attackCost) return fail('攻撃回数が不足しています');
  const kingdom = state.kingdoms[playerId];
  if (kingdom.stockpiles.mana < definition.manaCost) return fail('manaが不足しています');
  if (kingdom.stockpiles.gold < definition.goldCost) return fail('goldが不足しています');
  return { ok: true, definition, party, caster, target, kingdom, defender };
}

// Preview and resolution share the same validation and exact capped recovery.
// Healing is exact; magic enumerates outcomes without reading either random stream.
export function previewAbility(state, playerId, payload) {
  const checked = validateAbility(state, playerId, payload);
  if (!checked.ok) return checked;
  const { definition: d, target, caster } = checked;
  const recoveredHp = d.effect === 'heal' ? Math.min(d.amount, target.maxHp - target.currentHp) : null;
  const effect = d.effect === 'heal' ? { recoveredHp, remainingHp: target.currentHp + recoveredHp } : previewMagicStrike(state, checked);
  return { ok: true, abilityId: d.id, ...effect,
    costs: costs(d),
    chargesRemaining: caster.charges[d.id] - d.chargeCost, endsActivation: d.endsActivation };
}

export function resolveAbility(state, playerId, payload, events) {
  const checked = validateAbility(state, playerId, payload);
  if (!checked.ok) return checked;
  const { definition: d, party, caster, target, kingdom } = checked;
  const result = d.effect === 'heal' ? previewAbility(state, playerId, payload) : null;
  kingdom.stockpiles.mana -= d.manaCost; kingdom.stockpiles.gold -= d.goldCost;
  party.movementRemaining -= d.movementCost; party.attacksRemaining -= d.attackCost;
  caster.charges[d.id] -= d.chargeCost; caster.abilityStates[d.id].usesRemaining -= 1;
  let effect;
  if (d.effect === 'heal') { target.currentHp = result.remainingHp; target.hp = target.currentHp; effect = { recoveredHp: result.recoveredHp }; }
  else { effect = resolveMagicStrike(state, checked, events); party.hasAttacked = true; }
  if (d.endsActivation) { party.movementRemaining = 0; party.activationState = 'ended'; }
  // Reaction/Guard, morale, status effects and the legacy Unit action fields are
  // unchanged on the caster; magic resolves the defender through combat. No charge refill.
  updateDerivedCapabilities(kingdom, state);
  events.push({ type: 'AbilityUsed', playerId, partyId: party.id, casterUnitId: caster.id, targetUnitId: target.id,
    abilityId: d.id, ...effect, remainingHp: target.currentHp,
    costs: costs(d), chargesRemaining: caster.charges[d.id] });
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
      if (!d || !abilityAvailable(state, id) || !d.unitTypes.includes(unit.typeId) || !record(saved) || Object.keys(saved).length !== 1
        || !Object.hasOwn(saved, 'usesRemaining') || !count(saved.usesRemaining, d.usesPerRound)
        || !Object.hasOwn(unit.charges, id) || !count(unit.charges[id], d.initialCharges)) invalid(`units.${unit.id}.ability.${id}`);
    }
  }
  if (!enabled && (state.commandLog.some(c => c.type === 'UseAbility') || state.eventLog.some(e => e.type === 'AbilityUsed'))) invalid('activeAbilityVersion: 能力の履歴があります');
  if (enabled) {
    const identifier = value => typeof value === 'string' && value.trim().length > 0;
    for (const command of state.commandLog.filter(c => c.type === 'UseAbility')) {
      const p = command.payload;
      if (!record(p) || !abilityAvailable(state, p.abilityId) || Object.keys(p).length !== 4
        || !['partyId', 'casterUnitId', 'abilityId', 'targetUnitId'].every(key => identifier(p[key]))) invalid('commandLog.UseAbility');
    }
    for (const event of state.eventLog.filter(e => e.type === 'AbilityUsed')) {
      const d = abilityDefinition(event.abilityId);
      if (!d || !abilityAvailable(state, event.abilityId) || !['playerId', 'partyId', 'casterUnitId', 'targetUnitId'].every(key => identifier(event[key]))
        || !count(event.turn, state.currentTurn) || event.turn === 0 || !record(event.costs)
        || !Number.isFinite(event.remainingHp) || event.remainingHp < 0
        || !count(event.chargesRemaining, d.initialCharges - d.chargeCost)) invalid('eventLog.AbilityUsed');
      if (d.effect === 'heal') {
        if (!Number.isFinite(event.recoveredHp) || event.recoveredHp <= 0 || event.recoveredHp > d.amount || event.remainingHp < event.recoveredHp) invalid('eventLog.AbilityUsed');
      } else if (typeof event.hit !== 'boolean' || !count(event.rawDamage, RULESET.combat.maximumDamage) || event.rawDamage < 1
        || !Number.isFinite(event.damage) || event.damage < 0 || event.damage > event.rawDamage + 1 || Object.hasOwn(event, 'recoveredHp')) invalid('eventLog.AbilityUsed');
      for (const [key, expected] of Object.entries({ movement: d.movementCost, attacks: d.attackCost, mana: d.manaCost, gold: d.goldCost, charges: d.chargeCost })) {
        if (event.costs[key] !== expected) invalid(`eventLog.AbilityUsed.costs.${key}`);
      }
    }
  }
}
