// Controlled single-kingdom development, not a normal war-balance assessment.
// node tools/qa/playthrough-ai-expansion.mjs output.json
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createInitialGameState, serializeGameState, restoreGameState } from '../../src/core/game-state.js';
import { createUnit } from '../../src/models/unit.js';
import { HumanController } from '../../src/core/human-controller.js';
import { AIController } from '../../src/core/ai-controller.js';
import { RuleSystem } from '../../src/core/rule-system.js';
const seeds=[1,2,3,4,7,11,23,42,77,117,256,1024],games=[];let commands=0,saveRoundTrips=0;
for(const seed of seeds){
 let s=createInitialGameState(seed,{startingParty:true});s.aiExpansionVersion=1;
 const k=s.kingdoms['kingdom-1'];k.controllerType='ai';k.aiPolicy='reinforcements';
 for(let i=0;i<3;i++){const id=`unit-${s.nextIds.unit++}`;s.units[id]=createUnit(id,k.id,'warrior','0,0,0');k.unitIds.push(id);}
 s=RuleSystem.execute(s,new HumanController(k.id).startTurn(s)).state;
 const ai=new AIController(k.id);let turnCommands=0;
 while(s.currentTurn<=40 && s.kingdoms[k.id].cityIds.length<3){
  const c=ai.nextCommand(s,{forceEnd:turnCommands>=128}),restored=restoreGameState(serializeGameState(s));
  assert.deepEqual(restored,s);saveRoundTrips++;assert.deepEqual(ai.nextCommand(restored,{forceEnd:turnCommands>=128}),c);
  const a=RuleSystem.execute(s,c),b=RuleSystem.execute(restored,c);assert.equal(a.ok,true,a.reason);assert.deepEqual(a,b);s=a.state;commands++;
  turnCommands=c.type==='EndTurn'?0:turnCommands+1;
 }
 assert.equal(s.kingdoms[k.id].cityIds.length,3,`seed ${seed}: expansion failed`);
 games.push({seed,turn:s.currentTurn,cities:s.kingdoms[k.id].cityIds,foundings:s.eventLog.filter(e=>e.type==='CityFounded').map(e=>({turn:e.turn,tileKey:e.tileKey}))});
}
const report={verifiedAt:new Date().toISOString(),kind:'single kingdom, six initial soldiers, unmodified seeded map, no opponent; bounded development verification',seeds,commands,saveRoundTrips,games};
await fs.writeFile(process.argv[2],JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({commands,saveRoundTrips,games},null,2));
