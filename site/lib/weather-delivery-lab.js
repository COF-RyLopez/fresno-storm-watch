import {measureWeatherReady} from './weather-delivery-measure.js';
import {labRenderer} from './weather-delivery-renderer.js';
import {loadWatershedRain} from './watch-watershed-data.js';
import {validateWeatherReplay,createPreparedWeather,frameFingerprint} from './weather-frame-package.js';

const $=id=>document.getElementById(id);
let base=new URL('../data/weather-delivery-experiment/',import.meta.url);
const format=new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'});
const node=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
const sha=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
let map,manifest,routes,context,prepared,epoch=0,closed=false;
const method=()=>document.querySelector('input[name="method"]:checked').value;
const json=async file=>{const r=await fetch(new URL(file,base),{cache:'no-store',credentials:'omit'});if(!r.ok)throw Error('Recorded comparison data is unavailable; the main Command workspace is unchanged.');return r.json();};

function observedFetch(stats){
  return async(input,init)=>{
    stats.requests++;
    const r=await fetch(input,init);stats.payloadBytes+=Number(r.headers.get('content-length'))||0;return r;
  };
}
function serviceReplay(stats){
  const transport=observedFetch(stats);
  return async(input,init)=>{
    const source=routes[new URL(input).href];
    if(!source)throw Error('The requested source revision is not in this recording');
    const r=await transport(new URL(source.file,base),init);
    return new Response(r.body,{status:r.status,headers:{'content-type':source.type,'content-length':String(source.bytes)}});
  };
}
async function openPrepared(stats){
  const transport=observedFetch(stats),r=await transport(new URL('manifest.json',base),{credentials:'omit',cache:'no-store'});
  if(!r.ok)throw Error('Prepared forecast unavailable');
  return createPreparedWeather(await r.json(),base,{fetchImpl:transport});
}
async function direct(frame,stats){
  return loadWatershedRain(manifest.bounds,{window:frame.window,clock:()=>manifest.clock,fetchImpl:serviceReplay(stats)});
}
async function matching(rain,frame){
  const checksum=rain.blob?await sha(await rain.blob.arrayBuffer()):null;
  return await frameFingerprint({...rain,image:checksum?{sha256:checksum}:null})===await frameFingerprint(frame);
}
function commit(rain,frame){
  map?.rain(rain);
  const box=node('div');
  for(const b of rain.legend){const item=node('span',`${b.value}`),swatch=node('i');swatch.style.backgroundColor=b.color;item.prepend(swatch);box.append(item);}
  $('period').textContent=`${rain.cycle.hours}-hour forecast rain · inches`;
  $('valid').textContent=`Valid ${format.formatRange(rain.cycle.start,rain.cycle.end)}`;
  $('issue').textContent=`WPC issued ${format.format(rain.cycle.issue)} · recorded ${format.format(manifest.clock)}`;
  $('legend').replaceChildren(...box.children);
  $('frame-note').textContent=rain.blob?'Publisher colors. Clear areas can be below the contour threshold or outside coverage; not proof of no rain.':'Verified response returned no contours ≥0.01 in in this extent; not proof of no rain.';
  $('frame-label').textContent=`Displayed: ${frame.cycle.hours} h · ${format.formatRange(frame.cycle.start,frame.cycle.end)}`;
  $('evidence').dataset.frame=frame.id;$('lab-map').dataset.frame=frame.id;
}
async function show(){
  if(!manifest||!map||closed)return;
  const run=++epoch,frame=manifest.frames[Number($('frame').value)],kind=method();
  $('frame-label').textContent=`Requested: ${frame.cycle.hours} h · ${format.formatRange(frame.cycle.start,frame.cycle.end)}`;
  $('load-status').textContent='Loading selected forecast; keeping the displayed dated evidence until it is ready.';
  const stats={requests:0,payloadBytes:0};
  try{
    const measured=await measureWeatherReady(()=>kind==='prepared'?prepared.load(frame.id):direct(frame,stats),rain=>matching(rain,frame));
    const rain=measured.value,ms=measured.milliseconds;
    if(run!==epoch||closed)return;
    commit(rain,frame);
    $('load-status').textContent=`${kind==='prepared'?'Prepared':'Current'} weather data ready · ${ms.toFixed(1)} ms. Map, legend and dates use ${frame.id}.`;
  }catch(error){if(run===epoch)$('load-status').textContent=error.message+' · Previous evidence retained, not replaced with zero.';}
}
function focus(){
  const basin=context?.watersheds.features.find(f=>f.properties.reservoir===$('basin').value);
  if(!basin||!map)return;
  map.watershed(basin);map.focus(basin.properties.bounds,true);
  $('map-status').textContent=`${$('basin').selectedOptions[0].textContent} · recorded reference context${$('lab-map').dataset.renderer==='three'?' · 3D map':''}`;
}
const median=values=>{const rows=[...values].sort((a,b)=>a-b);return rows[Math.floor(rows.length/2)];};
async function benchmark(){
  $('benchmark').disabled=true;const rows=[];
  try{
    for(let round=0;round<5;round++)for(const frame of manifest.frames){
      for(const kind of round%2?['prepared','direct']:['direct','prepared']){
        $('benchmark-status').textContent=`Paired trial ${round+1}/5 · ${frame.id} · ${kind}`;
        const stats={requests:0,payloadBytes:0};let store;
        try{
          const measured=await measureWeatherReady(async()=>kind==='direct'?direct(frame,stats):(store=await openPrepared(stats)).load(frame.id),rain=>matching(rain,frame));
          const rain=measured.value,milliseconds=measured.milliseconds,equal=true;
          rows.push({round:round+1,frame:frame.id,method:kind,phase:'cold',milliseconds,...stats,equal});
          if(store){
            const before={...stats};const warm=await measureWeatherReady(()=>store.load(frame.id),retained=>retained===rain);const retained=warm.value;
            rows.push({round:round+1,frame:frame.id,method:kind,phase:'memory-repeat',milliseconds:warm.milliseconds,
              requests:stats.requests-before.requests,payloadBytes:stats.payloadBytes-before.payloadBytes,equal:retained===rain});
          }
        }finally{store?.destroy();}
      }
    }
    const summary=[['Current workflow','direct','cold'],['Prepared · cold','prepared','cold'],['Prepared · repeat','prepared','memory-repeat']].map(([label,kind,phase])=>{
      const subset=rows.filter(r=>r.method===kind&&r.phase===phase);
      return {label,method:kind,phase,n:subset.length,medianMs:median(subset.map(r=>r.milliseconds)),requests:median(subset.map(r=>r.requests)),payloadBytes:median(subset.map(r=>r.payloadBytes))};
    });
    const body=$('results').querySelector('tbody');body.replaceChildren();
    for(const r of summary){const tr=node('tr');tr.append(node('td',r.label),node('td',r.medianMs.toFixed(1)+' ms'),node('td',String(r.requests)));body.append(tr);}
    $('results').hidden=false;$('raw-results').hidden=false;
    const profile=await json('profile.json');
    const results={kind:'same-host-recorded-weather-delivery',capturedAt:manifest.capturedAt,measuredAt:new Date().toISOString(),profile,
      viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio},metric:'validated data ready; excludes map/GPU paint and terrain startup',summary,rows};
    $('benchmark-json').textContent=JSON.stringify(results,null,2);
    $('benchmark-status').textContent=`${rows.length} measurements completed. Every image, legend, unit and forecast window matched. Simulated per-request latency: ${profile.latencyMs} ms.`;
  }catch(error){$('benchmark-status').textContent='Comparison incomplete: '+error.message;}
  finally{$('benchmark').disabled=false;}
}
async function start(){
  try{
    const pointer=await json('index.json');
    if(pointer.schemaVersion!==1||!/^records\/[a-f0-9]{64}\/$/.test(pointer.recording))throw Error('Invalid recording pointer');
    base=new URL(pointer.recording,base);
    [manifest,routes,context]=await Promise.all([json('manifest.json'),json('routes.json'),json('context.json')]);
    validateWeatherReplay(manifest);
    if(manifest.capturedAt!==pointer.capturedAt)throw Error('Recording time mismatch');
    prepared=createPreparedWeather(manifest,base);
    const profile=await json('profile.json');
    $('source').textContent=`NOAA WPC. Recorded ${format.format(manifest.clock)}. Forecast images: ${manifest.rasterCrs}; corner coordinates: ${manifest.coordinateCrs}.`;
    $('context-note').textContent=context.contextNote;
    $('profile').textContent=`Same-host replay. ${profile.latencyMs} ms simulated latency per weather request; no artificial bandwidth limit. This is not a production CDN speed measurement.`;
    $('frame').max=String(manifest.frames.length-1);$('frame').disabled=false;
    $('frame').addEventListener('input',()=>void show());
    document.querySelectorAll('input[name="method"]').forEach(r=>r.addEventListener('change',()=>void show()));
    $('basin').addEventListener('change',focus);
    $('benchmark').onclick=()=>void benchmark();$('benchmark').disabled=false;
    const renderer=labRenderer(location.search);
    $('renderer-toggle').href=renderer.switchHref(location.pathname,location.hash);
    $('renderer-toggle').textContent=renderer.switchLabel;
    $('map-status').textContent=`Loading ${renderer.label}…`;
    const {createWatchTerrain}=renderer.three?await import('./county-scene-map.js'):await import('./watch-terrain-map.js');
    if(closed)return;
    $('lab-map').dataset.renderer=renderer.id;
    map=await createWatchTerrain({container:$('lab-map'),onSelect:record=>{$('map-status').textContent='Recorded reference · '+(record.name||record.id||'location');},
      onError:error=>{$('map-status').textContent='Some reference tiles are unavailable; weather delivery measurements remain usable.';
        const text=String(error);if(!$('map-errors').textContent.includes(text)&&$('map-errors').children.length<5)$('map-errors').append(node('li',text));}});
    map.set({type:'FeatureCollection',features:context.features});focus();await show();
  }catch(error){$('load-status').textContent=error.message;$('map-status').textContent='Laboratory unavailable; published Command is unchanged.';}
}
window.addEventListener('pagehide',()=>{closed=true;epoch++;prepared?.destroy();map?.destroy();},{once:true});
void start();
