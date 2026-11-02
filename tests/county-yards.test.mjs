import test from 'node:test';
import assert from 'node:assert/strict';
import {miles,nearestSite,siteContext,siteName,AT_SITE_MILES} from '../site/lib/county-yards-model.js';

// County RDYARD and Fuel_Site_Map points (Nov 2026).
const yards=[{name:'Auberry Yard',lon:-119.4856,lat:37.0765},{name:'Fresno Hamilton Yard',lon:-119.7471,lat:36.7266},{name:'Shaver Yard',lon:-119.3131,lat:37.1064}];
const fuel=[{name:'Auberry Public Works Yard',lon:-119.484155,lat:37.076505},{name:'Hamilton Yard',lon:-119.746741,lat:36.725782},{name:'Shaver Lake Public Works Yard',lon:-119.313061,lat:37.106422}];

test('straight-line miles are sane',()=>{
  assert.ok(Math.abs(miles(-119.7471,36.7266,-119.3131,37.1064)-35.4)<1);// Hamilton Yard → Shaver Yard
  assert.equal(miles(-119.5,37,-119.5,37),0);
});

test('sample units: 03107 is at Auberry Yard (Samsara "Area 11"), 43103 at Hamilton Yard (Fleet HQ), both with fuel on site',()=>{
  const p2=siteContext(-119.484152,37.076776,{yards,fuel});
  assert.equal(p2.at,'Auberry Yard');assert.match(p2.fuel,/^Fuel on site: Auberry/);
  const p9=siteContext(-119.748443,36.725517,{yards,fuel});
  assert.equal(p9.at,'Fresno Hamilton Yard');
});

test('away from a yard: nearest County fuel by straight line, said so',()=>{
  const c=siteContext(-119.40,37.09,{yards,fuel});// between Auberry and Shaver
  assert.equal(c.at,null);assert.match(c.fuel,/^Nearest County fuel: .+ mi straight-line$/);
  assert.ok(nearestSite(-119.40,37.09,fuel).miles>AT_SITE_MILES);
  assert.deepEqual(siteContext(NaN,NaN,{yards,fuel}),{at:null,fuel:null});
  assert.equal(nearestSite(-119.4,37.1,[]),null);
});

test('County upper-case names read as titles',()=>{
  assert.equal(siteName('FRESNO/CLOVIS YARD'),'Fresno/Clovis Yard');assert.equal(siteName('DEL REY YARD'),'Del Rey Yard');
});
