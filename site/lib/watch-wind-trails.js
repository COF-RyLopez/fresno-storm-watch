const RADIUS=6378137;
const DEGREES=180/Math.PI;
const WORLD=2*Math.PI*RADIUS;
const MIN_FLOW=.8;
const FRAME_MS=1000/30;
const TRACE_SAMPLES=8;

function lngLat(point){
 return [point.x/RADIUS*DEGREES,Math.atan(Math.sinh(point.y/RADIUS))*DEGREES];
}

/** HRRR grid cell centers are x-fastest with northward rows. */
export function sampleForecastWind({vectors,width,height,bounds},x,y){
 const [west,south,east,north]=bounds;
 if(x<west||x>east||y<south||y>north||!Number.isFinite(x)||!Number.isFinite(y))return null;
 const col=Math.max(0,Math.min(width-1,(x-west)/(east-west)*width-.5));
 const row=Math.max(0,Math.min(height-1,(y-south)/(north-south)*height-.5));
 const left=Math.floor(col),bottom=Math.floor(row),dx=col-left,dy=row-bottom;
 const i=(bottom*width+left)*2;
 const ii=i+(left===width-1?0:2);
 const j=i+(bottom===height-1?0:width*2);
 const jj=j+ii-i;
 const interpolate=offset=>{
  const lower=vectors[i+offset]*(1-dx)+vectors[ii+offset]*dx;
  const upper=vectors[j+offset]*(1-dx)+vectors[jj+offset]*dx;
  return lower*(1-dy)+upper*dy;
 };
 return [interpolate(0),interpolate(1)];
}

/** Thin, non-interactive trails, projected by MapLibre onto its current terrain view. */
export function createWatchWindTrails(map){
 const parent=map.getCanvasContainer();
 const canvas=document.createElement('canvas');
 canvas.className='watch-wind-trails';
 canvas.setAttribute('aria-hidden','true');
 canvas.hidden=true;
 parent.append(canvas);
 const context=canvas.getContext('2d');
 if(!context){canvas.remove();throw Error('2D graphics unavailable');}
 const motion=matchMedia('(prefers-reduced-motion: reduce)');
 let current,prior,start=0,duration=0,frame=null,last=0,width=0,height=0,pixels=1,particles=[],moving=false;

 function seed(fractionX,fractionY){
  const ll=map.unproject([fractionX*width,fractionY*height]);
  const x=ll.lng/DEGREES*RADIUS;
  const y=Math.asinh(Math.tan(ll.lat/DEGREES))*RADIUS;
  return sampleForecastWind(current,x,y)?{x,y}:null;
 }
 function spawn(particle,fraction=Math.random()){
  const cols=width<600?5:8,rows=5;
  const col=particle.index%cols,row=Math.floor(particle.index/cols);
  const point=seed((col+.15+Math.random()*.7)/cols,(row+.15+Math.random()*.7)/rows);
  return Object.assign(particle,{point,life:2.3+Math.random()*1.6,age:fraction*2,path:[],sampledAt:0});
 }
 function reset(){
  if(!current)return;
  const mapCanvas=map.getCanvas();
  width=mapCanvas.clientWidth;height=mapCanvas.clientHeight;pixels=Math.min(devicePixelRatio||1,1.5);
  canvas.hidden=moving;
  canvas.style.width=`${width}px`;canvas.style.height=`${height}px`;
  canvas.width=Math.ceil(width*pixels);canvas.height=Math.ceil(height*pixels);
  particles=width&&height?Array.from({length:width<600?25:40},(_,index)=>spawn({index})):[];
  last=0;
  schedule();
 }
 function vectorAt(point,blend){
  const next=sampleForecastWind(current,point.x,point.y);
  if(!next||!prior)return next;
  const previous=sampleForecastWind(prior,point.x,point.y);
  return previous?[
   previous[0]+(next[0]-previous[0])*blend,previous[1]+(next[1]-previous[1])*blend
  ]:next;
 }
 function stroke(points,alpha,arrow=false){
  if(points.length<2)return;
  const head=points.at(-1);
  if(points.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y))||
     head.x<-25||head.y<-25||head.x>width+25||head.y>height+25)return;
  const tail=points[0],dx=head.x-tail.x,dy=head.y-tail.y;
  const length=Math.hypot(dx,dy);
  if(length<2||length>100)return;
  const gradient=context.createLinearGradient(tail.x,tail.y,head.x,head.y);
  gradient.addColorStop(0,'rgba(182,235,247,0)');
  gradient.addColorStop(1,`rgba(203,244,252,${alpha})`);
  context.strokeStyle=gradient;
  context.beginPath();
  context.moveTo(tail.x,tail.y);
  for(const point of points.slice(1))context.lineTo(point.x,point.y);
  context.stroke();
  if(!arrow)return;
  const ux=dx/length,uy=dy/length;
  context.strokeStyle=`rgba(203,244,252,${alpha})`;
  context.beginPath();
  context.moveTo(head.x-4*ux+2.5*uy,head.y-4*uy-2.5*ux);
  context.lineTo(head.x,head.y);
  context.lineTo(head.x-4*ux-2.5*uy,head.y-4*uy+2.5*ux);
  context.stroke();
 }
 function draw(now){
  frame=null;
  if(!current||document.hidden||moving||!width||!height)return;
  if(!motion.matches&&last&&now-last<FRAME_MS-2){schedule();return;}
  const dt=last?Math.min(.08,(now-last)/1000):0;
  last=now;
  const amount=prior?Math.min(1,Math.max(0,(now-start)/duration)):1;
  if(amount===1)prior=null;
  const blend=amount*amount*(3-2*amount);
  const metresPerPixel=WORLD/(512*2**map.getZoom());
  context.setTransform(pixels,0,0,pixels,0,0);
  context.clearRect(0,0,width,height);
  context.lineWidth=1.25;
  context.lineJoin='round';context.lineCap='round';
  for(const particle of particles){
   if(!particle.point||particle.age>particle.life)spawn(particle,0);
   const p=particle.point;
   if(!p)continue;
   const vector=vectorAt(p,blend);
   const speed=vector?Math.hypot(...vector):0;
   if(speed<MIN_FLOW){
    particle.path=[];particle.age=particle.life+1;continue;
   }
   if(motion.matches){
    const end={x:p.x+vector[0]/speed*13*metresPerPixel,y:p.y+vector[1]/speed*13*metresPerPixel};
    stroke([map.project(lngLat(p)),map.project(lngLat(end))],.62,true);
    continue;
   }
   particle.age+=dt;
   // Bound the apparent speed so gentle flow stays legible and strong flow stays calm on screen.
   const travel=dt*metresPerPixel*(16+Math.min(speed*2.25,40))/speed;
   const next={x:p.x+vector[0]*travel,y:p.y+vector[1]*travel};
   if(!sampleForecastWind(current,next.x,next.y)){
    particle.path=[];particle.age=particle.life+1;continue;
   }
   if(now-particle.sampledAt>=75){
    particle.path.push(map.project(lngLat(p)));
    if(particle.path.length>TRACE_SAMPLES)particle.path.shift();
    particle.sampledAt=now;
   }
   particle.point=next;
   const alpha=.84*Math.min(1,particle.age/.3,(particle.life-particle.age)/.5);
   if(alpha>0)stroke([...particle.path,map.project(lngLat(next))],alpha);
  }
  if(!motion.matches)schedule();
 }
 function schedule(){
  if(frame===null&&current&&!moving&&!document.hidden)frame=requestAnimationFrame(draw);
 }
 function stop(){
  if(frame!==null)cancelAnimationFrame(frame);
  frame=null;
 }
 function visibility(){
  if(document.hidden)stop();else{last=0;schedule();}
 }
 function moveStart(){moving=true;canvas.hidden=true;stop();}
 function moveEnd(){moving=false;reset();}
 map.on('movestart',moveStart);
 map.on('moveend',moveEnd);
 map.on('resize',reset);
 motion.addEventListener('change',reset);
 document.addEventListener('visibilitychange',visibility);
 return {
  set(next,{durationMs=0}={}){
   const wasVisible=!!current;
   const changed=next!==current;
   prior=(next&&changed&&durationMs>0&&!motion.matches)?current:null;
   current=next;start=performance.now();duration=durationMs;
   canvas.hidden=!current||moving;
   if(!current){stop();particles=[];last=0;return;}
   if(!wasVisible||(changed&&!prior))reset();else schedule();
  },
  destroy(){
   stop();map.off('movestart',moveStart);map.off('moveend',moveEnd);map.off('resize',reset);
   motion.removeEventListener('change',reset);
   document.removeEventListener('visibilitychange',visibility);
   canvas.remove();
  }
 };
}
