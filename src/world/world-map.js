import { Hex } from './hex.js';
import { SeededRng } from '../core/rng.js';
import { RULESET } from '../core/ruleset.js';

export function createWorldMap(seed, radius = RULESET.mapRadius) {
  const rng = new SeededRng(seed);
  const terrainIds = ['plains', 'grassland', 'forest', 'hills', 'arcane'];
  const tiles = {};
  for (const hex of Hex.range(new Hex(0, 0, 0), radius)) {
    const terrainId = hex.distance(new Hex(0, 0, 0)) === radius && rng.next() < 0.12 ? 'void' : terrainIds[rng.integer(terrainIds.length)];
    tiles[hex.key] = { key: hex.key, q: hex.q, r: hex.r, s: hex.s, terrainId, ownerId: null, cityId: null };
  }
  return { radius, tiles, riverEdges: [], rng: rng.toJSON() };
}
