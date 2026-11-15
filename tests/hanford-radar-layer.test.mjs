import test from 'node:test';
import assert from 'node:assert/strict';
import {createHanfordRadarLayer} from '../site/lib/hanford-radar-layer.js';

function graphicsContext(){
 const calls=[],state={depthWrite:true,cull:true,program:{old:'program'},vao:{old:'vao'},buffer:{old:'buffer'},depthFunc:123,
  depth:false,blend:false,blendValues:[201,202,203,204],blendEquations:[205,206]},uniforms=new Map(),buffers=new Set(),vaos=new Set();
 let maximumBuffers=0;
 const gl={VERTEX_SHADER:1,FRAGMENT_SHADER:2,COMPILE_STATUS:3,LINK_STATUS:4,ARRAY_BUFFER:5,FLOAT:6,STATIC_DRAW:7,TRIANGLES:8,DEPTH_WRITEMASK:9,CULL_FACE:10,
  CURRENT_PROGRAM:11,VERTEX_ARRAY_BINDING:12,ARRAY_BUFFER_BINDING:13,DEPTH_TEST:14,DEPTH_FUNC:15,BLEND:16,BLEND_SRC_RGB:17,
  BLEND_DST_RGB:18,BLEND_SRC_ALPHA:19,BLEND_DST_ALPHA:20,BLEND_EQUATION_RGB:21,BLEND_EQUATION_ALPHA:22,ONE:23,ONE_MINUS_SRC_ALPHA:24,FUNC_ADD:25,LEQUAL:26,
  createShader:type=>({type}),shaderSource:(shader,code)=>{shader.code=code;},compileShader(){},getShaderParameter:()=>true,deleteShader(){},
  createProgram:()=>({}),attachShader(){},linkProgram(){},getProgramParameter:()=>true,deleteProgram:()=>calls.push(['deleteProgram']),
  createBuffer:()=>{const buffer={};buffers.add(buffer);maximumBuffers=Math.max(maximumBuffers,buffers.size);return buffer;},
  createVertexArray:()=>{const vao={};vaos.add(vao);return vao;},getUniformLocation:(_program,name)=>name,
  bindVertexArray:value=>{state.vao=value;},bindBuffer:(_target,value)=>{state.buffer=value;},enableVertexAttribArray(){},vertexAttribPointer(){},vertexAttribDivisor(){},
  deleteVertexArray:vao=>{vaos.delete(vao);calls.push(['deleteVertexArray']);},deleteBuffer:buffer=>{buffers.delete(buffer);calls.push(['deleteBuffer']);},
  getParameter:key=>({[gl.DEPTH_WRITEMASK]:state.depthWrite,[gl.CURRENT_PROGRAM]:state.program,[gl.VERTEX_ARRAY_BINDING]:state.vao,
   [gl.ARRAY_BUFFER_BINDING]:state.buffer,[gl.DEPTH_FUNC]:state.depthFunc,[gl.BLEND_SRC_RGB]:state.blendValues[0],[gl.BLEND_DST_RGB]:state.blendValues[1],
   [gl.BLEND_SRC_ALPHA]:state.blendValues[2],[gl.BLEND_DST_ALPHA]:state.blendValues[3],[gl.BLEND_EQUATION_RGB]:state.blendEquations[0],[gl.BLEND_EQUATION_ALPHA]:state.blendEquations[1]})[key],
  depthMask:value=>{state.depthWrite=value;},depthFunc:value=>{state.depthFunc=value;},
  isEnabled:key=>state[{[gl.CULL_FACE]:'cull',[gl.DEPTH_TEST]:'depth',[gl.BLEND]:'blend'}[key]],
  disable:key=>{state[{[gl.CULL_FACE]:'cull',[gl.DEPTH_TEST]:'depth',[gl.BLEND]:'blend'}[key]]=false;},
  enable:key=>{state[{[gl.CULL_FACE]:'cull',[gl.DEPTH_TEST]:'depth',[gl.BLEND]:'blend'}[key]]=true;},
  blendFuncSeparate:(...values)=>{state.blendValues=values;},blendEquationSeparate:(...values)=>{state.blendEquations=values;},
  bufferData:(_target,data)=>calls.push(['upload',new Float32Array(data)]),useProgram:value=>{state.program=value;},uniformMatrix4fv(){},uniform1f:(name,value)=>uniforms.set(name,value),
  drawArraysInstanced:(_mode,_first,vertices,instances)=>{assert.equal(state.cull,false);calls.push(['draw',vertices,instances,state.depthWrite]);calls.push(['frame',state.buffer,uniforms.get('frameOpacity')]);}};
 return {gl,calls,state,buffers,vaos,maximumBuffers:()=>maximumBuffers};
}
const coordinates={fromLngLat:([x,y],height=0)=>({x,y,z:height/100000})};
const projection={defaultProjectionData:{mainMatrix:new Float32Array(16)}};
const samples=new Float32Array([-120.597,36.303,1200,31,-120.598,36.302,3800,46,-120.1,36.8,1255,55]);

test('radar renders one two-triangle horizontal footprint per occupied bin at its strongest sample height',()=>{
 const {gl,calls,state}=graphicsContext(),layer=createHanfordRadarLayer(coordinates);let repaints=0;
 layer.onAdd({triggerRepaint:()=>repaints++},gl);layer.setSamples(samples,20);layer.render(gl,projection);
 assert.deepEqual(calls.find(row=>row[0]==='draw'),['draw',6,2,false],'No vertical walls or radar depth writes may hide later ground labels.');
 const data=calls.find(row=>row[0]==='upload')[1];assert.equal(data.length,16);
 assert.equal(data[4],Math.fround(3800/100000));assert.equal(data[12],Math.fround(1255/100000));
 assert.equal(state.depthWrite,true,'Shared map depth-write state must be restored.');
 assert.equal(state.cull,true,'Shared cull state must be restored.');
 layer.setSamples(samples,20);layer.render(gl,projection);assert.equal(repaints,1);assert.equal(calls.filter(row=>row[0]==='upload').length,1);
 layer.onRemove(null,gl);assert.deepEqual(calls.slice(-3).map(row=>row[0]),['deleteVertexArray','deleteBuffer','deleteProgram']);
});

test('replay threshold changes replace footprints, and an empty scan draws no retained cells',()=>{
 const {gl,calls}=graphicsContext(),layer=createHanfordRadarLayer(coordinates);
 layer.onAdd({triggerRepaint(){}},gl);layer.setSamples(samples,50);layer.render(gl,projection);
 assert.deepEqual(calls.find(row=>row[0]==='draw').slice(1),[6,1,false]);
 layer.setSamples(new Float32Array(),20);layer.render(gl,projection);assert.equal(calls.filter(row=>row[0]==='draw').length,1);
});

test('a render failure still restores the shared depth-write state',()=>{
 const {gl,state}=graphicsContext(),layer=createHanfordRadarLayer(coordinates);
 layer.onAdd({triggerRepaint(){}},gl);layer.setSamples(samples,20);gl.drawArraysInstanced=()=>{throw Error('context lost');};
 assert.throws(()=>layer.render(gl,projection),/context lost/);assert.equal(state.depthWrite,true);assert.equal(state.cull,true);
});

test('playback crossfades two unchanged footprint buffers and stops repainting when settled',t=>{
 let now=100,repaints=0;t.mock.method(performance,'now',()=>now);
 const {gl,calls,state,buffers,maximumBuffers}=graphicsContext(),before=structuredClone(state),layer=createHanfordRadarLayer(coordinates);
 layer.onAdd({triggerRepaint:()=>repaints++},gl);assert.deepEqual(state,before);
 layer.setSamples(samples,20);layer.render(gl,projection);
 const original=calls.find(row=>row[0]==='upload')[1];
 const next=new Float32Array([-119.8,36.7,2200,65]);
 layer.setSamples(next,20,{durationMs:400});layer.render(gl,projection);
 now=300;calls.length=0;layer.render(gl,projection);
 assert.deepEqual(calls.filter(row=>row[0]==='frame').map(row=>row[2]),[0.5,0.5]);
 assert.equal(calls.filter(row=>row[0]==='upload').length,0,'Each observed frame uploads once; no synthetic in-between values.');
 assert.equal(original[4],Math.fround(3800/100000));assert.equal(maximumBuffers(),2);assert.equal(buffers.size,2);assert.deepEqual(state,before);
 now=500;calls.length=0;layer.render(gl,projection);assert.deepEqual(calls.filter(row=>row[0]==='frame').map(row=>row[2]),[1]);
 assert.equal(buffers.size,1);const settled=repaints;layer.render(gl,projection);assert.equal(repaints,settled);
 layer.onRemove(null,gl);assert.equal(buffers.size,0);
});

test('interrupted and disabled footprint fades retain at most two frames and remove cancels work',t=>{
 let now=0,repaints=0;t.mock.method(performance,'now',()=>now);
 const {gl,calls,buffers,vaos,maximumBuffers}=graphicsContext(),layer=createHanfordRadarLayer(coordinates);
 layer.onAdd({triggerRepaint:()=>repaints++},gl);layer.setSamples(samples,20);layer.render(gl,projection);
 for(let i=0;i<5;i++){now+=50;layer.setSamples(new Float32Array([-119.8,36.7,2200,30+i]),20,{durationMs:400});layer.render(gl,projection);}
 assert.equal(maximumBuffers(),2);assert.equal(buffers.size,2);assert.equal(vaos.size,2);
 layer.setSamples(samples,20,{durationMs:0});calls.length=0;layer.render(gl,projection);
 assert.deepEqual(calls.filter(row=>row[0]==='frame').map(row=>row[2]),[1]);assert.equal(buffers.size,1);
 layer.setSamples(new Float32Array(samples),20,{durationMs:400});layer.render(gl,projection);layer.onRemove(null,gl);
 const stopped=repaints;layer.render(gl,projection);assert.equal(repaints,stopped);assert.equal(buffers.size,0);assert.equal(vaos.size,0);
});

test('footprint transition failures release both frames and restore all shared map state',t=>{
 t.mock.method(performance,'now',()=>0);
 for(const method of ['bufferData','drawArraysInstanced']){
  const {gl,state,buffers,vaos}=graphicsContext(),before=structuredClone(state),layer=createHanfordRadarLayer(coordinates);
  layer.onAdd({triggerRepaint(){}},gl);layer.setSamples(samples,20);layer.render(gl,projection);
  layer.setSamples(new Float32Array(samples),20,{durationMs:400});gl[method]=()=>{throw Error('GPU failed');};
  assert.throws(()=>layer.render(gl,projection),/GPU failed/);assert.deepEqual(state,before);assert.equal(buffers.size,0);assert.equal(vaos.size,0);
 }
});

test('clearing footprints during a fade removes both scans without another animation repaint',t=>{
 let now=0,repaints=0;t.mock.method(performance,'now',()=>now);
 const {gl,calls,buffers}=graphicsContext(),layer=createHanfordRadarLayer(coordinates);
 layer.onAdd({triggerRepaint:()=>repaints++},gl);layer.setSamples(samples,20);layer.render(gl,projection);
 layer.setSamples(new Float32Array(samples),20,{durationMs:400});layer.render(gl,projection);
 layer.setSamples(new Float32Array(),20);calls.length=0;const stopped=repaints;now=200;layer.render(gl,projection);
 assert.equal(calls.filter(row=>row[0]==='draw').length,0);assert.equal(repaints,stopped);assert.equal(buffers.size,1);
 layer.onRemove(null,gl);assert.equal(buffers.size,0);
});

test('an invalid footprint replacement cannot discard an active observed-frame transition',t=>{
 let now=0;t.mock.method(performance,'now',()=>now);
 const {gl,calls,buffers}=graphicsContext(),layer=createHanfordRadarLayer(coordinates);
 layer.onAdd({triggerRepaint(){}},gl);layer.setSamples(samples,20);layer.render(gl,projection);
 const next=new Float32Array(samples);layer.setSamples(next,20,{durationMs:400});layer.render(gl,projection);
 assert.throws(()=>layer.setSamples(new Float32Array([NaN,36,1000,40]),20,{durationMs:400}),/sample/);
 now=200;calls.length=0;layer.render(gl,projection);
 assert.deepEqual(calls.filter(row=>row[0]==='frame').map(row=>row[2]),[0.5,0.5]);assert.equal(buffers.size,2);
 layer.setSamples(next,20);calls.length=0;layer.render(gl,projection);
 assert.deepEqual(calls.filter(row=>row[0]==='frame').map(row=>row[2]),[1]);assert.equal(buffers.size,1);
});
