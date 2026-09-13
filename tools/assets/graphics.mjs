// Authoring instructions executed by AIPaint, never an alternate raster engine.
const ink = '#1c292d', stone = '#8a9b98', pale = '#d9d9b5', gold = '#d5b363';
class Drawing {
  constructor(id, title, size, category) { Object.assign(this, { id, title, size, category }); this.commands = []; this.layer('base', '地面・下地'); }
  layer(id, name) { this.active = id; this.commands.push({type:'layer.add', id, name}); }
  color(c) { return c.length === 7 ? c + 'ff' : c; }
  rect(x,y,width,height,c) { if(width>0 && height>0)this.commands.push({type:'shape.rect',layerId:this.active,x,y,width,height,fill:this.color(c)}); }
  ellipse(x,y,width,height,c) { this.commands.push({type:'shape.ellipse',layerId:this.active,x,y,width,height,fill:this.color(c)}); }
  line(x,y,x2,y2,c,size=1) { this.commands.push({type:'shape.line',layerId:this.active,x,y,x2,y2,color:this.color(c),size}); }
  poly(points,c) { // Lower polygons into AIPaint's supported scanline rectangles.
    for(let y=Math.min(...points.map(p=>p[1])); y<Math.max(...points.map(p=>p[1])); y++) {
      const xs=[]; const at=y+.5;
      for(let i=0;i<points.length;i++) { const a=points[i], b=points[(i+1)%points.length]; if((a[1]<=at&&b[1]>at)||(b[1]<=at&&a[1]>at))xs.push(a[0]+(at-a[1])*(b[0]-a[0])/(b[1]-a[1])); }
      xs.sort((a,b)=>a-b);for(let i=0;i+1<xs.length;i+=2){const x=Math.ceil(xs[i]-.5),end=Math.ceil(xs[i+1]-.5);this.rect(x,y,end-x,1,c);}
    }
  }
  job() { const batches=[]; for(let i=0;i<this.commands.length;i+=750)batches.push({batchId:`draw-${batches.length}`,expectedRevision:batches.length,commands:this.commands.slice(i,i+750)});
    return {schemaVersion:'paint-job/1',jobId:this.id+'-v001',idempotencyKey:this.id+'-v001',rendererProfile:'pixel-v0.1',source:{kind:'blank',documentId:this.id+'-v001',width:this.size,height:this.size,mode:'pixel',background:'transparent',colorSpace:'srgb'},batches,output:{assetId:this.id,revisionId:'v001',publishMode:'pull_request',reviewStatus:'candidate'},checks:{width:this.size,height:this.size,requireTransparency:true,maxOpaqueColors:24}}; }
}
function hex(d,base,light,edge) {
  d.poly([[32,1],[59,17],[59,47],[32,63],[5,47],[5,17]],ink);
  d.poly([[32,3],[57,18],[57,46],[32,60],[7,46],[7,18]],edge);
  d.poly([[32,3],[57,18],[57,42],[32,56],[7,42],[7,18]],base);
  d.line(8,18,32,4,light);d.line(32,4,56,18,light);
  d.layer('subject','地形の特徴');
}
function grass(d,x,y,c) { d.line(x,y,x-2,y-3,c);d.line(x,y,x+2,y-4,c);d.line(x,y,x,y-5,c); }
function pine(d,x,y,s=1) {
  d.rect(x-1,y+9*s,3,8*s,'#705c43');
  d.poly([[x,y-10*s],[x-9*s,y+8*s],[x+9*s,y+8*s]],'#193d37');
  d.poly([[x,y-13*s],[x-7*s,y+1*s],[x+7*s,y+1*s]],'#28604b');
  d.poly([[x,y-11*s],[x-5*s,y-1*s],[x,y-3*s]],'#64895a');
  d.line(x-6*s,y+5*s,x-2*s,y+4*s,'#417653');
}
function crystal(d,x,y,w,h) {
  d.poly([[x,y-h],[x-w,y-3],[x-w+1,y+6],[x,y+10],[x+w,y+4],[x+w-1,y-h+5]],ink);
  d.poly([[x,y-h+2],[x-w+2,y-2],[x-w+2,y+5],[x,y+8]],'#7f71c7');
  d.poly([[x,y-h+2],[x+w-2,y-h+6],[x+w-1,y+3],[x,y+8]],'#bcc2ec');
  d.line(x,y-h+3,x,y+6,'#e3f6ed');
}
export function graphicDrawings() {
  const all=[];const make=(id,title,size,category)=>{const d=new Drawing(id,title,size,category);all.push(d);return d;};
  let d=make('terrain-plains','平原',64,'terrain');hex(d,'#9aad62','#c4cd89','#6e834b');
  d.poly([[11,29],[24,22],[43,24],[53,33],[38,37],[17,39]],'#b6ba72');d.poly([[13,40],[34,37],[48,43],[34,49],[22,48]],'#829653');
  for(const [x,y] of [[17,27],[32,22],[45,29],[22,44],[39,44]])grass(d,x,y,'#657a44');d.line(24,33,32,31,'#d0ce91');d.line(36,33,41,32,'#d0ce91');
  d=make('terrain-grassland','草原',64,'terrain');hex(d,'#5d9b58','#96bd6b','#386c46');
  d.poly([[9,29],[24,21],[41,23],[53,32],[43,42],[25,47],[12,40]],'#72a75d');
  for(const [x,y] of [[16,29],[26,24],[39,27],[47,36],[35,43],[20,42],[29,35]]){grass(d,x,y,'#377a4b');d.rect(x-1,y-5,1,2,'#b0c978');}
  for(const [x,y]of[[19,33],[42,38],[33,24]]){d.rect(x,y,2,2,'#e3d28a');d.rect(x+1,y+2,1,2,'#417b45');}
  d=make('terrain-forest','森林',64,'terrain');hex(d,'#426c48','#7a9d5c','#284e3b');
  d.ellipse(12,32,39,15,'#294f3d');for(const [x,y]of[[23,24],[42,25],[16,33],[33,34],[48,35]])pine(d,x,y);
  d.rect(25,47,3,1,'#98a969');d.rect(39,45,2,1,'#98a969');
  d=make('terrain-hills','丘陵',64,'terrain');hex(d,'#a27b52','#d2ad75','#725940');
  d.poly([[10,38],[24,18],[40,39]],'#554d42');d.poly([[24,19],[24,37],[38,38]],'#8b7558');d.poly([[12,37],[24,21],[22,30]],'#c4ac80');
  d.poly([[25,44],[41,23],[55,44]],'#595046');d.poly([[41,24],[39,42],[54,44]],'#917757');d.poly([[27,42],[41,25],[37,34]],'#d6bd8d');
  d.line(37,40,40,34,'#675948');d.rect(18,43,7,2,'#6f7950');d.rect(38,48,5,2,'#c4aa79');
  d=make('terrain-arcane','霊脈',64,'terrain');hex(d,'#675489','#9b8db6','#3a385c');
  d.poly([[11,37],[24,29],[47,30],[54,41],[36,48],[18,45]],'#423857');d.line(14,38,26,41,'#72b8ca',2);d.line(26,41,43,33,'#72b8ca',2);
  crystal(d,23,32,6,12);crystal(d,37,30,7,21);crystal(d,46,38,5,10);d.rect(15,29,2,2,'#d6e9e6');d.rect(47,21,2,2,'#d6e9e6');
  d=make('terrain-void','虚無',64,'terrain');hex(d,'#29323f','#596071','#161f2c');
  d.poly([[10,20],[25,15],[29,27],[23,35],[12,39]],'#3c4452');d.poly([[35,13],[51,21],[48,35],[40,29]],'#444659');
  d.poly([[21,42],[28,32],[37,37],[42,47],[32,53]],'#354353');d.poly([[31,14],[28,28],[36,34],[28,45],[33,51],[33,42],[42,34],[33,26]],'#101b29');
  d.line(28,28,35,34,'#71617b');d.rect(20,27,2,2,'#6f7484');
  d=make('building-city','都市',48,'building');d.ellipse(5,37,38,8,'#172b29');d.layer('structure','石壁と屋根');
  d.rect(7,21,10,20,ink);d.rect(31,21,10,20,ink);d.rect(15,18,18,24,ink);d.rect(8,21,7,17,stone);d.rect(32,21,7,17,stone);d.rect(17,20,14,20,'#aab4a7');
  d.poly([[5,21],[11,10],[19,21]],'#474f5b');d.poly([[7,19],[11,12],[14,19]],'#ac6660');d.poly([[29,21],[36,10],[43,21]],'#474f5b');d.poly([[31,19],[36,12],[38,19]],'#ac6660');
  d.rect(20,7,8,13,ink);d.rect(21,8,6,11,'#aab4a7');d.poly([[18,9],[24,2],[30,9]],'#754c4e');d.line(23,4,20,8,'#c3866c');
  d.rect(12,31,25,11,ink);d.rect(13,32,23,8,stone);for(const x of[13,19,25,31])d.rect(x,29,4,4,'#bbc2ac');
  d.layer('detail','窓と門');d.rect(10,25,3,6,'#374148');d.rect(35,25,3,6,'#374148');d.rect(23,11,2,4,'#374148');d.ellipse(20,33,8,8,ink);d.rect(20,37,8,4,ink);d.rect(22,35,4,6,'#775c45');d.line(24,35,24,40,'#b29162');
  d=make('building-monument','モニュメント',48,'building');d.ellipse(7,37,34,7,'#203633');d.layer('stone','石碑と台座');
  d.rect(8,36,32,7,ink);d.rect(10,36,28,4,stone);d.rect(13,31,22,6,ink);d.rect(15,31,18,4,'#abb8a6');
  d.poly([[19,10],[24,3],[30,10],[30,32],[19,32]],ink);d.poly([[21,11],[24,6],[25,12],[25,30],[21,30]],'#bcc3ae');d.poly([[25,9],[28,12],[28,30],[25,30]],'#708780');
  d.layer('rune','彫刻');d.rect(22,16,3,2,gold);d.line(23,17,23,23,gold);d.line(21,21,25,21,gold);d.rect(20,29,8,1,'#d8d8b8');
  d=make('unit-warrior','戦士',48,'unit');d.ellipse(8,39,32,6,'#213932');d.layer('body','戦士の装備');
  d.poly([[17,19],[30,19],[35,37],[14,38]],'#713f45');d.rect(18,29,7,11,ink);d.rect(26,29,7,11,ink);d.rect(16,39,9,4,'#433d36');d.rect(27,39,9,4,'#433d36');
  d.rect(18,18,15,14,ink);d.rect(20,19,10,11,stone);d.line(21,20,27,20,pale);d.rect(20,30,10,3,'#785942');d.rect(24,30,3,2,gold);
  d.ellipse(17,4,17,15,ink);d.ellipse(19,5,13,12,'#9baea7');d.rect(19,12,14,5,'#414b4b');d.rect(24,11,3,7,'#c4d0b5');d.rect(20,13,3,2,'#182b32');d.rect(28,13,3,2,'#182b32');d.rect(23,3,6,3,'#a86253');
  d.poly([[7,20],[17,17],[20,22],[18,33],[13,38],[7,31]],ink);d.poly([[9,22],[16,20],[17,23],[15,32],[13,34],[9,30]],'#687c70');d.line(13,23,13,30,gold,2);d.line(10,26,16,26,gold);
  d.layer('weapon','剣と握り');d.line(36,9,35,29,ink,4);d.line(36,10,36,26,'#d7dfca',2);d.line(33,28,39,28,gold,2);d.rect(34,30,3,5,'#b78f68');d.rect(36,35,2,2,gold);
  const icon=(key,title)=>{const x=make('icon-'+key,title,24,'icon');x.layer('symbol','資源の紋章');return x;};
  d=icon('food','食料');d.line(10,21,13,4,'#735a32',2);for(const [x,y]of[[9,7],[8,12],[9,17]]){d.poly([[x,y],[x-3,y-3],[x-3,y+1],[x+2,y+3]],'#d9b75c');d.poly([[x+4,y-1],[x+8,y-5],[x+8,y],[x+3,y+3]],'#f0d183');}d.line(13,5,13,2,pale);
  d=icon('production','生産');d.rect(3,17,18,3,ink);d.poly([[5,15],[19,15],[16,18],[8,18]],'#98aaa5');d.rect(9,18,7,3,'#788c85');d.line(9,15,16,5,'#9c7751',3);d.poly([[8,5],[12,2],[20,8],[17,12]],ink);d.poly([[10,5],[12,4],[18,9],[17,10]],'#c4cec1');
  d=icon('gold','Gold');d.ellipse(3,3,18,18,'#624f35');d.ellipse(4,3,16,16,'#ddb867');d.ellipse(7,5,10,11,'#b68644');d.line(8,5,13,5,'#f4df9d');d.line(12,7,12,15,'#f4df9d',2);d.line(9,10,15,10,'#f4df9d');d.line(9,13,15,13,'#f4df9d');
  d=icon('science','科学');d.poly([[2,5],[9,3],[12,5],[16,3],[22,5],[22,20],[14,18],[12,20],[9,18],[2,20]],ink);d.poly([[4,6],[9,5],[11,7],[11,17],[9,16],[4,17]],'#dfd3a4');d.poly([[13,7],[16,5],[20,6],[20,17],[16,16],[13,17]],'#b9c4a3');for(const y of[8,11,14]){d.line(5,y,9,y,'#9a926e');d.line(15,y,19,y,'#82967f');}
  d=icon('mana','mana');crystal(d,12,13,8,11);d.line(3,4,5,4,'#e3f6ed');d.line(4,3,4,5,'#e3f6ed');
  d=icon('religion','宗教');d.ellipse(4,1,16,16,'#756246');d.ellipse(6,3,12,12,'#ddbf79');d.ellipse(8,5,8,8,'#253c3d');d.poly([[12,3],[16,10],[13,13],[10,11]],'#efcd78');d.rect(10,12,5,7,pale);d.rect(7,19,12,3,'#9b8152');
  d=icon('culture','文化');d.line(4,3,8,18,gold,3);d.line(19,3,15,18,gold,3);d.rect(6,3,15,3,'#e1c985');d.ellipse(6,15,12,7,'#9d7749');d.rect(8,16,8,3,gold);for(const x of[9,12,15])d.line(x,7,x,15,'#f0dba1');
  d=icon('popular-support','人心');d.ellipse(2,6,6,6,'#7c9b8b');d.ellipse(16,6,6,6,'#7c9b8b');d.ellipse(1,13,9,8,'#4a756c');d.ellipse(14,13,9,8,'#4a756c');d.ellipse(8,3,8,8,'#e1bb76');d.ellipse(6,12,12,10,'#c39353');d.line(9,14,14,14,'#f1d59a');
  return all;
}
