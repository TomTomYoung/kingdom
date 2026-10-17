import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialGameState, restoreGameState, serializeGameState } from '../src/core/game-state.js';
import { RuleSystem } from '../src/core/rule-system.js';
import { HumanController } from '../src/core/human-controller.js';
import { getReachablePartyPaths, validatePartyPath } from '../src/systems/movement-system.js';
import { MapCamera, hexPosition } from '../src/ui/map-camera.js';
import { Hex } from '../src/world/hex.js';

test('new playable setup has 331 cells and one controllable party; old saves retain their map and units', () => {
  const state = createInitialGameState(117, { startingParty: true });
  assert.equal(state.world.radius, 10); assert.equal(Object.keys(state.world.tiles).length, 331);
  assert.equal(state.parties['party-1'].location, state.cities['city-1'].centerHex);
  assert.deepEqual(state.parties['party-1'].unitIds, ['unit-1']); assert.equal(state.units['unit-1'].partyId, 'party-1');
  const controller = new HumanController('kingdom-1');
  const result = RuleSystem.execute(state, controller.purchaseItem(state, 'city-1', 'warrior'));
  assert.equal(result.ok, true); assert.equal(result.state.units['unit-2'].partyId, null);
  assert.equal(result.state.units['unit-1'].partyId, 'party-1');
  const old = createInitialGameState(117, { radius: 3 });
  const restored = restoreGameState(serializeGameState(old));
  assert.deepEqual(restored, old); assert.equal(Object.keys(restored.world.tiles).length, 37); assert.deepEqual(restored.units, {});
});

test('reachable routes choose the cheaper detour and execute with exactly the displayed terrain cost', () => {
  const state = createInitialGameState(117, { startingParty: true }), party = state.parties['party-1'];
  for (const tile of Object.values(state.world.tiles)) tile.terrainId = 'plains';
  state.world.tiles['1,0,-1'].terrainId = 'forest';
  const snapshot = serializeGameState(state), routes = getReachablePartyPaths(state, party), route = routes.get('1,1,-2');
  assert.equal(route.cost, 2); assert.deepEqual(route.path, ['0,1,-1', '1,1,-2']);
  assert.equal(routes.has('3,0,-3'), false); assert.equal(routes.has(party.location), false);
  for (const [key, entry] of routes) { const result = validatePartyPath(state, party, entry.path); assert.equal(result.ok, true); assert.equal(result.cost, entry.cost); assert.equal(result.destination, key); }
  assert.equal(serializeGameState(state), snapshot);
  const controller = new HumanController('kingdom-1');
  const moved = RuleSystem.execute(state, controller.moveParty(state, party.id, route.path));
  assert.equal(moved.ok, true); assert.equal(moved.state.parties[party.id].movementRemaining, 0); assert.equal(moved.state.units['unit-1'].location, '1,1,-2');
});

test('route previews exclude void, occupied cells, exhausted and defeated parties', () => {
  const state = createInitialGameState(117, { startingParty: true }), party = state.parties['party-1'];
  state.world.tiles['1,-1,0'].terrainId = 'void';
  state.parties.blocker = { ...structuredClone(party), id: 'blocker', location: '0,1,-1' };
  const paths = getReachablePartyPaths(state, party);
  for (const entry of paths.values()) { assert.equal(entry.path.includes('1,-1,0'), false); assert.equal(entry.path.includes('0,1,-1'), false); }
  party.movementRemaining = 0; assert.equal(getReachablePartyPaths(state, party).size, 0);
  party.movementRemaining = 2; party.status = 'defeated'; assert.equal(getReachablePartyPaths(state, party).size, 0);
  party.status = 'active'; party.activationState = 'ended'; assert.equal(getReachablePartyPaths(state, party).size, 0);
});

test('hex picking stays exact after panning and each integral zoom at desktop and narrow viewport sizes', () => {
  const camera = new MapCamera();
  for (const [width, height] of [[1100, 640], [330, 460]]) {
    for (const zoom of [1, 2, 3]) {
      camera.zoom = zoom; camera.x = 137; camera.y = -88;
      for (const hex of Hex.range(new Hex(0, 0, 0), 10)) {
        const p = camera.project(hex, width, height); assert.equal(camera.hexAt(p.x, p.y, width, height).key, hex.key);
      }
    }
  }
  camera.centerOn(new Hex(3, -2, -1)); assert.deepEqual({ x: camera.x, y: camera.y }, hexPosition(new Hex(3, -2, -1)));
});

test('zoom preserves the anchor world point and camera clamp keeps small saved maps reachable', () => {
  const camera = new MapCamera(), anchor = { x: 190, y: 200 }, width = 900, height = 600;
  const before = camera.worldAt(anchor.x, anchor.y, width, height);
  camera.setZoom(2, width, height, anchor); assert.deepEqual(camera.worldAt(anchor.x, anchor.y, width, height), before);
  camera.setZoom(100, width, height); assert.equal(camera.zoom, 3);
  camera.setZoom(-100, width, height); assert.equal(camera.zoom, 1);
  camera.x = 1e6; camera.y = -1e6; camera.clamp(3, 1200, 800);
  assert.equal(camera.x, 0); assert.equal(camera.y, 0);
});
