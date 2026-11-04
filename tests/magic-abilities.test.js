import test from 'node:test';
import assert from 'node:assert/strict';
import { createAiReinforcementGameState } from '../src/core/scenarios.js';
import { restoreGameState, serializeGameState } from '../src/core/game-state.js';
import { HumanController } from '../src/core/human-controller.js';
import { RuleSystem } from '../src/core/rule-system.js';
import { SeededRng } from '../src/core/rng.js';
import { previewAbility, validateAbility } from '../src/systems/ability-system.js';
import { resolveMagicStrike } from '../src/systems/magic-combat.js';
import { chooseAbilityCommand } from '../src/core/ai-abilities.js';
import { listTurnTasks, enableTurnFlow } from '../src/core/turn-tasks.js';
import { updateDerivedCapabilities } from '../src/models/kingdom.js';

const h = new HumanController('kingdom-1'), payload = { partyId:'party-1', casterUnitId:'unit-3', abilityId:'arcane-bolt', targetUnitId:'unit-6' };
const trip = s => restoreGameState(serializeGameState(s));
const command = (s, p = payload) => h.useAbility(s, p.partyId, p.casterUnitId, p.abilityId, p.targetUnitId);
const apply = (s, c) => { const r=RuleSystem.execute(s,c); assert.equal(r.ok,true,r.reason); return r.state; };
function fixture(seed=117) {
  let s=createAiReinforcementGameState(seed); s.activeAbilityVersion=2;
  for(const u of Object.values(s.units)){delete u.charges['arcane-wave'];delete u.abilityStates['arcane-wave'];} s.kingdoms['kingdom-2'].controllerType='human';s.scenarioId='magic-test';
  s=apply(s,h.startTurn(s)); s.kingdoms['kingdom-1'].stockpiles.mana=100;
  const enemy=s.parties['party-2'];enemy.location='2,-2,0';enemy.guardOrders={};
  for(const id of enemy.unitIds) { const u=s.units[id];u.location=enemy.location;u.tauntStrength=0;u.coverPower=0;u.evasion=0; }
  s.units['unit-3'].accuracy=1; updateDerivedCapabilities(s.kingdoms['kingdom-1'],s);return s;
}

test('v2 setup and new archers receive magic; v1 saves and v1 purchases stay unchanged',()=>{
  let s=fixture();assert.equal(s.activeAbilityVersion,2);assert.equal(s.units['unit-3'].magicStrength,18);
  assert.deepEqual(s.units['unit-3'].charges,{'arcane-bolt':3});assert.deepEqual(trip(s),s);
  const old=structuredClone(s);old.activeAbilityVersion=1;
  for(const u of Object.values(old.units))if(u.typeId==='archer'){u.abilityStates={};u.charges={};u.magicStrength=0;}
  assert.deepEqual(trip(old),old);assert.equal(previewAbility(old,'kingdom-1',payload).ok,false);
  const id=`unit-${old.nextIds.unit}`,after=apply(old,h.purchaseItem(old,'city-1','archer'));
  assert.deepEqual(after.units[id].abilityStates,{});assert.equal(after.units[id].magicStrength,0);
  const newId=`unit-${s.nextIds.unit}`;s=apply(s,h.purchaseItem(s,'city-1','archer'));
  assert.deepEqual(s.units[newId].charges,{'arcane-bolt':3});assert.equal(s.units[newId].magicStrength,18);
});

test('magic preview reads no RNG; costs are paid once and actual HP stays inside every predicted range',()=>{
  for(const seed of [1,7,22,117,999]) {
    const s=fixture(seed),before=structuredClone(s), checked={...s,get rng(){throw new Error('preview read RNG');}};
    const p=previewAbility(checked,'kingdom-1',payload);assert.equal(p.ok,true);assert.deepEqual(s,before);
    const r=RuleSystem.execute(s,command(s));assert.equal(r.ok,true);const a=r.state;
    assert.equal(a.kingdoms['kingdom-1'].stockpiles.mana,94);assert.equal(a.units['unit-3'].charges['arcane-bolt'],2);
    assert.equal(a.units['unit-3'].abilityStates['arcane-bolt'].usesRemaining,0);assert.equal(a.parties['party-1'].activationState,'ended');
    assert.equal(a.parties['party-1'].attacksRemaining,0);assert.equal(a.parties['party-1'].movementRemaining,0);assert.equal(a.parties['party-1'].hasAttacked,true);
    assert.equal(a.parties['party-1'].reactionCharges,s.parties['party-1'].reactionCharges);assert.equal(r.events.some(e=>e.counter),false);
    for(const [id,range]of Object.entries(p.damage)){const lost=s.units[id].currentHp-a.units[id].currentHp;assert.ok(lost>=range.min&&lost<=range.max);}
    const rng=SeededRng.fromJSON(s.rng.combat);rng.next();rng.next();assert.deepEqual(a.rng.combat,rng.toJSON());assert.deepEqual(a.rng.territory,s.rng.territory);
    assert.deepEqual(trip(a),a);assert.deepEqual(RuleSystem.execute(trip(s),command(s)),r);
    assert.equal(RuleSystem.execute(a,command(s)).ok,false);assert.deepEqual(s,before);
  }
});

test('resistance belongs to each actual recipient; Guard allocates raw damage and armor does not reduce magic',()=>{
  const s=fixture();s.parties['party-2'].guardOrders={'unit-7':{targetUnitId:'unit-6',mode:'share'}};
  s.units['unit-6'].resistance=0;s.units['unit-6'].armor=999;s.units['unit-7'].resistance=25;s.units['unit-7'].armor=999;
  const events=[];resolveMagicStrike(s,validateAbility(s,'kingdom-1',payload),events,()=>60,()=>true);
  assert.equal(s.units['unit-6'].currentHp,70);assert.equal(s.units['unit-7'].currentHp,89);
  assert.equal(s.units['unit-7'].guardCapacityRemaining,20);
  const guard=events.find(e=>e.type==='CombatGuard');assert.equal(guard.amount,30);
  assert.equal(events.filter(e=>e.type==='CombatDamage').length,2);
});

test('Intercept spends one defender reaction and uses the interceptor resistance',()=>{
  const s=fixture();s.parties['party-2'].guardOrders={'unit-7':{targetUnitId:'unit-6',mode:'intercept'}};
  s.units['unit-6'].resistance=0;s.units['unit-7'].resistance=25;
  const p=previewAbility(s,'kingdom-1',payload);assert.deepEqual(p.intercepts,['unit-7']);assert.equal(p.damage['unit-6'].max,0);
  const events=[];resolveMagicStrike(s,validateAbility(s,'kingdom-1',payload),events,()=>60,()=>true);
  assert.equal(s.units['unit-6'].currentHp,100);assert.equal(s.units['unit-7'].currentHp,78);
  assert.equal(s.parties['party-2'].reactionCharges,0);assert.equal(s.units['unit-7'].guardCapacityRemaining,50);
});

test('Cover and Taunt use caster accuracy; a missed projectile hits cover or disappears while costs stay spent',()=>{
  const s=fixture();s.units['unit-3'].accuracy=0.8;s.units['unit-8'].evasion=0.1;s.units['unit-6'].coverPower=0.25;s.units['unit-7'].tauntStrength=0.15;
  const p={...payload,targetUnitId:'unit-8'},preview=previewAbility(s,'kingdom-1',p);
  assert.ok(Math.abs(preview.hitChance-0.3)<1e-10);assert.deepEqual(preview.covers,['unit-6']);assert.deepEqual(preview.taunts,['unit-7']);
  const events=[];resolveMagicStrike(s,validateAbility(s,'kingdom-1',p),events,()=>60,()=>false);
  assert.equal(s.units['unit-8'].currentHp,100);assert.ok(s.units['unit-6'].currentHp<100);assert.ok(events.some(e=>e.type==='CombatCover'));
  const miss=fixture();miss.units['unit-3'].accuracy=0;const a=apply(miss,command(miss));
  assert.equal(a.units['unit-6'].currentHp,100);assert.equal(a.kingdoms['kingdom-1'].stockpiles.mana,94);assert.equal(a.units['unit-3'].charges['arcane-bolt'],2);
  assert.equal(a.eventLog.at(-1).damage,0);assert.equal(a.eventLog.at(-1).hit,false);assert.deepEqual(trip(a),a);
});

test('preview contains forced hit and miss outcomes for every legal raw damage with capped Guard',()=>{
  const s=fixture();s.units['unit-3'].accuracy=0.6;s.units['unit-6'].coverPower=0.25;s.units['unit-7'].guardCapacityRemaining=3;
  s.parties['party-2'].guardOrders={'unit-7':{targetUnitId:'unit-6',mode:'share'}};
  const p={...payload,targetUnitId:'unit-8'},preview=previewAbility(s,'kingdom-1',p);
  for(let raw=preview.rawDamage.min;raw<=preview.rawDamage.max;raw++)for(const hit of [true,false]){
    const c=structuredClone(s),events=[];resolveMagicStrike(c,validateAbility(c,'kingdom-1',p),events,()=>raw,()=>hit);
    for(const[id,range]of Object.entries(preview.damage)){const lost=s.units[id].currentHp-c.units[id].currentHp;assert.ok(lost>=range.min&&lost<=range.max);}
  }
});

const cases=[
 ['out of range',s=>{s.parties['party-2'].location='5,-5,0';}],
 ['same hex',s=>{s.parties['party-2'].location=s.parties['party-1'].location;}],
 ['no magic power',s=>{s.units['unit-3'].magicStrength=0;}],
 ['no mana',s=>{s.kingdoms['kingdom-1'].stockpiles.mana=5;}],
 ['no charge',s=>{s.units['unit-3'].charges['arcane-bolt']=0;}],
 ['no round use',s=>{s.units['unit-3'].abilityStates['arcane-bolt'].usesRemaining=0;}],
 ['no movement',s=>{s.parties['party-1'].movementRemaining=0;}],
 ['stunned caster',s=>{s.units['unit-3'].statusEffects=['stun'];}],
 ['dead target',s=>{s.units['unit-6'].hp=s.units['unit-6'].currentHp=0;s.units['unit-6'].status='shattered';}],
 ['waiting target',s=>{s.units['unit-6'].partyId=null;}],
 ['defeated enemy',s=>{s.parties['party-2'].status='defeated';}],
 ['old ability rules',s=>{s.activeAbilityVersion=1;}],
];
for(const[name,mutate]of cases)test(`invalid magic is atomic: ${name}`,()=>{
  const s=fixture();mutate(s);const before=structuredClone(s);assert.equal(previewAbility(s,'kingdom-1',payload).ok,false);
  const r=RuleSystem.execute(s,command(s));assert.equal(r.ok,false);assert.strictEqual(r.state,s);assert.deepEqual(r.events,[]);assert.deepEqual(s,before);
});

test('friendly/enemy-caster/caller-defined-power requests cannot bypass the spell definition',()=>{
 const s=fixture();for(const patch of [{targetUnitId:'unit-1'},{casterUnitId:'unit-8'},{casterUnitId:'unit-1'},{abilityId:'constructor'},{amount:9000},{damageType:'magic'},{range:99},{manaCost:0}]){
  const c=command(s);Object.assign(c.payload,patch);const r=RuleSystem.execute(s,c);assert.equal(r.ok,false);assert.strictEqual(r.state,s);
 }
});

test('magic damage interrupts rest, inherits leadership, defeats the last enemy and resolves victory',()=>{
 let s=fixture();s.units['unit-6'].hp=s.units['unit-6'].currentHp=1;
 s.parties['party-2'].restOrder={turn:s.currentTurn,location:s.parties['party-2'].location};
 let r=RuleSystem.execute(s,command(s));assert.equal(r.ok,true);assert.ok(r.events.some(e=>e.type==='PartyLeaderChanged'));assert.equal(r.state.parties['party-2'].restOrder,undefined);
 s=fixture();for(const id of s.parties['party-2'].unitIds.filter(id=>id!=='unit-6')){s.units[id].hp=s.units[id].currentHp=0;s.units[id].status='shattered';}
 s.units['unit-6'].hp=s.units['unit-6'].currentHp=1;r=RuleSystem.execute(s,command(s));assert.equal(r.ok,true);assert.equal(r.state.parties['party-2'].status,'defeated');
 assert.equal(r.state.gameResult.winnerId,'kingdom-1');assert.equal(r.state.phase,'GAME_OVER');assert.deepEqual(trip(r.state),r.state);
});

test('only round usage refreshes; load and round transitions preserve finite magic charges',()=>{
 let s=apply(fixture(),command(fixture()));assert.equal(s.units['unit-3'].charges['arcane-bolt'],2);
 s=apply(s,h.endTurn(s));assert.equal(s.units['unit-3'].abilityStates['arcane-bolt'].usesRemaining,0);
 s=apply(s,new HumanController('kingdom-2').endTurn(s));assert.equal(s.units['unit-3'].abilityStates['arcane-bolt'].usesRemaining,1);assert.equal(s.units['unit-3'].charges['arcane-bolt'],2);assert.deepEqual(trip(s),s);
});

test('task list offers legal magic and AI selects it deterministically without reading RNG',()=>{
 const s=fixture();enableTurnFlow(s);assert.ok(listTurnTasks(s).find(t=>t.id==='party:party-1').actions.includes('魔弾'));
 const before=structuredClone(s),c=chooseAbilityCommand({...s,get rng(){throw new Error('AI read RNG');}},'kingdom-1','magic-ai');
 assert.equal(c.payload.abilityId,'arcane-bolt');assert.deepEqual(s,before);assert.deepEqual(chooseAbilityCommand(trip(s),'kingdom-1','magic-ai'),c);
 const r=RuleSystem.execute(s,c);assert.equal(r.ok,true);assert.ok(!listTurnTasks(r.state).some(t=>t.id==='party:party-1'));
});

test('magic saves reject unsupported versions, partial state and inconsistent spell history without teaching old units',()=>{
 const s=fixture(),used=apply(s,command(s));
 for(const mutate of [x=>{x.activeAbilityVersion=1;},x=>{delete x.units['unit-3'].charges['arcane-bolt'];},x=>{x.units['unit-3'].charges['arcane-bolt']=4;},x=>{x.units['unit-3'].abilityStates['arcane-bolt'].usesRemaining=2;},x=>{x.units['unit-3'].resistance=-1;},x=>{x.units['unit-3'].magicStrength=-1;}]){const x=structuredClone(s);mutate(x);assert.throws(()=>trip(x),/セーブデータ/);}
 for(const patch of [{hit:1},{damage:-1},{damage:999},{rawDamage:0},{rawDamage:91},{recoveredHp:1},{remainingHp:-1}]){const x=structuredClone(used);Object.assign(x.eventLog.find(e=>e.type==='AbilityUsed'),patch);assert.throws(()=>trip(x),/AbilityUsed/);}
 const noLearning=structuredClone(s);noLearning.units['unit-3'].abilityStates={};noLearning.units['unit-3'].charges={};assert.deepEqual(trip(noLearning),noLearning);
});
