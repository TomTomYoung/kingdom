import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { graphicDrawings } from './graphics.mjs';
import { musicJobs } from './music.mjs';

const [paintArg,musicArg,outputArg]=process.argv.slice(2);
if(!paintArg||!musicArg||!outputArg)throw Error('Usage: node render-first-pack.mjs AIPAINT_ROOT AIMUSIC_ROOT NEW_OUTPUT_ROOT');
const paintRoot=path.resolve(paintArg),musicRoot=path.resolve(musicArg),root=path.resolve(outputArg);
if(fs.existsSync(path.join(root,'assets')))throw Error('Output assets directory already exists; select a fresh root');
const lock=JSON.parse(fs.readFileSync(new URL('./tool-lock.json',import.meta.url),'utf8'));
const sha=b=>createHash('sha256').update(b).digest('hex');
for(const [name,dir]of [['AIPaint',paintRoot],['AIMusic',musicRoot]])for(const [p,expected]of Object.entries(lock.tools[name].files)){
 const file=path.join(dir,p);if(!fs.existsSync(file))throw Error('Missing pinned tool file: '+file);
 const b=fs.readFileSync(file),actual=createHash('sha1').update(`blob ${b.length}\0`).update(b).digest('hex');if(actual!==expected)throw Error('Tool differs from pinned commit: '+file);
}
const {executeJob:paint}=await import(pathToFileURL(path.join(paintRoot,'src/agent.js')));
const {PaintCore}=await import(pathToFileURL(path.join(paintRoot,'src/core.js')));
function write(rel,bytes){const dest=path.join(root,rel);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,bytes,{flag:'wx'});return {path:rel,bytes:Buffer.byteLength(bytes),sha256:sha(bytes)};}
const json=(rel,value)=>write(rel,JSON.stringify(value,null,2)+'\n');
function crc32(b){let c=0xffffffff;for(const x of b){c^=x;for(let k=0;k<8;k++)c=(c>>>1)^(c&1?0xedb88320:0);}return(c^0xffffffff)>>>0;}
function chunk(tag,data){const b=Buffer.alloc(data.length+12);b.writeUInt32BE(data.length);b.write(tag,4);data.copy(b,8);b.writeUInt32BE(crc32(b.subarray(4,-4)),b.length-4);return b;}
// PNG packaging only; every raster sample below comes from AIPaint.composite().
function png(r){const header=Buffer.alloc(13);header.writeUInt32BE(r.width);header.writeUInt32BE(r.height,4);header[8]=8;header[9]=6;const rows=Buffer.alloc((r.width*4+1)*r.height);for(let y=0;y<r.height;y++)Buffer.from(r.data.buffer,r.data.byteOffset+y*r.width*4,r.width*4).copy(rows,y*(r.width*4+1)+1);return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',deflateSync(rows,{level:9})),chunk('IEND',Buffer.alloc(0))]);}
const records=[],rendered=[];
for(const d of graphicDrawings()){
 const job=d.job(),result=paint(job),r=result.core.composite(),dir=`assets/graphics/${d.id}/v001`,project=result.core.exportProject();
 const reopened=PaintCore.fromProject(project).composite();if(!Buffer.from(r.data).equals(Buffer.from(reopened.data)))throw Error('Paint project roundtrip mismatch: '+d.id);
 const files=[json(`assets/jobs/${d.id}.v001.paint.json`,job),write(`${dir}/image.png`,png(r)),json(`${dir}/project.paint.json`,project)];
 const check={...result.checks,rgbaSHA256:sha(r.data),projectRoundtrip:true,alphaValues:[...new Set(Array.from(r.data).filter((_,i)=>i%4===3))],renderer:'AIPaint executeJob / PaintCore',toolCommit:lock.tools.AIPaint.commit,pngAdapter:'kingdom-node-png/1'};
 files.push(json(`${dir}/report.json`,check));records.push({id:d.id,title:d.title,category:d.category,revision:'v001',tool:'AIPaint',toolCommit:lock.tools.AIPaint.commit,width:r.width,height:r.height,status:'rendered',integrated:false,visualReview:false,files,checks:check});rendered.push({d,r});console.log('AIPaint: '+d.id);
}
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'kingdom-aimusic-'));
for(const music of musicJobs()){
 const dir=`assets/audio/${music.id}/v001`,jobRel=`assets/jobs/${music.id}.v001.music.json`,jobFile=json(jobRel,music.job),work=path.join(tmp,music.id);
 execFileSync(process.execPath,[path.join(musicRoot,'scripts/render.mjs'),path.join(root,jobRel),work],{stdio:'pipe'});
 const report=JSON.parse(fs.readFileSync(path.join(work,'report.json'),'utf8'));
 if(report.silent||!Number.isFinite(report.peak)||report.peak>.93)throw Error('Invalid audio: '+music.id);
 if(music.kind==='bgm'&&report.loopBoundaryJump>.005)throw Error('Loop boundary exceeds candidate threshold: '+music.id);
 for(const f of report.files)if(sha(fs.readFileSync(path.join(work,f.file)))!==f.sha256)throw Error('AIMusic hash mismatch');
 const files=[jobFile,write(`${dir}/project.music.json`,fs.readFileSync(path.join(work,'project.music.json'))),write(`${dir}/song.mid`,fs.readFileSync(path.join(work,'song.mid'))),json(`${dir}/source-render-report.json`,report)];
 let final,derivation,frames=report.frames;
 if(music.kind==='se'){
   const source=fs.readFileSync(path.join(work,'song.wav'));let last=0;
   for(let i=44;i<source.length;i+=4)if(Math.abs(source.readInt16LE(i))>1||Math.abs(source.readInt16LE(i+2))>1)last=(i-44)/4;
   frames=Math.min(report.frames,last+1+882);const b=Buffer.from(source.subarray(0,44+frames*4));b.writeUInt32LE(b.length-8,4);b.writeUInt32LE(frames*4,40);
   final=write(`${dir}/audio.wav`,b);derivation={operation:'trim trailing silence only',startFrame:0,endFrame:frames,thresholdPCM16:1,tailPaddingFrames:882,pcmSamplesUnchanged:true,originalWAV:report.files.find(f=>f.file==='song.wav')};
 }else{
   const dest=path.join(work,'audio.ogg');execFileSync('ffmpeg',['-v','error','-i',path.join(work,'song.wav'),'-map_metadata','-1','-c:a','libvorbis','-q:a','3','-metadata','title='+music.title,'-metadata','LOOPSTART=0','-metadata','LOOPEND='+report.bodyFrames,dest]);
   final=write(`${dir}/audio.ogg`,fs.readFileSync(dest));derivation={operation:'WAV to Ogg Vorbis',encoder:'ffmpeg libvorbis q3',ffmpegVersion:execFileSync('ffmpeg',['-version'],{encoding:'utf8'}).split('\n')[0],loopStartFrame:0,loopEndFrame:report.bodyFrames,originalWAV:report.files.find(f=>f.file==='song.wav')};
 }
 files.push(final,json(`${dir}/delivery-report.json`,{assetId:music.id,sourceTool:'AIMusic',toolCommit:lock.tools.AIMusic.commit,sampleRate:44100,channels:2,seconds:frames/44100,derivation,listeningReviewed:false,integrated:false,delivery:final}));
 records.push({id:music.id,title:music.title,category:music.kind,revision:'v001',tool:'AIMusic',toolCommit:lock.tools.AIMusic.commit,status:'rendered-analysis-checked',integrated:false,listeningReviewed:false,seconds:frames/44100,sampleRate:44100,channels:2,loop:music.mode==='loop',files,checks:report});console.log('AIMusic: '+music.id+' '+(frames/44100).toFixed(3)+'s');
}
// AIPaint contact sheet: translate pixel runs into native rectangle commands.
const commands=[{type:'layer.add',id:'sheet',name:'素材一覧'},{type:'shape.rect',layerId:'sheet',x:0,y:0,width:800,height:720,fill:'#14272aff'}];
const rect=(x,y,width,height,fill)=>commands.push({type:'shape.rect',layerId:'sheet',x,y,width,height,fill});
const font={A:['010','101','111','101','101'],B:['110','101','110','101','110'],C:['011','100','100','100','011'],D:['110','101','101','101','110'],E:['111','100','110','100','111'],F:['111','100','110','100','100'],G:['011','100','101','101','011'],H:['101','101','111','101','101'],I:['111','010','010','010','111'],J:['001','001','001','101','010'],K:['101','101','110','101','101'],L:['100','100','100','100','111'],M:['101','111','111','101','101'],N:['101','111','111','111','101'],O:['010','101','101','101','010'],P:['110','101','110','100','100'],Q:['010','101','101','111','011'],R:['110','101','110','101','101'],S:['011','100','010','001','110'],T:['111','010','010','010','010'],U:['101','101','101','101','111'],V:['101','101','101','101','010'],W:['101','101','111','111','101'],X:['101','101','010','101','101'],Y:['101','101','010','010','010'],Z:['111','001','010','100','111'],'0':['111','101','101','101','111'],'1':['010','110','010','010','111'],'2':['110','001','010','100','111'],'3':['110','001','010','001','110'],'4':['101','101','111','001','001'],'5':['111','100','110','001','110'],'6':['011','100','110','101','010'],'7':['111','001','010','010','010'],'8':['010','101','010','101','010'],'9':['010','101','011','001','110'],'-':['000','000','111','000','000']};
function text(x,y,t,s=2){for(const ch of t){const glyph=font[ch];if(glyph)glyph.forEach((row,j)=>[...row].forEach((p,i)=>{if(p==='1')rect(x+i*s,y+j*s,s,s,'#d7c799ff');}));x+=4*s;}}
text(20,14,'KINGDOM - FIRST MATERIALS',3);text(22,37,'AIPAINT - V001 - NATIVE PIXELS',2);
const labels=['PLAINS','GRASSLAND','FOREST','HILLS','ARCANE','VOID','CITY','MONUMENT','WARRIOR','FOOD','PRODUCTION','GOLD','SCIENCE','MANA','RELIGION','CULTURE','SUPPORT'];
rendered.forEach(({r},i)=>{const cx=i%5,cy=Math.floor(i/5),left=cx*160,top=64+cy*160,scale=r.width===24?3:2;rect(left+7,top,146,154,'#20383aff');const ox=left+80-r.width*scale/2,oy=top+8+Math.floor((128-r.height*scale)/2);
 for(let y=0;y<r.height;y++)for(let x=0;x<r.width;){const at=(y*r.width+x)*4,c=Buffer.from(r.data.subarray(at,at+4)).toString('hex');let end=x+1;while(end<r.width&&Buffer.from(r.data.subarray((y*r.width+end)*4,(y*r.width+end)*4+4)).toString('hex')===c)end++;if(r.data[at+3])rect(ox+x*scale,oy+y*scale,(end-x)*scale,scale,'#'+c);x=end;}text(left+16,top+139,String(i+1).padStart(2,'0')+' '+labels[i],2);});
const batches=[];for(let i=0;i<commands.length;i+=500)batches.push({batchId:'sheet-'+batches.length,expectedRevision:batches.length,commands:commands.slice(i,i+500)});
const job={schemaVersion:'paint-job/1',jobId:'first-pack-contact-v001',idempotencyKey:'first-pack-contact-v001',rendererProfile:'pixel-v0.1',source:{kind:'blank',documentId:'first-pack-contact-v001',width:800,height:720,mode:'pixel',background:'transparent',colorSpace:'srgb'},batches,output:{assetId:'first-pack-contact',revisionId:'v001',publishMode:'pull_request',reviewStatus:'candidate'},checks:{width:800,height:720,maxOpaqueColors:256}};
const contact=write('assets/previews/first-pack.png',png(paint(job).core.composite()));
json('assets/manifest.json',{schemaVersion:1,packId:'kingdom-first-pack-v001',created:'2026-09-13',plan:'doc/ASSET_LIST.md',graphics:17,soundEffects:8,music:2,tools:lock.tools,authoringScripts:['tools/assets/graphics.mjs','tools/assets/music.mjs','tools/assets/render-first-pack.mjs'],integrationStatus:'not-integrated',imageReview:'pending',audioListeningReview:'not-performed',contactSheet:contact,assets:records});
console.log(JSON.stringify({outputRoot:root,assets:records.length,graphics:17,se:8,bgm:2,intermediateAIMusicWAVs:tmp}));
