import {CLOUD_TOP_HEIGHT_BANDS} from './cloud-top-style.js';

const MAX_VERTICES=300000,LEAF_SIZE=12,MAX_ALPHA=0.58;
const vertex=`#version 300 es
layout(location=0) in vec4 positionHeight;
uniform mat4 matrix;
out float height;
void main(){height=positionHeight.w;gl_Position=matrix*vec4(positionHeight.xyz,1.0);}`;
const colorFunction=CLOUD_TOP_HEIGHT_BANDS.slice().reverse().map(band=>
 `if(height>=${band.minMeters.toFixed(1)})return vec3(${band.rgb.map(c=>(c/255).toFixed(9)).join(',')});`).join('\n');
const fragment=`#version 300 es
precision highp float;
in float height;
uniform float opacity;
out vec4 pixel;
vec3 altitudeColor(){${colorFunction}\nreturn vec3(0.0);}
void main(){pixel=vec4(altitudeColor()*opacity,opacity);}`;

function program(gl){
 const result=gl.createProgram(),shaders=[];
 if(!result)throw Error('GOES cloud-top program unavailable');
 try{
  for(const [type,code]of [[gl.VERTEX_SHADER,vertex],[gl.FRAGMENT_SHADER,fragment]]){
   const shader=gl.createShader(type);if(!shader)throw Error('GOES cloud-top shader unavailable');
   shaders.push(shader);gl.shaderSource(shader,code);gl.compileShader(shader);
   if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw Error('GOES cloud-top shader did not compile');
   gl.attachShader(result,shader);
  }
  gl.linkProgram(result);
  if(!gl.getProgramParameter(result,gl.LINK_STATUS))throw Error('GOES cloud-top program did not link');
  return result;
 }catch(error){gl.deleteProgram(result);throw error;}
 finally{for(const shader of shaders)gl.deleteShader(shader);}
}

/** Spatial midpoint BVH: O(n log n) for the regular GOES grid, <=12 triangles per leaf unless unsplittable. */
function indexTriangles(data){
 const count=data.length/12,order=Uint32Array.from({length:count},(_,i)=>i),bounds=new Float32Array(count*6);
 for(let triangle=0;triangle<count;triangle++)for(let axis=0;axis<3;axis++){
  const i=triangle*12;bounds[triangle*6+axis]=Math.min(data[i+axis],data[i+4+axis],data[i+8+axis]);
  bounds[triangle*6+axis+3]=Math.max(data[i+axis],data[i+4+axis],data[i+8+axis]);
 }
 function build(start,end,depth=0){
  const box=[Infinity,Infinity,Infinity,-Infinity,-Infinity,-Infinity];
  for(let at=start;at<end;at++)for(let axis=0;axis<3;axis++){
   box[axis]=Math.min(box[axis],bounds[order[at]*6+axis]);
   box[axis+3]=Math.max(box[axis+3],bounds[order[at]*6+axis+3]);
  }
  const node={box,start,end};if(end-start<=LEAF_SIZE||depth>=32)return node;
  let axis=0;for(let a=1;a<3;a++)if(box[a+3]-box[a]>box[axis+3]-box[axis])axis=a;
  const middle=(box[axis]+box[axis+3])/2;let split=start;
  for(let at=start;at<end;at++)if((bounds[order[at]*6+axis]+bounds[order[at]*6+axis+3])/2<middle){
   [order[at],order[split]]=[order[split],order[at]];split++;
  }
  if(split===start||split===end)return node;
  node.left=build(start,split,depth+1);node.right=build(split,end,depth+1);return node;
 }
 return {order,root:build(0,count)};
}

/** Retain metre heights alongside local Mercator positions to avoid global float cancellation. */
function surfaceGeometry(vertices,MercatorCoordinate){
 if(!(vertices instanceof Float32Array)||vertices.length%9||vertices.length>MAX_VERTICES*3)
  throw Error('Invalid GOES cloud-top geometry');
 if(!vertices.length)return null;
 const projected=new Float64Array(vertices.length),low=[Infinity,Infinity,Infinity],high=[-Infinity,-Infinity,-Infinity];
 for(let i=0;i<vertices.length;i+=3){
  const lon=vertices[i],lat=vertices[i+1],height=vertices[i+2];
  if(!Number.isFinite(lon)||Math.abs(lon)>180||!Number.isFinite(lat)||Math.abs(lat)>85||
    !Number.isFinite(height)||height<0||height>20000)throw Error('Invalid GOES cloud-top vertex');
  const point=MercatorCoordinate.fromLngLat([lon,lat],height),values=[point.x,point.y,point.z];
  for(let axis=0;axis<3;axis++){
   if(!Number.isFinite(values[axis]))throw Error('Invalid GOES cloud-top projection');
   projected[i+axis]=values[axis];low[axis]=Math.min(low[axis],values[axis]);high[axis]=Math.max(high[axis],values[axis]);
  }
 }
 const scale=Math.max(...high.map((value,axis)=>value-low[axis]),1e-9),data=new Float32Array(vertices.length/3*4);
 for(let i=0,j=0;i<vertices.length;i+=3,j+=4){
  for(let axis=0;axis<3;axis++)data[j+axis]=(projected[i+axis]-low[axis])/scale;
  data[j+3]=vertices[i+2];
 }
 return {data,origin:low,scale,index:indexTriangles(data),buffer:null,drawn:false};
}

function localMatrix(main,surface){
 if(!main||main.length!==16||Array.from(main).some(value=>!Number.isFinite(value)))throw Error('Invalid GOES cloud-top matrix');
 const result=new Float32Array(16);
 for(let row=0;row<4;row++){
  for(let col=0;col<3;col++)result[col*4+row]=main[col*4+row]*surface.scale;
  result[12+row]=main[row]*surface.origin[0]+main[4+row]*surface.origin[1]+main[8+row]*surface.origin[2]+main[12+row];
 }
 return result;
}

/** Invert the matrix actually sent to the GPU using double precision and pivoting. */
function inverse4(matrix){
 const rows=Array.from({length:4},(_,r)=>Array.from({length:8},(_,c)=>c<4?matrix[c*4+r]:Number(c-4===r)));
 for(let col=0;col<4;col++){
  let pivot=col;for(let r=col+1;r<4;r++)if(Math.abs(rows[r][col])>Math.abs(rows[pivot][col]))pivot=r;
  if(Math.abs(rows[pivot][col])<Number.EPSILON)return null;
  [rows[col],rows[pivot]]=[rows[pivot],rows[col]];const divisor=rows[col][col];
  for(let c=0;c<8;c++)rows[col][c]/=divisor;
  for(let r=0;r<4;r++)if(r!==col){const factor=rows[r][col];for(let c=0;c<8;c++)rows[r][c]-=factor*rows[col][c];}
 }
 return Float64Array.from({length:16},(_,i)=>rows[i%4][4+Math.floor(i/4)]);
}
const transform=(matrix,x,y,z,w=1)=>Array.from({length:4},(_,r)=>matrix[r]*x+matrix[4+r]*y+matrix[8+r]*z+matrix[12+r]*w);

function boxEntry(box,origin,direction,maximum){
 let entry=0,exit=maximum;
 for(let axis=0;axis<3;axis++){
  if(Math.abs(direction[axis])<1e-14){if(origin[axis]<box[axis]||origin[axis]>box[axis+3])return Infinity;}
  else{
   const a=(box[axis]-origin[axis])/direction[axis],b=(box[axis+3]-origin[axis])/direction[axis];
   entry=Math.max(entry,Math.min(a,b));exit=Math.min(exit,Math.max(a,b));if(exit<entry)return Infinity;
  }
 }
 return entry;
}

/** Ray barycentrics match perspective interpolation; the near/far clip segment excludes hidden planes. */
function pickSurface(surface,snapshot,point,width,height){
 const x=point?.x,y=point?.y;
 if(!Number.isFinite(x)||!Number.isFinite(y)||!Number.isFinite(width)||!Number.isFinite(height)||
  width<=0||height<=0||x<0||x>width||y<0||y>height||!snapshot.inverse)return null;
 const nx=x/width*2-1,ny=1-y/height*2,near=transform(snapshot.inverse,nx,ny,-1),far=transform(snapshot.inverse,nx,ny,1);
 if(Math.abs(near[3])<1e-14)return null;
 const origin=near.slice(0,3).map(v=>v/near[3]);
 const direction=far.slice(0,3).map((v,axis)=>v*near[3]-near[axis]*far[3]);
 const length=Math.hypot(...direction);if(!length)return null;for(let axis=0;axis<3;axis++)direction[axis]/=length;
 let closest=far[3]>1e-14?Math.hypot(...far.slice(0,3).map((v,axis)=>v/far[3]-origin[axis])):Infinity,hit=null;
 const {data,index}=surface,stack=[index.root];
 while(stack.length){
  const node=stack.pop();if(boxEntry(node.box,origin,direction,closest)===Infinity)continue;
  if(node.left){
   const left=boxEntry(node.left.box,origin,direction,closest),right=boxEntry(node.right.box,origin,direction,closest);
   if(left<right){if(right!==Infinity)stack.push(node.right);if(left!==Infinity)stack.push(node.left);}
   else{if(left!==Infinity)stack.push(node.left);if(right!==Infinity)stack.push(node.right);}continue;
  }
  for(let at=node.start;at<node.end;at++){
   const i=index.order[at]*12,ax=data[i],ay=data[i+1],az=data[i+2];
   const ex=data[i+4]-ax,ey=data[i+5]-ay,ez=data[i+6]-az,fx=data[i+8]-ax,fy=data[i+9]-ay,fz=data[i+10]-az;
   const px=direction[1]*fz-direction[2]*fy,py=direction[2]*fx-direction[0]*fz,pz=direction[0]*fy-direction[1]*fx;
   const determinant=ex*px+ey*py+ez*pz;
   if(Math.abs(determinant)<1e-14)continue;
   const tx=origin[0]-ax,ty=origin[1]-ay,tz=origin[2]-az,u=(tx*px+ty*py+tz*pz)/determinant;
   if(u< -1e-8||u>1+1e-8)continue;
   const qx=ty*ez-tz*ey,qy=tz*ex-tx*ez,qz=tx*ey-ty*ex,v=(direction[0]*qx+direction[1]*qy+direction[2]*qz)/determinant;
   if(v< -1e-8||u+v>1+1e-8)continue;
   const distance=(fx*qx+fy*qy+fz*qz)/determinant;if(distance<0||distance>closest)continue;
   const position=origin.map((value,axis)=>value+direction[axis]*distance),clip=transform(snapshot.matrix,...position);
   if(clip[3]<=0||clip[2]< -clip[3]-1e-7||clip[2]>clip[3]+1e-7)continue;
   closest=distance;hit={position,depth:clip[2]/clip[3],height:data[i+3]*(1-u-v)+data[i+7]*u+data[i+11]*v};
  }
 }
 if(!hit)return null;
 const world=hit.position.map((value,axis)=>surface.origin[axis]+value*surface.scale);
 return {height:hit.height,lon:world[0]*360-180,lat:Math.atan(Math.sinh(Math.PI*(1-2*world[1])))*180/Math.PI,depth:hit.depth};
}

function renderState(gl){
 return {program:gl.getParameter(gl.CURRENT_PROGRAM),vao:gl.getParameter(gl.VERTEX_ARRAY_BINDING),buffer:gl.getParameter(gl.ARRAY_BUFFER_BINDING),
  depthWrite:gl.getParameter(gl.DEPTH_WRITEMASK),depthFunc:gl.getParameter(gl.DEPTH_FUNC),
  enabled:[gl.DEPTH_TEST,gl.CULL_FACE,gl.BLEND].map(key=>gl.isEnabled(key)),
  blend:['BLEND_SRC_RGB','BLEND_DST_RGB','BLEND_SRC_ALPHA','BLEND_DST_ALPHA','BLEND_EQUATION_RGB','BLEND_EQUATION_ALPHA'].map(key=>gl.getParameter(gl[key]))};
}
function restoreState(gl,state){
 gl.useProgram(state.program);gl.bindVertexArray(state.vao);gl.bindBuffer(gl.ARRAY_BUFFER,state.buffer);
 gl.depthMask(state.depthWrite);gl.depthFunc(state.depthFunc);
 gl.blendFuncSeparate(...state.blend.slice(0,4));gl.blendEquationSeparate(...state.blend.slice(4));
 [gl.DEPTH_TEST,gl.CULL_FACE,gl.BLEND].forEach((key,i)=>state.enabled[i]?gl.enable(key):gl.disable(key));
}

/**
 * Render immutable [longitude, latitude, geopotential metres] triangles in Mercator.
 * Crossfades blend observations' opacity only, with <=2 buffers (4.8 MB each maximum).
 * Picking uses the rendered float geometry and a BVH, never a nearest sample or gap fill.
 */
export function createCloudTopLayer(MercatorCoordinate){
 let map,context,compiled,vao,uniforms,current=null,previous=null,input=null,snapshot=null,fade=null;
 const dispose=surface=>{if(surface?.buffer){context?.deleteBuffer(surface.buffer);surface.buffer=null;}};
 const settle=()=>{if(fade){fade.resolve();fade=null;}};
 const release=()=>{dispose(previous);dispose(current);if(vao)context.deleteVertexArray(vao);if(compiled)context.deleteProgram(compiled);vao=compiled=null;};
 function draw(gl,surface,main,opacity){
  const matrix=localMatrix(main,surface);
  if(!surface.buffer){
   surface.buffer=gl.createBuffer();if(!surface.buffer)throw Error('GOES cloud-top graphics unavailable');
   try{
    gl.bindBuffer(gl.ARRAY_BUFFER,surface.buffer);gl.bufferData(gl.ARRAY_BUFFER,surface.data,gl.STATIC_DRAW);
    if(gl.getError()!==gl.NO_ERROR)throw Error('GOES cloud-top upload failed');
   }catch(error){dispose(surface);throw error;}
  }else gl.bindBuffer(gl.ARRAY_BUFFER,surface.buffer);
  gl.vertexAttribPointer(0,4,gl.FLOAT,false,16,0);gl.uniformMatrix4fv(uniforms.matrix,false,matrix);gl.uniform1f(uniforms.opacity,opacity);
  gl.drawArrays(gl.TRIANGLES,0,surface.data.length/4);
  if(gl.getError()!==gl.NO_ERROR)throw Error('GOES cloud-top draw failed');
  surface.drawn=true;return matrix;
 }
 return {id:'watch-goes-cloud-tops',type:'custom',renderingMode:'3d',
  onAdd(owner,gl){
   if(typeof gl.createVertexArray!=='function')throw Error('GOES cloud-top requires WebGL2');
   context=gl;
   try{
    compiled=program(gl);vao=gl.createVertexArray();if(!vao)throw Error('GOES cloud-top graphics unavailable');
    uniforms=Object.fromEntries(['matrix','opacity'].map(name=>[name,gl.getUniformLocation(compiled,name)]));
    if(Object.values(uniforms).some(value=>value===null))throw Error('GOES cloud-top uniforms unavailable');
    map=owner;
   }catch(error){release();throw error;}
  },
  setSurface(vertices,{durationMs=0}={}){
   if(!Number.isFinite(durationMs)||durationMs<0)throw Error('Invalid GOES cloud-top transition duration');
   if(input===vertices){
    if(fade&&durationMs===0){dispose(previous);previous=null;settle();snapshot=null;map?.triggerRepaint();}
    return fade?.promise??Promise.resolve();
   }
   const next=vertices===null?null:surfaceGeometry(vertices,MercatorCoordinate);
   settle();dispose(previous);previous=null;snapshot=null;
   if(next&&current?.drawn&&durationMs>0){
    previous=current;const start=performance.now();let resolve;const promise=new Promise(done=>{resolve=done;});
    fade={start,durationMs,resolve,promise};
   }else dispose(current);
   current=next;input=vertices;map?.triggerRepaint();return fade?.promise??Promise.resolve();
  },
  invalidatePick(){snapshot=null;},
  pick(point,width,height){
   if(!current||!snapshot||fade||map?.isMoving?.())return null;
   return pickSurface(current,snapshot,point,width,height);
  },
  /** NDC depth (-1 near, +1 far) for a terrain intersection, using the same rendered projection. */
  projectDepth(lon,lat,height){
   if(!current||!snapshot||fade||map?.isMoving?.()||![lon,lat,height].every(Number.isFinite)||Math.abs(lon)>180||Math.abs(lat)>85)return null;
   const world=MercatorCoordinate.fromLngLat([lon,lat],height);
   const local=[world.x,world.y,world.z].map((value,axis)=>(value-current.origin[axis])/current.scale);
   const clip=transform(snapshot.matrix,...local);
   if(!clip.every(Number.isFinite)||clip[3]<=0||Math.abs(clip[2])>clip[3])return null;
   return clip[2]/clip[3];
  },
  render(gl,{defaultProjectionData}){
   snapshot=null;if(!compiled||!current)return;
   if(gl.isContextLost())throw Error('GOES cloud-top WebGL context lost');
   const saved=renderState(gl),progress=fade?Math.min(1,Math.max(0,(performance.now()-fade.start)/fade.durationMs)):1;
   try{
    gl.useProgram(compiled);gl.bindVertexArray(vao);gl.enableVertexAttribArray(0);
    gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);gl.depthMask(false);gl.disable(gl.CULL_FACE);gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.ONE,gl.ONE_MINUS_SRC_ALPHA,gl.ONE,gl.ONE_MINUS_SRC_ALPHA);gl.blendEquationSeparate(gl.FUNC_ADD,gl.FUNC_ADD);
    if(previous&&progress<1)draw(gl,previous,defaultProjectionData?.mainMatrix,MAX_ALPHA*(1-progress));
    if(progress>0){const matrix=draw(gl,current,defaultProjectionData?.mainMatrix,MAX_ALPHA*progress);if(progress===1)snapshot={matrix,inverse:inverse4(matrix)};}
   }finally{restoreState(gl,saved);}
   if(fade&&progress===1){dispose(previous);previous=null;settle();}
   else if(fade)map?.triggerRepaint();
  },
  onRemove(){release();settle();map=context=input=current=previous=snapshot=null;}
 };
}
