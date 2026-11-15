import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {riverConcerns,roadConcerns,alertConcerns} from '../site/lib/command-data.js';
import {arcGeometry} from '../site/lib/command-model.js';
import {normalizeRoad} from '../site/lib/roads.js';

test('disjoint polygon islands and a hole keep their distinct topology',()=>{
 const a=[[0,0],[0,5],[5,5],[5,0],[0,0]],hole=[[1,1],[2,1],[2,2],[1,2],[1,1]],b=[[7,0],[7,2],[9,2],[9,0],[7,0]];
 const g=arcGeometry({rings:[hole,b,a]});assert.equal(g.type,'MultiPolygon');assert.equal(g.coordinates.length,2);assert.equal(g.coordinates[0].length,2);
});
test('NWS category and source revision survive; county filtering is fixed',()=>{
 const input={key:'a',type:'Winter Weather Advisory',category:'Advisory',counties:['Fresno'],office:'HNX',issued:10,onset:20,expires:30,signature:'revision2',sourceUrl:'https://weather.gov',geometries:[]};
 const a=alertConcerns([input,{...input,key:'b',counties:['Kings']}]);assert.equal(a.length,1);assert.equal(a[0].quality,'Official NWS Advisory');assert.equal(a[0].revision,'revision2');
});
test('elapsed road dates become one backlog item, never inferred open or current closure',()=>{
 const raw={attributes:{globalid:'A',blocknm:'Road A',active:'yes',enddate:1000},geometry:{x:-119,y:36}};
 const road=normalizeRoad(raw,1,2000),rows=roadConcerns({rows:[road]},null,2000);
 assert.equal(rows.find(r=>r.id===road.key).review,false);assert.equal(rows.find(r=>r.id==='roads:legacy-review').review,true);assert.match(rows[1].quality,/not confirmed/);
});
test('overview gauges and dams resolve to evidence; utility timestamps are numeric',async()=>{
 const bundle=JSON.parse(await readFile(new URL('../site/data/map-pilot-latest.json',import.meta.url),'utf8'));
 const result=riverConcerns(bundle,Date.parse(bundle.generatedAt)+60000);
 for(const f of result.features)assert.ok(result.rows.some(r=>r.id===f.properties.id),f.properties.name+' must select a concern');
 for(const r of result.rows.filter(r=>r.kind==='power'))assert.ok(r.time===null||Number.isFinite(r.time));
});
