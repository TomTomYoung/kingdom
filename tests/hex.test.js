import test from 'node:test'; import assert from 'node:assert/strict';
import { Hex, edgeKey } from '../src/world/hex.js';
test('hex round, neighbors, distance and range are correct',()=>{const origin=new Hex(0,0,0);assert.deepEqual(Hex.round(.6,-.2,-.4),new Hex(1,0,-1));assert.equal(origin.neighbor(0).distance(origin),1);assert.equal(Hex.range(origin,2).length,19)});
test('edge keys are shared by both endpoint orders',()=>{const a=new Hex(0,0,0),b=a.neighbor(2);assert.equal(edgeKey(a,b),edgeKey(b,a))});
