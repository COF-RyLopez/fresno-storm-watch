import test from 'node:test';
import assert from 'node:assert/strict';
import {createCloudTopLayer} from '../site/lib/cloud-top-layer.js';

const C=2*Math.PI*6371008.8;
const coordinates={fromLngLat:([lon,lat],height=0)=>({x:(lon+180)/360,
 y:(1-Math.log(Math.tan(Math.PI/4+lat*Math.PI/360))/Math.PI)/2,z:height/(C*Math.cos(lat*Math.PI/180))})};
const center=coordinates.fromLngLat([-119.5,36.75],0);
const view=[1000,0,0,0,0,-1000,0,0,0,0,-1000,0,-1000*center.x,1000*center.y,0,1];
const triangle=(height=5500)=>new Float32Array([-119.6,36.7,height,-119.4,36.7,height,-119.5,36.9,height]);
const project=(lon,lat,height,matrix=view)=>{
 const p=coordinates.fromLngLat([lon,lat],height),v=[p.x,p.y,p.z,1];
 const clip=Array.from({length:4},(_,r)=>v.reduce((n,x,c)=>n+x*matrix[c*4+r],0));
 return {x:(clip[0]/clip[3]+1)*500,y:(1-clip[1]/clip[3])*400};
};
const close=(value,want,tolerance=0.02)=>assert.ok(Math.abs(value-want)<tolerance,`${value} != ${want}`);

// A tracked GL boundary checks the state contract shared with the following map layers.
function context({compile=true,allocation=true}={}){
 const gl={},state=new Map(),enabled=new Set(),calls=[],buffers=new Set();let maxBuffers=0;
 const names=['VERTEX_SHADER','FRAGMENT_SHADER','COMPILE_STATUS','LINK_STATUS','CURRENT_PROGRAM','VERTEX_ARRAY_BINDING',
  'ARRAY_BUFFER','ARRAY_BUFFER_BINDING','STATIC_DRAW','FLOAT','DEPTH_WRITEMASK','DEPTH_TEST','DEPTH_FUNC','CULL_FACE','BLEND',
  'BLEND_SRC_RGB','BLEND_DST_RGB','BLEND_SRC_ALPHA','BLEND_DST_ALPHA','BLEND_EQUATION_RGB','BLEND_EQUATION_ALPHA',
  'LEQUAL','ONE','ONE_MINUS_SRC_ALPHA','FUNC_ADD','TRIANGLES','NO_ERROR'];
 names.forEach((name,i)=>{gl[name]=i+1;});
 state.set(gl.CURRENT_PROGRAM,{old:'program'});state.set(gl.VERTEX_ARRAY_BINDING,{old:'vao'});
 state.set(gl.ARRAY_BUFFER_BINDING,{old:'buffer'});state.set(gl.DEPTH_WRITEMASK,true);state.set(gl.DEPTH_FUNC,88);enabled.add(gl.CULL_FACE);
 for(const name of names.filter(n=>n.startsWith('BLEND_')))state.set(gl[name],77);
 gl.getParameter=key=>state.get(key);gl.isEnabled=key=>enabled.has(key);
 gl.enable=key=>enabled.add(key);gl.disable=key=>enabled.delete(key);
 gl.createProgram=()=>({});gl.deleteProgram=()=>calls.push(['deleteProgram']);
 gl.createShader=()=>({});gl.shaderSource=()=>{};gl.compileShader=()=>{};gl.getShaderParameter=()=>compile;
 gl.deleteShader=()=>{};gl.attachShader=()=>{};gl.linkProgram=()=>{};gl.getProgramParameter=()=>true;
 gl.createVertexArray=()=>({});gl.deleteVertexArray=()=>calls.push(['deleteVao']);
 gl.createBuffer=()=>{if(!allocation)return null;const b={};buffers.add(b);maxBuffers=Math.max(maxBuffers,buffers.size);return b;};
 gl.deleteBuffer=b=>{buffers.delete(b);calls.push(['deleteBuffer']);};
 gl.bindVertexArray=value=>state.set(gl.VERTEX_ARRAY_BINDING,value);
 gl.bindBuffer=(_target,value)=>state.set(gl.ARRAY_BUFFER_BINDING,value);
 gl.useProgram=value=>state.set(gl.CURRENT_PROGRAM,value);
 gl.getUniformLocation=(_program,name)=>name;gl.enableVertexAttribArray=()=>{};gl.vertexAttribPointer=()=>{};
 gl.uniformMatrix4fv=()=>{};gl.uniform1f=(_name,value)=>calls.push(['opacity',value]);
 gl.bufferData=(_target,data)=>calls.push(['upload',new Float32Array(data)]);
 gl.depthMask=value=>state.set(gl.DEPTH_WRITEMASK,value);gl.depthFunc=value=>state.set(gl.DEPTH_FUNC,value);
 gl.blendEquationSeparate=(rgb,alpha)=>{state.set(gl.BLEND_EQUATION_RGB,rgb);state.set(gl.BLEND_EQUATION_ALPHA,alpha);};
 gl.blendFuncSeparate=(...values)=>['BLEND_SRC_RGB','BLEND_DST_RGB','BLEND_SRC_ALPHA','BLEND_DST_ALPHA'].forEach((name,i)=>state.set(gl[name],values[i]));
 gl.drawArrays=(...args)=>{assert.equal(state.get(gl.DEPTH_WRITEMASK),false);assert.ok(enabled.has(gl.DEPTH_TEST));calls.push(['draw',...args]);};
 gl.getError=()=>gl.NO_ERROR;gl.isContextLost=()=>false;
 return {gl,calls,buffers,get maxBuffers(){return maxBuffers;},snapshot:()=>({state:new Map(state),enabled:new Set(enabled)})};
}
function scene(options){
 const ctx=context(options),layer=createCloudTopLayer(coordinates);let repaints=0,moving=false;
 layer.onAdd({triggerRepaint:()=>repaints++,isMoving:()=>moving},ctx.gl);
 return {...ctx,layer,render:(matrix=view)=>layer.render(ctx.gl,{defaultProjectionData:{mainMatrix:matrix}}),
  repaints:()=>repaints,moving:value=>{moving=value;},getMaxBuffers:()=>ctx.maxBuffers};
}

test('picking samples only rendered triangle coverage and preserves the height units',()=>{
 const s=scene();s.layer.setSurface(triangle());
 assert.equal(s.layer.pick(project(-119.5,36.75,5500),1000,800),null);
 s.render();const picked=s.layer.pick(project(-119.5,36.75,5500),1000,800);
 close(picked.height,5500);close(picked.lon,-119.5,0.00002);close(picked.lat,36.75,0.00002);
 assert.equal(s.layer.pick(project(-119.68,36.75,5500),1000,800),null,'No nearest-neighbour filling outside the measured triangle.');
 assert.equal(s.layer.pick({x:-1,y:400},1000,800),null);
 s.moving(true);assert.equal(s.layer.pick({x:500,y:400},1000,800),null);s.moving(false);
 s.layer.invalidatePick();assert.equal(s.layer.pick({x:500,y:400},1000,800),null);
});

test('screen picking is perspective-correct at Fresno Mercator coordinates',()=>{
 const s=scene(),verts=new Float32Array([-119.6,36.7,2000,-119.4,36.7,6000,-119.5,36.9,12000]);
 const perspective=[...view];perspective[11]=-1200;perspective[15]=1.5;
 s.layer.setSurface(verts);s.render(perspective);
 const points=[0,3,6].map(i=>coordinates.fromLngLat([verts[i],verts[i+1]],verts[i+2]));
 const world=[0,1,2].map(axis=>points.reduce((sum,p,i)=>sum+[0.2,0.3,0.5][i]*[p.x,p.y,p.z][axis],0));
 const clip=Array.from({length:4},(_,r)=>[...world,1].reduce((sum,x,c)=>sum+x*perspective[c*4+r],0));
 const result=s.layer.pick({x:(clip[0]/clip[3]+1)*500,y:(1-clip[1]/clip[3])*400},1000,800);
 close(result.height,8200,0.05);
 const wrongScreenLinear=points.reduce((sum,p,i)=>sum+[0.2,0.3,0.5][i]*(1.5-1200*p.z)*verts[i*3+2],0)/
  points.reduce((sum,p,i)=>sum+[0.2,0.3,0.5][i]*(1.5-1200*p.z),0);
 assert.ok(Math.abs(result.height-wrongScreenLinear)>100,'Fixture distinguishes perspective correction from screen-linear heights.');
});

test('picking chooses the frontmost surface and excludes clipped or behind-camera geometry',()=>{
 const s=scene();s.layer.setSurface(new Float32Array([...triangle(1000),...triangle(12000)]));s.render();
 close(s.layer.pick({x:500,y:400},1000,800).height,12000);
 const clipped=[...view];clipped[14]=-2;s.render(clipped);assert.equal(s.layer.pick({x:500,y:400},1000,800),null);
 const behind=[...view];behind[15]=-1;s.render(behind);assert.equal(s.layer.pick({x:500,y:400},1000,800),null);
 s.layer.setSurface(new Float32Array());s.render();assert.equal(s.layer.pick({x:500,y:400},1000,800),null);
});

test('crossfades retain observed geometry, suppress ambiguous picks, and settle without a repaint loop',async t=>{
 let now=0;t.mock.method(performance,'now',()=>now);
 const s=scene();s.layer.setSurface(triangle(2000));s.render();
 let settled=false;const done=s.layer.setSurface(triangle(10000),{durationMs:400}).then(()=>{settled=true;});
 s.render();now=200;s.render();assert.equal(s.layer.pick({x:500,y:400},1000,800),null);
 const opacities=s.calls.filter(c=>c[0]==='opacity').map(c=>c[1]),midpoint=opacities.slice(-2);
 assert.ok(midpoint.every(value=>value>0&&value<opacities[0]));close(midpoint[0]+midpoint[1],opacities[0],1e-8);
 assert.equal(settled,false);assert.equal(s.calls.filter(c=>c[0]==='upload').length,2,'Geometry uploads once per observation.');
 const uploadedHeights=s.calls.filter(c=>c[0]==='upload').map(c=>[...c[1]].filter((_v,i)=>i%4===3));
 assert.deepEqual(uploadedHeights,[[2000,2000,2000],[10000,10000,10000]]);
 now=400;s.render();await done;close(s.layer.pick({x:500,y:400},1000,800).height,10000);
 const count=s.repaints();s.render();assert.equal(s.repaints(),count);assert.equal(s.buffers.size,1);
 assert.ok(s.getMaxBuffers()<=2);s.layer.onRemove(null,s.gl);assert.equal(s.buffers.size,0);
});

test('immediate updates and interrupted fades settle, invalidate old picks, and cap graphics memory',async t=>{
 let now=0;t.mock.method(performance,'now',()=>now);const s=scene();
 s.layer.setSurface(triangle(2000));s.render();const first=s.layer.setSurface(triangle(4000),{durationMs:400});s.render();
 now=100;const second=s.layer.setSurface(triangle(6000),{durationMs:400});await first;s.render();
 s.layer.setSurface(triangle(8000),{durationMs:0});await second;
 assert.equal(s.layer.pick({x:500,y:400},1000,800),null);s.render();close(s.layer.pick({x:500,y:400},1000,800).height,8000);
 assert.ok(s.getMaxBuffers()<=2);
 const last=s.layer.setSurface(triangle(10000),{durationMs:400});s.render();s.layer.onRemove(null,s.gl);await last;
 assert.equal(s.buffers.size,0);assert.equal(s.layer.pick({x:500,y:400},1000,800),null);
});

test('rendering restores shared graphics state on success and draw failure',()=>{
 const ctx=context(),before=ctx.snapshot(),layer=createCloudTopLayer(coordinates);
 layer.onAdd({triggerRepaint(){}},ctx.gl);assert.deepEqual(ctx.snapshot(),before);layer.setSurface(triangle());
 layer.render(ctx.gl,{defaultProjectionData:{mainMatrix:view}});assert.deepEqual(ctx.snapshot(),before);
 ctx.gl.drawArrays=()=>{throw Error('draw failed');};
 assert.throws(()=>layer.render(ctx.gl,{defaultProjectionData:{mainMatrix:view}}),/draw failed/);
 assert.deepEqual(ctx.snapshot(),before);assert.equal(layer.pick({x:500,y:400},1000,800),null);
});

test('invalid observations cannot replace the current measurement',()=>{
 const s=scene();s.layer.setSurface(triangle());s.render();
 for(const invalid of [new Float32Array([0,0,1]),triangle(-1),triangle(20001),triangle(NaN)])
  assert.throws(()=>s.layer.setSurface(invalid),/cloud-top/i);
 close(s.layer.pick({x:500,y:400},1000,800).height,5500);
 assert.throws(()=>s.layer.setSurface(triangle(),{durationMs:NaN}),/duration/i);
});

test('terrain comparisons use the same rendered depth and become unavailable with an invalid projection',()=>{
 const s=scene();s.layer.setSurface(triangle());s.render();
 const hit=s.layer.pick({x:500,y:400},1000,800),terrain=s.layer.projectDepth(hit.lon,hit.lat,2000);
 assert.ok(terrain>hit.depth,'The lower terrain is behind the observed cloud in this camera.');
 close(s.layer.projectDepth(hit.lon,hit.lat,hit.height),hit.depth,0.000001);
 assert.equal(s.layer.projectDepth(hit.lon,hit.lat,NaN),null);
 s.layer.invalidatePick();assert.equal(s.layer.projectDepth(hit.lon,hit.lat,2000),null);
});

test('a failed upload releases its incomplete buffer and retries safely on the next render',()=>{
 const s=scene(),before=s.snapshot(),upload=s.gl.bufferData;s.layer.setSurface(triangle());
 s.gl.bufferData=()=>{throw Error('upload interrupted');};assert.throws(()=>s.render(),/upload interrupted/);
 assert.deepEqual(s.snapshot(),before);assert.equal(s.buffers.size,0);
 s.gl.bufferData=upload;s.render();close(s.layer.pick({x:500,y:400},1000,800).height,5500);
});

test('reduced motion can finish an active transition to the same observation immediately',async t=>{
 let now=0;t.mock.method(performance,'now',()=>now);const s=scene(),next=triangle(10000);
 s.layer.setSurface(triangle(2000));s.render();const done=s.layer.setSurface(next,{durationMs:400});
 now=100;s.render();s.layer.setSurface(next,{durationMs:0});s.render();
 close(s.layer.pick({x:500,y:400},1000,800).height,10000);await done;assert.equal(s.buffers.size,1);
});

test('the maximum regional mesh supports repeated local picks without filling an interior missing cell',t=>{
 const nx=250,ny=200,vertices=new Float32Array(nx*ny*18);let at=0;
 for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){
  const west=-122.5+x*6/nx,east=west+6/nx,south=34.75+y*4.85/ny,north=south+4.85/ny;
  // A missing cell is represented by a degenerate triangle, never a height fabricated across it.
  const cell=x===125&&y===100?[west,south,5500,west,south,5500,west,south,5500,west,south,5500,west,south,5500,west,south,5500]:
   [west,south,5500,east,south,5500,west,north,5500,west,north,5500,east,south,5500,east,north,5500];
  vertices.set(cell,at);at+=18;
 }
 const s=scene(),start=performance.now();s.layer.setSurface(vertices);s.render();const built=performance.now();
 for(let i=0;i<250;i++)close(s.layer.pick({x:400+i%200,y:350+i%100},1000,800).height,5500);
 const sampled=performance.now();
 assert.equal(s.layer.pick(project(-119.488,37.187125,5500),1000,800),null);
 t.diagnostic(`300,000 vertices: build ${(built-start).toFixed(1)} ms; 250 picks ${(sampled-built).toFixed(1)} ms.`);
});
