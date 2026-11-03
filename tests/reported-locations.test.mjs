import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {reportedFeatures,filterReports} from '../site/lib/reported-locations-model.js';

const collection=JSON.parse(await readFile(new URL('../site/data/reported-locations/locations.geojson',import.meta.url),'utf8'));

test('District 1 filter counts reports once and retains candidate and road geometries',()=>{
  const rows=reportedFeatures(collection);
  assert.equal(rows.length,92);
  assert.deepEqual(filterReports(rows,{source:'d1'}).map(f=>f.properties.id),['D1-01','D1-02','D1-03','D1-04','D1-05','D1-06','D1-07']);
  assert.equal(filterReports(rows,{source:'oes'}).length,85);
  const candidates=filterReports(rows,{query:'47390'});
  assert.equal(candidates.length,1);
  assert.equal(candidates[0].properties.id,'A01');
  assert.equal(candidates[0].geometry.type,'MultiPoint');
  assert.equal(candidates[0].geometry.coordinates.length,2);
  assert.equal(rows.find(f=>f.properties.id==='D1-03').geometry.type,'MultiLineString');
  assert.equal(rows.filter(f=>f.properties.has_reported_coordinate).length,75);
  assert.deepEqual(rows.find(f=>f.properties.id==='K01').geometry.coordinates,[-119.710091,36.922921]);
});

test('search and section filters intersect without changing locations or source evidence',()=>{
  const before=JSON.stringify(collection),rows=reportedFeatures(collection);
  assert.equal(filterReports(rows,{source:'d1',query:' HYACINTH '})[0].properties.id,'D1-07');
  assert.equal(filterReports(rows,{source:'oes',section:'Earlier District 1'}).length,0);
  assert.equal(filterReports(rows,{query:'no-such-report-936'}).length,0);
  assert.equal(JSON.stringify(collection),before);
});

test('invalid geometry, duplicate identity and missing uncertainty fail visibly instead of dropping reports',()=>{
  const bad=()=>structuredClone(collection);
  let data=bad();data.features[0].geometry.coordinates=[36.7,-120.4];
  assert.throws(()=>reportedFeatures(data),/coordinate/i);
  data=bad();data.features.push(data.features[0]);
  assert.throws(()=>reportedFeatures(data),/duplicate/i);
  data=bad();delete data.features[0].properties.confirmation;
  assert.throws(()=>reportedFeatures(data),/confirmation/i);
  data=bad();data.features[0].properties.photo_links=['https://private.example/photo'];
  assert.throws(()=>reportedFeatures(data),/private/i);
});
