import {createPreparedWeather,validateCurrentWeather} from './weather-frame-package.js';
import {loadWatershedRain,regionalForecastBounds} from './watch-watershed-data.js';
import {fetchQpfCycle} from './environment-data.js';
import {qpfPlanningTime} from './environment-model.js';
import {WPC_INTERVALS} from './watershed-timeline-model.js';
import {RAIN_PRESENTATION} from './rain-presentation.js';
import {presentRainImage} from './rain-image.js';
export {RAIN_BANDS as rainLegend} from './rain-presentation.js';

export const PREPARED_RAIN_MAX_AGE=30*60000;
export const RAIN_REFRESH_INTERVAL=15*60000;
const REVISION_MAX_AGE=60000, ISSUE_MAX_AGE=24*3600000, MAX_MANIFEST_BYTES=256*1024;
const sameCycle=(a,b)=>['issue','start','end','hours','units','product'].every(key=>a[key]===b[key]);
const sameWindow=(a,b)=>!a&&!b||a&&b&&['issue','start','end','layer'].every(key=>a[key]===b[key]);

/** Merge partial transport coverage without hiding live fallback or rolling overlaps. */
export function rainForecastWindows(prepared,timeline,now=Date.now()){
  const byLayer=new Map(),conflicts=new Set();
  for(const w of [...(prepared??[]),...timeline]){
    if(!WPC_INTERVALS.includes(w.layer)||w.end-w.start!==6*3600000||w.end>now+78*3600000||
      qpfPlanningTime(w,now,now,ISSUE_MAX_AGE)===null)continue;
    const previous=byLayer.get(w.layer);
    if(!previous||w.issue>previous.issue){byLayer.set(w.layer,w);conflicts.delete(w.layer);}
    else if(w.issue===previous.issue&&!sameWindow(previous,w))conflicts.add(w.layer);
  }
  const candidates=[...byLayer.values()].filter(w=>!conflicts.has(w.layer));
  return candidates.filter(w=>!candidates.some(other=>other!==w&&other.start<w.end&&other.end>w.start))
    .sort((a,b)=>a.start-b.start);
}

function currentPreparation(manifest,now){
  if(manifest.clock>now+120000||now-manifest.clock>PREPARED_RAIN_MAX_AGE)throw Error('Rain preparation is out of date');
}

/** Current public WPC transport only. The recorded benchmark is never a fallback.
 * @param {{baseUrl?: URL,signal?: AbortSignal,fetchImpl?: typeof fetch,clock?: ()=>number,direct?: typeof loadWatershedRain,getCycle?: typeof fetchQpfCycle}} [options]
 */
export async function createCommandRainDelivery({baseUrl=new URL('../data/prepared-weather/',import.meta.url),
  signal,fetchImpl=fetch,clock=Date.now,direct=loadWatershedRain,getCycle=fetchQpfCycle}={}){
  const lifetime=new AbortController(),revisions=new Map();
  const combined=extra=>AbortSignal.any([lifetime.signal,...(signal?[signal]:[]),...(extra?[extra]:[])]);
  const request=(url,options={})=>fetchImpl(url,{...options,credentials:'omit',signal:combined(options.signal)});
  let prepared=null;
  try{
    const response=await request(new URL('manifest.json',baseUrl),{cache:'no-store',signal:AbortSignal.timeout(3000)});
    if(!response.ok)throw Error('Prepared rainfall unavailable');
    const reader=response.body.getReader(),chunks=[];let size=0;
    try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;
      if(size>MAX_MANIFEST_BYTES)throw Error('Rain manifest exceeds size limit');chunks.push(value);}}
    catch(error){await reader.cancel().catch(()=>{});throw error;}
    const manifest=validateCurrentWeather(JSON.parse(await new Blob(chunks).text()));
    if(manifest.presentation!==RAIN_PRESENTATION)throw Error('Prepared rain presentation is incompatible');
    currentPreparation(manifest,clock());
    if(manifest.bounds.some((v,i)=>v!==regionalForecastBounds[i]))throw Error('Prepared rainfall coverage changed');
    prepared=createPreparedWeather(manifest,baseUrl,{fetchImpl:(url,options)=>request(url,{...options,signal:AbortSignal.any([options.signal,AbortSignal.timeout(8000)])})});
  }catch(error){if(signal?.aborted)throw error; /* Direct WPC remains authoritative. */}

  function assertOpen(extra){if(lifetime.signal.aborted)throw Error('Rain delivery is closed');combined(extra).throwIfAborted();}
  async function revision(id,hours,extra){
    assertOpen(extra);
    const existing=revisions.get(id);
    if(existing&&clock()-existing.checked<REVISION_MAX_AGE)return existing.cycle;
    const cycle=await getCycle({id,hours},(url,options)=>request(url,{...options,
      signal:AbortSignal.any([combined(extra),AbortSignal.timeout(5000),...(options.signal?[options.signal]:[])])}),clock());
    assertOpen(extra);revisions.set(id,{cycle,checked:clock()});return cycle;
  }
  async function validate(rain,window,extra){
    assertOpen(extra);const now=clock(),c=rain.cycle;
    if(qpfPlanningTime(c,now,now,ISSUE_MAX_AGE)===null)throw Error('Rain forecast is stale or expired');
    if(window&&!sameWindow(window,{layer:window.layer,...c}))throw Error('WPC has revised the selected window');
    if(rain.delivery?.method==='prepared')currentPreparation(prepared.manifest,now);
    if(!sameCycle(c,await revision(window?.layer??9,c.hours,extra)))throw Error('WPC has revised the selected window');
    if(c.end<=clock())throw Error('Rain forecast expired while loading');
    if(rain.delivery?.method==='prepared')currentPreparation(prepared.manifest,clock());
  }
  return {
    get windows(){
      try{if(!prepared)return null;currentPreparation(prepared.manifest,clock());}
      catch{return null;}
      return rainForecastWindows(prepared.manifest.frames.filter(f=>f.window).map(f=>({...f.window})),[],clock());
    },
    async load(window=null,extra){
      assertOpen(extra);
      try{
        if(!prepared)throw Error('Prepared rainfall unavailable');
        currentPreparation(prepared.manifest,clock());
        const f=prepared.manifest.frames.find(f=>sameWindow(f.window,window));
        if(!f)throw Error('Prepared window unavailable');
        const delivery={method:'prepared',preparedAt:prepared.manifest.capturedAt};
        await validate({cycle:f.cycle,delivery},window,extra);
        const frame=await prepared.load(f.id);assertOpen(extra);
        await validate({...frame,delivery},window,extra);
        return {...frame,delivery};
      }catch(error){
        assertOpen(extra); // Cancellation must not start another network path.
        const rain=await presentRainImage(await direct(regionalForecastBounds,{window,signal:combined(extra),fetchImpl,clock}));
        assertOpen(extra);
        revisions.set(window?.layer??9,{cycle:rain.cycle,checked:clock()});
        return {...rain,delivery:{method:'publisher'}};
      }
    },
    validate,
    destroy(){lifetime.abort();prepared?.destroy();revisions.clear();},
  };
}
