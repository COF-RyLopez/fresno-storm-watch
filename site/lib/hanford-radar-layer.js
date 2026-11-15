import {radarSampleColor} from './hanford-radar-data.js';
import {radarEchoCells} from './hanford-radar-cells.js';

const vertex=`#version 300 es
layout(location=0) in vec4 bounds;
layout(location=1) in float altitude;
layout(location=2) in vec3 reflectivityColor;
uniform mat4 matrix;
out vec3 color;
out vec2 uv;
const vec2 corners[6] = vec2[6](
  vec2(0,0),vec2(1,0),vec2(0,1),vec2(0,1),vec2(1,0),vec2(1,1)
);
void main() {
  uv = corners[gl_VertexID];
  gl_Position = matrix * vec4(mix(bounds.xy, bounds.zw, uv), altitude, 1.0);
  color = reflectivityColor;
}`;
const fragment=`#version 300 es
precision mediump float;
in vec3 color;
in vec2 uv;
uniform float frameOpacity;
out vec4 pixel;
void main() {
  // Round and feather inward only: never color outside this occupied horizontal bin.
  vec2 edge = abs(uv - vec2(0.5)) - vec2(0.38);
  float distanceToEdge = length(max(edge, vec2(0.0))) + min(max(edge.x, edge.y), 0.0) - 0.12;
  if (distanceToEdge >= 0.0) discard;
  float feather = max(fwidth(distanceToEdge) * 1.25, 0.04);
  float coverage = 1.0 - smoothstep(-feather, 0.0, distanceToEdge);
  float opacity = mix(0.28, 0.48, smoothstep(0.0, 0.16, -distanceToEdge)) * coverage;
  pixel = vec4(color * opacity, opacity) * frameOpacity;
}`;

function shader(gl,type,code){
 const shader=gl.createShader(type);
 if(!shader)throw Error('Hanford radar shader unavailable');
 gl.shaderSource(shader,code);
 gl.compileShader(shader);
 if(gl.getShaderParameter(shader,gl.COMPILE_STATUS))return shader;
 gl.deleteShader(shader);
 throw Error('Hanford radar shader did not compile');
}

function program(gl){
 let vert,frag,linked;
 try{
  vert=shader(gl,gl.VERTEX_SHADER,vertex);
  frag=shader(gl,gl.FRAGMENT_SHADER,fragment);
  linked=gl.createProgram();
  if(!linked)throw Error('Hanford radar program unavailable');
  gl.attachShader(linked,vert);
  gl.attachShader(linked,frag);
  gl.linkProgram(linked);
  if(!gl.getProgramParameter(linked,gl.LINK_STATUS))throw Error('Hanford radar program did not link');
  return linked;
 }catch(error){if(linked)gl.deleteProgram(linked);throw error;}
 finally{if(vert)gl.deleteShader(vert);if(frag)gl.deleteShader(frag);}
}

/**
 * Soft horizontal reflectivity footprints, not boxes or reconstructed storm volumes.
 * Each occupied ~4 km bin keeps its strongest return's estimated sample height.
 * Terrain depth is respected, but radar never writes depth that could hide ground labels.
 */
export function createHanfordRadarLayer(MercatorCoordinate){
 let map,context,compiled,matrix,frameOpacity,current={input:null,count:0},previous=null,transition=null;
 const mvp=new Float32Array(16);
 const dispose=frame=>{
  if(frame?.vao)context.deleteVertexArray(frame.vao);
  if(frame?.buffer)context.deleteBuffer(frame.buffer);
  if(frame)frame.vao=frame.buffer=null;
 };
 const release=gl=>{
  dispose(previous);dispose(current);previous=transition=null;
  if(compiled)gl.deleteProgram(compiled);
  compiled=null;
 };
 const allocate=(gl,frame)=>{
  if(frame.buffer&&frame.vao)return;
  frame.buffer=gl.createBuffer();frame.vao=gl.createVertexArray();
  if(!frame.buffer||!frame.vao)throw Error('Hanford radar buffer unavailable');
  gl.bindVertexArray(frame.vao);gl.bindBuffer(gl.ARRAY_BUFFER,frame.buffer);
  for(const [index,size,offset]of [[0,4,0],[1,1,16],[2,3,20]]){
   gl.enableVertexAttribArray(index);gl.vertexAttribPointer(index,size,gl.FLOAT,false,32,offset);
   gl.vertexAttribDivisor(index,1);
  }
 };
 return {
  id:'watch-hanford-radar',type:'custom',renderingMode:'3d',
  onAdd(owner,gl){
   context=gl;
   const vao=gl.getParameter(gl.VERTEX_ARRAY_BINDING),buffer=gl.getParameter(gl.ARRAY_BUFFER_BINDING);
   try{
    compiled=program(gl);allocate(gl,current);
    matrix=gl.getUniformLocation(compiled,'matrix');frameOpacity=gl.getUniformLocation(compiled,'frameOpacity');
    if(matrix===null||frameOpacity===null)throw Error('Hanford radar shader uniforms unavailable');
    map=owner;
   }catch(error){release(gl);throw error;}
   finally{gl.bindVertexArray(vao);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);}
  },
  setSamples(samples,minDbz=20,{durationMs=0}={}){
   const animate=Number.isFinite(durationMs)&&durationMs>0;
   if(current.input===samples&&current.minimum===minDbz){
    if(previous&&!animate){dispose(previous);previous=transition=null;map?.triggerRepaint();}
    return;
   }
   const cells=radarEchoCells(samples,minDbz);
   const next=new Float32Array(cells.length*8);
   cells.forEach(({west,south,east,north,height,dbz},index)=>{
    const start=MercatorCoordinate.fromLngLat([west,north]);
    const end=MercatorCoordinate.fromLngLat([east,south]);
    const level=MercatorCoordinate.fromLngLat([(west+east)/2,(south+north)/2],height);
    const [r,g,b]=radarSampleColor(dbz);
    next.set([start.x,start.y,end.x,end.y,level.z,r/255,g/255,b/255],index*8);
   });
   const frame={input:samples,minimum:minDbz,count:cells.length,vertices:next,buffer:null,vao:null};
   dispose(previous);previous=transition=null;
   if(animate&&compiled&&current.input&&current.minimum===minDbz&&(current.count||frame.count)){
    previous=current;transition={durationMs,start:null};
   }else{
    frame.buffer=current.buffer;frame.vao=current.vao;
    current.buffer=current.vao=null;
   }
   current=frame;
   map?.triggerRepaint();
  },
  render(gl,{defaultProjectionData}){
   if(!compiled||!current.count&&!previous?.count)return;
   const saved={program:gl.getParameter(gl.CURRENT_PROGRAM),vao:gl.getParameter(gl.VERTEX_ARRAY_BINDING),buffer:gl.getParameter(gl.ARRAY_BUFFER_BINDING),
    depthWrite:gl.getParameter(gl.DEPTH_WRITEMASK),depthFunc:gl.getParameter(gl.DEPTH_FUNC),
    enabled:[gl.DEPTH_TEST,gl.CULL_FACE,gl.BLEND].map(key=>gl.isEnabled(key)),
    blend:['BLEND_SRC_RGB','BLEND_DST_RGB','BLEND_SRC_ALPHA','BLEND_DST_ALPHA','BLEND_EQUATION_RGB','BLEND_EQUATION_ALPHA'].map(key=>gl.getParameter(gl[key]))};
   try{
    // Upload each observed field once; only display opacity changes between frames.
    for(const frame of [previous,current])if(frame?.count){
     allocate(gl,frame);
     if(frame.vertices){gl.bindBuffer(gl.ARRAY_BUFFER,frame.buffer);gl.bufferData(gl.ARRAY_BUFFER,frame.vertices,gl.STATIC_DRAW);frame.vertices=null;}
    }
    let progress=1;
    if(transition){
     const now=performance.now();transition.start??=now;
     progress=Math.max(0,Math.min(1,(now-transition.start)/transition.durationMs));
     if(progress===1){dispose(previous);previous=transition=null;}
    }
    gl.depthMask(false);gl.depthFunc(gl.LEQUAL);gl.enable(gl.DEPTH_TEST);gl.disable(gl.CULL_FACE);gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.ONE,gl.ONE_MINUS_SRC_ALPHA,gl.ONE,gl.ONE_MINUS_SRC_ALPHA);gl.blendEquationSeparate(gl.FUNC_ADD,gl.FUNC_ADD);
    gl.useProgram(compiled);mvp.set(defaultProjectionData.mainMatrix);gl.uniformMatrix4fv(matrix,false,mvp);
    // Premultiplied color composition only: no interpolated reflectivity, heights or motion.
    for(const [frame,opacity]of [[previous,1-progress],[current,progress]])if(frame?.count&&opacity>0){
     gl.bindVertexArray(frame.vao);gl.bindBuffer(gl.ARRAY_BUFFER,frame.buffer);gl.uniform1f(frameOpacity,opacity);
     gl.drawArraysInstanced(gl.TRIANGLES,0,6,frame.count);
    }
   }catch(error){release(gl);throw error;}
   finally{
    gl.useProgram(saved.program);gl.bindVertexArray(saved.vao);gl.bindBuffer(gl.ARRAY_BUFFER,saved.buffer);
    gl.depthMask(saved.depthWrite);gl.depthFunc(saved.depthFunc);gl.blendFuncSeparate(...saved.blend.slice(0,4));gl.blendEquationSeparate(...saved.blend.slice(4));
    [gl.DEPTH_TEST,gl.CULL_FACE,gl.BLEND].forEach((key,i)=>saved.enabled[i]?gl.enable(key):gl.disable(key));
   }
   if(transition)map?.triggerRepaint();
  },
  onRemove(_map,gl){release(gl);current={input:null,count:0};map=context=null;}
 };
}
