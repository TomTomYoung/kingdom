// Original, editable note sequences for the AIMusic score model (480 PPQ).
const track=(id,instrument,volume=.6,pan=0)=>({id,name:id,instrument,volume,pan,mute:false,solo:false,notes:[]});
function score(id,title,tempo,bars,beatsPerBar=4){return {format:'aimusic-project',version:1,id,title,tempo,bars,beatsPerBar,master:.76,tracks:[]};}
function add(t,pitch,beat,duration,velocity=90){t.notes.push({id:t.id+'-'+t.notes.length,pitch,start:Math.round(beat*480),duration:Math.round(duration*480),velocity});}
export function musicJobs(){
 const out=[];
 function se(id,title,parts){const p=score(id,title,240,1,3);for(const [instrument,notes,vol]of parts){const t=track(instrument+'-'+p.tracks.length,instrument,vol??.72);p.tracks.push(t);for(const [pitch,start,dur,vel]of notes)add(t,pitch,start,dur,vel??96);}out.push({id,title,kind:'se',project:p,mode:'tail'});}
 se('se-ui-select','選択',[['pluck',[[79,0,.18]],.65]]);
 se('se-ui-confirm','確定',[['pluck',[[72,0,.26],[79,.33,.32]],.75]]);
 se('se-ui-cancel','戻る',[['pluck',[[74,0,.22],[67,.30,.24]],.63]]);
 se('se-ui-error','操作不可',[['pulse',[[48,0,.24],[47,.36,.24]],.38]]);
 se('se-turn-start','新しい手番',[['bell',[[67,0,.25],[74,.48,.26],[79,.98,.5]],.76]]);
 se('se-production-complete','完成',[['bell',[[60,0,.28],[64,.4,.28],[67,.8,.3],[72,1.25,.45]],.77],['pluck',[[48,0,.5],[55,.8,.6]],.35]]);
 se('se-purchase','購入',[['bell',[[88,0,.1],[91,.28,.14]],.63]]);
 se('se-party-move','足取り',[['snare',[[38,0,.08],[38,.4,.08]],.20],['kick',[[36,0,.06]],.32]]);
 {
  const p=score('bgm-overworld','暁の王領',108,8);const lead=track('melody','flute',.62,-.1),arp=track('harp','pluck',.49,.3),bass=track('bass','bass',.58),pad=track('harmony','pad',.19,-.25);p.tracks=[lead,arp,bass,pad];
  const chords=[[60,64,67],[55,62,67],[57,60,64],[53,60,65],[60,64,67],[57,62,65],[55,59,62],[55,59,65]];
  const melody=[[[72,0,.85],[76,1,.38],[79,1.5,1.2],[76,3,.7]],[[74,0,1.35],[71,1.5,.4],[67,2,.9],[69,3,.35],[71,3.5,.35]],[[72,0,.6],[76,.75,.6],[81,1.5,.85],[79,2.5,.4],[76,3,.7]],[[77,0,1.3],[76,1.5,.4],[74,2,.7],[72,3,.7]],[[79,0,.65],[84,.75,.55],[83,1.5,.4],[79,2,1.1],[76,3.5,.35]],[[77,0,.6],[81,.75,.6],[79,1.5,.4],[77,2,.6],[74,3,.7]],[[74,0,.65],[76,.75,.4],[74,1.5,.45],[71,2,1.1],[67,3.5,.35]],[[71,0,.9],[74,1,.6],[79,2,.8],[71,3,.65]]];
  chords.forEach((ch,b)=>{const at=b*4;for(const [pitch,t,d]of melody[b])add(lead,pitch,at+t,d,84+(b%3)*3);[0,1,2,1,0,2,1,2].forEach((k,i)=>add(arp,ch[k]+12,at+i*.5,.28,i%2?60:70));add(bass,ch[0]-12,at,1.6,88);add(bass,ch[2]-12,at+2,1.55,78);for(const pitch of ch)add(pad,pitch,at,.9,57);});
  out.push({id:p.id,title:p.title,kind:'bgm',project:p,mode:'loop'});
 }
 {
  const p=score('bgm-battle','剣旗の進軍',144,8);const lead=track('melody','pulse',.37,-.08),arp=track('ostinato','pluck',.49,.23),bass=track('bass','bass',.62),kick=track('kick','kick',.66),snare=track('snare','snare',.35),hat=track('hat','hat',.19,.23);p.tracks=[lead,arp,bass,kick,snare,hat];
  const chords=[[57,60,64],[53,57,60],[50,57,62],[52,56,59],[57,60,64],[53,57,60],[50,53,57],[52,56,62]];
  const melodies=[[76,76,79,76,72,74],[77,76,72,69,72,76],[74,77,81,77,74,72],[71,76,80,76,74,71],[81,79,76,79,84,83],[81,77,76,72,76,77],[77,74,69,72,74,77],[80,76,71,68,71,80]];
  chords.forEach((ch,b)=>{const at=b*4;[0,.5,1,2,2.5,3].forEach((t,i)=>add(lead,melodies[b][i],at+t,i===2||i===5?.75:.35,88+i%2*6));[0,1,2,1,0,2,1,2].forEach((k,i)=>add(arp,ch[k],at+i*.5,.27,72));for(let i=0;i<4;i++)add(bass,ch[i%2===0?0:2]-12,at+i,.65,94-i%2*9);for(const t of[0,1.5,2])add(kick,36,at+t,.1,103);for(const t of[1,3])add(snare,38,at+t,.1,90);for(let i=0;i<8;i++)add(hat,42,at+i*.5,.05,i%2?55:71);});
  out.push({id:p.id,title:p.title,kind:'bgm',project:p,mode:'loop'});
 }
 return out.map(x=>({...x,job:{format:'aimusic-job',version:1,project:x.project,batches:[],render:{sampleRate:44100,mode:x.mode}}}));
}
