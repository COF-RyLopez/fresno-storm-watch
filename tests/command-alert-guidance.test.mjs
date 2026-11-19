import test from 'node:test';
import assert from 'node:assert/strict';
import {nwsGuidance, citedRoadEntries} from '../site/lib/command-alert-guidance.js';
import {alertConcerns} from '../site/lib/command-data.js';
import {snapshotConcern} from '../site/lib/command-model.js';

const description=`* WHAT...Southeast winds 15 to 25 mph with gusts 35 to 45 mph\nexpected.\n\n* WHERE...Merced - Madera - Mendota.\n\n* WHEN...Until 10 PM PST this evening.\n\n* IMPACTS...Tree limbs could be blown down and a few power outages\nmay result.\n\n* ADDITIONAL DETAILS...Highways impacted include State Routes 99, 198,\n43, and 41. Includes Interstate 5.`;
const alert={key:'cap|sent',type:'Wind Advisory',category:'Advisory',office:'NWS Hanford CA',issued:100,onset:200,ends:300,expires:400,counties:['Fresno'],geometries:[],sourceUrl:'https://api.weather.gov/alerts/urn:oid:test',signature:'v1',description,instruction:'Use extra caution when driving high profile vehicles.'};
test('selected alert exposes verbatim NWS hazard, impacts, time and instructions and freezes the source in briefing capture',()=>{
 const c=alertConcerns([alert])[0];
 assert.equal(c.guidance.what,'Southeast winds 15 to 25 mph with gusts 35 to 45 mph expected.');
 assert.equal(c.guidance.impacts,'Tree limbs could be blown down and a few power outages may result.');
 assert.equal(c.guidance.when,'Until 10 PM PST this evening.');
 assert.equal(c.guidance.instruction,alert.instruction);
 assert.deepEqual(c.guidance.corridors.map(r=>r.label),['SR 99','SR 198','SR 43','SR 41','I-5']);
 const frozen=snapshotConcern(c);
 assert.ok(frozen.details.includes(description));
 c.guidance.what='Changed';
 assert.equal(frozen.guidance.what,'Southeast winds 15 to 25 mph with gusts 35 to 45 mph expected.');
 assert.ok(frozen.details.includes(alert.sourceUrl));
 assert.ok(frozen.details.includes(description));
});

test('unstructured messages retain an official headline and absent impact text stays absent',()=>{
 const g=nwsGuidance({type:'Flood Warning',headline:'Flooding expected along a named river',description:'See the river forecast.',parameters:{flashFloodDamageThreat:['CONSIDERABLE']}});
 assert.equal(g.what,'Flooding expected along a named river');
 assert.equal(g.impacts,'');
 assert.deepEqual(g.tags,[{label:'Flash-flood damage threat',value:'CONSIDERABLE'}]);
 assert.deepEqual(nwsGuidance({type:'Flood Watch'}).tags,[]);
});

test('corridor matches respect route identity, exclude ramps and do not mistake a street number for a highway',()=>{
 const entries=[
  {key:'41',kind:'street',name:'SR-41 NB FWY',aliases:['Highway 41']},
  {key:'410',kind:'street',name:'SR-410 HWY'},
  {key:'ramp',kind:'street',name:'CA-41 NB ONRAMP ON'},
  {key:'house',kind:'street',name:'41 Main Street'},
  {key:'us',kind:'street',name:'US-41 HWY'},
  {key:'water',kind:'waterway',name:'Highway 41 Canal'},
 ];
 const routes=nwsGuidance({description:'Highways include State Route 41.'}).corridors;
 assert.deepEqual(citedRoadEntries(entries,routes).map(r=>r.entry.key),['41']);
 assert.deepEqual(nwsGuidance({description:'Wind gusts 45 mph until 10 PM; rainfall 1 to 3 inches.'}).corridors,[]);
});

test('hazard-source-impact format and distinct state, US and interstate lists remain attributable',()=>{
 const g=nwsGuidance({description:'HAZARD...Flash flooding caused by heavy rain.\nSOURCE...Radar indicated.\nIMPACT...Small streams may flood.\nLocations include Interstate 5 and U.S. Highway 395.\n',parameters:{flashFloodDetection:['RADAR INDICATED']}});
 assert.equal(g.what,'Flash flooding caused by heavy rain.');
 assert.match(g.impacts,/Small streams may flood/);
 assert.equal(g.source,'Radar indicated.');
 assert.deepEqual(g.corridors.map(r=>r.label),['I-5','US 395']);
});

test('distance, time and wind-speed values after a route cannot create extra cited highways',()=>{
 for (const suffix of ['5 miles north of Fresno.','5.5 miles north of Fresno.','5 to 10 miles north of Fresno.','5 AM.','7:00 PM.','45 mph gusts expected.']) {
  assert.deepEqual(nwsGuidance({description:'Highway 41, '+suffix}).corridors.map(r=>r.label),['Highway 41']);
 }
});
