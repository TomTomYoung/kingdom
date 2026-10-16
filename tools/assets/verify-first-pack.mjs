import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const root=path.resolve(process.argv[2]||'.');
const reportPath=process.argv[3]||'assets/verification.json';
const manifest=JSON.parse(fs.readFileSync(path.join(root,'assets/manifest.json'),'utf8'));
const sha=b=>createHash('sha256').update(b).digest('hex');
const results=[];
for(const asset of manifest.assets){
 for(const file of asset.files){const b=fs.readFileSync(path.join(root,file.path));if(b.length!==file.bytes||sha(b)!==file.sha256)throw Error('File integrity: '+file.path);}
 const file=asset.files.find(f=>/\/(image\.png|audio\.(wav|ogg))$/.test(f.path));
 if(asset.tool==='AIPaint'){
  const decoded=execFileSync('ffmpeg',['-v','error','-i',path.join(root,file.path),'-f','rawvideo','-pix_fmt','rgba','-'],{maxBuffer:4*1024*1024});
  if(decoded.length!==asset.width*asset.height*4||sha(decoded)!==asset.checks.rgbaSHA256)throw Error('PNG decoder mismatch: '+asset.id);
  if(!asset.checks.passed||!asset.checks.hasTransparency||asset.checks.visibleRGBColors>24)throw Error('Image checks: '+asset.id);
  results.push({id:asset.id,fileHashesValid:true,independentPNGDecodeMatches:true,width:asset.width,height:asset.height,colors:asset.checks.visibleRGBColors,transparent:true});
 }else{
  const b=execFileSync('ffmpeg',['-v','error','-i',path.join(root,file.path),'-f','f32le','-acodec','pcm_f32le','-'],{maxBuffer:16*1024*1024});
  let peak=0,sum=0;for(let i=0;i<b.length;i+=4){const v=b.readFloatLE(i);if(!Number.isFinite(v))throw Error('Nonfinite sample');peak=Math.max(peak,Math.abs(v));sum+=v*v;}
  const frames=b.length/8,rms=Math.sqrt(sum/(b.length/4)),expected=Math.round(asset.seconds*44100);
  const loopBoundaryJump=Math.max(Math.abs(b.readFloatLE(0)-b.readFloatLE(b.length-8)),Math.abs(b.readFloatLE(4)-b.readFloatLE(b.length-4)));
  if(peak>=1||rms<0.0001||frames!==expected)throw Error('Audio delivery failed: '+JSON.stringify({id:asset.id,peak,rms,frames,expected}));
  if(asset.loop&&loopBoundaryJump>0.005)throw Error('Decoded loop boundary: '+asset.id);
  results.push({id:asset.id,fileHashesValid:true,decoded:true,sampleRate:44100,channels:2,frames,seconds:frames/44100,peak,rms,clipped:false,...asset.loop&&{loopBoundaryJump},listeningReviewed:false});
 }
}
const sheet=fs.readFileSync(path.join(root,manifest.contactSheet.path));
if(sha(sheet)!==manifest.contactSheet.sha256)throw Error('Contact sheet hash mismatch');
const output={schemaVersion:1,packId:manifest.packId,checked:new Date().toISOString().slice(0,10),result:'passed',assets:results.length,method:'Manifest SHA-256 and independent FFmpeg PNG/audio decoding',audioListeningReview:'not-performed',gameIntegration:manifest.integrationStatus,scope:'File and decode verification only; runtime checks are separate',results};
if(reportPath!=='--check')fs.writeFileSync(path.join(root,reportPath),JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify(output,null,2));
