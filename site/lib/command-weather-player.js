import {createWeatherFrameCache} from './weather-frame-cache.js';

/** Serial published-frame playback. Keep at most three frames, never synthesize gaps or loop time. */
/**
 * @template Frame, Value
 * @param {import("../../command/src/module-contracts.ts").PlaybackOptions<Frame, Value>} options
 * @returns {import("../../command/src/module-contracts.ts").ForecastPlayback}
 */
export function createForecastPlayback({frames,load,render,validate=async()=>{},changed=()=>{},available=()=>true,
  reducedMotion=()=>globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
  dwell=1800,schedule=setTimeout,cancel=clearTimeout}) {
  const cache=createWeatherFrameCache(3);
  let generation=0,index=-1,playing=false,destroyed=false,timer;
  const report=(status,error)=>changed({status,error,playing,index,count:frames.length});
  function pause(){generation++;playing=false;cancel(timer);cache.cancelPending();if(!destroyed)report('paused');}
  const valid=run=>!destroyed&&generation===run;
  const read=at=>cache.get(at,signal=>load(frames[at],signal));
  async function show(at,run) {
    if(at<0||at>=frames.length||!valid(run))return false;
    try {
      const value=await read(at);
      if(!valid(run))return false;
      await validate(value,frames[at]);
      if(!valid(run))return false;
      index=at;render(value,frames[at],at);return true;
    } catch(error) {
      if(valid(run)){playing=false;cancel(timer);report('error',error);}
      return false;
    }
  }
  async function prepare(run) {
    if(!valid(run)||!playing)return false;
    if(!available()){pause();return false;}
    if(index>=frames.length-1){playing=false;report('paused');return false;}
    try {await read(index+1);}
    catch(error){if(valid(run)){playing=false;report('error',error);}return false;}
    if(!valid(run)||!playing)return false;
    if(!available()){pause();return false;}
    report('playing');timer=schedule(()=>advance(run),dwell);return true;
  }
  async function advance(run) {
    if(!valid(run))return;
    if(!available()){pause();return;}
    if(await show(index+1,run))await prepare(run);
  }
  return {
    get playing(){return playing;},
    async select(at){pause();const run=generation;report('loading');const ok=await show(at,run);if(ok)report('paused');return ok;},
    async play({automatic=false}={}) {
      if(destroyed||playing||frames.length<2||!available()||automatic&&reducedMotion())return false;
      pause();const run=generation;playing=true;report('buffering');
      if(index<0||index>=frames.length-1){if(!await show(0,run)){if(valid(run)){playing=false;report('paused');}return false;}}
      return prepare(run);
    },
    pause,
    destroy(){pause();destroyed=true;cache.clear();},
  };
}
