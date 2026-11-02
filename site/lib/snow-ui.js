import {loadSdk} from './map.js';
import {reportHealth} from './source-health.js';
import {labelPolygons,createLabelLayer} from './map-labels.js';
import {SNOW_POINTS,SNOW_ROUTES_URL,ROUTE_PRIORITIES,snowLevels,snowLevelAt,snowRange,feet,snowLines,chainPaths,profileSamples,profileStats,km,FT_PER_M,GNIS_URL,LANDMARK_LAYERS,placeOnProfile,labelRows} from './snow-model.js';

const $=id=>document.getElementById(id);
const ELEVATION_URL='https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer';
const NWS={Accept:'application/geo+json,application/json'};
const HOUR=3_600_000;
/** Snow level (NWS gridpoints) shaded on USGS 3DEP terrain at the weather timeline time, plus the county's snow-removal routes. */
export function createSnowLevel({time,exercise,target}){
  let controller=null,routes=null,highlight=null,peakLabels=null,Graphic=null,profile=null,profileToken=0,point='shaver',series=new Map(),errors=new Map(),checked=null,threshold=null,terrain=null,afd=null,afdError=null,busy=false;
  const json=async url=>{const r=await fetch(url,{headers:NWS,cache:'no-store',signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error(`NWS HTTP ${r.status}`);return r.json();};
  /** Mask the 3DEP elevation tile to cells at or above the snow level and paint them pale blue-white (ArcGIS client-side pixelFilter). */
  function pixelFilter(data){
    const pb=data?.pixelBlock;if(!pb?.pixels||threshold===null)return;
    const elev=pb.pixels[0],n=pb.width*pb.height,mask=new Uint8Array(n),r=new Uint8Array(n),g=new Uint8Array(n),b=new Uint8Array(n);
    for(let i=0;i<n;i++)if(elev[i]>=threshold&&(!pb.mask||pb.mask[i])){mask[i]=1;r[i]=226;g[i]=240;b[i]=255;}
    pb.pixels=[r,g,b];pb.mask=mask;pb.pixelType='u8';pb.statistics=null;
  }
  function render(){
    const t=target(),steps=series.get(point)||[],m=snowLevelAt(steps,t),name=SNOW_POINTS.find(p=>p.id===point).name;
    const next=threshold;threshold=m;if(terrain&&next!==threshold)terrain.redraw();
    const err=exercise?'Exercise · live NWS snow level disabled':errors.get(point);
    $('snow-level').textContent=err||(m===null?`No NWS snow level for ${name} at ${time(t)}`:`${feet(m).toLocaleString()} ft (${Math.round(m).toLocaleString()} m) · ${name} · ${time(t)}`);
    const r=snowRange(steps,t,t+24*HOUR);
    $('snow-range').textContent=r?`Next 24 h at ${name}: ${feet(r.low).toLocaleString()}–${feet(r.high).toLocaleString()} ft`:'';
    $('snow-legend-text').textContent=m===null?'No snow level for this time · shading hidden':`Shaded: terrain at or above ${feet(m).toLocaleString()} ft, the NWS snow level at ${name} for ${time(t)}`;
    $('snow-afd').replaceChildren(...(afd?.lines.length?afd.lines.map(l=>{const li=document.createElement('li');li.textContent=l;return li;}):[]));
    $('snow-afd-status').textContent=afdError||(afd?`NWS Hanford forecast discussion issued ${time(Date.parse(afd.issued))}${afd.lines.length?'':' · no snow mentioned'}`:'Checking NWS Hanford forecast discussion…');
    if(afd)$('snow-afd-link').href=afd.link;
    drawProfile();
    if(!exercise)reportHealth('snow-level','NWS snow level',{checked,error:errors.get(point)||null,maxAgeMs:3*HOUR,detail:'Gridpoint snow level at three Sierra points; AFD text is shown separately.'});
  }
  /** Profile chart: elevation line, dashed snow level, and the stretch at or above it shaded (clip above the snow line). */
  function drawProfile(){
    const svg=$('snow-profile-chart');
    // SVG elements have no .hidden property; toggle the attribute.
    if(!profile){svg.toggleAttribute('hidden',true);$('snow-profile-places').replaceChildren();return;}
    const marks=profile.marks||[],pts=profile.points,s=profileStats(pts,threshold),W=320,H=marks.length?180:150,L=52,B=22,T=marks.length?34:8,R=8,mi=k=>k/1.609344;
    svg.setAttribute('viewBox',`0 0 ${W} ${H}`);
    const lo=Math.min(...pts.map(p=>p.m),threshold??Infinity)-40,hi=Math.max(...pts.map(p=>p.m),threshold??-Infinity)+40,max=pts.at(-1).km||1;
    const x=k=>L+(k/max)*(W-L-R),y=m=>T+(1-(m-lo)/(hi-lo))*(H-T-B),line=pts.map(p=>`${x(p.km).toFixed(1)},${y(p.m).toFixed(1)}`).join(' ');
    const area=`${x(0)},${H-B} ${line} ${x(max)},${H-B}`,sy=threshold===null?null:y(threshold);
    svg.innerHTML=`<defs><clipPath id="snow-above"><rect x="0" y="0" width="${W}" height="${sy??0}"/></clipPath></defs>`+
      `<polygon points="${area}" fill="var(--calcite-color-foreground-3)"/>`+(sy===null?'':`<polygon points="${area}" fill="#e2f0ff" clip-path="url(#snow-above)"/><line x1="${L}" x2="${W-R}" y1="${sy}" y2="${sy}" stroke="#6fb6ff" stroke-dasharray="4 3"/><text x="${L+4}" y="${sy-4}" font-size="11" fill="#6fb6ff">snow level ${feet(threshold).toLocaleString()} ft</text>`)+
      `<polyline points="${line}" fill="none" stroke="var(--calcite-color-text-1)" stroke-width="1.5"/>`+
      `<text x="${L-4}" y="${y(hi-40)+3}" text-anchor="end" font-size="11" fill="currentColor">${Math.round((hi-40)*FT_PER_M).toLocaleString()} ft</text><text x="${L-4}" y="${y(lo+40)+3}" text-anchor="end" font-size="11" fill="currentColor">${Math.round((lo+40)*FT_PER_M).toLocaleString()} ft</text>`+
      landmarkSvg(labelRows(marks,{width:W-L-R,maxKm:max}),x,y,T,H-B,L,W-R)+
      `<text x="${L}" y="${H-6}" font-size="11" fill="currentColor">0</text><text x="${W-R}" y="${H-6}" text-anchor="end" font-size="11" fill="currentColor">${s.lengthMi.toFixed(1)} mi</text>`;
    $('snow-profile-places').replaceChildren(...marks.map(m=>{const li=document.createElement('li');const ft=Math.round(m.m*FT_PER_M).toLocaleString();li.textContent=m.kind==='peak'?`${m.name} (${m.name.includes('Gap')?'pass':'summit'}${m.peakFt?` ${m.peakFt.toLocaleString()} ft`:''}, ${mi(m.offKm).toFixed(1)} mi off the road) · mi ${mi(m.km).toFixed(1)} · road at ${ft} ft`:`${m.name} · mi ${mi(m.km).toFixed(1)} · ${ft} ft`;return li;}));
    svg.toggleAttribute('hidden',false);svg.setAttribute('aria-label',`Elevation profile of ${profile.name}: ${Math.round(s.lowFt).toLocaleString()} to ${Math.round(s.highFt).toLocaleString()} ft over ${s.lengthMi.toFixed(1)} miles`);
    $('snow-profile-status').textContent=`${profile.name}: ${Math.round(s.lowFt).toLocaleString()}–${Math.round(s.highFt).toLocaleString()} ft over ${s.lengthMi.toFixed(1)} mi`+(s.aboveMi===null?' · no snow level for this time':s.aboveMi<0.05?` · all below the ${feet(threshold).toLocaleString()} ft snow level`:` · ${s.aboveMi.toFixed(1)} mi at or above the ${feet(threshold).toLocaleString()} ft snow level`)+`. USGS 3DEP elevation along the county route${profile.parts>1?`, ${profile.parts} mapped pieces joined (gaps not counted)`:''}.`;
  }
  /** Labelled places on two rows above the profile with a leader line; peaks and extra places as ticks (name on hover). */
  function landmarkSvg(marks,x,y,top,bottom,left,right){
    const esc=t=>t.replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
    return marks.map(m=>{const cx=x(m.km),cy=y(m.m),title=`<title>${esc(m.name)} · ${Math.round(m.m*FT_PER_M).toLocaleString()} ft at the road</title>`;
      if(m.kind==='peak')return `<g>${title}<path d="M${cx-4},${cy-3} L${cx},${cy-10} L${cx+4},${cy-3} Z" fill="#c9b27c"/></g>`;
      if(m.row===null)return `<g>${title}<line x1="${cx}" x2="${cx}" y1="${bottom}" y2="${bottom-6}" stroke="currentColor"/></g>`;
      const ly=12+m.row*12,w=m.name.length*6+6,tx=Math.min(Math.max(cx,left+w/2),right-w/2);
      return `<g>${title}<line x1="${cx}" x2="${cx}" y1="${ly+3}" y2="${cy}" stroke="currentColor" stroke-opacity=".35" stroke-dasharray="2 2"/><text x="${tx}" y="${ly}" text-anchor="middle" font-size="10" fill="currentColor">${esc(m.name)}</text></g>`;}).join('');
  }
  /** GNIS places (600 m) and summits/passes (1.5 km) near the road, placed on the profile. Optional: the profile stands without them. */
  async function landmarks(parts,points){
    const geometry=JSON.stringify({paths:parts,spatialReference:{wkid:4326}});
    const sets=await Promise.all(LANDMARK_LAYERS.map(async l=>{
      const body=new URLSearchParams({geometry,geometryType:'esriGeometryPolyline',inSR:'4326',distance:String(l.metres),units:'esriSRUnit_Meter',spatialRel:'esriSpatialRelIntersects',where:l.where||'1=1',outFields:'gaz_name',returnGeometry:'true',outSR:'4326',f:'json'});
      const r=await fetch(`${GNIS_URL}/${l.id}/query`,{method:'POST',body,signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error(`GNIS HTTP ${r.status}`);
      const j=await r.json();if(j.error)throw Error(j.error.message||'GNIS error');
      // GNIS returns multipoints; every point is a candidate and placeOnProfile keeps the one nearest the road.
      return placeOnProfile(j.features.filter(f=>f.attributes.gaz_name&&f.geometry).flatMap(f=>(f.geometry.points||[[f.geometry.x,f.geometry.y]]).map(([x,y])=>({name:f.attributes.gaz_name,kind:l.kind,x,y}))),points).filter(m=>m.offKm<=l.metres/1000+0.2);}));
    return sets.flat().sort((a,b)=>a.km-b.km);
  }
  /** The profiled road's summits and passes on the map: a ▲ like the chart and one label (name · elevation) each. Peak
   * elevations are one 3DEP getSamples call; places are left to the basemap, which already names them. */
  async function showPeaks(peaks,token){
    if(!peaks.length)return;
    let feet=new Map();
    try{const body=new URLSearchParams({geometry:JSON.stringify({points:peaks.map(p=>[p.x,p.y]),spatialReference:{wkid:4326}}),geometryType:'esriGeometryMultipoint',returnFirstValueOnly:'true',f:'json'});
      const r=await fetch(`${ELEVATION_URL}/getSamples`,{method:'POST',body,signal:AbortSignal.timeout(30000)});
      if(r.ok)for(const s of (await r.json()).samples||[]){const v=Number(s.value);if(Number.isFinite(v)&&!feet.has(s.locationId))feet.set(s.locationId,Math.round(v*FT_PER_M/10)*10);}}
    catch{/* Names still show without elevations. */}
    if(token!==profileToken)return;
    for(const [i,p] of peaks.entries()){p.peakFt=feet.get(i)??null;highlight?.add(new Graphic({geometry:{type:'point',longitude:p.x,latitude:p.y,spatialReference:{wkid:4326}},symbol:{type:'simple-marker',style:'triangle',size:11,color:'#c9b27c',outline:{color:'#17232b',width:1}}}));}
    void peakLabels?.set(peaks.map(p=>({longitude:p.x,latitude:p.y,label:p.peakFt?`${p.name} · ${p.peakFt.toLocaleString()} ft`:p.name})));
    drawProfile();
  }
  async function showProfile(name){
    const token=++profileToken;profile=null;highlight?.removeAll();void peakLabels?.set([]);drawProfile();
    if(!name||!routes){$('snow-profile-status').textContent='Choose a road to see its elevation profile.';return;}
    $('snow-profile-status').textContent=`Sampling elevation along ${name}…`;
    try{
      const q=await routes.queryFeatures({where:`name = '${name.replace(/'/g,"''")}'`,outFields:['name'],returnGeometry:true,outSpatialReference:{wkid:4326}});
      const parts=chainPaths(q.features.flatMap(f=>f.geometry.paths));if(!parts.length)throw Error('no mapped line');
      // Sample each part separately (about 250 samples shared by length) and join them end to end, so gaps add no distance.
      const len=parts.map(p=>p.slice(1).reduce((a,pt,i)=>a+km(p[i],pt),0)),total=len.reduce((a,b)=>a+b,0)||1;
      const sampled=await Promise.all(parts.map(async(p,i)=>{
        const body=new URLSearchParams({geometry:JSON.stringify({paths:[p],spatialReference:{wkid:4326}}),geometryType:'esriGeometryPolyline',sampleCount:String(Math.max(20,Math.round(250*len[i]/total))),returnFirstValueOnly:'true',f:'json'});
        const r=await fetch(`${ELEVATION_URL}/getSamples`,{method:'POST',body,signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error(`3DEP HTTP ${r.status}`);
        return profileSamples((await r.json()).samples);}));
      // Keep x/y on each point: landmarks are matched to the road by position.
      let offset=0;const points=sampled.flatMap(ps=>{const out=ps.map(p=>({...p,km:p.km+offset}));offset=out.at(-1)?.km??offset;return out;});
      if(points.length<2)throw Error('too few elevation samples');const line=parts.flat();
      if(token!==profileToken)return;
      profile={name:name.replace(/\b\w+/g,w=>w[0]+w.slice(1).toLowerCase()),points};
      profile.parts=parts.length;
      highlight?.add(new Graphic({geometry:{type:'polyline',paths:parts,spatialReference:{wkid:4326}},symbol:{type:'simple-line',color:[255,255,255,.85],width:7}}));
      const xs=line.map(p=>p[0]),ys=line.map(p=>p[1]);void controller?.fitExtent({xmin:Math.min(...xs)-.01,ymin:Math.min(...ys)-.01,xmax:Math.max(...xs)+.01,ymax:Math.max(...ys)+.01});
      drawProfile();
      try{const marks=await landmarks(parts,points);if(token!==profileToken)return;profile.marks=marks;drawProfile();
        await showPeaks(marks.filter(m=>m.kind==='peak'),token);}
      catch{/* Names are optional; the profile and its numbers stand alone. */}
    }catch(e){if(token===profileToken)$('snow-profile-status').textContent=`Elevation profile unavailable · ${e.message}`;}
  }
  async function refresh(){
    if(busy||exercise||document.hidden)return;busy=true;
    await Promise.all(SNOW_POINTS.map(async p=>{try{const pt=await json(`https://api.weather.gov/points/${p.latitude},${p.longitude}`);series.set(p.id,snowLevels(await json(pt.properties.forecastGridData)));errors.delete(p.id);}catch(e){errors.set(p.id,`NWS snow level unavailable · ${e.message}`);}}));
    checked=Date.now();
    try{const list=await json('https://api.weather.gov/products/types/AFD/locations/HNX'),latest=list['@graph']?.[0];if(!latest)throw Error('no discussion listed');const prod=await json(`https://api.weather.gov/products/${latest.id}`);afd={issued:prod.issuanceTime,lines:snowLines(prod.productText),link:`https://forecast.weather.gov/product.php?site=HNX&issuedby=HNX&product=AFD`};afdError=null;}
    catch(e){afdError=`Forecast discussion unavailable · ${e.message}`;}
    busy=false;render();
  }
  $('snow-point').addEventListener('calciteSelectChange',e=>{point=e.target.value;render();});
  $('snow-profile-road').addEventListener('calciteSelectChange',e=>void showProfile(e.target.value));
  for(const [id,key] of [['snow-terrain-toggle','snowLevel'],['snow-routes-toggle','snowRoutes']])$(id).addEventListener('calciteCheckboxChange',e=>controller?.setLayerPreference(key,e.target.checked));
  $('snow-refresh').addEventListener('click',()=>void refresh());
  setInterval(()=>{if(!document.hidden)void refresh();},30*60000);
  queueMicrotask(()=>{render();void refresh();});
  return {update:render,async setMap(map){controller=map;try{
    const sdk=await loadSdk();const [ImageryLayer,FeatureLayer,GraphicsLayer,G]=await sdk.import(['@arcgis/core/layers/ImageryLayer.js','@arcgis/core/layers/FeatureLayer.js','@arcgis/core/layers/GraphicsLayer.js','@arcgis/core/Graphic.js']);Graphic=G;
    // rasterFunction None: raw metres. The service's default display function is a hillshade (0-255), which never reaches a snow level.
    terrain=new ImageryLayer({url:ELEVATION_URL,title:'Terrain above NWS snow level · USGS 3DEP',format:'lerc',rasterFunction:{functionName:'None'},pixelFilter,opacity:.45,popupEnabled:false,legendEnabled:false});
    map.registerLayer('snowLevel',terrain);
    routes=new FeatureLayer({url:SNOW_ROUTES_URL,title:'County snow removal routes',outFields:['name','maintainedby','priority','prioritydescription','limits','description'],
      renderer:{type:'unique-value',field:'priority',defaultSymbol:{type:'simple-line',color:'#a5a9ad',width:1.5},uniqueValueInfos:Object.entries(ROUTE_PRIORITIES).map(([v,p])=>({value:Number(v),label:p.label,symbol:{type:'simple-line',color:p.color,width:p.width,style:p.style||'solid'}}))},
      // Contact name/phone in the source are for permit holders; they are deliberately not requested.
      popupTemplate:{title:'{name} · snow removal',content:[{type:'fields',fieldInfos:[{fieldName:'prioritydescription',label:'County priority'},{fieldName:'maintainedby',label:'Maintained by'},{fieldName:'limits',label:'Limits'},{fieldName:'description',label:'Road class'}]},{type:'text',text:'County snow-removal plan, not current road conditions or plow status. Check closures and chain controls before travel.'}]}});
    labelPolygons(routes,{expression:'Proper($feature.name)',minScale:150_000,placement:'center-along'});
    // The profiled road, drawn under the coloured routes as a white casing.
    highlight=new GraphicsLayer({title:'Selected snow route (elevation profile)',popupEnabled:false});map.registerLayer('snowRoutes',highlight);map.registerLayer('snowRoutes',routes);
    // Peak names: same deconflicted label layer as gauges, shown once zoomed in near the road (the profile zooms there).
    peakLabels=createLabelLayer({FeatureLayer,Graphic},{title:'Summits and passes near the profiled road',below:true,minScale:300_000});map.registerLayer('snowRoutes',peakLabels.layer);render();
    try{const names=await routes.queryFeatures({where:'1=1',outFields:['name'],returnDistinctValues:true,returnGeometry:false});
      const opts=[...new Set(names.features.map(f=>f.attributes.name).filter(Boolean))].sort().map(n=>{const o=document.createElement('calcite-option');o.value=n;o.textContent=n.replace(/\b\w+/g,w=>w[0]+w.slice(1).toLowerCase());return o;});
      $('snow-profile-road').append(...opts);$('snow-profile-road').disabled=exercise;}
    catch(e){$('snow-profile-status').textContent=`Road list unavailable · ${e.message}`;}
  }catch(e){errors.set(point,`Snow map unavailable · ${e.message}`);render();}}};
}
