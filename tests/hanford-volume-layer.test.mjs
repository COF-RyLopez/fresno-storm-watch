import test from 'node:test';
import assert from 'node:assert/strict';
import {createHanfordVolumeLayer,volumeGeometry,volumeMatrices} from '../site/lib/hanford-volume-layer.js';

const R=6378137,C=2*Math.PI*6371008.8;
const coordinates={fromLngLat:([lon,lat],height=0)=>({x:(lon+180)/360,
 y:(1-Math.log(Math.tan(Math.PI/4+lat*Math.PI/360))/Math.PI)/2,z:height/(C*Math.cos(lat*Math.PI/180))})};
const mercatorY=lat=>R*Math.log(Math.tan(Math.PI/4+lat*Math.PI/360));
const identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
const fixture=()=>({values:new Float32Array(24*48*64).fill(-999),shape:[24,48,64],
 bounds3857:[-120.6*Math.PI*R/180,mercatorY(36.3),-118.5*Math.PI*R/180,mercatorY(37.7)],heightRange:[0,12000]});
const apply=(matrix,point)=>Array.from({length:4},(_,row)=>point.reduce((sum,v,column)=>sum+matrix[column*4+row]*v,0));
const close=(actual,expected,tolerance=1e-7)=>assert.ok(Math.abs(actual-expected)<tolerance,`${actual} != ${expected}`);

test('renderer accepts the same finite 10-to-under-80 range as the source loader',()=>{
 const data=fixture();data.values[0]=79.75;
 assert.equal(volumeGeometry(data,coordinates).maximum,79.75);
 data.values[0]=80;assert.throws(()=>volumeGeometry(data,coordinates),/reflectivity/);
});

// This fake tracks context state, not implementation internals: leaks affect subsequent map layers.
function context({compile=true,link=true,allocation=true}={}){
 const gl={},calls=[],shaders=[],uniforms=new Map(),state=new Map(),enabled=new Set(),textures=new Map(),samplers=new Map(),allocated=new Set();let maximumTextures=0;
 const names=['VERTEX_SHADER','FRAGMENT_SHADER','COMPILE_STATUS','LINK_STATUS','CURRENT_PROGRAM','VERTEX_ARRAY_BINDING',
  'ACTIVE_TEXTURE','TEXTURE0','TEXTURE_3D','TEXTURE_BINDING_3D','SAMPLER_BINDING','MAX_3D_TEXTURE_SIZE','TEXTURE_MIN_FILTER',
  'TEXTURE_MAG_FILTER','TEXTURE_WRAP_S','TEXTURE_WRAP_T','TEXTURE_WRAP_R','NEAREST','CLAMP_TO_EDGE','R32F','RED','FLOAT',
  'UNPACK_ALIGNMENT','UNPACK_ROW_LENGTH','UNPACK_IMAGE_HEIGHT','UNPACK_SKIP_PIXELS','UNPACK_SKIP_ROWS','UNPACK_SKIP_IMAGES',
  'UNPACK_FLIP_Y_WEBGL','UNPACK_PREMULTIPLY_ALPHA_WEBGL','PIXEL_UNPACK_BUFFER','PIXEL_UNPACK_BUFFER_BINDING',
  'DEPTH_WRITEMASK','DEPTH_TEST','DEPTH_FUNC','CULL_FACE','BLEND','BLEND_SRC_RGB','BLEND_DST_RGB','BLEND_SRC_ALPHA',
  'BLEND_DST_ALPHA','BLEND_EQUATION_RGB','BLEND_EQUATION_ALPHA','LEQUAL','ONE','ONE_MINUS_SRC_ALPHA','FUNC_ADD','TRIANGLES','NO_ERROR'];
 names.forEach((name,index)=>{gl[name]=index+1;});
 state.set(gl.ACTIVE_TEXTURE,gl.TEXTURE0+4);state.set(gl.CURRENT_PROGRAM,{old:'program'});state.set(gl.VERTEX_ARRAY_BINDING,{old:'vao'});
 state.set(gl.PIXEL_UNPACK_BUFFER_BINDING,{old:'unpack'});state.set(gl.DEPTH_WRITEMASK,true);state.set(gl.DEPTH_FUNC,12345);
 state.set(gl.MAX_3D_TEXTURE_SIZE,256);enabled.add(gl.CULL_FACE);
 for(const name of names.filter(name=>name.startsWith('UNPACK_')))state.set(gl[name],name.endsWith('WEBGL')?true:7);
 for(const name of names.filter(name=>name.startsWith('BLEND_')))state.set(gl[name],999);
 textures.set(gl.TEXTURE0,{old:'volume texture'});samplers.set(gl.TEXTURE0,{old:'sampler'});
 textures.set(gl.TEXTURE0+4,{other:'texture'});samplers.set(gl.TEXTURE0+4,{other:'sampler'});
 gl.getParameter=key=>key===gl.TEXTURE_BINDING_3D?textures.get(state.get(gl.ACTIVE_TEXTURE)):key===gl.SAMPLER_BINDING?samplers.get(state.get(gl.ACTIVE_TEXTURE)):state.get(key);
 gl.isEnabled=key=>enabled.has(key);gl.enable=key=>enabled.add(key);gl.disable=key=>enabled.delete(key);
 gl.createShader=type=>({type});gl.shaderSource=(shader,code)=>{shader.code=code;shaders.push(shader);};gl.compileShader=()=>{};
 gl.getShaderParameter=()=>compile;gl.getShaderInfoLog=()=> 'test shader failure';gl.deleteShader=()=>calls.push(['deleteShader']);
 gl.createProgram=()=>({new:'program'});gl.attachShader=()=>{};gl.linkProgram=()=>{};gl.getProgramParameter=()=>link;
 gl.getProgramInfoLog=()=> 'test link failure';gl.deleteProgram=()=>calls.push(['deleteProgram']);
 gl.createVertexArray=()=>({new:'vao'});gl.deleteVertexArray=()=>calls.push(['deleteVertexArray']);
 gl.createTexture=()=>{if(!allocation)return null;const texture={new:'texture'};allocated.add(texture);maximumTextures=Math.max(maximumTextures,allocated.size);return texture;};
 gl.deleteTexture=texture=>{allocated.delete(texture);calls.push(['deleteTexture']);};
 gl.getUniformLocation=(_program,name)=>name;gl.bindVertexArray=value=>state.set(gl.VERTEX_ARRAY_BINDING,value);
 gl.useProgram=value=>state.set(gl.CURRENT_PROGRAM,value);gl.activeTexture=value=>state.set(gl.ACTIVE_TEXTURE,value);
 gl.bindTexture=(_target,value)=>textures.set(state.get(gl.ACTIVE_TEXTURE),value);
 gl.bindSampler=(unit,value)=>samplers.set(gl.TEXTURE0+unit,value);
 gl.bindBuffer=(target,value)=>{assert.equal(target,gl.PIXEL_UNPACK_BUFFER);state.set(gl.PIXEL_UNPACK_BUFFER_BINDING,value);};
 gl.pixelStorei=(key,value)=>state.set(key,value);gl.texParameteri=(...args)=>calls.push(['parameter',...args]);
 gl.texImage3D=(...args)=>{assert.equal(state.get(gl.PIXEL_UNPACK_BUFFER_BINDING),null);assert.equal(state.get(gl.UNPACK_FLIP_Y_WEBGL),false);calls.push(['upload',...args]);};
 gl.getError=()=>gl.NO_ERROR;gl.isContextLost=()=>false;
 gl.depthMask=value=>state.set(gl.DEPTH_WRITEMASK,value);gl.depthFunc=value=>state.set(gl.DEPTH_FUNC,value);
 gl.blendEquationSeparate=(rgb,alpha)=>{state.set(gl.BLEND_EQUATION_RGB,rgb);state.set(gl.BLEND_EQUATION_ALPHA,alpha);};
 gl.blendFuncSeparate=(...values)=>['BLEND_SRC_RGB','BLEND_DST_RGB','BLEND_SRC_ALPHA','BLEND_DST_ALPHA'].forEach((name,i)=>state.set(gl[name],values[i]));
 gl.uniformMatrix4fv=(name,_transpose,value)=>uniforms.set(name,Array.from(value));
 for(const method of ['uniform1i','uniform1f','uniform2f','uniform3f','uniform4f'])gl[method]=(name,...value)=>uniforms.set(name,value);
 gl.drawArrays=(...args)=>{assert.equal(state.get(gl.DEPTH_WRITEMASK),false);assert.ok(enabled.has(gl.DEPTH_TEST));assert.ok(enabled.has(gl.BLEND));assert.ok(!enabled.has(gl.CULL_FACE));calls.push(['draw',...args]);calls.push(['frame',textures.get(gl.TEXTURE0),uniforms.get('frameOpacity')?.[0]]);};
 const snapshot=()=>({state:new Map(state),enabled:new Set(enabled),textures:new Map(textures),samplers:new Map(samplers)});
 return {gl,calls,shaders,uniforms,snapshot,allocated,maximumTextures:()=>maximumTextures};
}

test('projected x/y and metre heights agree with MapLibre across the volume latitude range',()=>{
 const volume=fixture(),geometry=volumeGeometry(volume,coordinates);
 for(const [x,y]of [[0,0],[0.5,0.5],[1,1]]){
  const lon=(volume.bounds3857[0]+x*(volume.bounds3857[2]-volume.bounds3857[0]))/R*180/Math.PI;
  const lat=Math.atan(Math.sinh((volume.bounds3857[1]+y*(volume.bounds3857[3]-volume.bounds3857[1]))/R))*180/Math.PI;
  const projected=coordinates.fromLngLat([lon,lat],12000);
  close(geometry.origin[0]+x*geometry.scale[0],projected.x);
  close(geometry.origin[1]+y*geometry.scale[1],projected.y);
  const localHeight=12000*Math.cosh(geometry.southAngle+y*geometry.angleSpan)/geometry.topScaledMeters;
  close(localHeight*geometry.scale[2],projected.z,1e-12);
 }
 assert.ok(geometry.scale[1]<0,'The source y axis increases north; normalized Mercator increases south.');
 close(geometry.scale[2],coordinates.fromLngLat([0,37.7],12000).z,1e-12);
});

test('local matrix and inverse retain perspective precision at a distant Mercator origin',()=>{
 const geometry=volumeGeometry(fixture(),coordinates);
 const view=[100,0,0,0,0,-100,0,0,0,0,-50,-30,-100*geometry.origin[0]-0.5,100*geometry.origin[1]+0.3,1,2];
 const {matrix,inverse}=volumeMatrices(view,geometry);
 for(const point of [[0,0,0,1],[0.5,0.7,0.8,1],[1,1,1,1]]){
  const clip=apply(matrix,point),back=apply(inverse,clip);
  back.forEach((value,i)=>close(value/back[3],point[i],2e-5));
  const world=point.map((value,i)=>i===3?1:geometry.origin[i]+value*geometry.scale[i]);
  apply(view,world).forEach((value,i)=>close(clip[i],value,2e-6));
 }
 assert.throws(()=>volumeMatrices(new Array(16).fill(0),geometry),/singular/i);
 assert.throws(()=>volumeMatrices([NaN,...identity.slice(1)],geometry),/matrix/i);
});

test('screen bounds contain all projected corners and conservatively cover a near-plane crossing',()=>{
 const geometry=volumeGeometry(fixture(),coordinates),{matrix,screenBounds}=volumeMatrices(identity,geometry);
 for(let z=0;z<=1;z++)for(let y=0;y<=1;y++)for(let x=0;x<=1;x++){
  const clip=apply(matrix,[x,y,z,1]);
  assert.ok(clip[0]>=screenBounds[0]-1e-7&&clip[0]<=screenBounds[2]+1e-7);
  assert.ok(clip[1]>=screenBounds[1]-1e-7&&clip[1]<=screenBounds[3]+1e-7);
 }
 assert.ok(screenBounds[2]-screenBounds[0]<0.01,'Work is limited to the volume footprint, not every screen pixel.');
 const perspective=[...identity];perspective[11]=-1;perspective[15]=geometry.scale[2]/2;
 assert.deepEqual(volumeMatrices(perspective,geometry).screenBounds,[-1,-1,1,1]);
});

test('malformed or excessive volumes cannot replace a valid measured field',()=>{
 const layer=createHanfordVolumeLayer(coordinates),base=fixture();base.values[0]=30;layer.setVolume(base);
 for(const invalid of [{...base,values:new Float32Array(1)},{...base,shape:[64,64,65]},
  {...base,bounds3857:[4,0,2,1]},{...base,heightRange:[0,12001]},
  {...base,values:new Float32Array(base.values).fill(NaN)},{...base,values:new Float32Array(base.values).fill(0)}]){
  assert.throws(()=>layer.setVolume(invalid),/volume/i);
 }
 assert.throws(()=>layer.setVolume(base,NaN),/threshold/i);
});

test('volume uploads z/y/x floats once and restores all shared GL state',()=>{
 const {gl,calls,snapshot,uniforms,shaders}=context(),before=snapshot(),layer=createHanfordVolumeLayer(coordinates);let repaints=0;
 const volume=fixture();volume.values[2*48*64+3*64+4]=45;
 layer.setVolume(volume);layer.onAdd({triggerRepaint:()=>repaints++},gl);assert.deepEqual(snapshot(),before);
 layer.render(gl,{defaultProjectionData:{mainMatrix:identity}});assert.deepEqual(snapshot(),before);
 const upload=calls.find(row=>row[0]==='upload');
 assert.deepEqual(upload.slice(1,10),[gl.TEXTURE_3D,0,gl.R32F,64,48,24,0,gl.RED,gl.FLOAT]);
 assert.equal(upload[10][2*48*64+3*64+4],45);assert.equal(upload[10][0],-999);
 assert.deepEqual(uniforms.get('minimumDbz'),[20]);
 layer.setVolume(volume,30);layer.render(gl,{defaultProjectionData:{mainMatrix:identity}});
 assert.equal(calls.filter(row=>row[0]==='upload').length,1,'A threshold change uses the same measured texture.');
 assert.equal(repaints,1);layer.setVolume(volume,30);assert.equal(repaints,1);
 const fragment=shaders.find(shader=>shader.type===gl.FRAGMENT_SHADER).code;
 assert.match(fragment,/gl_FragDepth\s*=/);assert.match(fragment,/texelFetch/);assert.match(fragment,/160/);
 layer.onRemove(null,gl);assert.equal(calls.filter(row=>row[0]==='deleteTexture').length,1);
 assert.equal(calls.filter(row=>row[0]==='deleteVertexArray').length,1);assert.equal(calls.filter(row=>row[0]==='deleteProgram').length,1);
});

test('empty and cleared volumes never draw or start a repaint loop',()=>{
 const {gl,calls}=context(),layer=createHanfordVolumeLayer(coordinates);let repaints=0;
 layer.onAdd({triggerRepaint:()=>repaints++},gl);layer.setVolume(fixture());
 layer.render(gl,{defaultProjectionData:{mainMatrix:identity}});layer.setVolume(null);
 layer.render(gl,{defaultProjectionData:{mainMatrix:identity}});
 assert.equal(calls.filter(row=>row[0]==='draw').length,0);assert.equal(repaints,2);
});

test('threshold changes hide all lower echoes without throwing away the measured texture',()=>{
 const {gl,calls}=context(),layer=createHanfordVolumeLayer(coordinates),volume=fixture();volume.values[0]=29.5;
 layer.onAdd({triggerRepaint(){}},gl);layer.setVolume(volume,30);
 layer.render(gl,{defaultProjectionData:{mainMatrix:identity}});
 assert.equal(calls.filter(row=>row[0]==='draw').length,0);
 layer.setVolume(volume,20);layer.render(gl,{defaultProjectionData:{mainMatrix:identity}});
 assert.equal(calls.filter(row=>row[0]==='draw').length,1);
 assert.equal(calls.filter(row=>row[0]==='upload').length,1);
 layer.setVolume(volume,30);layer.render(gl,{defaultProjectionData:{mainMatrix:identity}});
 assert.equal(calls.filter(row=>row[0]==='draw').length,1);
});

test('draw and upload failures restore map state and propagate for the footprint fallback',()=>{
 for(const method of ['drawArrays','texImage3D']){
  const {gl,snapshot}=context(),before=snapshot(),layer=createHanfordVolumeLayer(coordinates),volume=fixture();volume.values[0]=35;
  layer.onAdd({triggerRepaint(){}},gl);layer.setVolume(volume);gl[method]=()=>{throw Error(`${method} failed`);};
  assert.throws(()=>layer.render(gl,{defaultProjectionData:{mainMatrix:identity}}),/failed/);assert.deepEqual(snapshot(),before);
 }
});

test('GPU initialization failures delete partial resources and reject WebGL1',()=>{
 for(const option of [{compile:false},{link:false},{allocation:false}]){
  const {gl,calls,snapshot}=context(option),before=snapshot(),layer=createHanfordVolumeLayer(coordinates);
  assert.throws(()=>layer.onAdd({triggerRepaint(){}},gl),/Hanford volume/);assert.deepEqual(snapshot(),before);
  if(option.link===false||option.allocation===false)assert.equal(calls.filter(row=>row[0]==='deleteProgram').length,1);
 }
 assert.throws(()=>createHanfordVolumeLayer(coordinates).onAdd({},{}),/WebGL2/);
});

test('WebGL error codes propagate and restore state even when the driver does not throw',()=>{
 const {gl,snapshot}=context(),before=snapshot(),layer=createHanfordVolumeLayer(coordinates),volume=fixture();volume.values[0]=35;
 layer.onAdd({triggerRepaint(){}},gl);layer.setVolume(volume);gl.getError=()=>99999;
 assert.throws(()=>layer.render(gl,{defaultProjectionData:{mainMatrix:identity}}),/texture upload failed/);
 assert.deepEqual(snapshot(),before);
});

test('volume playback blends independent observed textures then releases the previous frame',t=>{
 let now=100,repaints=0;t.mock.method(performance,'now',()=>now);
 const {gl,calls,snapshot,allocated,maximumTextures}=context(),before=snapshot(),layer=createHanfordVolumeLayer(coordinates);
 const first=fixture(),second=fixture();first.values[0]=35;second.values[30]=65;
 layer.onAdd({triggerRepaint:()=>repaints++},gl);layer.setVolume(first,20);layer.render(gl,{defaultProjectionData:{mainMatrix:identity}});
 layer.setVolume(second,20,{durationMs:400});layer.render(gl,{defaultProjectionData:{mainMatrix:identity}});
 assert.deepEqual(calls.filter(row=>row[0]==='upload').map(row=>row[10]),[first.values,second.values]);
 now=300;calls.length=0;layer.render(gl,{defaultProjectionData:{mainMatrix:identity}});
 assert.deepEqual(calls.filter(row=>row[0]==='frame').map(row=>row[2]),[0.5,0.5]);
 assert.equal(calls.filter(row=>row[0]==='upload').length,0);assert.equal(allocated.size,2);assert.equal(maximumTextures(),2);assert.deepEqual(snapshot(),before);
 now=500;calls.length=0;layer.render(gl,{defaultProjectionData:{mainMatrix:identity}});
 assert.deepEqual(calls.filter(row=>row[0]==='frame').map(row=>row[2]),[1]);assert.equal(allocated.size,1);
 const settled=repaints;layer.render(gl,{defaultProjectionData:{mainMatrix:identity}});assert.equal(repaints,settled);
 layer.onRemove(null,gl);assert.equal(allocated.size,0);
});

test('interrupted volume transitions stay bounded and immediate updates cancel the fade',t=>{
 let now=0,repaints=0;t.mock.method(performance,'now',()=>now);
 const {gl,calls,allocated,maximumTextures}=context(),layer=createHanfordVolumeLayer(coordinates),first=fixture();first.values[0]=35;
 const render=()=>layer.render(gl,{defaultProjectionData:{mainMatrix:identity}});
 layer.onAdd({triggerRepaint:()=>repaints++},gl);layer.setVolume(first,20);render();
 for(let i=0;i<5;i++){now+=50;const next=fixture();next.values[i]=40+i;layer.setVolume(next,20,{durationMs:400});render();}
 assert.equal(allocated.size,2);assert.equal(maximumTextures(),2);
 layer.setVolume(first,20,{durationMs:-1});calls.length=0;render();
 assert.deepEqual(calls.filter(row=>row[0]==='frame').map(row=>row[2]),[1]);assert.equal(allocated.size,1);
 const next=fixture();next.values[0]=50;layer.setVolume(next,20,{durationMs:400});render();layer.onRemove(null,gl);
 const stopped=repaints;render();assert.equal(repaints,stopped);assert.equal(allocated.size,0);
});

test('volume transition upload and draw failures release both textures and stop animation',t=>{
 t.mock.method(performance,'now',()=>0);
 for(const method of ['drawArrays','texImage3D']){
  let repaints=0;const {gl,snapshot,allocated}=context(),before=snapshot(),layer=createHanfordVolumeLayer(coordinates),first=fixture(),second=fixture();
  first.values[0]=35;second.values[1]=50;layer.onAdd({triggerRepaint:()=>repaints++},gl);layer.setVolume(first,20);
  layer.render(gl,{defaultProjectionData:{mainMatrix:identity}});layer.setVolume(second,20,{durationMs:400});gl[method]=()=>{throw Error('GPU failed');};
  assert.throws(()=>layer.render(gl,{defaultProjectionData:{mainMatrix:identity}}),/GPU failed/);assert.deepEqual(snapshot(),before);assert.equal(allocated.size,0);
  const stopped=repaints;layer.render(gl,{defaultProjectionData:{mainMatrix:identity}});assert.equal(repaints,stopped);
 }
});

test('clearing a volume during a fade removes both scans without another animation repaint',t=>{
 let now=0,repaints=0;t.mock.method(performance,'now',()=>now);
 const {gl,calls,allocated}=context(),layer=createHanfordVolumeLayer(coordinates),first=fixture(),second=fixture();first.values[0]=35;second.values[1]=50;
 const render=()=>layer.render(gl,{defaultProjectionData:{mainMatrix:identity}});
 layer.onAdd({triggerRepaint:()=>repaints++},gl);layer.setVolume(first,20);render();layer.setVolume(second,20,{durationMs:400});render();
 layer.setVolume(null,20,{durationMs:400});calls.length=0;const stopped=repaints;now=200;render();
 assert.equal(calls.filter(row=>row[0]==='draw').length,0);assert.equal(repaints,stopped);assert.equal(allocated.size,1);
 layer.onRemove(null,gl);assert.equal(allocated.size,0);
});

test('invalid volume replacement preserves an active fade and settling the same frame does not upload again',t=>{
 let now=0;t.mock.method(performance,'now',()=>now);
 const {gl,calls,allocated}=context(),layer=createHanfordVolumeLayer(coordinates),first=fixture(),second=fixture();first.values[0]=35;second.values[1]=50;
 const render=()=>layer.render(gl,{defaultProjectionData:{mainMatrix:identity}});
 layer.onAdd({triggerRepaint(){}},gl);layer.setVolume(first,20);render();layer.setVolume(second,20,{durationMs:400});render();
 assert.throws(()=>layer.setVolume({...second,shape:[1,1,1]},20,{durationMs:400}),/volume/);
 now=200;calls.length=0;render();assert.deepEqual(calls.filter(row=>row[0]==='frame').map(row=>row[2]),[0.5,0.5]);assert.equal(allocated.size,2);
 layer.setVolume(second,20);calls.length=0;render();
 assert.deepEqual(calls.filter(row=>row[0]==='frame').map(row=>row[2]),[1]);assert.equal(calls.filter(row=>row[0]==='upload').length,0);assert.equal(allocated.size,1);
});
