import {RADAR_BANDS} from './hanford-radar-data.js';

const PROJECTED_RADIUS=6378137,WORLD_METERS=2*Math.PI*PROJECTED_RADIUS;
const MAX_BYTES=1024*1024,MAX_HEIGHT=12000;
const vertex=`#version 300 es
precision highp float;
uniform vec4 screenBounds;
out vec2 screen;
const vec2 corners[6]=vec2[6](vec2(0,0),vec2(1,0),vec2(0,1),vec2(0,1),vec2(1,0),vec2(1,1));
void main(){
 screen=mix(screenBounds.xy,screenBounds.zw,corners[gl_VertexID]);
 gl_Position=vec4(screen,0.0,1.0);
}`;
const colorFunction=RADAR_BANDS.slice().reverse().map(({min,color})=>
 `if(dbz>=${min.toFixed(1)})return vec3(${color.map(channel=>(channel/255).toFixed(9)).join(',')});`).join('\n');
const fragment=`#version 300 es
precision highp float;
precision highp sampler3D;
in vec2 screen;
out vec4 pixel;
uniform sampler3D echoes;
uniform mat4 localMatrix;
uniform mat4 inverseMatrix;
uniform vec3 gridSize;
uniform vec4 heightMapping; // south/R, (north-south)/R, maxHeight*max(sec(latitude)), minHeight
uniform float heightSpan;
uniform float minimumDbz;
uniform float frameOpacity;
const float MAX_ALPHA=0.55;
const int MAX_STEPS=160;

vec3 echoColor(float dbz){${colorFunction}\nreturn vec3(0.0);}

bool retained(ivec3 cell){
 if(any(lessThan(cell,ivec3(0)))||any(greaterThanEqual(cell,ivec3(gridSize))))return false;
 return texelFetch(echoes,cell,0).r>=minimumDbz;
}

// Feather inward only at measured/unknown or threshold boundaries. Adjacent retained
// cells stay connected; no value, color, or opacity is interpolated into an unknown cell.
float coverageAt(vec3 uv,ivec3 cell){
 vec3 f=fract(uv*gridSize);
 float coverage=1.0;
 const float feather=0.24;
 for(int axis=0;axis<3;axis++){
  ivec3 neighbour=cell;
  if(f[axis]<feather){
   neighbour[axis]-=1;
   if(!retained(neighbour))coverage*=smoothstep(0.0,feather,f[axis]);
  }else if(f[axis]>1.0-feather){
   neighbour[axis]+=1;
   if(!retained(neighbour))coverage*=smoothstep(0.0,feather,1.0-f[axis]);
  }
 }
 return coverage;
}

bool intersectBox(vec3 origin,vec3 direction,inout float entry,inout float exitAt){
 for(int axis=0;axis<3;axis++){
  if(abs(direction[axis])<1e-8){
   if(origin[axis]<0.0||origin[axis]>1.0)return false;
  }else{
   float a=-origin[axis]/direction[axis];
   float b=(1.0-origin[axis])/direction[axis];
   entry=max(entry,min(a,b));exitAt=min(exitAt,max(a,b));
  }
 }
 return exitAt>entry;
}

void main(){
 vec4 nearPoint=inverseMatrix*vec4(screen,-1.0,1.0);
 vec4 farPoint=inverseMatrix*vec4(screen,1.0,1.0);
 if(abs(nearPoint.w)<1e-10)discard;
 vec3 origin=nearPoint.xyz/nearPoint.w;
 // Homogeneous form also handles a perspective far plane at infinity.
 vec3 direction=normalize(farPoint.xyz*nearPoint.w-nearPoint.xyz*farPoint.w);
 float entry=0.0;
 float exitAt=farPoint.w>1e-10?length(farPoint.xyz/farPoint.w-origin):1e20;
 if(!intersectBox(origin,direction,entry,exitAt))discard;
 float distance=exitAt-entry;
 vec3 voxelTravel=abs(direction*distance)*gridSize;
 // About two samples per crossed voxel, with a fixed worst-case shader budget.
 int steps=int(clamp(ceil(max(max(voxelTravel.x,voxelTravel.y),voxelTravel.z)*2.0),1.0,float(MAX_STEPS)));
 float stepSize=distance/float(steps);
 float voxelStep=length(voxelTravel)/float(steps);
 vec4 accumulated=vec4(0.0);
 float firstDepth=1.0;
 for(int i=0;i<MAX_STEPS;i++){
  if(i>=steps||accumulated.a>=MAX_ALPHA-0.0001)break;
  vec3 point=origin+direction*(entry+(float(i)+0.5)*stepSize);
  float mercatorAngle=heightMapping.x+point.y*heightMapping.y;
  float latitudeScale=0.5*(exp(mercatorAngle)+exp(-mercatorAngle));
  float altitude=point.z*heightMapping.z/latitudeScale;
  vec3 uv=vec3(point.xy,(altitude-heightMapping.w)/heightSpan);
  if(any(lessThan(uv,vec3(0.0)))||any(greaterThanEqual(uv,vec3(1.0))))continue;
  ivec3 cell=ivec3(floor(uv*gridSize));
  float dbz=texelFetch(echoes,cell,0).r;
  if(dbz<minimumDbz)continue; // -999 unknown is transparent, including at the box boundary.
  float opacity=1.0-exp(-0.24*coverageAt(uv,cell)*voxelStep);
  if(opacity<0.0001)continue;
  if(accumulated.a==0.0){
   vec4 clip=localMatrix*vec4(point,1.0);
   firstDepth=clip.z/clip.w*0.5+0.5;
  }
  opacity=min(opacity,(MAX_ALPHA-accumulated.a)/(1.0-accumulated.a));
  accumulated.rgb+=(1.0-accumulated.a)*opacity*echoColor(dbz);
  accumulated.a+=(1.0-accumulated.a)*opacity;
 }
 if(accumulated.a==0.0)discard;
 // Test the nearest actual echo against terrain; never write radar into the map depth buffer.
 gl_FragDepth=gl_DepthRange.near+firstDepth*gl_DepthRange.diff;
 pixel=accumulated*frameOpacity;
}`;

/** Validate a bounded [z,y,x] measured field and construct its local Mercator cube. */
export function volumeGeometry(volume,MercatorCoordinate){
 const {values,shape,bounds3857,heightRange}=volume??{};
 if(!(values instanceof Float32Array)||values.byteLength>MAX_BYTES||!Array.isArray(shape)||shape.length!==3||
  shape.some(size=>!Number.isInteger(size)||size<1||size>256)||shape.reduce((a,b)=>a*b,1)!==values.length||
  !Array.isArray(bounds3857)||bounds3857.length!==4||bounds3857.some(value=>!Number.isFinite(value)||Math.abs(value)>WORLD_METERS/2)||
  bounds3857[0]>=bounds3857[2]||bounds3857[1]>=bounds3857[3]||
  !Array.isArray(heightRange)||heightRange.length!==2||heightRange.some(value=>!Number.isFinite(value))||
  heightRange[0]<0||heightRange[1]>MAX_HEIGHT||heightRange[0]>=heightRange[1])throw Error('Invalid Hanford volume geometry');
 let maximum=-Infinity;
 for(const dbz of values){
  if(dbz!==-999&&(!Number.isFinite(dbz)||dbz<10||dbz>=80))throw Error('Invalid Hanford volume reflectivity');
  maximum=Math.max(maximum,dbz);
 }
 const [west,south,east,north]=bounds3857,southAngle=south/PROJECTED_RADIUS,angleSpan=(north-south)/PROJECTED_RADIUS;
 // EPSG:3857 uses the WGS84 semi-major radius; MapLibre's altitude uses its mean
 // Earth radius. Derive the latter from the supplied class so these are not conflated.
 const metersToMercator=MercatorCoordinate.fromLngLat([0,0],1).z;
 if(!Number.isFinite(metersToMercator)||metersToMercator<=0)throw Error('Invalid Hanford volume altitude conversion');
 const topScaledMeters=heightRange[1]*Math.max(Math.cosh(southAngle),Math.cosh(southAngle+angleSpan));
 return {origin:[0.5+west/WORLD_METERS,0.5-south/WORLD_METERS,0],
  scale:[(east-west)/WORLD_METERS,-(north-south)/WORLD_METERS,topScaledMeters*metersToMercator],
  southAngle,angleSpan,topScaledMeters,maximum};
}

/** Invert a column-major matrix using double precision and partial pivoting. */
function inverse4(matrix){
 const rows=Array.from({length:4},(_,r)=>Array.from({length:8},(_,c)=>c<4?matrix[c*4+r]:Number(c-4===r)));
 for(let column=0;column<4;column++){
  let pivot=column;
  for(let row=column+1;row<4;row++)if(Math.abs(rows[row][column])>Math.abs(rows[pivot][column]))pivot=row;
  if(Math.abs(rows[pivot][column])<Number.EPSILON)throw Error('Hanford volume projection matrix is singular');
  [rows[column],rows[pivot]]=[rows[pivot],rows[column]];
  const divisor=rows[column][column];
  for(let c=0;c<8;c++)rows[column][c]/=divisor;
  for(let row=0;row<4;row++)if(row!==column){
   const factor=rows[row][column];
   for(let c=0;c<8;c++)rows[row][c]-=factor*rows[column][c];
  }
 }
 return new Float32Array(Array.from({length:16},(_,i)=>rows[i%4][4+Math.floor(i/4)]));
}

/** Compose before rounding to float: shaders never subtract nearly equal global positions. */
export function volumeMatrices(mainMatrix,{origin,scale}){
 if(!mainMatrix||mainMatrix.length!==16||Array.from(mainMatrix).some(value=>!Number.isFinite(value)))
  throw Error('Invalid Hanford volume projection matrix');
 const local=new Float64Array(16);
 for(let row=0;row<4;row++){
  for(let column=0;column<3;column++)local[column*4+row]=mainMatrix[column*4+row]*scale[column];
  local[12+row]=mainMatrix[row]*origin[0]+mainMatrix[4+row]*origin[1]+mainMatrix[8+row]*origin[2]+mainMatrix[12+row];
 }
 const inverse=inverse4(local),matrix=new Float32Array(local),screenBounds=[1,1,-1,-1];
 for(let z=0;z<=1;z++)for(let y=0;y<=1;y++)for(let x=0;x<=1;x++){
  const w=local[3]*x+local[7]*y+local[11]*z+local[15];
  // Near-plane crossing needs a conservative viewport bound, including an inside camera.
  if(w<=1e-8)return {matrix,inverse,screenBounds:[-1,-1,1,1]};
  const sx=(local[0]*x+local[4]*y+local[8]*z+local[12])/w;
  const sy=(local[1]*x+local[5]*y+local[9]*z+local[13])/w;
  screenBounds[0]=Math.min(screenBounds[0],sx);screenBounds[1]=Math.min(screenBounds[1],sy);
  screenBounds[2]=Math.max(screenBounds[2],sx);screenBounds[3]=Math.max(screenBounds[3],sy);
 }
 return {matrix,inverse,screenBounds:screenBounds.map(value=>Math.max(-1,Math.min(1,value)))};
}

function shader(gl,type,code){
 const compiled=gl.createShader(type);
 if(!compiled)throw Error('Hanford volume shader unavailable');
 gl.shaderSource(compiled,code);gl.compileShader(compiled);
 if(gl.getShaderParameter(compiled,gl.COMPILE_STATUS))return compiled;
 const message=gl.getShaderInfoLog(compiled);gl.deleteShader(compiled);
 throw Error(`Hanford volume shader failed: ${message}`);
}

function program(gl){
 let vert,frag,linked;
 try{
  vert=shader(gl,gl.VERTEX_SHADER,vertex);frag=shader(gl,gl.FRAGMENT_SHADER,fragment);
  linked=gl.createProgram();if(!linked)throw Error('Hanford volume program unavailable');
  gl.attachShader(linked,vert);gl.attachShader(linked,frag);gl.linkProgram(linked);
  if(!gl.getProgramParameter(linked,gl.LINK_STATUS))throw Error(`Hanford volume link failed: ${gl.getProgramInfoLog(linked)}`);
  return linked;
 }catch(error){if(linked)gl.deleteProgram(linked);throw error;}
 finally{if(vert)gl.deleteShader(vert);if(frag)gl.deleteShader(frag);}
}

function textureState(gl){
 const active=gl.getParameter(gl.ACTIVE_TEXTURE);gl.activeTexture(gl.TEXTURE0);
 return {active,texture:gl.getParameter(gl.TEXTURE_BINDING_3D),sampler:gl.getParameter(gl.SAMPLER_BINDING)};
}
function restoreTexture(gl,state){
 gl.bindTexture(gl.TEXTURE_3D,state.texture);gl.bindSampler(0,state.sampler);gl.activeTexture(state.active);
}

/** Upload under known unpack settings; restore map buffers, row strides and image flags. */
function upload(gl,texture,volume){
 const keys=['UNPACK_ALIGNMENT','UNPACK_ROW_LENGTH','UNPACK_IMAGE_HEIGHT','UNPACK_SKIP_PIXELS','UNPACK_SKIP_ROWS',
  'UNPACK_SKIP_IMAGES','UNPACK_FLIP_Y_WEBGL','UNPACK_PREMULTIPLY_ALPHA_WEBGL'];
 const saved=keys.map(key=>gl.getParameter(gl[key])),buffer=gl.getParameter(gl.PIXEL_UNPACK_BUFFER_BINDING);
 try{
  gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER,null);
  keys.forEach((key,i)=>gl.pixelStorei(gl[key],i===0?4:i>=6?false:0));
  gl.bindTexture(gl.TEXTURE_3D,texture);
  for(const parameter of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_3D,parameter,gl.NEAREST);
  for(const parameter of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T,gl.TEXTURE_WRAP_R])gl.texParameteri(gl.TEXTURE_3D,parameter,gl.CLAMP_TO_EDGE);
  const [z,y,x]=volume.shape;
  gl.texImage3D(gl.TEXTURE_3D,0,gl.R32F,x,y,z,0,gl.RED,gl.FLOAT,volume.values);
  if(gl.getError()!==gl.NO_ERROR)throw Error('Hanford volume texture upload failed');
 }finally{
  keys.forEach((key,i)=>gl.pixelStorei(gl[key],saved[i]));gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER,buffer);
 }
}

function renderState(gl){
 return {texture:textureState(gl),program:gl.getParameter(gl.CURRENT_PROGRAM),vao:gl.getParameter(gl.VERTEX_ARRAY_BINDING),
  depthWrite:gl.getParameter(gl.DEPTH_WRITEMASK),depthFunc:gl.getParameter(gl.DEPTH_FUNC),
  enabled:[gl.DEPTH_TEST,gl.CULL_FACE,gl.BLEND].map(key=>gl.isEnabled(key)),
  blend:['BLEND_SRC_RGB','BLEND_DST_RGB','BLEND_SRC_ALPHA','BLEND_DST_ALPHA','BLEND_EQUATION_RGB','BLEND_EQUATION_ALPHA'].map(key=>gl.getParameter(gl[key]))};
}
function restoreRender(gl,state){
 gl.useProgram(state.program);gl.bindVertexArray(state.vao);restoreTexture(gl,state.texture);
 gl.depthMask(state.depthWrite);gl.depthFunc(state.depthFunc);
 gl.blendFuncSeparate(...state.blend.slice(0,4));gl.blendEquationSeparate(...state.blend.slice(4));
 [gl.DEPTH_TEST,gl.CULL_FACE,gl.BLEND].forEach((key,i)=>state.enabled[i]?gl.enable(key):gl.disable(key));
}

/**
 * Experimental Mercator-only measured-echo volume. Input is immutable, x-fastest,
 * y northward and z upward, with -999 unknown. No gap filling or weather inference.
 * Each R32F texture is <=1 MiB; at most two observed frames during an opacity fade.
 * Each frame uses <=160 samples/pixel. No scalar interpolation or invented motion.
 * Place before gauges, roads and labels. GPU failures throw for the caller's fallback.
 */
export function createHanfordVolumeLayer(MercatorCoordinate){
 let map,context,compiled,vao,uniforms,current={volume:null,geometry:null,minimum:20,texture:null,pending:false},previous=null,transition=null;
 const dispose=frame=>{if(frame?.texture)context.deleteTexture(frame.texture);if(frame)frame.texture=null;};
 const release=gl=>{
  dispose(previous);dispose(current);previous=transition=null;
  if(vao)gl.deleteVertexArray(vao);if(compiled)gl.deleteProgram(compiled);
  vao=compiled=null;
 };
 return {
  id:'watch-hanford-volume',type:'custom',renderingMode:'3d',
  onAdd(owner,gl){
   if(typeof gl.texImage3D!=='function'||typeof gl.createVertexArray!=='function')throw Error('Hanford volume requires WebGL2');
   context=gl;
   try{
    compiled=program(gl);vao=gl.createVertexArray();current.texture=gl.createTexture();
    if(!vao||!current.texture)throw Error('Hanford volume GPU allocation failed');
    uniforms=Object.fromEntries(['echoes','localMatrix','inverseMatrix','screenBounds','gridSize','heightMapping','heightSpan','minimumDbz','frameOpacity']
     .map(name=>[name,gl.getUniformLocation(compiled,name)]));
    if(Object.values(uniforms).some(value=>value===null))throw Error('Hanford volume shader uniforms unavailable');
    map=owner;current.pending=!!current.volume;
   }catch(error){release(gl);throw error;}
  },
  setVolume(next,minDbz=20,{durationMs=0}={}){
   if(!Number.isFinite(minDbz)||minDbz<10||minDbz>79.5)throw Error('Invalid Hanford volume threshold');
   const animate=Number.isFinite(durationMs)&&durationMs>0,changed=next!==current.volume;
   if(!changed&&minDbz===current.minimum){
    if(previous&&!animate){dispose(previous);previous=transition=null;map?.triggerRepaint();}
    return;
   }
   const geometry=changed&&next?volumeGeometry(next,MercatorCoordinate):current.geometry;
   dispose(previous);previous=transition=null;
   if(!changed){current.minimum=minDbz;}
   else{
    const frame={volume:next,geometry:next?geometry:null,minimum:minDbz,texture:null,pending:!!next};
    if(animate&&compiled&&next&&current.volume&&minDbz===current.minimum&&(geometry.maximum>=minDbz||current.geometry.maximum>=minDbz)){
     previous=current;transition={durationMs,start:null};
    }else{frame.texture=current.texture;current.texture=null;}
    current=frame;
   }
   map?.triggerRepaint();
  },
  render(gl,{defaultProjectionData}){
   if(!compiled||!current.volume&&!previous?.volume)return;
   const saved=renderState(gl);
   try{
    if(gl.isContextLost())throw Error('Hanford volume WebGL context lost');
    const frames=[];
    for(const frame of [previous,current])if(frame?.volume&&frame.geometry.maximum>=frame.minimum){
     const matrices=volumeMatrices(defaultProjectionData?.mainMatrix,frame.geometry),{screenBounds}=matrices;
     if(screenBounds[0]>=screenBounds[2]||screenBounds[1]>=screenBounds[3])continue;
     if(frame.volume.shape.some(size=>size>gl.getParameter(gl.MAX_3D_TEXTURE_SIZE)))throw Error('Hanford volume exceeds GPU texture size');
     if(!frame.texture){frame.texture=gl.createTexture();if(!frame.texture)throw Error('Hanford volume GPU allocation failed');}
     if(frame.pending){upload(gl,frame.texture,frame.volume);frame.pending=false;}
     frames.push({frame,...matrices});
    }
    let progress=1;
    if(transition){
     const now=performance.now();transition.start??=now;
     progress=Math.max(0,Math.min(1,(now-transition.start)/transition.durationMs));
     if(progress===1){dispose(previous);previous=transition=null;}
    }
    gl.bindSampler(0,null);
    gl.useProgram(compiled);gl.bindVertexArray(vao);
    gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);gl.depthMask(false);gl.disable(gl.CULL_FACE);gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.ONE,gl.ONE_MINUS_SRC_ALPHA,gl.ONE,gl.ONE_MINUS_SRC_ALPHA);
    gl.blendEquationSeparate(gl.FUNC_ADD,gl.FUNC_ADD);
    gl.uniform1i(uniforms.echoes,0);
    // Composite the colors of two observed volumes; their unknown masks and dBZ stay separate.
    for(const {frame,matrix,inverse,screenBounds}of frames){
     const opacity=frame===current?progress:1-progress;
     if(opacity<=0)continue;
     const {volume,geometry,minimum,texture}=frame;
     gl.bindTexture(gl.TEXTURE_3D,texture);gl.uniform1f(uniforms.frameOpacity,opacity);gl.uniform1f(uniforms.minimumDbz,minimum);
     gl.uniformMatrix4fv(uniforms.localMatrix,false,matrix);gl.uniformMatrix4fv(uniforms.inverseMatrix,false,inverse);
     gl.uniform4f(uniforms.screenBounds,...screenBounds);
     gl.uniform3f(uniforms.gridSize,volume.shape[2],volume.shape[1],volume.shape[0]);
     gl.uniform4f(uniforms.heightMapping,geometry.southAngle,geometry.angleSpan,geometry.topScaledMeters,volume.heightRange[0]);
     gl.uniform1f(uniforms.heightSpan,volume.heightRange[1]-volume.heightRange[0]);
     gl.drawArrays(gl.TRIANGLES,0,6);
     if(gl.getError()!==gl.NO_ERROR)throw Error('Hanford volume draw failed');
    }
   }catch(error){release(gl);throw error;
   }finally{restoreRender(gl,saved);}
   if(transition)map?.triggerRepaint();
  },
  onRemove(_owner,gl){release(gl);map=context=null;current={volume:null,geometry:null,minimum:20,texture:null,pending:false};}
 };
}
