import { Hex } from '../world/hex.js';
import { hasActiveUnits } from '../models/party.js';

const TERRAIN_MOVE_COST = Object.freeze({ plains: 1, grassland: 1, forest: 2, hills: 2, arcane: 1 });

export function validatePartyPath(state, party, path) {
  if (party.status !== 'active' || party.activationState === 'ended' || !hasActiveUnits(state, party)) return { ok: false, reason: '移動可能なPartyではありません' };
  if (!Array.isArray(path) || path.length === 0) return { ok: false, reason: '移動経路が必要です' };
  let previous = Hex.fromKey(party.location); let cost = 0;
  for (const key of path) {
    const next = typeof key === 'string' && Object.hasOwn(state.world.tiles, key) && state.world.tiles[key];
    if (!next || next.terrainId === 'void') return { ok: false, reason: '進入できないタイルです' };
    if (previous.distance(Hex.fromKey(key)) !== 1) return { ok: false, reason: '移動経路が連続していません' };
    if (Object.values(state.parties).some((other) => other.id !== party.id && other.location === key)) return { ok: false, reason: '他のPartyが占有しています' };
    cost += TERRAIN_MOVE_COST[next.terrainId] ?? 1;
    previous = Hex.fromKey(key);
  }
  if (cost > party.movementRemaining) return { ok: false, reason: '移動力が不足しています' };
  return { ok: true, cost, destination: path.at(-1) };
}
