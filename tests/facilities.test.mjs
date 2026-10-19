import test from 'node:test';
import assert from 'node:assert/strict';
import {assessFacilities,facilityExercise,facilityFields,facilityService,normalizeFacility} from '../site/lib/facility-model.js';
import {queryFacilities,openFacilitySource} from '../site/lib/facility-data.js';
import {powerExercise} from '../site/lib/power-exercise.js';
import {FACILITY_PRESETS} from '../site/lib/facility-presets.js';

const now=Date.parse('2026-10-18T21:00:00Z');
const url='https://services3.arcgis.com/ibgDyuD2DLBge82s/arcgis/rest/services/Test_Fictional_Sites/FeatureServer/0';
const metadata={name:'EXERCISE',geometryType:'esriGeometryPoint',objectIdField:'OBJECTID',fields:[{name:'OBJECTID',type:'esriFieldTypeOID'},{name:'GlobalID',type:'esriFieldTypeGlobalID'},{name:'Name',type:'esriFieldTypeString'},{name:'Backup',type:'esriFieldTypeInteger',domain:{codedValues:[{code:1,name:'Generator listed'}]}},{name:'Updated',type:'esriFieldTypeDate'}]};
const source={url,kind:'Pump station',title:'EXERCISE',fields:{id:'GlobalID',name:'Name',backup:'Backup',updated:'Updated'},lastSuccess:now};
const county={geometry:{type:'Polygon',coordinates:[[[-120,36],[-119,36],[-119,37.5],[-120,37.5],[-120,36]]]}};
const feature=(id=1,x=-119.7)=>({attributes:{OBJECTID:id,GlobalID:`test-${id}`,Name:'EXERCISE',Backup:1,Updated:now},geometry:{x,y:36.9}});
const queryResult=features=>({spatialReference:{wkid:4326},features});
const power=(scenario='watch')=>{const p=powerExercise(scenario,now);return {feeds:p.feeds,rows:p.feeds.flatMap(f=>f.rows)};};

test('site matches flag polygon overlaps, not point proximity, and count sites once',()=>{
  const p=power(),sites=facilityExercise(now),a=assessFacilities(sites,p.rows,p.feeds,undefined,now);
  assert.equal(a.overlap,3);assert.equal(a.review,3);assert.equal(a.unknownBackup,2);
  assert.equal(a.sites.find(r=>r.site.id==='F2').label,'No published area match');
  const point={...p.rows[0],key:'point',geometries:[sites[3].geometry],status:'outage'};
  const b=assessFacilities(sites,[...p.rows,point],p.feeds,undefined,now);
  assert.equal(b.pointOnly,1);assert.equal(b.overlap,3);assert.equal(b.sites.find(r=>r.site.id==='F2').review,false);
  assert.equal(assessFacilities([...sites,sites[0]],p.rows,p.feeds,undefined,now).overlap,3);
});
test('one site overlapping several records is one review; a generator listing does not suppress it',()=>{
  const p=power(),site=facilityExercise(now)[1],extra={...p.rows[0],key:'different-warning'};
  const a=assessFacilities([site],[...p.rows,extra],p.feeds,undefined,now);
  assert.equal(a.review,1);assert.equal(a.sites[0].matches.length,2);assert.equal(a.sites[0].tone,'watch');assert.match(a.sites[0].next,/verify backup/);
});
test('holes are not matched, and polygon boundaries are conservative review matches',()=>{
  const p=power(),row={...p.rows[0],geometries:[{rings:[[[0,0],[10,0],[10,10],[0,10],[0,0]],[[2,2],[2,8],[8,8],[8,2],[2,2]]]}]};
  const site={...facilityExercise(now)[0],geometry:{x:5,y:5}};
  assert.equal(assessFacilities([site],[row],p.feeds,undefined,now).overlap,0);
  assert.equal(assessFacilities([{...site,geometry:{x:2,y:5}}],[row],p.feeds,undefined,now).overlap,1);
});
test('building footprints use full polygon intersections rather than a centroid substitute',()=>{
  const p=power(),base=facilityExercise(now)[0];
  const geometry={rings:[[[-119.8,36.88],[-119.69,36.88],[-119.69,36.91],[-119.8,36.91],[-119.8,36.88]]],spatialReference:{wkid:4326}};
  const a=assessFacilities([{...base,geometry}],p.rows,p.feeds,undefined,now);assert.equal(a.overlap,1);
  const outside={rings:[[[-120,36.1],[-119.9,36.1],[-119.9,36.2],[-120,36.2],[-120,36.1]]],spatialReference:{wkid:4326}};
  assert.equal(assessFacilities([{...base,geometry:outside}],p.rows,p.feeds,undefined,now).overlap,0);
});
test('stale utility or site evidence produces verification, never a fresh outage claim',()=>{
  const p=power('failure'),site=facilityExercise(now)[0];
  assert.equal(assessFacilities([site],p.rows,p.feeds,undefined,now).sites[0].tone,'verify');
  const fresh=power();assert.equal(assessFacilities([{...site,fetched:now-3600000}],fresh.rows,fresh.feeds,undefined,now).sites[0].tone,'verify');
  assert.equal(assessFacilities([site],[],[],undefined,now).sites[0].label,'Match incomplete');
});
test('removed footprints preserve follow-up; utility restoration is not confirmed site restoration',()=>{
  const p=power(),sites=facilityExercise(now),before=assessFacilities(sites,p.rows,p.feeds,undefined,now),prior=new Map(before.sites.map(r=>[r.site.key,r]));
  const after=assessFacilities(sites,[],p.feeds,prior,now);assert.equal(after.review,3);assert.equal(after.overlap,0);assert(after.sites.find(r=>r.site.id==='F1').followup);
  const restored=power('restored'),a=assessFacilities(sites,restored.rows,restored.feeds,prior,now);assert.equal(a.overlap,0);assert.equal(a.review,3);assert.match(a.sites[0].label,/verification/);
});
test('only county service paths are accepted, with no tokens, embedded credentials or redirects',()=>{
  assert.equal(facilityService(url),url);
  for(const unsafe of [url+'?token=secret',url+'#secret',url.replace('https:','http:'),url.replace('ibgDyuD2DLBge82s','anotherOrg'),url.replace('services3.arcgis.com','services3.arcgis.com.example.org'),url.replace('services3.','name:password@services3.'),'https://example.org/FeatureServer/0']) assert.throws(()=>facilityService(unsafe));
});
test('mapping requires a stable identity and point geometry',()=>{
  assert.throws(()=>facilityFields(metadata,{id:'OBJECTID',name:'Name'}),/stable/);
  assert.throws(()=>facilityFields(metadata,{id:'GlobalID',name:'notThere'}),/name field/);
  assert.throws(()=>facilityFields({...metadata,geometryType:'esriGeometryPolyline'},source.fields),/point/);
  assert.deepEqual(facilityFields(metadata,source.fields),['OBJECTID','GlobalID','Name','Backup','Updated']);
  const s=normalizeFacility(feature(),source,metadata);assert.equal(s.backup,'Generator listed');assert.equal(s.updated,now);
  const f=feature();f.attributes.Backup=null;assert.equal(normalizeFacility(f,source,metadata).backup,null);
});
test('site collection accounts for invalid locations and outside-county points',async()=>{
  const invalid=feature(3);invalid.geometry=null;const features=[feature(),feature(2,-118),invalid];
  const data=await queryFacilities(source,metadata,async p=>p.returnIdsOnly?{objectIds:[1,2,3]}:queryResult(features),county);
  assert.equal(data.rows.length,1);assert.deepEqual(data.accounting,{returned:3,inCounty:1,outsideCounty:1,rejected:1});
});
test('inventory, CRS, truncation and duplicate identities fail closed',async()=>{
  for(const batch of [{...queryResult([feature()]),exceededTransferLimit:true},{...queryResult([feature()]),spatialReference:{wkid:3857}},queryResult([]),queryResult([feature(9)])])await assert.rejects(()=>queryFacilities(source,metadata,async p=>p.returnIdsOnly?{objectIds:[1]}:batch,county),/incomplete/);
  const a=feature(),b=feature(2);b.attributes.GlobalID=a.attributes.GlobalID;
  await assert.rejects(()=>queryFacilities(source,metadata,async p=>p.returnIdsOnly?{objectIds:[1,2]}:queryResult([a,b]),county),/duplicated/);
  await assert.rejects(()=>queryFacilities(source,metadata,async()=>({objectIds:Array.from({length:5001},(_,i)=>i)}),county),/smaller county view/);
});
test('null inventories need zero-count confirmation',async()=>{
  const data=await queryFacilities(source,metadata,async p=>p.returnIdsOnly?{objectIds:null}:{count:0},county);assert.equal(data.rows.length,0);
  await assert.rejects(()=>queryFacilities(source,metadata,async p=>p.returnIdsOnly?{objectIds:null}:{count:1},county),/reconciled/);
});
test('private adapter rejects signed-out or foreign accounts before making requests',async()=>{
  const sdk=async()=>{throw new Error('Network must not run');};
  await assert.rejects(()=>openFacilitySource(url,null,sdk),/Sign in/);
  await assert.rejects(()=>openFacilitySource(url,{portal:{id:'anotherOrg'}},sdk),/Sign in/);
});
test('county adapter uses authenticated POST queries and aborts requests on close',async()=>{
  const calls=[];let resolveRequest;
  const request=async (u,options)=>{calls.push({u,options});if(calls.length===1)return {data:metadata};return new Promise(resolve=>{resolveRequest=resolve;});};
  const adapter=await openFacilitySource(url,{portal:{id:'ibgDyuD2DLBge82s'}},async()=>({import:async()=>[request]}));
  const task=adapter.query({returnIdsOnly:true});adapter.close();assert(calls[1].options.signal.aborted);resolveRequest({data:{objectIds:[1]}});await assert.rejects(()=>task,/unavailable/);
  assert(calls.every(c=>c.options.method==='post'&&c.options.cacheBust&&!c.u.includes('?')));
  await assert.rejects(()=>adapter.query({}),/connection ended/);
});
test('single-layer service roots resolve their published ID without assuming layer zero',async()=>{
  const root=url.replace('/0',''),calls=[];
  const request=async (u)=>{calls.push(u);return {data:calls.length===1?{layers:[{id:7,name:'Sites',geometryType:'esriGeometryPoint'}]}:metadata};};
  const adapter=await openFacilitySource(root,{portal:{id:'ibgDyuD2DLBge82s'}},async()=>({import:async()=>[request]}));
  assert.equal(adapter.url,root+'/7');assert.deepEqual(calls,[root,root+'/7']);adapter.close();
});

test('denied or expired service access is distinguished from temporary feed failures',async()=>{
  for(const error of [{code:499},{details:{httpStatus:403}},{details:{raw:{error:{code:498}}}},{name:'identity-manager:user-aborted'}]) {
    const request=async()=>{throw error;};
    await assert.rejects(()=>openFacilitySource(url,{portal:{id:'ibgDyuD2DLBge82s'}},async()=>({import:async()=>[request]})),e=>e.accessDenied===true);
  }
  const request=async()=>{throw {details:{httpStatus:503}};};
  await assert.rejects(()=>openFacilitySource(url,{portal:{id:'ibgDyuD2DLBge82s'}},async()=>({import:async()=>[request]})),e=>e.accessDenied===false);
});

test('fuel assets are separate review records and cannot establish facility backup power',()=>{
  const preset=FACILITY_PRESETS.find(p=>p.id==='generators'),p=power();
  assert.equal(preset.fields.id,'globalid');assert.equal(preset.fields.backup,undefined);assert.equal(preset.fields.runtime,undefined);
  const sites=facilityExercise(now).slice(0,1),asset={...sites[0],key:'fuel-asset',id:'fuel-asset',kind:preset.kind};
  const result=assessFacilities([...sites,asset],p.rows,p.feeds,undefined,now);
  assert.equal(result.review,2);assert.equal(result.unknownBackup,1);assert.equal(result.sites.find(r=>r.site.id===sites[0].id).site.backup,null);
  assert.match(result.sites.find(r=>r.site.id==='fuel-asset').next,/facility served/);
});
