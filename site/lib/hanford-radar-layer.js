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
out vec4 pixel;
void main() {
  // Round and feather inward only: never color outside this occupied horizontal bin.
  vec2 edge = abs(uv - vec2(0.5)) - vec2(0.38);
  float distanceToEdge = length(max(edge, vec2(0.0))) + min(max(edge.x, edge.y), 0.0) - 0.12;
  if (distanceToEdge >= 0.0) discard;
  float feather = max(fwidth(distanceToEdge) * 1.25, 0.04);
  float coverage = 1.0 - smoothstep(-feather, 0.0, distanceToEdge);
  float opacity = mix(0.28, 0.48, smoothstep(0.0, 0.16, -distanceToEdge)) * coverage;
  pixel = vec4(color * opacity, opacity);
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
 let map,compiled,buffer,vao,matrix,vertices=null,count=0,input=null,minimum;
 const mvp=new Float32Array(16);
 const release=gl=>{
  if(vao)gl.deleteVertexArray(vao);
  if(buffer)gl.deleteBuffer(buffer);
  if(compiled)gl.deleteProgram(compiled);
  vao=buffer=compiled=null;
 };
 return {
  id:'watch-hanford-radar',type:'custom',renderingMode:'3d',
  onAdd(owner,gl){
   map=owner;
   try{
    compiled=program(gl);buffer=gl.createBuffer();vao=gl.createVertexArray();
    if(!buffer||!vao)throw Error('Hanford radar buffer unavailable');
    matrix=gl.getUniformLocation(compiled,'matrix');
    gl.bindVertexArray(vao);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
    for(const [index,size,offset]of [[0,4,0],[1,1,16],[2,3,20]]){
     gl.enableVertexAttribArray(index);gl.vertexAttribPointer(index,size,gl.FLOAT,false,32,offset);
     gl.vertexAttribDivisor(index,1);
    }
   }catch(error){release(gl);throw error;}
   finally{gl.bindVertexArray(null);gl.bindBuffer(gl.ARRAY_BUFFER,null);}
  },
  setSamples(samples,minDbz){
   if(input===samples&&minimum===minDbz)return;
   const cells=radarEchoCells(samples,minDbz);
   const next=new Float32Array(cells.length*8);
   cells.forEach(({west,south,east,north,height,dbz},index)=>{
    const start=MercatorCoordinate.fromLngLat([west,north]);
    const end=MercatorCoordinate.fromLngLat([east,south]);
    const level=MercatorCoordinate.fromLngLat([(west+east)/2,(south+north)/2],height);
    const [r,g,b]=radarSampleColor(dbz);
    next.set([start.x,start.y,end.x,end.y,level.z,r/255,g/255,b/255],index*8);
   });
   input=samples;minimum=minDbz;count=cells.length;vertices=next;
   map?.triggerRepaint();
  },
  render(gl,{defaultProjectionData}){
   if(!compiled||!count)return;
   const depthWrite=gl.getParameter(gl.DEPTH_WRITEMASK),cull=gl.isEnabled(gl.CULL_FACE);
   try{
    gl.depthMask(false);gl.disable(gl.CULL_FACE);gl.bindVertexArray(vao);
    if(vertices){
     gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
     gl.bufferData(gl.ARRAY_BUFFER,vertices,gl.STATIC_DRAW);
     vertices=null;
    }
    gl.useProgram(compiled);
    mvp.set(defaultProjectionData.mainMatrix);
    gl.uniformMatrix4fv(matrix,false,mvp);
    // MapLibre supplies premultiplied-alpha blending; the shader keeps the same dBZ colors.
    gl.drawArraysInstanced(gl.TRIANGLES,0,6,count);
   }finally{gl.bindVertexArray(null);gl.depthMask(depthWrite);if(cull)gl.enable(gl.CULL_FACE);}
  },
  onRemove(_map,gl){release(gl);count=0;vertices=input=map=null;}
 };
}
