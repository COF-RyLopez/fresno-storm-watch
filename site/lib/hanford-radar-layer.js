import {radarSampleColor} from './hanford-radar-data.js';

const vertex=`#version 300 es
layout(location=0) in vec3 position;
layout(location=1) in vec3 reflectivityColor;
uniform mat4 matrix;
uniform float size;
out vec3 color;
void main() {
  gl_Position = matrix * vec4(position, 1.0);
  gl_PointSize = size;
  color = reflectivityColor;
}`;
const fragment=`#version 300 es
precision mediump float;
in vec3 color;
out vec4 pixel;
void main() {
  if (distance(gl_PointCoord, vec2(0.5)) > 0.5) discard;
  pixel = vec4(color * 0.82, 0.82);
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

/** Use MapLibre's existing context and depth buffer. One static point buffer per scan. */
export function createHanfordRadarLayer(MercatorCoordinate){
 let map,compiled,buffer,vao,matrix,size,vertices=null,count=0,input=null;
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
    matrix=gl.getUniformLocation(compiled,'matrix');size=gl.getUniformLocation(compiled,'size');
    gl.bindVertexArray(vao);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
    gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,3,gl.FLOAT,false,24,0);
    gl.enableVertexAttribArray(1);gl.vertexAttribPointer(1,3,gl.FLOAT,false,24,12);
   }catch(error){release(gl);throw error;}
   finally{gl.bindVertexArray(null);gl.bindBuffer(gl.ARRAY_BUFFER,null);}
  },
  setSamples(samples){
   if(input===samples)return;
   input=samples;count=samples.length/4;
   vertices=new Float32Array(count*6);
   for(let i=0,j=0;i<samples.length;i+=4,j+=6){
    const point=MercatorCoordinate.fromLngLat({lng:samples[i],lat:samples[i+1]},samples[i+2]);
    const [r,g,b]=radarSampleColor(samples[i+3]);
    vertices[j]=point.x;vertices[j+1]=point.y;vertices[j+2]=point.z;
    vertices[j+3]=r/255;vertices[j+4]=g/255;vertices[j+5]=b/255;
   }
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
   gl.uniform1f(size,Math.min(6,3*(globalThis.devicePixelRatio||1)));
   gl.drawArrays(gl.POINTS,0,count);
   gl.bindVertexArray(null);
  },
  onRemove(_map,gl){release(gl);count=0;vertices=input=map=null;}
 };
}
