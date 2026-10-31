import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialGameState, serializeGameState, restoreGameState, addCity } from '../src/core/game-state.js';
import { createAiConquestGameState, createAiReinforcementGameState, createAiSkirmishGameState } from '../src/core/scenarios.js';
import { HumanController } from '../src/core/human-controller.js';
import { AIController, runAiTurn } from '../src/core/ai-controller.js';
import { RuleSystem } from '../src/core/rule-system.js';
import { chooseSupplyCommand, chooseDeploymentCommand, chooseReinforcementCommand, chooseCityExitCommand } from '../src/core/ai-economy.js';
import { chooseExpeditionCommand, chooseExpansionSupplyCommand, findSettlementSite, hasExpansionAi, isExpansionParty, reservedEscortIds } from '../src/core/ai-expansion.js';
import { createUnit } from '../src/models/unit.js';
import { createParty } from '../src/models/party.js';
import { validateCitySite, validateFoundCity } from '../src/systems/founding-system.js';
import { validatePartyPath } from '../src/systems/movement-system.js';
import { Hex } from '../src/world/hex.js';
const owner = 'kingdom-2', human = new HumanController('kingdom-1'), ai = new AIController(owner);
const apply = (s, c) => { const r = RuleSystem.execute(s,c); assert.equal(r.ok,true,r.reason); return r.state; };
const trip = s => { const restored = restoreGameState(serializeGameState(s)); assert.deepEqual(restored,s); return restored; };
function recruit(s,type='warrior',location='4,-4,0',player=owner) {
 const id=`unit-${s.nextIds.unit++}`, u=createUnit(id,player,type,location); s.units[id]=u;s.kingdoms[player].unitIds.push(id);return u;
}
function relocate(s,id,key) { const p=s.parties[id];p.location=key;s.world.tiles[key].terrainId='plains';p.unitIds.forEach(id=>{s.units[id].location=key;}); }
function fixture(seed=117) {
 let s=createAiConquestGameState(seed); s=apply(s,human.startTurn(s));s=apply(s,human.endTurn(s));
 for(const t of Object.values(s.world.tiles)) t.terrainId='plains';
 relocate(s,'party-1','-7,7,0');relocate(s,'party-2','6,-6,0');
 Object.assign(s.parties['party-2'],{movementRemaining:0,attacksRemaining:0,activationState:'ended'});
 s.kingdoms[owner].stockpiles.gold=300;recruit(s);return s;
}
const supply=s=>chooseExpansionSupplyCommand(s,owner,`expansion-${s.commandLog.length}`);
const expedition=s=>chooseExpeditionCommand(s,owner,`expedition-${s.commandLog.length}`);
function group(s,location='4,-4,0') { const u=recruit(s,'settler',location),e=recruit(s,'warrior',location),id=`party-${s.nextIds.party++}`;s.parties[id]=createParty(id,owner,[e.id,u.id],location);u.partyId=e.partyId=id;return s.parties[id]; }
function arranged(s,p) { const u=p.unitIds.find(id=>s.units[id].typeId==='settler'),e=p.unitIds.find(id=>s.units[id].typeId==='warrior');p.formation={'front-center':e,'middle-center':u};p.guardOrders[e]={targetUnitId:u,mode:'share'}; }

test('new recruitment scenarios opt into expansion and legacy saves never gain the flag',()=>{
 for(const make of [createAiConquestGameState,createAiReinforcementGameState]) {const s=make();assert.equal(s.aiExpansionVersion,1);trip(s);}
 assert.equal(hasExpansionAi(createAiSkirmishGameState()),false);
 const s=fixture();delete s.aiExpansionVersion;assert.equal(supply(trip(s)),null);assert.equal(expedition(s),null);
 for(const v of [0,2,-1,null,true,'1',{},1.5]) {const bad=fixture();bad.aiExpansionVersion=v;assert.throws(()=>restoreGameState(serializeGameState(bad)),/aiExpansionVersion/);}
});
test('planner and site scoring are read-only, deterministic and never access RNG',()=>{
 const s=fixture(),before=serializeGameState(s),c=supply(s);assert.equal(c.payload.itemId,'settler');
 for(let i=0;i<4;i++)assert.deepEqual(supply(s),c);assert.equal(serializeGameState(s),before);
 Object.defineProperty(s,'rng',{get(){throw Error('future RNG');}});assert.deepEqual(supply(s),c);
});
test('wrong handoff, human/tactical controllers, ended games and phases cannot expand',()=>{
 for(const f of [s=>{s.activePlayerId='kingdom-1';},s=>{s.kingdoms[owner].controllerType='human';},s=>{s.kingdoms[owner].aiPolicy='tactical';},s=>{s.phase='GAME_OVER';},s=>{s.gameResult={};}]){const s=fixture();f(s);assert.equal(supply(s),null);assert.equal(expedition(s),null);}
});
test('settler purchase retains emergency gold, spends full price and shares the city purchase cap',()=>{
 const s=fixture(),command=supply(s),a=apply(s,command);assert.equal(command.type,'PurchaseCityItem');assert.equal(a.kingdoms[owner].stockpiles.gold,180);assert.deepEqual(a.rng,s.rng);trip(a);
 assert.equal(supply(a),null);assert.equal(supply(trip(a)),null);
 const low=fixture();low.kingdoms[owner].stockpiles.gold=191;assert.equal(supply(low).type,'SetCityProduction');
 const exact=fixture();exact.kingdoms[owner].stockpiles.gold=192;assert.equal(supply(exact).type,'PurchaseCityItem');
 const capped=apply(fixture(),new HumanController(owner).purchaseItem(fixture(),'city-2','warrior'));assert.equal(supply(capped).type,'SetCityProduction');
});
test('no escort available reserves settler plus warrior production, counting queued military capacity',()=>{
 const s=fixture();const u=Object.values(s.units).find(u=>u.ownerId===owner&&u.partyId===null);u.location='7,-7,0';
 const c=supply(s);assert.equal(c.type,'SetCityProduction');assert.deepEqual(c.payload.queue,['warrior']);
 s.cities['city-2'].production.currentItemId='warrior';assert.equal(supply(s),null);
 s.cities['city-2'].production.currentItemId=null;s.cities['city-2'].yieldSummary.production=0;assert.equal(supply(s),null);
});
test('old queues and progress survive purchase, and neither alive nor queued settlers duplicate',()=>{
 const s=fixture(),city=s.cities['city-2'];city.production={currentItemId:'archer',queue:['warrior'],progressByItem:{archer:9}};
 const after=apply(s,supply(s));assert.deepEqual(after.cities['city-2'].production,city.production);
 assert.equal(supply(after),null);city.production.queue.push('settler');assert.equal(supply(s),null);
});
test('fewer than six living soldiers and absent armies block new expeditions',()=>{
 const s=fixture(),u=Object.values(s.units).find(u=>u.ownerId===owner&&u.partyId===null);u.currentHp=u.hp=0;u.status='shattered';assert.equal(supply(s),null);
 recruit(s,'settler');s.cities['city-2'].production.queue=Array(10).fill('warrior');assert.equal(supply(s),null);
 const noArmy=fixture();noArmy.parties['party-2'].status='defeated';assert.equal(supply(noArmy),null);
});
test('any threatened owned city blocks new expansion, and emergency walls remain first',()=>{
 const s=fixture();relocate(s,'party-1','2,-2,0');assert.equal(supply(s),null);assert.equal(chooseSupplyCommand(s,owner,'defend').payload.itemId,'walls');
 s.cities['city-2'].buildings.push('walls');s.cities['city-2'].defense.wallHp=60;assert.equal(supply(s),null);
});
test('site and route share founding constraints, avoid hostile territory and occupied cells',()=>{
 const s=fixture(),probe={id:null,location:'4,-4,0',movementMaximum:2},site=findSettlementSite(s,owner,probe);assert.ok(site);assert.ok(validateCitySite(s,owner,site.key).ok);
 for(const key of site.path){assert.notEqual(s.world.tiles[key].ownerId,'kingdom-1');assert.ok(Hex.fromKey(key).distance(Hex.fromKey('0,0,0'))>3);}
 const blocked=structuredClone(s);for(const t of Object.values(blocked.world.tiles))if(t.ownerId===null)t.terrainId='void';assert.equal(findSettlementSite(blocked,owner,probe),null);assert.equal(supply(blocked),null);
});
test('three owned cities stop discretionary settlement but do not change human founding rules',()=>{
 const s=fixture();addCity(s,{ownerId:owner,id:'city-3',centerHex:'8,-8,0'});addCity(s,{ownerId:owner,id:'city-4',centerHex:'8,0,-8'});
 assert.equal(supply(s),null);assert.equal(findSettlementSite(s,owner,{location:'4,-4,0',movementMaximum:2}),null);
 const p=group(s,'0,5,-5');assert.equal(validateFoundCity(s,owner,p.id,p.unitIds[1]).ok,true);
});
test('escort reservations prevent ordinary deployment and reinforcement from stealing a pending escort',()=>{
 const s=fixture(),escort=Object.values(s.units).find(u=>u.ownerId===owner&&u.partyId===null);s.cities['city-2'].production.currentItemId='settler';
 assert.equal(reservedEscortIds(s,owner).has(escort.id),true);assert.equal(chooseDeploymentCommand(s,owner,'deploy'),null);assert.equal(chooseReinforcementCommand(s,owner,'recruit'),null);
 delete s.aiExpansionVersion;assert.equal(reservedEscortIds(s,owner).size,0);assert.ok(chooseDeploymentCommand(s,owner,'legacy'));
});
test('waiting settler and escort form one party then set protected formation through Commands',()=>{
 let s=fixture();s=apply(s,supply(s));const c=expedition(s);assert.equal(c.type,'CreateParty');s=apply(s,c);const p=Object.values(s.parties).find(p=>isExpansionParty(s,p));
 assert.equal(expedition(s).type,'SetFormation');s=apply(s,expedition(s));assert.equal(expedition(s).type,'SetGuardOrder');s=apply(s,expedition(s));
 assert.ok(s.parties[p.id].guardOrders[p.unitIds[0]]);assert.equal(s.parties[p.id].formation['middle-center'],p.unitIds[1]);trip(s);
});
test('waiting settler can join a ready co-located military party without teleporting or refreshing it',()=>{
 const s=fixture(),p=group(s);const civilian=s.units[p.unitIds[1]];p.unitIds.pop();p.formation={'front-center':p.unitIds[0]};civilian.partyId=null;
 const c=expedition(s);assert.equal(c.type,'ReinforceParty');const after=apply(s,c);assert.equal(after.parties[p.id].activationState,'ended');assert.equal(after.units[civilian.id].partyId,p.id);trip(after);
});
test('escort-less settlers never march toward a new city or fall through to assault movement',()=>{
 const s=fixture(),p=group(s,'6,0,-6'),escort=s.units[p.unitIds[0]];escort.currentHp=escort.hp=0;escort.status='shattered';p.leaderUnitId=p.unitIds[1];
 const c=expedition(s);assert.ok(!c||c.type==='MoveParty');if(c)assert.ok(Hex.fromKey(c.payload.path.at(-1)).distance(Hex.fromKey('4,-4,0'))<Hex.fromKey(p.location).distance(Hex.fromKey('4,-4,0')));
 assert.equal(chooseCityExitCommand(s,owner,'exit')?.payload.partyId===p.id,false);
});
test('danger re-evaluation retreats away from an enemy instead of continuing the previous route',()=>{
 const s=fixture(),p=group(s,'7,-4,-3');arranged(s,p);relocate(s,'party-1','7,-2,-5');
 const c=expedition(s);assert.equal(c.type,'MoveParty');const before=Hex.fromKey(p.location).distance(Hex.fromKey(s.parties['party-1'].location));
 assert.ok(Hex.fromKey(c.payload.path.at(-1)).distance(Hex.fromKey(s.parties['party-1'].location))>before);assert.ok(validatePartyPath(s,p,c.payload.path).ok);
});
test('movement spends real terrain cost and cannot cross void, stale targets or exhausted activations',()=>{
 const s=fixture(),p=group(s);arranged(s,p);const c=expedition(s);assert.equal(c.type,'MoveParty');const v=validatePartyPath(s,p,c.payload.path);assert.ok(v.ok);
 const after=apply(s,c);assert.equal(after.parties[p.id].movementRemaining,p.movementRemaining-v.cost);trip(after);
 p.movementRemaining=0;assert.equal(expedition(s),null);
});
test('founding consumes only the settler, preserves escort damage and waits for next-round income',()=>{
 let s=fixture(),p=group(s);arranged(s,p);const site=findSettlementSite(s,owner,p);relocate(s,p.id,site.key);s.units[p.unitIds[0]].hp=s.units[p.unitIds[0]].currentHp=80;
 const c=expedition(s);assert.equal(c.type,'FoundCity');const before=structuredClone(s.kingdoms[owner].stockpiles),after=apply(s,c),city=Object.values(after.cities).find(c=>c.centerHex===site.key);
 assert.ok(city);assert.equal(city.population,1);assert.deepEqual(city.yieldSummary,{food:0,production:0,gold:0,science:0,mana:0,religion:0,culture:0});
 assert.deepEqual(after.kingdoms[owner].stockpiles,before);assert.equal(after.units[p.unitIds[1]],undefined);assert.equal(after.units[p.unitIds[0]].currentHp,80);assert.equal(after.parties[p.id].activationState,'ended');assert.equal(isExpansionParty(after,after.parties[p.id]),false);trip(after);
});
test('invalidated site replans without ownership mutation or allocating any IDs',()=>{
 const s=fixture(),p=group(s);arranged(s,p);const first=findSettlementSite(s,owner,p);s.world.tiles[first.key].terrainId='void';const before=serializeGameState(s),next=findSettlementSite(s,owner,p);assert.ok(!next||next.key!==first.key);assert.equal(serializeGameState(s),before);
});
test('new order and expedition continuation are identical across each save boundary',()=>{
 let s=fixture();s=apply(s,supply(s));for(let i=0;i<5;i++){const c=expedition(s);assert.deepEqual(c,expedition(trip(s)));if(!c)break;assert.deepEqual(apply(s,c),apply(trip(s),c));s=apply(s,c);}
});
test('single-kingdom normal AI completes three cities without direct expansion actions or free resources',()=>{
 for(const seed of [1,7,42]){
  let s=createInitialGameState(seed,{startingParty:true});s.aiExpansionVersion=1;s.kingdoms['kingdom-1'].controllerType='ai';s.kingdoms['kingdom-1'].aiPolicy='reinforcements';
  for(const t of Object.values(s.world.tiles))t.terrainId='plains';for(let i=0;i<3;i++)recruit(s,'warrior','0,0,0','kingdom-1');
  s=apply(s,new HumanController('kingdom-1').startTurn(s));
  for(let round=0;round<25&&s.kingdoms['kingdom-1'].cityIds.length<3;round++){const result=runAiTurn(s);assert.equal(result.ok,true,result.reason);s=trip(result.state);}
  assert.equal(s.kingdoms['kingdom-1'].cityIds.length,3,`seed ${seed}`);assert.equal(s.eventLog.filter(e=>e.type==='CityFounded').length,2);
 }
});
test('ordinary two-AI warfare remains bounded and resumes identically in both recruitment scenarios',()=>{
 for(const make of [createAiConquestGameState,createAiReinforcementGameState])for(const seed of [1,117]){
  let s=make(seed);s.kingdoms['kingdom-1'].controllerType='ai';s.kingdoms['kingdom-1'].aiPolicy='reinforcements';s=apply(s,human.startTurn(s));
  let handoffs=0;while(!s.gameResult&&handoffs++<82){const a=runAiTurn(s),b=runAiTurn(trip(s));assert.equal(a.ok,true,a.reason);assert.deepEqual(a,b);assert.ok(a.commands.length<=129);s=a.state;}
  assert.ok(s.gameResult,`seed ${seed}`);trip(s);
 }
});
test('a full garrison clears the city for a waiting escorted settler even at the military cap',()=>{
 const s=fixture();relocate(s,'party-2','4,-4,0');Object.assign(s.parties['party-2'],{activationState:'ready',movementRemaining:2});recruit(s,'settler');for(let i=0;i<9;i++)recruit(s,'warrior','7,-7,0');
 const c=expedition(s);assert.equal(c.type,'MoveParty');assert.equal(c.payload.partyId,'party-2');const after=apply(s,c);assert.equal(expedition(after).type,'CreateParty');trip(after);
});
test('the military cap includes queued soldiers and cannot reserve an additional escort beyond it',()=>{
 const s=fixture();Object.values(s.units).find(u=>u.ownerId===owner&&u.partyId===null).location='7,-7,0';
 for(let i=0;i<9;i++)recruit(s,'warrior','7,-7,0');assert.equal(supply(s),null);
});
test('captured or enemy-occupied sites are rejected by the shared validator',()=>{
 const s=fixture(),p=group(s),site=findSettlementSite(s,owner,p);s.world.tiles[site.key].ownerId='kingdom-1';assert.equal(validateCitySite(s,owner,site.key).ok,false);
 s.world.tiles[site.key].ownerId=null;recruit(s,'settler',site.key,'kingdom-1');assert.equal(validateCitySite(s,owner,site.key).ok,false);
});
test('expeditions cannot spend fractional remaining movement to enter costly terrain',()=>{
 const s=fixture(),p=group(s);arranged(s,p);p.movementRemaining=1;
 for(const h of Hex.range(Hex.fromKey(p.location),1))if(h.key!==p.location)s.world.tiles[h.key].terrainId='hills';
 assert.equal(expedition(s),null);p.movementRemaining=2;const c=expedition(s);assert.equal(c.type,'MoveParty');assert.equal(c.payload.path.length,1);
});
test('a rejected replay never duplicates a settler, purchase or city',()=>{
 const s=fixture(),c=supply(s),after=apply(s,c),text=serializeGameState(after),r=RuleSystem.execute(after,c);assert.equal(r.ok,false);assert.equal(r.state,after);assert.deepEqual(r.events,[]);assert.equal(serializeGameState(after),text);
});
test('a lost settler releases the escort back to ordinary military AI rather than reserving it',()=>{
 const s=fixture(),p=group(s),u=s.units[p.unitIds[1]];u.currentHp=u.hp=0;u.status='shattered';assert.equal(isExpansionParty(s,p),false);
});
