import {radarSampleColor} from './hanford-radar-data.js';
import {radarEchoCells} from './hanford-radar-cells.js';

const vertex=`#version 300 es
layout(location=0) in vec3 minimum;
layout(location=1) in vec3 maximum;
layout(location=2) in vec3 reflectivityColor;
uniform mat4 matrix;
out vec3 color;
const vec3 corners[8] = vec3[8](
  vec3(0,0,0),vec3(1,0,0),vec3(1,1,0),vec3(0,1,0),
  vec3(0,0,1),vec3(1,0,1),vec3(1,1,1),vec3(0,1,1)
);
const int faces[36] = int[36](
  0,2,1,0,3,2, 4,5,6,4,6,7, 0,1,5,0,5,4,
  1,2,6,1,6,5, 2,3,7,2,7,6, 3,0,4,3,4,7
);
const float shade[6] = float[6](0.65,1.0,0.76,0.87,0.76,0.87);
void main() {
  gl_Position = matrix * vec4(mix(minimum, maximum, corners[faces[gl_VertexID]]), 1.0);
  color = shade[gl_VertexID / 6] * reflectivityColor;
}`;
const fragment=`#version 300 es
precision mediump float;
in vec3 color;
out vec4 pixel;
void main() {
  pixel = vec4(color * 0.74, 0.74);
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

/** Use MapLibre's existing depth buffer and one instance per occupied echo cell. */
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
    for(let index=0;index<3;index++){
     gl.enableVertexAttribArray(index);gl.vertexAttribPointer(index,3,gl.FLOAT,false,36,index*12);
     gl.vertexAttribDivisor(index,1);
    }
   }catch(error){release(gl);throw error;}
   finally{gl.bindVertexArray(null);gl.bindBuffer(gl.ARRAY_BUFFER,null);}
  },
  setSamples(samples,minDbz){
   if(input===samples&&minimum===minDbz)return;
   input=samples;minimum=minDbz;
   const cells=radarEchoCells(samples,minDbz);
   count=cells.length;vertices=new Float32Array(count*9);
   cells.forEach(({west,south,east,north,bottom,top,dbz},index)=>{
    const start=MercatorCoordinate.fromLngLat([west,north],bottom);
    const end=MercatorCoordinate.fromLngLat([east,south],top);
    const [r,g,b]=radarSampleColor(dbz);
    vertices.set([start.x,start.y,start.z,end.x,end.y,end.z,r/255,g/255,b/255],index*9);
   });
   map.triggerRepaint();
  },
  render(gl,{defaultProjectionData}){
   if(!compiled||!count)return;
   gl.bindVertexArray(vao);
   if(vertices){
    gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
    gl.bufferData(gl.ARRAY_BUFFER,vertices,gl.STATIC_DRAW);
    vertices=null;
   }
   gl.useProgram(compiled);
   mvp.set(defaultProjectionData.mainMatrix);
   gl.uniformMatrix4fv(matrix,false,mvp);
   gl.drawArraysInstanced(gl.TRIANGLES,0,36,count);
   gl.bindVertexArray(null);
  },
  onRemove(_map,gl){release(gl);count=0;vertices=input=map=null;}
 };
}
