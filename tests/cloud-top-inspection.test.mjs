import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {cloudTopReadout,installCloudTopInspection} from '../site/lib/cloud-top-inspection.js';
import {stubGlobals} from './helpers/dom.mjs';

test('height readout rounds source altitude and retains observation time, never labels missing height as zero',()=>{
 assert.match(cloudTopReadout(5500,Date.parse('2026-11-15T18:03:00Z')),/18,000 ft.*5\.5 km/);
 assert.match(cloudTopReadout(5500,Date.parse('2026-11-15T18:03:00Z')),/10:03 AM PST/);
 assert.match(cloudTopReadout(5500,Date.parse('2026-11-15T18:03:00Z')),/geopotential.*not height above terrain/i);
 for(const invalid of [null,NaN,-1,20001])assert.equal(cloudTopReadout(invalid,0),null);
 assert.equal(cloudTopReadout(1000,NaN),null);
});

test('tap inspects the rendered cloud, gives ground records priority, and clears outdated readings',()=>{
 const map=new EventEmitter(),canvas=new EventTarget();canvas.style={};canvas.clientWidth=600;canvas.clientHeight=400;
 map.getCanvas=()=>canvas;map.isMoving=()=>false;
 const popups=[],selected=[];let record=null,surface={pick:()=>({height:5500,lon:-119.5,lat:37})};
 class Popup{constructor(){popups.push(this);}setText(text){this.text=text;return this;}setLngLat(point){this.point=point;return this;}addTo(){this.open=true;return this;}isOpen(){return this.open;}remove(){this.open=false;}}
 const restore=stubGlobals({matchMedia:()=>({matches:true}),requestAnimationFrame:fn=>{fn();return 1;},cancelAnimationFrame(){}});
 try{
  const view=installCloudTopInspection({map,Popup,recordAt:()=>record,onSelect:r=>selected.push(r),getSurface:()=>surface,getMetadata:()=>({observedAt:Date.parse('2026-11-15T18:03Z')})});
  map.emit('click',{point:{x:30,y:30},lngLat:{lng:-119.4,lat:36.9}});
  assert.match(popups[1].text,/18,000 ft/);assert.equal(popups[1].open,true);
  map.unproject=()=>({lng:-119.4,lat:36.9});map.queryTerrainElevation=()=>1000;
  surface.pick=()=>({height:5500,lon:-119.5,lat:37,depth:.6});surface.projectDepth=()=>.3;
  map.emit('click',{point:{x:30,y:30},lngLat:{lng:-119.4,lat:36.9}});
  assert.equal(popups[1].open,false,'A cloud hidden behind nearer terrain must not produce a reading.');
  surface.projectDepth=()=>.9;
  map.emit('click',{point:{x:30,y:30},lngLat:{lng:-119.4,lat:36.9}});
  assert.equal(popups[1].open,true,'Visible clouds in front of terrain remain selectable.');
  record={name:'Gauge',hoverText:'Observed stage 11 ft\nRising · thresholds unknown',readout:'Gauge\nObserved stage 11 ft\nPublished thresholds unknown',key:'gauge'};
  map.emit('mousemove',{point:{x:30,y:30},lngLat:{lng:-119.4,lat:36.9}});
  assert.match(popups[0].text,/Observed stage 11 ft/);
  map.emit('click',{point:{x:30,y:30},lngLat:{lng:-119.4,lat:36.9}});
  assert.match(popups[1].text,/Published thresholds unknown/);
  map.emit('mouseout',{originalEvent:{relatedTarget:{closest:selector=>selector==='.watch-cloud-readout'}}});
  assert.equal(popups[1].open,true,'Moving into the inset tap card must not dismiss it.');
  map.emit('movestart');assert.equal(popups[1].open,false,'Moving the map clears the old anchored reading.');
  record={name:'Gauge',key:'gauge'};map.emit('click',{point:{x:30,y:30},lngLat:{lng:-119.4,lat:36.9}});
  assert.deepEqual(selected,[record]);assert.equal(popups[1].open,false);
  record=null;surface=null;map.emit('click',{point:{x:30,y:30},lngLat:{lng:-119.4,lat:36.9}});
  assert.equal(popups[1].open,false,'Infrared imagery cannot yield a fabricated height.');
  view.destroy();assert.equal(map.listenerCount('click'),0);
 }finally{restore();}
});
