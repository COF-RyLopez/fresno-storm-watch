const vertex=`#version 300 es
layout(location=0) in vec3 position;
uniform mat4 matrix;
out vec3 world;
void main() {
  world=position;
  gl_Position=matrix*vec4(position,1.0);
}`;
const fragment=`#version 300 es
precision highp float;
in vec3 world;
out vec4 pixel;
void main() {
  vec3 n=cross(dFdx(world),dFdy(world));
  float facing=abs(n.z)/max(length(n),0.000000000001);
  vec3 color=mix(vec3(0.65,0.72,0.82),vec3(0.94,0.96,0.98),facing);
  pixel=vec4(color*0.52,0.52);
}`;

function program(gl){
 const result=gl.createProgram(),shaders=[];
 if(!result)throw Error('GOES cloud-top program unavailable');
 try{
  for(const [type,code] of [[gl.VERTEX_SHADER,vertex],[gl.FRAGMENT_SHADER,fragment]]){
   const shader=gl.createShader(type);
   if(!shader)throw Error('GOES cloud-top shader unavailable');
   shaders.push(shader);
   gl.shaderSource(shader,code);gl.compileShader(shader);
   if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw Error('GOES cloud-top shader did not compile');
   gl.attachShader(result,shader);
  }
  gl.linkProgram(result);
  if(!gl.getProgramParameter(result,gl.LINK_STATUS))throw Error('GOES cloud-top program did not link');
  return result;
 }catch(error){gl.deleteProgram(result);throw error;}
 finally{for(const shader of shaders)gl.deleteShader(shader);}
}

/** Render the retrieved surface at its altitude in the shared MapLibre scene. */
export function createCloudTopLayer(MercatorCoordinate){
 let map,compiled,buffer,vao,matrix,pending=null,count=0,input=null;
 const mvp=new Float32Array(16);
 const release=gl=>{
  if(vao)gl.deleteVertexArray(vao);
  if(buffer)gl.deleteBuffer(buffer);
  if(compiled)gl.deleteProgram(compiled);
  vao=buffer=compiled=null;
 };
 return {id:'watch-goes-cloud-tops',type:'custom',renderingMode:'3d',
  onAdd(owner,gl){
   map=owner;
   try{
    compiled=program(gl);buffer=gl.createBuffer();vao=gl.createVertexArray();
    if(!buffer||!vao)throw Error('GOES cloud-top graphics unavailable');
    matrix=gl.getUniformLocation(compiled,'matrix');
    gl.bindVertexArray(vao);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
    gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,3,gl.FLOAT,false,12,0);
   }catch(error){release(gl);throw error;}
   finally{gl.bindVertexArray(null);gl.bindBuffer(gl.ARRAY_BUFFER,null);}
  },
  setSurface(vertices){
   if(input===vertices)return;
   input=vertices;count=vertices.length/3;
   pending=new Float32Array(vertices.length);
   for(let i=0;i<vertices.length;i+=3){
    const point=MercatorCoordinate.fromLngLat([vertices[i],vertices[i+1]],vertices[i+2]);
    pending[i]=point.x;pending[i+1]=point.y;pending[i+2]=point.z;
   }
   map.triggerRepaint();
  },
  render(gl,{defaultProjectionData}){
   if(!compiled||!count)return;
   gl.bindVertexArray(vao);
   if(pending){gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,pending,gl.STATIC_DRAW);pending=null;}
   gl.useProgram(compiled);
   mvp.set(defaultProjectionData.mainMatrix);gl.uniformMatrix4fv(matrix,false,mvp);
   // Read terrain depth for occlusion; keep the following radar and ground symbols above the translucent surface.
   gl.depthMask(false);
   gl.drawArrays(gl.TRIANGLES,0,count);
   gl.depthMask(true);
   gl.bindVertexArray(null);
  },
  onRemove(_map,gl){release(gl);count=0;pending=input=map=null;}
 };
}
