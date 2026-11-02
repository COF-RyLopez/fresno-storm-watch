import test from 'node:test';
import assert from 'node:assert/strict';
import {buildPaths,snapPoints,km} from '../scripts/build-river-network.mjs';
import {indexNetwork,routeSlice,surgeFrames,surgeSources,SURGE_CONFIG} from '../site/lib/river-network-model.js';
import {siteJson} from '../scripts/lib/snapshot-io.mjs';

const H=3_600_000,box=[[[-121,36],[-118,36],[-118,38],[-121,38],[-121,36]]];
// Two levelpaths along latitude 37: A flows east (upstream at -120.2) into B; one A segment sits after a gap.
const seg=(lp,hs,dnhs,x0,x1,pathlength,extra={})=>({levelpath:lp,hydrosequence:hs,dnhydrosequence:dnhs,streamorder:5,gnisidlabel:null,lengthkm:km([x0,37],[x1,37]),pathlength,terminalflag:0,coords:[[x0,37],[x1,37]],...extra});

test('buildPaths chains segments upstream→downstream, splits gaps, links downstream paths and drops paths outside the county',()=>{
  const segs=[seg(1,30,20,-120.1,-120.0,20,{gnisidlabel:'Alpha Creek'}),seg(1,40,30,-120.2,-120.1,29),seg(1,10,5,-119.9,-119.85,12),seg(2,5,0,-119.85,-119.8,0,{streamorder:6,terminalflag:1}),
    seg(3,99,98,-130,-129.9,1)];
  const paths=buildPaths(segs,box),[b,a]=paths;
  assert.deepEqual(paths.map(p=>p.id),['2','1']);
  assert.equal(a.name,'Alpha Creek');assert.equal(a.dn,'2');assert.equal(b.dn,null);
  assert.equal(a.parts.length,2,'the jump from -120.0 to -119.9 starts a new part');
  assert.deepEqual(a.parts[0].c,[[-120.2,37],[-120.1,37],[-120,37]]);assert.equal(a.parts[0].end,20);assert.equal(a.parts[1].end,12);
});

test('snapPoints prefers the named river over a closer tributary and records km to the terminal',()=>{
  const paths=buildPaths([seg(1,30,20,-120.1,-120.0,10,{gnisidlabel:'San Joaquin River'}),seg(2,31,30,-120.05,-120.05001,15,{gnisidlabel:'Tiny Creek'})],box);
  paths[1].parts[0].c=[[-120.05,37.0002],[-120.0501,37.0002]];
  const [p,far]=snapPoints([{id:'G',kind:'nwps',name:'San Joaquin River near X',longitude:-120.05,latitude:37.0003},{id:'F',kind:'usgs',name:'Far',longitude:-119,latitude:37.5}],paths);
  assert.equal(p.path,'1');assert(Math.abs(p.km-(10+km([-120.05,37],[-120,37])))<0.01);
  assert.deepEqual([far.path,far.km],[null,null]);
});

const net=()=>indexNetwork({version:1,paths:[
  {id:'A',name:'A',order:5,dn:'B',parts:[{c:[[-120.2,37],[-120.1,37]],end:10}]},
  {id:'B',name:'B',order:6,dn:null,parts:[{c:[[-120.1,37],[-120.0,37]],end:0}]}],points:[{id:'G',path:'A',km:15,name:'Gauge on A'}]});
const len=km([-120.2,37],[-120.1,37]); // ~8.9 km per part

test('routeSlice follows the downstream link with distance-to-terminal continuous across the confluence',()=>{
  const n=net(),lines=routeSlice(n,'A',12,5);
  assert.equal(lines.length,2);assert.deepEqual(lines[0].at(-1),[-120.1,37]);assert.deepEqual(lines[1][0],[-120.1,37]);
  assert(Math.abs(lines[0][0][0]-(-120.2+(10+len-12)/len*0.1))<1e-6);
  assert(Math.abs(lines[1].at(-1)[0]-(-120.1+(len-5)/km([-120.1,37],[-120,37])*0.1))<1e-6);
  assert.deepEqual(routeSlice(n,'A',3,3),[]);
});

test('surgeFrames: nothing before the start, moves at the assumed speed, and is flagged once it leaves the mapped network',()=>{
  const n=net(),src=[{key:'observed:G',id:'G',kind:'observed',t0:0,path:'A',km:15}];
  assert.deepEqual(surgeFrames(n,src,-1),[]);
  const [start]=surgeFrames(n,src,0);assert.equal(start.lines.length,0);assert.equal(start.left,false);
  const [f]=surgeFrames(n,src,2*H);assert.equal(f.front,15-2*SURGE_CONFIG.speedKmh);assert(f.lines.length>=1);
  const [gone]=surgeFrames(n,src,100*H);assert.equal(gone.left,true);
});

test('surgeSources: gauges rising 0.2 ft/h+, published forecast crests ahead, rising USGS sites; snapped points only',()=>{
  const n=indexNetwork({version:1,paths:[{id:'A',order:5,dn:null,parts:[{c:[[-120.2,37],[-120.1,37]],end:0}]}],points:[{id:'R',path:'A',km:5,name:'R'},{id:'S',path:'A',km:6,name:'S'},{id:'U',path:'A',km:4,name:'U'},{id:'X',path:null,km:null,name:'X'}]});
  const g=(id,delta,extra={})=>({id,gauge:{observed:{units:'ft'},forecast:{units:'ft'}},assessment:{trend:{delta,hours:2.5},observed:{time:1000},peak:null,delta:0,forecastUsable:false,...extra}});
  const areas=[{gauges:[g('R',0.5),g('S',0.4,{peak:{time:5*H,value:9},delta:1,forecastUsable:true}),g('X',2)]},{gauges:[g('R',0.5)]}];
  const usgs={readings:new Map([['U',{stage:{time:2000},rise:{rate:0.3}}],['S',{stage:{time:1},rise:{rate:0.1}}]])};
  const s=surgeSources({areas,usgs,net:n,now:H});
  assert.deepEqual(s.map(x=>x.key),['observed:R','forecast:S','observed:U']);
  assert.equal(s[1].t0,5*H);assert.match(s[0].label,/Rising 0\.20 ft\/h/);
});

test('published network: valid, routable, and every app gauge and dam snapped within 0.5 km',async()=>{
  const doc=await siteJson('river-network.json'),n=indexNetwork(doc);
  assert(n.paths.size>500);assert.equal(doc.source,'https://3dhp.nationalmap.gov/arcgis/rest/services/usgs_3dhp_all/MapServer/50');
  for(const p of n.paths.values())if(p.dn)assert(n.paths.has(p.dn),`dangling dn ${p.dn}`);
  const [rivers,usgs,dams]=await Promise.all(['river-watchlist.json','usgs-watchlist.json','reservoir-watchlist.json'].map(siteJson));
  const ids=[...rivers.stations.map(s=>s.id),...usgs.sites.map(s=>s.site),...dams.stations.map(s=>s.id)];
  for(const id of ids){const pt=n.points.get(id);assert(pt?.path&&n.paths.has(pt.path)&&pt.offsetKm<=0.5,id);}
  // San Joaquin order, upstream to downstream, on one path: Redinger → Millerton → Friant → Hwy 41 → Hwy 145 → Gravelly Ford → Mendota.
  const sj=['RJQC1','MIL','11251000','SJXC1','RSBC1','GVAC1','SJMC1'].map(id=>n.points.get(id));
  assert(sj.every(p=>p.path===sj[0].path));assert(sj.every((p,i)=>!i||p.km<sj[i-1].km));
  assert(n.points.get('MLPC1').km<n.points.get('PNF').km+5&&n.points.get('KREC1').km>n.points.get('PNF').km,'Kings: Trimmer above Pine Flat above Mill Creek gauge');
});

test('Google 3D tile credits: read asset.copyright from a GLB, ignore anything else, order by frequency',async()=>{
  const {glbCopyright,createCredits}=await import('../site/lib/google-tiles.js');
  const glb=copyright=>{const json=new TextEncoder().encode(JSON.stringify({asset:{version:'2.0',copyright}})),pad=(4-json.length%4)%4,len=json.length+pad,b=new ArrayBuffer(20+len),v=new DataView(b);
    v.setUint32(0,0x46546c67,true);v.setUint32(4,2,true);v.setUint32(8,20+len,true);v.setUint32(12,len,true);v.setUint32(16,0x4e4f534a,true);new Uint8Array(b,20).set(json);new Uint8Array(b,20+json.length).fill(32);return b;};
  assert.deepEqual(glbCopyright(glb('Data SIO, NOAA; Google;Airbus')),['Data SIO, NOAA','Google','Airbus']);
  assert.deepEqual(glbCopyright(new TextEncoder().encode('{"not":"glb"}').buffer),[]);assert.deepEqual(glbCopyright(new ArrayBuffer(4)),[]);
  const c=createCredits(2);c.add(['Google','Airbus']);c.add(['Google','Maxar']);assert.equal(c.line(),'Google; Airbus; Maxar');
  c.add(['Maxar']);assert.equal(c.line(),'Maxar; Google','oldest tile drops out of the rolling window');assert.equal(c.add([]),false);
});

test('forecast crests start a pulse only when at least 0.5 ft above the current stage; the timeline stretches to reach them',async()=>{
  const {timelineRange,startOffset}=await import('../site/lib/river-network-model.js');
  const n=indexNetwork({version:1,paths:[{id:'A',order:5,dn:null,parts:[{c:[[-120.2,37],[-120.1,37]],end:0}]}],points:[{id:'G',path:'A',km:5,name:'Gravelly'},{id:'J',path:'A',km:4,name:'James'},{id:'K',path:'A',km:3,name:'Kcfs'}]});
  const g=(id,delta,units='ft')=>({id,gauge:{observed:{units},forecast:{units}},assessment:{trend:null,observed:{time:0},peak:{time:30*H,value:7.6},delta,forecastUsable:true}});
  const s=surgeSources({areas:[{gauges:[g('G',0.03),g('J',0.8),g('K',2,'kcfs')]}],net:n,now:0});
  assert.deepEqual(s.map(x=>x.id),['J']);assert.equal(s[0].label,'Forecast crest 7.6 ft (+0.8 ft)');
  assert.deepEqual(timelineRange([],0),{min:-360,max:720});
  assert.deepEqual(timelineRange(s,0),{min:-360,max:(30+6)*60},'stretched to show the pulse moving for 6 h');
  assert.equal(timelineRange([{t0:200*H}],0).max,72*60,'capped');
  assert.equal(startOffset({t0:37*60_000},0),45);assert.equal(startOffset({t0:-10*60_000},0),0);
});

test('routeLine joins a downstream route into one line; profilePath scales samples into the chart box',async()=>{
  const {routeLine,profilePath}=await import('../site/lib/river-network-model.js');
  const line=routeLine(net(),'A',15,0);
  assert.deepEqual(line[0],routeSlice(net(),'A',15,0)[0][0]);assert.deepEqual(line.at(-1),[-120,37]);
  assert.equal(line.filter(c=>c[0]===-120.1&&c[1]===37).length,1,'the confluence vertex is not repeated');
  const p=profilePath([{distance:0,elevation:100},{distance:500,elevation:60},{distance:1000,elevation:50}],300,100);
  assert.equal(p.d,'M0.0 0.0L150.0 80.0L300.0 100.0');assert.deepEqual([p.maxD,p.lo,p.hi],[1000,50,100]);
  assert.equal(profilePath([{distance:0,elevation:1}],300,100),null);
});

test('frontKm uses measured reach speeds on their own path and the assumed speed elsewhere',async()=>{
  const {frontKm,reachSpeeds,speedNote}=await import('../site/lib/river-network-model.js');
  const travel=r=>({version:1,reaches:r.map(([path,kmFrom,kmTo,speedKmh])=>({path,kmFrom,kmTo,speedKmh,fromName:'X',toName:'Y'}))});
  const n=net();n.reaches=reachSpeeds(travel([['B',8,2,2]]));
  const s={path:'A',km:15};
  assert.equal(frontKm(n,s,1),11,'tributary A: assumed 4 km/h');
  assert(Math.abs(frontKm(n,s,2)-7.5)<1e-9,'15→10 on A (1.25 h), 10→8 on B at 4 km/h (0.5 h), then 0.25 h at the measured 2 km/h');
  n.reaches=reachSpeeds(travel([['B',14,9,1]]));assert.equal(frontKm(n,s,0.5),13,'a reach on B never applies while the pulse is still on A');
  assert.deepEqual(reachSpeeds(travel([['B',2,8,3],['B',8,2,0],['B',8,2,Number.NaN]])),[],'inverted, zero and missing speeds are dropped');
  assert.equal(reachSpeeds({version:2,reaches:[]}).length,0);
  n.reaches=reachSpeeds(travel([['B',8,2,2]]));assert.match(speedNote(n),/Measured gauge-to-gauge travel times on 1 San Joaquin reaches; assumed 2\.5 mph elsewhere/);
  n.reaches=[];assert.match(speedNote(n),/^Assumed 2\.5 mph travel/);
});
