import test from 'node:test';
import assert from 'node:assert/strict';
import {damOperator,leveeSponsors} from '../site/lib/water-operators.js';

test('dam operator: federal from NID, utility hydro licensee by name, otherwise not listed',()=>{
  assert.deepEqual(damOperator({NAME:'Pine Flat Dam',FED_AGENCY_OPERATIONS:'US Army Corps of Engineers',PRIMARY_OWNER_TYPE:'Federal'}).operator,'US Army Corps of Engineers');
  assert.equal(damOperator({NAME:'Shaver Lake Dam',PRIMARY_OWNER_TYPE:'Private'}).operator,'Southern California Edison');
  assert.equal(damOperator({NAME:'Big Creek Dam No. 3a',PRIMARY_OWNER_TYPE:'Private'}).operator,'Southern California Edison');
  assert.equal(damOperator({NAME:'Courtright',PRIMARY_OWNER_TYPE:'Private'}).operator,'Pacific Gas and Electric');
  const none=damOperator({NAME:'Sequoia Lake',PRIMARY_OWNER_TYPE:'Private'});assert.equal(none.operator,'Not listed');assert.match(none.basis,/owner type: Private/);
  assert.match(damOperator({NAME:'Wishon Main'}).basis,/verify with the utility/);
});
test('levee sponsors drop Undefined/Unknown and keep names and roles as published',()=>{
  const s=leveeSponsors({SPONSORS:'CA Department of Water Resources, Central Valley Flood Protection Board, Lower San Joaquin Levee District',SPONSOR_ROLE:'Inspection;Owner / sponsor;Maintainer & operator'});
  assert.deepEqual(s.sponsors,['CA Department of Water Resources','Central Valley Flood Protection Board','Lower San Joaquin Levee District']);assert.equal(s.roles.length,3);assert.equal(s.listed,true);
  assert.equal(leveeSponsors({SPONSORS:'Undefined'}).listed,false);assert.equal(leveeSponsors({}).listed,false);
});
import {concernSummary} from '../site/lib/mission-model.js';
test('river review names the dam operator whose releases feed the area, once each',()=>{
  const base={area:{id:'a',name:'A'},gauges:[],gaps:[]};
  assert.match(concernSummary({...base,releases:[{operator:'US Bureau of Reclamation',name:'Millerton / Friant Dam'},{operator:'US Bureau of Reclamation',name:'Millerton / Friant Dam'}]}).nextReview,/^Confirm release plans with US Bureau of Reclamation \(Millerton \/ Friant Dam\), then field conditions/);
  assert.equal(concernSummary({...base,releases:[]}).nextReview,'Confirm operator guidance, field conditions, site power and approved access.');
});
import {scenariosFor} from '../site/lib/water-operators.js';
import {readFileSync} from 'node:fs';
test('prepared dam-failure scenarios attach to the dam with the same name, every variant, no cross-matching',()=>{
  const {scenarios}=JSON.parse(readFileSync(new URL('../site/data/flood-scenarios/index.json',import.meta.url)));
  const ids=n=>scenariosFor(n,scenarios).map(s=>s.id).sort();
  assert.deepEqual(ids('Big Dry Creek'),['big-dry-creek','big-dry-creek-outlet-1','big-dry-creek-outlet-2','big-dry-creek-spillway']);
  assert.deepEqual(ids('Fancher Creek'),['fancher-creek','fancher-creek-spillway']);// not the Detention dam
  assert.deepEqual(ids('Fancher Creek Detention'),['fancher-creek-detention','fancher-creek-detention-spillway']);
  assert.deepEqual(ids('Redbank'),['redbank']);assert.deepEqual(ids('Redbank Creek Detention Basin'),['redbank-creek-detention','redbank-creek-detention-spillway']);
  assert.deepEqual(ids('Alluvial Drain Detention'),['alluvial-drain']);assert.deepEqual(ids('Pine Flat Dam'),[]);assert.deepEqual(ids(''),[]);
  assert.deepEqual(scenariosFor('Big Dry Creek Dam',scenarios).map(s=>s.variant).sort(),['Little Dry Creek outlet','Main dam','Outlet 1','Spillway']);
});

import {districtName,DISTRICTS_WHERE} from '../site/lib/water-operators.js';
test('district names are tidied and drinking-water systems are filtered out',()=>{
  assert.equal(districtName('Fresno Irrigation District'),'Fresno Irrigation District');
  assert.equal(districtName('Merced  City Of'),'Merced, City of');assert.equal(districtName('WHISPERING PINES APARTMENTS\r\n'),'WHISPERING PINES APARTMENTS');
  for(const s of ['CDPH','SWRCB'])assert.ok(DISTRICTS_WHERE.includes(`'${s}'`));
});
