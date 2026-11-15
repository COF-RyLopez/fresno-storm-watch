import test from 'node:test';
import assert from 'node:assert/strict';
import {createHanfordRadarLayer} from '../site/lib/hanford-radar-layer.js';

function graphicsContext(){
 const calls=[],state={depthWrite:true,cull:true};
 const gl={VERTEX_SHADER:1,FRAGMENT_SHADER:2,COMPILE_STATUS:3,LINK_STATUS:4,ARRAY_BUFFER:5,FLOAT:6,STATIC_DRAW:7,TRIANGLES:8,DEPTH_WRITEMASK:9,CULL_FACE:10,
  createShader:type=>({type}),shaderSource:(shader,code)=>{shader.code=code;},compileShader(){},getShaderParameter:()=>true,deleteShader(){},
  createProgram:()=>({}),attachShader(){},linkProgram(){},getProgramParameter:()=>true,deleteProgram:()=>calls.push(['deleteProgram']),
  createBuffer:()=>({}),createVertexArray:()=>({}),getUniformLocation:()=>({}),bindVertexArray(){},bindBuffer(){},enableVertexAttribArray(){},vertexAttribPointer(){},vertexAttribDivisor(){},
  deleteVertexArray:()=>calls.push(['deleteVertexArray']),deleteBuffer:()=>calls.push(['deleteBuffer']),
  getParameter:key=>{assert.equal(key,gl.DEPTH_WRITEMASK);return state.depthWrite;},depthMask:value=>{state.depthWrite=value;},
  isEnabled:key=>{assert.equal(key,gl.CULL_FACE);return state.cull;},disable:key=>{assert.equal(key,gl.CULL_FACE);state.cull=false;},enable:key=>{assert.equal(key,gl.CULL_FACE);state.cull=true;},
  bufferData:(_target,data)=>calls.push(['upload',new Float32Array(data)]),useProgram(){},uniformMatrix4fv(){},
  drawArraysInstanced:(_mode,_first,vertices,instances)=>{assert.equal(state.cull,false);calls.push(['draw',vertices,instances,state.depthWrite]);}};
 return {gl,calls,state};
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
