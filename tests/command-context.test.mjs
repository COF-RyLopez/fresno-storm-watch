import test from 'node:test';
import assert from 'node:assert/strict';
import * as module from '../site/lib/command-context.js';
const now=Date.parse('2026-11-19T18:00:00Z');
function fixture(){return {schemaVersion:1,generatedAt:new Date(now).toISOString(),cities:{type:'FeatureCollection',features:[]},
 burnScars:{type:'FeatureCollection',features:[{type:'Feature',id:'burn-scar:a',geometry:{type:'Polygon',coordinates:[[[-119.6,36.8],[-119.5,36.8],[-119.5,36.9],[-119.6,36.8]]]},properties:{id:'burn-scar:a',name:'BASIN',year:2024,discovered:1719360000000,updated:null,source:'https://example.org/calfire',publisher:'CAL FIRE',geometryStatus:'Historical perimeter',assessment:{source:'https://example.org/usgs',issued:1722211200000,storm:'30 mm/h peak 15-minute intensity',note:'Historical immediate-postfire model, not current danger'}}}]},sources:[],warnings:[]};}
test('recent perimeters become reference records and never an invented current hazard or tier',()=>{
 assert.equal(typeof module.contextRecords,'function');const rows=module.contextRecords(fixture(),now);
 assert.equal(rows.length,2);assert.equal(rows[0].id,'burn-scars');assert.equal(rows[1].id,'burn-scar:a');
 assert.ok(rows.every(r=>r.review===false));assert.match(rows[1].quality,/not.*hazard/i);
 assert.ok(rows[1].details.some(text=>text.includes('30 mm/h')));assert.ok(rows[1].details.some(text=>/Historical/.test(text)));
 assert.equal(rows[1].features[0].properties.kind,'burn-scar');
 assert.ok(rows[1].links.some(link=>link.url==='https://example.org/usgs'));
 assert.ok(rows[1].details.some(text=>text.includes('Jul 29, 2024')),'date-only assessment must not shift to prior local day');
});
test('old copies and missing future context retain explicit limits rather than indicating no burn risk',()=>{
 const rows=module.contextRecords(fixture(),now+3*86400000);assert.match(rows[0].quality,/overdue/i);
 assert.throws(()=>module.contextRecords({...fixture(),generatedAt:new Date(now+86400000).toISOString()},now),/timestamp|future/i);
 const empty=fixture();empty.burnScars.features=[];assert.match(module.contextRecords(empty,now)[0].change,/No.*returned/i);
});
