import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {prepareWatchGeometry,nearbyWatchpoints} from '../site/lib/watch-proximity.js';
import {validateBriefingContext,correlateBriefingContext,briefingDateRelation} from '../site/lib/briefing-context-model.js';
import {briefingImpacts} from '../site/lib/briefing-impact-model.js';
import {planningPoints} from '../site/lib/planning-model.js';
const json=async name=>JSON.parse(await readFile(new URL('../site/data/'+name+'.json',import.meta.url),'utf8'));
const [associations,register,snapshot,areas,gauges,reservoirs]=await Promise.all(['briefing-river-context','hanford-briefing-impacts','hanford-briefing','river-areas','river-watchlist','reservoir-watchlist'].map(json));
const now=Date.parse('2026-10-19T23:00:00Z'),known=structuredClone(snapshot);known.document.sha256=register.documents.find(d=>d.kind==='latest').sha256;known.checkedAt=known.lastSuccessAt=new Date(now).toISOString();for(const k of ['sourceUpdatedAt','collectedAt','fileModifiedAt'])known.document[k]=new Date(now-3600000).toISOString();
const points=planningPoints(areas,gauges.stations,reservoirs.stations),briefing=briefingImpacts(register,known,now);
const planning={points,rows:areas.areas.map(area=>({area,status:'Review evidence',riverReview:area.id==='san-joaquin-lower',gaps:[]}))};
const point=points.find(p=>p.id==='MIL'),geometry={x:point.longitude,y:point.latitude,spatialReference:{wkid:4326}};
const road=(key,extra={})=>({key,name:key,geometry,active:'yes',issues:[],status:'Published active',start:Date.parse('2026-10-21T12:00:00Z'),end:Date.parse('2026-10-23T00:00:00Z'),...extra});
const facility={site:{key:'private-site',name:'Private county facility',geometry,fetched:now,backup:null},active:[],followup:false};
const input={associations,briefing,planning,roads:{snapshot:{checked:now,rows:[road('A')]},error:null},facilities:{connected:true,sites:[facility]},radiusKm:5};
const lower=result=>result.groups.find(g=>g.id==='san-joaquin-lower');

test('spherical proximity uses meters, segment interiors, multipart separation and polygon holes',()=>{
  const p=[{id:'P',longitude:0,latitude:0}];assert(Math.abs(nearbyWatchpoints(prepareWatchGeometry({x:0,y:1}),p).meters-111195.08)<1);
  assert(nearbyWatchpoints(prepareWatchGeometry({paths:[[[-1,0],[1,0]]]}),p).meters<0.001);
  assert(nearbyWatchpoints(prepareWatchGeometry({paths:[[[-2,0],[-1,0]],[[1,0],[2,0]]]}),p).meters>111000);
  const outer=[[-1,-1],[1,-1],[1,1],[-1,1],[-1,-1]],hole=[[-.1,-.1],[-.1,.1],[.1,.1],[.1,-.1],[-.1,-.1]];
  assert.equal(nearbyWatchpoints(prepareWatchGeometry({rings:[outer]}),p).meters,0);
  assert(nearbyWatchpoints(prepareWatchGeometry({rings:[outer,hole]}),p).meters>11000);
  assert.equal(nearbyWatchpoints(prepareWatchGeometry({x:0,y:0}),[]),null);
});
test('projected, null, open-ring and malformed geometries are rejected, not silently reprojected',()=>{
  for(const g of [null,{x:0,y:0,spatialReference:{wkid:3857}},{x:NaN,y:0},{paths:[[[0,0],[181,0]]]},{rings:[[[0,0],[1,1],[2,2],[3,3]]]}])assert.throws(()=>prepareWatchGeometry(g));
});
test('coarse proximity pruning agrees with full distances around Fresno, including segments across a lookup circle',()=>{
  const ps=[{id:'F',longitude:-119.7,latitude:36.9}];
  for(const g of [{x:-119.7,y:36.9},{x:-120.7,y:37.9},{paths:[[[-120,36.9],[-119.4,36.9]]]},{rings:[[[-119.8,36.8],[-119.6,36.8],[-119.6,37],[-119.8,37],[-119.8,36.8]]]}]){
    const prep=prepareWatchGeometry(g),full=nearbyWatchpoints(prep,ps),fast=nearbyWatchpoints(prep,ps,5000);if(full.meters<=5000)assert.equal(fast.meters,full.meters);else assert(!fast||fast.meters>5000);
  }
});
test('regional associations bind to reviewed revisions; high Sierra stays headwater context',()=>{
  validateBriefingContext(associations);const result=correlateBriefingContext(input,now);assert.equal(result.groups.length,6);assert(lower(result).contextReview);
  const snow=result.groups.find(g=>g.id==='kings-upper').impacts.find(i=>i.id==='fresno-high-sierra-snow');assert.equal(snow.association.relation,'headwater-context');assert.match(snow.association.note,/not assumed above/);
  const changed=structuredClone(input);changed.briefing.rows.forEach(i=>i.document.sha256='a'.repeat(64));const r=correlateBriefingContext(changed,now);assert(r.groups.every(g=>g.impacts.length===0));assert(r.unassociated>0);
});
test('nearby records are deduplicated and independent of topic filters or map extent',()=>{
  const base=lower(correlateBriefingContext({...input,mapExtent:[0,0,1,1],filter:'all'},now));assert.equal(base.roads.length,1);assert.equal(base.facilities.length,1);assert.equal(base.facilities[0].row.site.backup,null);
  const duplicated={...input,roads:{snapshot:{checked:now,rows:[road('A'),road('A')]}},facilities:{connected:true,sites:[facility,facility]}};
  const r=lower(correlateBriefingContext(duplicated,now));assert.equal(r.roads.length,1);assert.equal(r.facilities.length,1);
});
test('lookup distance changes associations without becoming a hazard or travel-time boundary',()=>{
  const g={x:geometry.x,y:geometry.y+.02};const r={...input,roads:{snapshot:{checked:now,rows:[road('A',{geometry:g})]}}};
  assert.equal(lower(correlateBriefingContext({...r,radiusKm:1},now)).roads.length,0);assert.equal(lower(correlateBriefingContext({...r,radiusKm:5},now)).roads.length,1);
  assert.throws(()=>correlateBriefingContext({...input,radiusKm:100},now));
});
test('inactive history is explicit; an elapsed active flag remains verification, never reopening',()=>{
  const r={...input,roads:{snapshot:{checked:now,rows:[road('old',{end:now-1,issues:['End elapsed']}),road('inactive',{active:'no'})]}}};
  const found=lower(correlateBriefingContext(r,now));assert.equal(found.roads.length,1);assert(found.roads[0].verification);assert.equal(found.roads[0].row.active,'yes');
  const history=lower(correlateBriefingContext({...r,history:true},now));assert.equal(history.roads.length,2);assert(history.roads.find(i=>i.row.key==='inactive').history);
});
test('failed / stale road and asset feeds remain qualified and missing geometry is counted',()=>{
  const r={...input,roads:{error:'failed',snapshot:{checked:now-500000,rows:[road('A'),road('missing',{geometry:null})]}},facilities:{connected:true,sites:[{...facility,site:{...facility.site,fetched:now-700000}}],sourceGaps:1}};
  const found=correlateBriefingContext(r,now);assert.equal(found.roadCurrent,false);assert.equal(found.roadRejected,1);assert.equal(found.facilityGaps,1);assert.equal(lower(found).facilities[0].siteCurrent,false);assert(lower(found).roads[0].verification);
});
test('disconnect / expired authorization removes private assets even if an old caller still supplies rows',()=>{
  const r=correlateBriefingContext({...input,facilities:{connected:false,sites:[facility]}},now);assert(r.groups.every(g=>g.facilities.length===0));assert(!JSON.stringify(r).includes('Private county facility'));
});
test('calendar overlap is qualified and missing or contradictory dates never imply simultaneity',()=>{
  const b=briefing.rows.filter(i=>i.id==='fresno-valley-rain');assert.match(briefingDateRelation(Date.parse('2026-10-21T07:00:00Z'),Date.parse('2026-10-23T06:59:59Z'),b),/dates intersect/);
  assert.match(briefingDateRelation(null,now,b),/unknown/);assert.match(briefingDateRelation(now,now-1,b),/contradictory/);assert.match(briefingDateRelation(now-10000,now,b),/do not intersect/);assert.match(briefingDateRelation(now,now,[]),/No current/);
});
test('dated / past / stale briefing context cannot become a current combined review cue',()=>{
  for(const change of [i=>i.document.kind='archive',i=>i.period='past',i=>i.qualification='Source check overdue']){const b=structuredClone(briefing);b.rows.forEach(change);const r=correlateBriefingContext({...input,briefing:b},now);assert(r.groups.every(g=>!g.contextReview&&g.current.length===0));}
});
test('invalid association IDs, duplicate edges and missing source identity fail closed',()=>{
  for(const change of [r=>r.associations[0].areas.push('unknown'),r=>r.associations.push(r.associations[0]),r=>r.associations[0].sha256='',r=>r.associations[0].relation='inundation']){const r=structuredClone(associations);change(r);assert.throws(()=>validateBriefingContext(r));}
});
