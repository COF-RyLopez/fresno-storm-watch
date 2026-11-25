import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createCommandRainDelivery,rainForecastWindows} from '../site/lib/command-rain.js';
import {regionalForecastBounds,rainRasterGeometry} from '../site/lib/watch-watershed-data.js';

const HOUR=3600000, now=Date.parse('2026-11-25T12:00:00Z');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGfoAAAAASUVORK5CYII=','base64');
const sha256=createHash('sha256').update(png).digest('hex');
export const fixture=()=>({schemaVersion:1,kind:'prepared-wpc-display',capturedAt:new Date(now).toISOString(),clock:now,
  publisher:'NOAA WPC',source:'https://mapservices.weather.noaa.gov/vector/rest/services/precip/wpc_qpf/MapServer',
  rasterCrs:'EPSG:3857',coordinateCrs:'EPSG:4326',bounds:[...regionalForecastBounds],frames:[{
    id:'qpf-9',window:null,cycle:{issue:now-HOUR,start:now,end:now+72*HOUR,hours:72,units:'in',product:'72-hour QPF'},
    coordinates:rainRasterGeometry(regionalForecastBounds).coordinates,legend:[{value:.25,color:'rgb(1,2,3)'}],
    image:{file:`images/${sha256}.png`,sha256,bytes:png.length,width:1,height:1}},
    {id:'qpf-14',window:{layer:14,issue:now-HOUR,start:now,end:now+6*HOUR},
    cycle:{issue:now-HOUR,start:now,end:now+6*HOUR,hours:6,units:'in',product:'6-hour QPF'},
    coordinates:rainRasterGeometry(regionalForecastBounds).coordinates,legend:[],image:null}]});

async function harness(t,{edit=()=>{},image=png,cycle,failManifest=false}={}){
  const manifest=fixture();edit(manifest);let time=now,reads=[],directCalls=0,checks=0;
  const delivery=await createCommandRainDelivery({baseUrl:new URL('https://example.test/data/prepared-weather/'),clock:()=>time,
    fetchImpl:async(url,options)=>{assert.equal(options.credentials,'omit');reads.push(String(url));
      if(String(url).endsWith('manifest.json'))return failManifest?new Response('',{status:404}):Response.json(manifest);
      return new Response(image,{headers:{'content-type':'image/png'}});},
    getCycle:async period=>{checks++;return cycle?cycle(period):fixture().frames.find(f=>f.id===`qpf-${period.id}`).cycle;},
    direct:async(_bounds,options)=>{directCalls++;return {...fixture().frames[0],cycle:fixture().frames[0].cycle,blob:null,options};},
  });
  t.after(()=>delivery.destroy());
  return {delivery,reads,setTime:value=>time=value,get directCalls(){return directCalls;},get checks(){return checks;}};
}

test('current prepared rain retains the exact source image, dates and legend; reuses bounded image data',async t=>{
  const h=await harness(t);assert.equal(h.delivery.windows.length,1);
  const a=await h.delivery.load(null);const b=await h.delivery.load(null);
  assert.equal(a.delivery.method,'prepared');assert.equal(b.blob,a.blob);
  assert.deepEqual(a.cycle,fixture().frames[0].cycle);assert.deepEqual(a.legend,fixture().frames[0].legend);
  assert.deepEqual(Buffer.from(await a.blob.arrayBuffer()),png);
  assert.equal(h.directCalls,0);assert.equal(h.checks,1);assert.equal(h.reads.length,2);
});

for(const [name,options] of [
  ['missing manifest',{failManifest:true}],
  ['recorded experiment',{edit:p=>p.kind='recorded-wpc-display-replay'}],
  ['old preparation',{edit:p=>{p.clock-=31*60000;p.capturedAt=new Date(p.clock).toISOString();}}],
  ['future preparation',{edit:p=>{p.clock+=3*60000;p.capturedAt=new Date(p.clock).toISOString();}}],
  ['wrong coverage',{edit:p=>p.bounds[0]=-125}],
  ['wrong image location',{edit:p=>p.frames[0].coordinates=[[0,1],[1,1],[1,0],[0,0]]}],
  ['corrupt image',{image:new Uint8Array(png.length)}],
  ['new WPC revision',{cycle:()=>({...fixture().frames[0].cycle,issue:now})}],
  ['publisher check unavailable',{cycle:()=>{throw Error('source down');}}],
])test(`${name} uses direct publisher delivery, never an old replay`,async t=>{
  const h=await harness(t,options);const rain=await h.delivery.load(null);
  assert.equal(rain.delivery.method,'publisher');assert.equal(h.directCalls,1);
});

test('exact selected window is required; verified empty contours remain distinct from missing data',async t=>{
  const h=await harness(t),window=fixture().frames[1].window;
  const rain=await h.delivery.load(window);assert.equal(rain.blob,null);assert.equal(rain.delivery.method,'prepared');
  assert.equal(h.reads.length,1);assert.equal(h.directCalls,0);
  await h.delivery.load({...window,issue:now});assert.equal(h.directCalls,1);
});

test('cached playback is revalidated after the source check expires and cannot show a changed revision',async t=>{
  let revised=false;
  const h=await harness(t,{cycle:()=>({...fixture().frames[0].cycle,issue:revised?now:now-HOUR})});
  const rain=await h.delivery.load(null);h.setTime(now+61000);revised=true;
  await assert.rejects(h.delivery.validate(rain,null),/revised/);assert.equal(h.checks,2);
});

test('prepared expiry and window expiry are enforced even for a loaded frame',async t=>{
  const h=await harness(t),rain=await h.delivery.load(null);
  h.setTime(now+31*60000);await assert.rejects(h.delivery.validate(rain,null),/prepar/);
  const h2=await harness(t),window=fixture().frames[1].window,rain2=await h2.delivery.load(window);
  h2.setTime(window.end);await assert.rejects(h2.delivery.validate(rain2,window),/expired/);
});

test('aborted selection does not fall through to a second network route',async t=>{
  const h=await harness(t),controller=new AbortController();controller.abort();
  await assert.rejects(h.delivery.load(null,controller.signal),{name:'AbortError'});
  assert.equal(h.directCalls,0);assert.equal(h.reads.length,1);
  h.delivery.destroy();await assert.rejects(h.delivery.load(null),/closed/);
});

test('partial prepared coverage retains direct-service windows; newer known revisions supersede prepared ones',()=>{
  const a=fixture().frames[1].window,b={...a,layer:15,start:a.end,end:a.end+6*HOUR};
  assert.deepEqual(rainForecastWindows([a],[b],now),[a,b]);
  const revised={...a,issue:now};
  assert.deepEqual(rainForecastWindows([a],[revised],now),[revised]);
});

test('rolling publication with overlapping or conflicting windows is withheld instead of duplicated',()=>{
  const a=fixture().frames[1].window;
  assert.deepEqual(rainForecastWindows([a,{...a,layer:15}],[],now),[]);
  assert.deepEqual(rainForecastWindows([a],[{...a,start:a.start+HOUR,end:a.end+HOUR}],now),[]);
});
