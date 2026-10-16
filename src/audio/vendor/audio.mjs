import { validateProject, audibleTracks, scoreSeconds, PPQ, number, check, INSTRUMENTS } from './core.mjs';
export const RENDER_VERSION = 'pcm-synth/1';
export const RELEASE = Object.freeze({pluck:.12,bell:.45,flute:.06,pulse:.035,pad:.3,bass:.07,kick:.12,snare:.12,hat:.05});
const TAU=Math.PI*2;
export const frequency = pitch => 440*2**((pitch-69)/12);
function seed(text) { let h=2166136261; for(const c of text)h=Math.imul(h^c.charCodeAt(0),16777619); return h>>>0||1; }
function blep(t,dt) { if(t<dt){t/=dt;return t+t-t*t-1;} if(t>1-dt){t=(t-1)/dt;return t*t+t+t+1;} return 0; }
/** Render exactly the same score in browser and Node; no wall clock or random source. */
export function renderPCM(project,{sampleRate=22050,mode='tail'}={}) {
  const p=validateProject(project); check([22050,44100,48000].includes(sampleRate),'INVALID_INPUT','sampleRate: 22050 / 44100 / 48000');
  check(['tail','loop'].includes(mode),'INVALID_INPUT','mode: tail / loop');
  const body=scoreSeconds(p),tracks=audibleTracks(p),events=[]; let work=0;
  for(const t of tracks)for(const n of t.notes){
    const gate=n.duration/PPQ*60/p.tempo, release=RELEASE[t.instrument],length=Math.ceil((gate+release)*sampleRate);
    events.push({t,n,gate,release,length});work+=length;
  }
  check(work<=40000000,'RESOURCE_LIMIT','同時発音・音の長さがレンダー上限を超えています。曲を短くするかノートを減らしてください');
  const bodyFrames=Math.round(body*sampleRate),frames=bodyFrames+(mode==='tail'?Math.ceil(.5*sampleRate):0);
  const left=new Float32Array(frames),right=new Float32Array(frames);
  for(const {t,n,gate,release,length} of events) {
    const f=frequency(n.pitch),begin=Math.round(n.start/PPQ*60/p.tempo*sampleRate),g=.26*t.volume*n.velocity/127*p.master;
    const gl=g*Math.cos((t.pan+1)*Math.PI/4),gr=g*Math.sin((t.pan+1)*Math.PI/4);
    let rng=seed(`${p.id}:${t.id}:${n.id}`),previousNoise=0;
    for(let i=0;i<length;i++){
      const time=i/sampleRate,phase=time*f,attack=t.instrument==='pad'?.045:.004;
      const env=Math.min(1,time/attack)*Math.max(0,Math.min(1,(gate+release-time)/release));
      if(env===0)continue;
      const s=h=>f*h<sampleRate*.48?Math.sin(TAU*phase*h):0;
      let v;
      switch(t.instrument){
        case 'pulse': {const ph=phase%1,dt=f/sampleRate;v=((ph<.5?1:-1)+blep(ph,dt)-blep((ph+.5)%1,dt))*.6;break;}
        case 'pluck': v=(s(1)+.35*s(2)+.15*s(3)+.08*s(4))/1.58*Math.exp(-time*4);break;
        case 'bell': v=(s(1)+.4*s(2.76)*Math.exp(-time*4)+.2*s(4.07)*Math.exp(-time*8))/.95*Math.exp(-time*2.4);break;
        case 'flute': v=(s(1)+.12*s(2))*.85;break;
        case 'pad': v=(s(1)+.35*s(1.005)+.16*s(2))*.6;break;
        case 'bass': v=(s(1)+s(3)/9+s(5)/25)*.85;break;
        case 'kick': v=Math.sin(TAU*(48*time+85*.025*(1-Math.exp(-time/.025))))*Math.exp(-time*16);break;
        default: {
          rng^=rng<<13;rng^=rng>>>17;rng^=rng<<5;const noise=(rng>>>0)/2147483648-1;
          if(t.instrument==='snare')v=(noise*.75+Math.sin(TAU*180*time)*.25)*Math.exp(-time*23);
          else v=(noise-previousNoise)*.5*Math.exp(-time*60);
          previousNoise=noise;
        }
      }
      const j=mode==='loop'?(begin+i)%bodyFrames:begin+i;
      if(j>=frames)break;
      left[j]+=v*env*gl;right[j]+=v*env*gr;
    }
  }
  let rawPeak=0;
  for(let i=0;i<frames;i++)rawPeak=Math.max(rawPeak,Math.abs(left[i]),Math.abs(right[i]));
  const limiterGain=rawPeak>.92?.92/rawPeak:1; let energy=0,peak=0;
  for(let i=0;i<frames;i++){
    left[i]*=limiterGain;right[i]*=limiterGain;
    check(Number.isFinite(left[i])&&Number.isFinite(right[i]),'RENDER_FAILED','非数値の音声です');
    energy+=left[i]**2+right[i]**2;peak=Math.max(peak,Math.abs(left[i]),Math.abs(right[i]));
  }
  return {sampleRate,left,right,report:{renderer:RENDER_VERSION,mode,frames,bodyFrames,seconds:frames/sampleRate,scoreSeconds:body,
    audibleTracks:tracks.length,notes:events.length,peak,rms:Math.sqrt(energy/(frames*2)),limiterGain,
    silent:peak===0,loopBoundaryJump:mode==='loop'?Math.max(Math.abs(left[0]-left.at(-1)),Math.abs(right[0]-right.at(-1))):null}};
}
export function encodeWAV(pcm) {
  const {left,right,sampleRate}=pcm;number(sampleRate,8000,192000);check(left.length===right.length,'INVALID_AUDIO','チャンネル長が不一致です');
  const b=new ArrayBuffer(44+left.length*4),v=new DataView(b),tag=(pos,s)=>{for(let i=0;i<s.length;i++)v.setUint8(pos+i,s.charCodeAt(i));};
  tag(0,'RIFF');v.setUint32(4,b.byteLength-8,true);tag(8,'WAVE');tag(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,2,true);
  v.setUint32(24,sampleRate,true);v.setUint32(28,sampleRate*4,true);v.setUint16(32,4,true);v.setUint16(34,16,true);tag(36,'data');v.setUint32(40,left.length*4,true);
  for(let i=0;i<left.length;i++)for(let c=0;c<2;c++){
    const x=c?right[i]:left[i];check(Number.isFinite(x),'INVALID_AUDIO','非数値サンプルです');
    v.setInt16(44+i*4+c*2,Math.round(Math.max(-1,Math.min(1,x))*(x<0?32768:32767)),true);
  }
  return new Uint8Array(b);
}
/** SMF type 1 / 480 PPQ. MIDI is an editable performance, not the synth's sound. */
export function encodeMIDI(project) {
  const p=validateProject(project),tracks=audibleTracks(p),te=new TextEncoder();
  const be=(n,size)=>Array.from({length:size},(_,i)=>n>>>((size-1-i)*8)&255);
  const vlq=n=>{const b=[n&127];while(n>>>=7)b.unshift((n&127)|128);return b;};
  const meta=(type,bytes)=>[255,type,...vlq(bytes.length),...bytes];
  const chunk=(name,bytes)=>[...te.encode(name),...be(bytes.length,4),...bytes];
  const track=events=>{const b=[];let last=0;events.sort((a,b)=>a.at-b.at||a.order-b.order);for(const e of events){b.push(...vlq(e.at-last),...e.bytes);last=e.at;}return chunk('MTrk',b);};
  const end={at:total(p),order:9,bytes:meta(47,[])};
  const chunks=[track([{at:0,order:0,bytes:meta(3,[...te.encode(p.title)])},
    {at:0,order:0,bytes:meta(81,be(Math.round(60000000/p.tempo),3))},
    {at:0,order:0,bytes:meta(88,[p.beatsPerBar,2,24,8])},end])];
  const drumNotes=new Map();let channel=0;
  for(const t of tracks){
    const preset=INSTRUMENTS[t.instrument],drum=!!preset.drum,ch=drum?9:channel++;
    const events=[{at:0,order:-2,bytes:meta(3,[...te.encode(t.name)])}];
    if(!drum)events.push({at:0,order:-1,bytes:[192|ch,preset.midi]},
      {at:0,order:-1,bytes:[176|ch,7,Math.round(t.volume*p.master*127)]},
      {at:0,order:-1,bytes:[176|ch,10,Math.round((t.pan+1)*63.5)]});
    for(const n of t.notes){
      if(drum){const list=drumNotes.get(n.pitch)||[];check(!list.some(x=>n.start<x.start+x.duration&&x.start<n.start+n.duration),'MIDI_OVERLAP','同じ打楽器を複数トラックで重ねたMIDIは書き出せません');list.push(n);drumNotes.set(n.pitch,list);}
      const velocity=drum?Math.round(n.velocity*t.volume*p.master):n.velocity;
      if(t.volume===0||p.master===0||velocity===0)continue;
      events.push({at:n.start,order:1,bytes:[144|ch,n.pitch,velocity]},{at:n.start+n.duration,order:0,bytes:[128|ch,n.pitch,0]});
    }
    events.push(end);chunks.push(track(events));
  }
  return Uint8Array.from([...chunk('MThd',[0,1,...be(chunks.length,2),...be(PPQ,2)]),...chunks.flat()]);
}
const total=p=>p.bars*p.beatsPerBar*PPQ;
