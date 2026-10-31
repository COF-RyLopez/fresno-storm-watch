/** Regional HRRR display contracts. Model snapshots, never observations or routed impacts. */
export const HOUR=3_600_000;
export const MPH=2.2369362920544;
export const GUST_STOPS=Object.freeze([[0,'#304560'],[15,'#436d9b'],[30,'#629bc0'],[45,'#9bc5be'],[60,'#ded59b'],[75,'#e6a16e']]);
/** Validate public provenance, fixed regional coverage and a single coherent run. */
export function validateHrrrManifest(m,now=Date.now()){
  const g=m?.grid,run=Date.parse(m?.run),checked=Date.parse(m?.generatedAt);
  if(m?.schemaVersion!==1||m.product!=='noaa-hrrr-forecast-48-hour'||m.units!=='m/s'||m.vectorConvention!=='earth-east-north'||m.license!=='CC-BY-4.0'||typeof m.attribution!=='string'||!Number.isFinite(run)||!Number.isFinite(checked)||run>now+120000||checked>now+120000)throw Error('HRRR identity, units, wind convention or timestamps changed.');
  if(!g||g.wkid!==4326||g.width!==101||g.height!==80||g.x0!==-121.25||g.y0!==38.12||g.dx!==0.03||g.dy!==-0.03)throw Error('HRRR regional grid changed; review coverage.');
  if(!Array.isArray(m.frames)||m.frames.length!==49||m.frames.some((f,i)=>f.leadHours!==i||Date.parse(f.valid)!==run+i*HOUR||!/^\d{8}T\d{6}Z-f\d{2}\.json$/.test(f.file)||f.file!==m.run.replace(/[-:]/g,'')+`-f${String(i).padStart(2,'0')}.json`))throw Error('HRRR forecast run/frame inventory is inconsistent.');
  return m;
}
/** Reject mismatched files and preserve missing cells independently of valid zeros. */
export function validateHrrrFrame(f,m,entry){
  const n=m.grid.width*m.grid.height;
  if(f?.schemaVersion!==1||f.run!==m.run||f.valid!==entry.valid||f.leadHours!==entry.leadHours||f.width!==m.grid.width||f.height!==m.grid.height)throw Error('HRRR frame does not match the selected run.');
  for(const k of ['u','v','gust'])if(!Array.isArray(f[k])||f[k].length!==n||f[k].some(v=>v!==null&&(!Number.isFinite(v)||Math.abs(v)>(k==='gust'?200:150)||(k==='gust'&&v<0))))throw Error('HRRR frame pixels or units are invalid.');
  return f;
}
/** Half-open one-hour display slots; never extrapolate beyond available model steps. */
export function hrrrAt(m,target,now=Date.now()){
  if(!m)return {reason:'Waiting for HRRR grid'};
  if(m.error)return {reason:m.error};
  if(now-Date.parse(m.generatedAt)>45*60000)return {reason:'HRRR collection overdue · field hidden'};
  if(now-Date.parse(m.run)>18*HOUR)return {reason:'HRRR model run is old · field hidden'};
  const frame=target>Date.parse(m.frames.at(-1).valid)?null:m.frames.find(f=>Date.parse(f.valid)<=target&&target<Date.parse(f.valid)+HOUR);
  return frame?{frame}:{reason:'No HRRR step for selected time · field hidden'};
}
/** Sample nearest prepared cell for a named NWS point; label its spatial support. */
export function hrrrPoint(f,g,lon,lat){
  const x=Math.round((lon-g.x0)/g.dx),y=Math.round((lat-g.y0)/g.dy);
  if(x<0||x>=g.width||y<0||y>=g.height)return null;
  const i=y*g.width+x,u=f.u[i],v=f.v[i];
  return {speed:u===null||v===null?null:Math.hypot(u,v)*MPH,gust:f.gust[i]===null?null:f.gust[i]*MPH,longitude:g.x0+x*g.dx,latitude:g.y0+y*g.dy};
}
/** Build top-down masked bands; Esri's vector raster expects earth east/north UV. */
export function hrrrPixels(f,kind){
  const arrays=kind==='wind'?[f.u,f.v]:[f.gust.map(v=>v===null?null:v*MPH)];
  const mask=Uint8Array.from(f.u,(_,i)=>arrays.every(a=>a[i]!==null)?1:0);
  return {width:f.width,height:f.height,pixelType:'f32',pixels:arrays.map(a=>Float32Array.from(a,v=>v??0)),mask};
}
