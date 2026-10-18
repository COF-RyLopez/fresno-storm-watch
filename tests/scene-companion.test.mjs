import test from 'node:test';
import assert from 'node:assert/strict';
import { sceneCamera, sceneCompanionUrl, setupSceneCompanion } from '../site/lib/scene-companion.js';

const config = { portalUrl:'https://cofgisonline.maps.arcgis.com', photorealisticSceneId:'' };

test('unconfigured companion opens official Scene Viewer with FEMA and a Fresno fallback', () => {
  const url = new URL(sceneCompanionUrl(config));
  assert.equal(url.origin, config.portalUrl);
  assert.equal(url.pathname, '/home/webscene/viewer.html');
  assert.equal(url.searchParams.get('url'), 'https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28');
  assert.equal(url.searchParams.get('viewpoint'), 'cam:-119.700000,36.800000,180000.0;0.0,0.0');
  assert.equal(url.searchParams.has('webscene'), false);
  assert.equal(url.searchParams.has('token'), false);
});

test('a saved scene preserves the current geographic camera and replaces the draft FEMA URL', () => {
  const id='0123456789abcdef0123456789abcdef';
  const url=new URL(sceneCompanionUrl({...config,photorealisticSceneId:id},
    {longitude:-119.79333333333,latitude:36.876111111111,altitude:3500,heading:-5,tilt:55}));
  assert.equal(url.searchParams.get('webscene'),id);
  assert.equal(url.searchParams.has('url'),false);
  assert.equal(url.searchParams.get('viewpoint'),'cam:-119.793333,36.876111,3500.0;355.0,55.0');
});

test('invalid or projected coordinates fall back without invalid navigation', () => {
  for(const bad of [null,{}, {longitude:-13335555,latitude:4420000,altitude:2000,heading:0,tilt:45},
    {longitude:-119,latitude:36,altitude:NaN,heading:0,tilt:45},
    {longitude:-119,latitude:36,altitude:2000,heading:0,tilt:110}]) {
    assert.deepEqual(sceneCamera(bad),sceneCamera(null));
  }
});

test('companion rejects unsafe destinations, embedded credentials and invalid item IDs', () => {
  for(const portalUrl of ['http://cofgisonline.maps.arcgis.com','https://cofgisonline.maps.arcgis.com.evil.test',
    'https://name:password@cofgisonline.maps.arcgis.com','https://cofgisonline.maps.arcgis.com/?token=example',
    'javascript:alert(1)','https://cofgisonline.maps.arcgis.com/elsewhere']) {
    assert.throws(()=>sceneCompanionUrl({...config,portalUrl}));
  }
  assert.throws(()=>sceneCompanionUrl({...config,photorealisticSceneId:'not-a-webscene'}));
});

test('UI clearly reports setup and config errors while retaining a working closeable dialog', () => {
  const previous=globalThis.document;
  const nodes=new Map();
  for(const id of ['#open-photorealistic','#photorealistic-help','#open-scene-companion','#scene-companion-status','#scene-exercise-note']) {
    nodes.set(id,{attrs:{},hidden:true,textContent:'',events:{},
      setAttribute(name,value){this.attrs[name]=value;},removeAttribute(name){delete this.attrs[name];},
      addEventListener(name,callback){this.events[name]=callback;}});
  }
  globalThis.document={querySelector:id=>nodes.get(id)};
  try {
    setupSceneCompanion(config,()=>undefined,true);
    nodes.get('#open-photorealistic').events.click();
    assert.match(nodes.get('#scene-companion-status').textContent,/County setup needed/);
    assert.ok(nodes.get('#open-scene-companion').attrs.href.startsWith(config.portalUrl));
    assert.equal(nodes.get('#scene-exercise-note').hidden,false);
    assert.equal(nodes.get('#photorealistic-help').attrs.open,'');
    setupSceneCompanion({...config,photorealisticSceneId:'bad'},()=>null);
    nodes.get('#open-photorealistic').events.click();
    assert.match(nodes.get('#scene-companion-status').textContent,/configuration is invalid/);
    assert.equal(nodes.get('#open-scene-companion').attrs.href,undefined);
    assert.equal(nodes.get('#open-scene-companion').attrs.disabled,'');
  } finally {globalThis.document=previous;}
});
