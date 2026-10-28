import test from 'node:test';
import assert from 'node:assert/strict';
import {commandQueue,queuePage} from '../site/lib/command-queue-model.js';
const river={area:{id:'a',name:'River A'},review:true,status:'River change — review',gauges:[],gaps:['Forecast unavailable']};
const road={key:'road1',name:'Road A',kind:'Closure',status:'Verify',active:'yes',start:1,end:null,sourceTime:null,issues:[]};
test('queue reuses domain review decisions, keeps missing timing unknown and deduplicates entity keys',()=>{
 const care={key:'a',name:'Care A',review:true,reasons:['Nearby road'],gaps:['Utility unavailable'],zonesChecked:100};
 const rows=commandQueue({rivers:[river,river,{...river,area:{id:'b',name:'B'},review:false}],care:[care]});
 assert.equal(rows.length,2);assert.equal(rows[0].time,null);assert.equal(rows[1].type,'care');assert.equal(rows[1].timeLabel,'County source checked');assert.equal(rows[1].quality,'Incomplete evidence');
});
test('private rows are unavailable unless their source is assessed; disconnect removes them',()=>{
 const drainage=[{id:'d',name:'D',review:true,change:'Verify capacity',gaps:[],pumpPower:[]}];
 assert.equal(commandQueue({drainage}).length,0);
 const rows=commandQueue({drainage,drainageReady:true});assert.equal(rows.length,1);assert.equal(rows[0].private,true);
 assert.equal(commandQueue({drainage:[],drainageReady:false}).length,0);
});
test('restored utility history, inactive roads and elapsed-date road contradictions stay outside current queue',()=>{
 const power={rows:[{key:'p',name:'Area',utility:'PG&E',status:'outage',updated:{time:50}},{key:'old',status:'restored'}]};
 const rows=commandQueue({power,roads:{error:'Failed check',snapshot:{rows:[road,{...road,key:'old',end:1},{...road,key:'no',active:'no'}]}}});
 assert.equal(rows.length,2);assert.equal(rows[1].quality,'Retained record · source check failed');
 assert(!rows.some(r=>r.id==='old'||r.id==='no'));
});
test('pump assignments keep responsibility and due time distinct from owner contact and rainfall onset',()=>{
 const p={key:'p',name:'Pump',inventoryCurrent:true,readiness:{needsReview:true},tasks:{rows:[{type:'Backup',owner:'Team A',active:true,overdue:true,due:150,status:'Open'}]},maximum:1,rainCurrent:true};
 const rows=commandQueue({rivers:[river],drainageReady:true,drainage:[{id:'d',name:'D',review:false,cycle:{start:200},pumpPower:[p]}]});
 assert.equal(rows[0].type,'pump');assert.equal(rows[0].owner,'Team A');assert.equal(rows[0].due,150);assert.equal(rows[0].timeLabel,'Rainfall window starts');assert.equal(rows[0].status,'Overdue follow-up');
});
test('display paging does not alter countywide rows or leak private inventories into disconnected views',()=>{
 const rows=Array.from({length:12},(_,i)=>({key:String(i),type:i<11?'care':'river'}));
 assert.equal(queuePage(rows,{type:'care',page:9}).page,1);assert.equal(queuePage(rows,{type:'care',page:9}).rows.length,1);assert.equal(rows.length,12);
 assert.equal(commandQueue({assets:{connected:false,sites:[{review:true,site:{key:'p',name:'Private'}}]}}).length,0);
});
