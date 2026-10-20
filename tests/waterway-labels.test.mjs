import test from 'node:test';
import assert from 'node:assert/strict';
import {waterwayLabelCandidates,latestWaterwayLabels} from '../site/lib/waterway-labels.js';

const feature=(name,paths,type=1,id=name)=>({attributes:{gnisidlabel:name,id3dhp:id,featuretype:type},geometry:{paths,spatialReference:{wkid:3857}}});
const options={width:800,height:600,project:p=>({x:p[0],y:p[1]})};
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
test('many USGS segments and case/whitespace variants display one river name per view',()=>{
  const rows=Array.from({length:10},(_,i)=>feature(i%2?' San Joaquin  River ':'San Joaquin River',[[[100+i*30,100+i*20],[170+i*30,100+i*20]]],1,String(i)));
  const labels=waterwayLabelCandidates(rows,options);assert.equal(labels.length,1);assert.equal(labels[0].name,'San Joaquin River');
  assert.equal(new Set(labels.map(r=>r.key)).size,labels.length);
});
test('cross-viewport source segments can be labeled; disconnected paths are never joined',()=>{
  const cross=waterwayLabelCandidates([feature('Kings River',[[[-100,300],[900,300]]])],options);
  assert.equal(cross.length,1);assert.deepEqual(cross[0].coordinate,[400,300]);
  const outside=feature('Not visible',[[[-100,100],[-10,100]],[[810,100],[900,100]]]);
  assert.equal(waterwayLabelCandidates([outside],options).length,0);
});
test('distinct names get conservative spacing, edge protection and deterministic priority',()=>{
  const rows=[feature('Madera Canal',[[[300,305],[500,305]]],2),feature('San Joaquin River',[[[300,300],[500,300]]]),feature('Friant-Kern Canal',[[[300,430],[500,430]]],2)];
  const result=waterwayLabelCandidates(rows,options);
  assert.deepEqual(result.map(r=>r.name),['San Joaquin River','Friant-Kern Canal']);
  assert.deepEqual(waterwayLabelCandidates(rows.toReversed(),options),result);
});
test('missing names, bad coordinates, offscreen geometry and disconnected projections do not invent labels',()=>{
  const rows=[feature('',[[[100,100],[200,100]]]),feature(null,[[[100,100],[200,100]]]),feature('Bad',[[[NaN,100],[200,100]]]),feature('Offscreen',[[[100,-100],[200,-100]]])];
  assert.deepEqual(waterwayLabelCandidates(rows,options),[]);
  assert.deepEqual(waterwayLabelCandidates([feature('Behind view',[[[100,100],[200,100]]])],{...options,project:()=>null}),[]);
  assert.deepEqual(waterwayLabelCandidates(rows,{...options,width:10}),[]);
});
test('late queries, disabled contexts and failures cannot restore obsolete labels',async()=>{
  const pending=[],drawn=[],failures=[],cleared=[];
  const controller=latestWaterwayLabels({read:(context,signal)=>{const d=deferred();pending.push({...d,signal});return d.promise;},draw:rows=>drawn.push(rows),clear:()=>cleared.push(true),onError:error=>failures.push(error)});
  const first=controller.refresh({}),last=controller.refresh({});assert(pending[0].signal.aborted);
  pending[1].resolve(['latest']);pending[0].resolve(['obsolete']);await Promise.all([first,last]);assert.deepEqual(drawn,[['latest']]);
  const hidden=controller.refresh({});controller.cancel();pending[2].resolve(['hidden']);await hidden;assert.equal(drawn.length,1);
  const failed=latestWaterwayLabels({read:async()=>{throw new Error('layer unavailable');},draw:()=>assert.fail('must not draw'),clear:()=>cleared.push(true),onError:error=>failures.push(error)});
  await failed.refresh({});assert.equal(cleared.length,1);assert.equal(failures[0].message,'layer unavailable');
});

test('large detailed lines keep projection work bounded and anchors on original segments',()=>{
  let calls=0;const path=Array.from({length:100000},(_,i)=>[100+i/1000,200]);
  const labels=waterwayLabelCandidates([feature('Detailed River',[path])],{...options,project:p=>{calls++;return {x:p[0],y:p[1]};}});
  assert.equal(labels.length,1);assert(calls<=100);assert.equal(labels[0].coordinate[1],200);
});

test('labels try another source segment rather than covering an operational marker',()=>{
  const rows=[feature('Madera Canal',[[[300,300],[500,300]],[[300,450],[500,450]]],2)];
  const labels=waterwayLabelCandidates(rows,{...options,blocked:[{left:380,right:420,top:280,bottom:320}]});
  assert.equal(labels.length,1);assert.equal(labels[0].coordinate[1],450);
});
