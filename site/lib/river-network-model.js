/** River network (data/river-network.json) and illustrative surge travel. Planning aid only: no hydraulic routing.
 * Every point on the network has D = km to the network terminal; D is shared across confluences, so a pulse moving
 * downstream is just D falling, following each path's downstream link. Reaches with measured gauge-to-gauge travel times
 * (data/travel-times.json) use their measured speed; everywhere else uses the assumed SURGE_CONFIG.speedKmh. */
const R=6371.0088,rad=Math.PI/180,HOUR=3_600_000;
const km=(a,b)=>{const dLat=(b[1]-a[1])*rad,dLon=(b[0]-a[0])*rad,h=Math.sin(dLat/2)**2+Math.cos(a[1]*rad)*Math.cos(b[1]*rad)*Math.sin(dLon/2)**2;return 2*R*Math.asin(Math.sqrt(h));};

/** Owner-adjustable. ponytail: one assumed speed for every channel; per-reach celerity needs a hydraulic model or measured lags. */
export const SURGE_CONFIG=Object.freeze({
  speedKmh:4,          // assumed flood-wave speed (~2.5 mph) where no measured reach applies; illustrative
  tailKm:6,            // drawn length of each pulse
  riseFtPerHour:0.2,   // a gauge rising at least this fast (same as Storm now "Next") starts a pulse
  forecastRiseFt:0.5,  // a published forecast crest at least this far above the current stage starts a pulse
  maxAheadHours:72,    // the timeline stretches to reach upcoming pulses, up to this far ahead
  backHours:6,aheadHours:12,stepMinutes:15
});

/** @param {object|null} doc travel-times.json @returns {object[]} Measured reaches usable for speeds (bad rows dropped). */
export function reachSpeeds(doc){
  if(doc?.version!==1||!Array.isArray(doc.reaches))return [];
  return doc.reaches.filter(r=>typeof r.path==='string'&&Number.isFinite(r.kmFrom)&&Number.isFinite(r.kmTo)&&r.kmFrom>r.kmTo&&Number.isFinite(r.speedKmh)&&r.speedKmh>0&&r.speedKmh<40)
    .map(r=>({path:r.path,hi:r.kmFrom,lo:r.kmTo,speedKmh:r.speedKmh,lagHours:r.lagHours,label:`${r.fromName} → ${r.toName}`}));
}
/** @param {object} doc river-network.json @param {object|null} travel travel-times.json @returns {object} Indexed network; throws on a malformed file. */
export function indexNetwork(doc,travel=null){
  if(doc?.version!==1||!Array.isArray(doc.paths)||!Array.isArray(doc.points))throw new Error('River network file is invalid.');
  const paths=new Map();
  for(const p of doc.paths){
    if(typeof p.id!=='string'||!Array.isArray(p.parts)||!p.parts.length)throw new Error('River network path is invalid.');
    const parts=p.parts.map(part=>{
      if(!Array.isArray(part.c)||part.c.length<2||!Number.isFinite(part.end))throw new Error('River network part is invalid.');
      const cum=[0];for(let i=1;i<part.c.length;i++)cum.push(cum[i-1]+km(part.c[i-1],part.c[i]));
      return {c:part.c,end:part.end,len:cum.at(-1),cum};
    }).sort((a,b)=>b.end-a.end); // upstream part first
    paths.set(p.id,{...p,parts});
  }
  return {paths,points:new Map(doc.points.map(pt=>[pt.id,pt])),doc,reaches:reachSpeeds(travel)};
}

/** Sub-line of a part between distances-from-upstream a<b. */
function cut(part,a,b){
  const at=s=>{let i=1;while(i<part.cum.length-1&&part.cum[i]<s)i++;const s0=part.cum[i-1],s1=part.cum[i],t=s1>s0?(s-s0)/(s1-s0):0,p=part.c[i-1],q=part.c[i];return {i,pt:[p[0]+t*(q[0]-p[0]),p[1]+t*(q[1]-p[1])]};};
  const A=at(a),B=at(b);return [A.pt,...part.c.slice(A.i,B.i),B.pt];
}
/** @returns {number[][][]} Polylines covering distances-to-terminal hi→lo, starting on pathId and following downstream links. */
export function routeSlice(net,pathId,hi,lo){
  const out=[],seen=new Set();let id=pathId;
  while(id&&!seen.has(id)&&hi>lo){
    seen.add(id);const p=net.paths.get(id);if(!p)break;
    for(const part of p.parts){
      const top=part.end+part.len,from=Math.min(hi,top),to=Math.max(lo,part.end);
      if(from>to)out.push(cut(part,top-from,top-to));
    }
    hi=Math.min(hi,p.parts.at(-1).end);id=p.dn;
  }
  return out;
}

/** @param {object} input {areas, usgs, net, now} @returns {object[]} Pulse sources at snapped gauges: observed rises and published forecast crests. */
export function surgeSources({areas=[],usgs=null,net,now=Date.now()}){
  const out=[],cfg=SURGE_CONFIG;
  const add=(id,kind,t0,label)=>{const pt=net.points.get(id);if(pt?.path&&Number.isFinite(pt.km)&&Number.isFinite(t0))out.push({key:`${kind}:${id}`,id,kind,t0,label,name:pt.name,path:pt.path,km:pt.km});};
  const seen=new Set();
  for(const r of areas)for(const g of r.gauges||[]){
    const a=g.assessment;if(!a||seen.has(g.id))continue;seen.add(g.id);
    const rate=a.trend&&a.trend.hours>0&&g.gauge?.observed?.units==='ft'?a.trend.delta/a.trend.hours:null;
    if(rate!==null&&rate>=cfg.riseFtPerHour)add(g.id,'observed',a.observed?.time,`Rising ${rate.toFixed(2)} ft/h`);
    // A crest only a few hundredths above today's stage is not a surge; ft only, since kcfs deltas are not comparable.
    if(a.forecastUsable&&a.peak&&a.peak.time>now&&a.delta>=cfg.forecastRiseFt&&g.gauge?.forecast?.units==='ft')add(g.id,'forecast',a.peak.time,`Forecast crest ${a.peak.value} ft (+${a.delta.toFixed(1)} ft)`);
  }
  for(const [site,r] of usgs?.readings||[])if(r?.rise&&r.rise.rate>=cfg.riseFtPerHour&&r.stage)add(site,'observed',r.stage.time,`Rising ${r.rise.rate.toFixed(2)} ft/h`);
  return out;
}

/** @returns {number} Distance-to-terminal of a pulse front `hours` after it starts: measured reach speeds on the reach's own
 * path, the assumed speed elsewhere. A measured reach never applies while the pulse is still on a tributary above it. */
export function frontKm(net,s,hours,cfg=SURGE_CONFIG){
  const route=[];for(let id=s.path,seen=new Set();id&&!seen.has(id)&&net.paths.has(id);id=net.paths.get(id).dn){seen.add(id);route.push(net.paths.get(id));}
  const reaches=net.reaches??[];let km=s.km,t=hours,i=0;
  while(t>1e-9){
    while(i<route.length-1&&km<=route[i].parts.at(-1).end)i++;
    const p=route[i],bottom=i<route.length-1?p.parts.at(-1).end:-Infinity,mine=reaches.filter(r=>r.path===p?.id);
    const r=mine.find(r=>km<=r.hi&&km>r.lo),lower=mine.filter(r=>r.hi<km).reduce((m,r)=>Math.max(m,r.hi),-Infinity);
    const next=Math.max(r?r.lo:lower,bottom),speed=r?r.speedKmh:cfg.speedKmh;
    if(next===-Infinity||(km-next)/speed>=t){km-=speed*t;break;}
    t-=(km-next)/speed;km=next;
  }
  return km;
}
/** @returns {string} How pulse speeds were set, for status lines. */
export function speedNote(net,cfg=SURGE_CONFIG){
  const n=(net?.reaches??[]).length,mph=(cfg.speedKmh*0.621371).toFixed(1);
  return n?`Measured gauge-to-gauge travel times on ${n} San Joaquin reaches; assumed ${mph} mph elsewhere. Illustrative, not a forecast.`:`Assumed ${mph} mph travel. Illustrative, not a forecast.`;
}
/** @param {object} net @param {object[]} sources @param {number} t timeline time @returns {object[]} Where each pulse is at t (none before it starts). */
export function surgeFrames(net,sources,t,cfg=SURGE_CONFIG){
  return sources.filter(s=>t>=s.t0).map(s=>{
    const front=frontKm(net,s,(t-s.t0)/HOUR,cfg);
    const lines=routeSlice(net,s.path,Math.min(s.km,front+cfg.tailKm),front);
    return {...s,front,lines,left:!lines.length&&front<s.km};
  });
}

/** @param {object[]} sources @param {number} now @returns {{min:number,max:number}} Timeline bounds in minutes from now: the usual
 * window, stretched to show the latest upcoming pulse moving for a few hours (capped at maxAheadHours). */
export function timelineRange(sources,now=Date.now(),cfg=SURGE_CONFIG){
  const step=cfg.stepMinutes,latest=Math.max(0,...sources.map(s=>(s.t0-now)/60_000));
  return {min:-cfg.backHours*60,max:Math.min(cfg.maxAheadHours*60,Math.max(cfg.aheadHours*60,Math.ceil((latest+360)/step)*step))};
}
/** @returns {number} Minutes from now to the first timeline step at or after a source's start. */
export const startOffset=(s,now=Date.now(),cfg=SURGE_CONFIG)=>(Math.ceil((s.t0-now)/60_000/cfg.stepMinutes)*cfg.stepMinutes||0); // round up: land on or after the start

/** @returns {number[][]} One downstream line from distance-to-terminal `fromKm` to `toKm` (parts joined in route order). */
export function routeLine(net,pathId,fromKm,toKm=0){
  const out=[];
  for(const part of routeSlice(net,pathId,fromKm,toKm))for(const c of part){const last=out.at(-1);if(!last||last[0]!==c[0]||last[1]!==c[1])out.push(c);}
  return out;
}
/** @param {{distance:number,elevation:number}[]} samples metres @returns {object|null} SVG path for a width×height chart, with its ranges. */
export function profilePath(samples,width,height){
  const s=(samples||[]).filter(p=>Number.isFinite(p?.distance)&&Number.isFinite(p?.elevation));if(s.length<2)return null;
  const maxD=s.at(-1).distance,lo=Math.min(...s.map(p=>p.elevation)),hi=Math.max(...s.map(p=>p.elevation)),span=hi-lo||1;
  const x=d=>d/maxD*width,y=e=>height-(e-lo)/span*height;
  return {d:s.map((p,i)=>`${i?'L':'M'}${x(p.distance).toFixed(1)} ${y(p.elevation).toFixed(1)}`).join(''),maxD,lo,hi,x,y};
}
