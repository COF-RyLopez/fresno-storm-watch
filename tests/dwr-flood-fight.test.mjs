import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fresnoDefinition,inspectionDate,inventoryQuantity,assertScopedInventory} from '../site/lib/dwr-flood-fight-model.js';

test('Fresno source scope deduplicates IDs and fails closed for an empty county result',()=>{
  assert.equal(fresnoDefinition('ObjectId',[51,50,51],"County = 'Fresno'"),"(County = 'Fresno') AND ObjectId IN (50,51)");
  assert.equal(fresnoDefinition('OBJECTID',[]),'1=0');
  assert.throws(()=>fresnoDefinition('OBJECTID',null));
  assert.throws(()=>fresnoDefinition('OBJECTID',[NaN]));
  assert.throws(()=>fresnoDefinition('OBJECTID',[1.5]));
  assert.throws(()=>fresnoDefinition('OBJECTID',[1,'2']));
  assert.throws(()=>fresnoDefinition('OID;1=1',[1]));
});

test('reported zero, unknown quantity and UTC inventory dates remain distinct',()=>{
  assert.equal(inventoryQuantity(0),'0');assert.equal(inventoryQuantity(10000),'10,000');
  for(const value of [null,undefined,'0',NaN,-1])assert.equal(inventoryQuantity(value),'Unknown');
  assert.equal(inspectionDate(1727740800000),'Oct 1, 2024');assert.equal(inspectionDate(null),'Unknown');
});

test('inventory responses cannot escape county scope or silently omit and duplicate records',()=>{
  const f=id=>({attributes:{ObjectId:id}});
  assert.equal(assertScopedInventory([f(50),f(51)],[50,51],'ObjectId').length,2);
  assert.throws(()=>assertScopedInventory([f(1),f(50),f(51)],[50,51],'ObjectId'));
  assert.throws(()=>assertScopedInventory([f(50)],[50,51],'ObjectId'));
  assert.throws(()=>assertScopedInventory([f(50),f(50)],[50,51],'ObjectId'));
  assert.throws(()=>assertScopedInventory([f(1)],[],'ObjectId'));
  assert.deepEqual(assertScopedInventory([],[],'ObjectId'),[]);
});

test('DWR catalog preserves all nine dashboard sources, publisher symbols and the unavailable levee source',async()=>{
  const catalog=JSON.parse(await readFile(new URL('../site/data/dwr-flood-fight.json',import.meta.url),'utf8'));
  assert.equal(catalog.countyGeoid,'06019');assert.equal(catalog.layers.length,9);
  assert.deepEqual(catalog.layers.filter(l=>l.defaultOn).map(l=>l.key),['supplies','offices']);
  assert.equal(catalog.layers.find(l=>l.key==='supplies').where,"County = 'Fresno'");
  assert.equal(catalog.layers.find(l=>l.key==='county').where,"COUNTY_FIPS = '019'");
  assert.equal(catalog.layers.find(l=>l.key==='levees').sourceIssue,'Service not found');
  for(const l of catalog.layers){assert(l.renderer);assert(['services1.arcgis.com','gis.water.ca.gov','ferix.water.ca.gov'].includes(new URL(l.url).hostname));}
});
