import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {WORKSPACES,workspaceRoute,workspaceDefaults,workspaceMemory,layerVisible,unhealthyChecks} from '../site/lib/workspace-model.js';

test('seven focused defaults never start with an unrelated operational stack',()=>{
  assert.deepEqual(Object.keys(WORKSPACES),['watch','rivers','weather','reservoirs','alerts','power','roads']);
  assert.deepEqual(Object.entries(workspaceDefaults('roads').layers).filter(([,v])=>v).map(([k])=>k),['roads']);
  assert.equal(workspaceDefaults('weather').layers.wind,true);assert.equal(workspaceDefaults('weather').layers.weather,true);assert.equal(workspaceDefaults('weather').layers.power,false);
  for(const id of Object.keys(WORKSPACES)){const s=workspaceDefaults(id);assert.equal(s.mode,'2d');assert.equal(s.imagery,false);assert.equal(s.cameras,false);assert.equal(s.layers.fema,false);assert.equal(s.layers.buildings,false);}
});
test('saved tab preferences and viewpoints are isolated, remembered in memory, and reset for a new page',()=>{
  const m=workspaceMemory();m.activate('roads');const r=m.get('roads');r.imagery=true;r.mode='3d';r.viewpoint={scale:22000};r.layers.power=true;
  m.activate('weather');assert.equal(m.get('weather').imagery,false);assert.equal(m.get('weather').layers.power,false);assert.equal(m.get('weather').viewpoint,null);
  m.activate('roads');assert.equal(m.get('roads'),r);assert.equal(m.get('roads').viewpoint.scale,22000);assert.equal(workspaceMemory().get('roads').imagery,false);assert.throws(()=>m.get('unknown'));
});
test('eligibility refreshes cannot expose another topic and cannot override a failed selected layer',()=>{
  const weather=workspaceDefaults('weather');for(let i=0;i<3;i++)assert.equal(layerVisible(weather,'roads',true),false);
  weather.layers.roads=true;assert.equal(layerVisible(weather,'roads',true),true);assert.equal(layerVisible(weather,'roads',false),false);
  weather.layers.roads=false;assert.equal(layerVisible(weather,'roads',true),false);assert.equal(layerVisible(workspaceDefaults('roads'),'roads',true),true);
});
test('legacy conditions and release links, initial landing and canonical tab links resolve safely',()=>{
  assert.equal(workspaceRoute('/'),'watch');assert.equal(workspaceRoute('/?view=conditions&overlay=satellite'),'weather');assert.equal(workspaceRoute('/?view=environment'),'weather');
  for(const id of Object.keys(WORKSPACES))assert.equal(workspaceRoute('/?view='+id),id);
  assert.equal(workspaceRoute('/?view=conditions&trends=MIL'),'reservoirs');assert.equal(workspaceRoute('/?trends=PNF'),'reservoirs');assert.equal(workspaceRoute('/?trends=INVALID&view=roads'),'roads');assert.equal(workspaceRoute('/?view=INVALID'),'watch');
});
test('source issues count one check rather than repeated area associations and retain unknown/stale states',()=>{
  const checks=new Map();for(let i=0;i<6;i++)checks.set('cdec:MIL',{label:'Millerton',status:'stale'});
  checks.set('pge-psps',{label:'PG&E PSPS',status:'current'});checks.set('goes',{label:'GOES',status:'unknown'});assert.equal(unhealthyChecks(checks).length,2);assert.deepEqual(unhealthyChecks(checks).map(r=>r.label),['GOES','Millerton']);
});
test('Calcite shell retains unique live control ids and one pinned runtime after the split',async()=>{
  const html=await readFile(new URL('../site/index.html',import.meta.url),'utf8');const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);assert.equal(ids.length,new Set(ids).size,'DOM ids must remain unique');
  for(const id of Object.keys(WORKSPACES)){assert(ids.includes('tab-'+id));assert(ids.includes(WORKSPACES[id].panel));}
  for(const id of ['context-menu','map-tools-menu','camera-sheet','source-health-dialog','notify-areas','notify-alerts','notify-power','notify-health'])assert(ids.includes(id));
  assert.equal((html.match(/type="module" src="https:\/\/js.arcgis.com\/5.1\/"/g)||[]).length,1);assert(!html.includes('cdn.jsdelivr.net/npm/@esri/calcite'));
});
