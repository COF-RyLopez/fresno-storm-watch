import {createWeatherFrameCache} from './weather-frame-cache.js';

/** Serial published-frame playback. Keep at most three frames, never synthesize gaps or loop time. */
/**
 * @template Frame, Value
 * @param {import("../../command/src/module-contracts.ts").PlaybackOptions<Frame, Value>} options
 * @returns {import("../../command/src/module-contracts.ts").ForecastPlayback}
 */
export function createForecastPlayback({frames,load,render,validate=async()=>{},changed=()=>{},available=()=>true,
  reducedMotion=()=>globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
  dwell=1800,firstPlayable=0,schedule=setTimeout,cancel=clearTimeout}) {
  const cache=createWeatherFrameCache(3);
  let generation=0,selectionVersion=0,index=-1,playing=false,destroyed=false,timer,presenting;
  const report=(status,error)=>changed({status,error,playing,index,count:frames.length});
  function pause(){generation++;playing=false;cancel(timer);cache.cancelPending();if(!destroyed)report('paused');}
  const valid=run=>!destroyed&&generation===run;
  const read=at=>cache.get(at,signal=>load(frames[at],signal));
  async function show(at,run) {
    const selection=selectionVersion;
    if(at<0||at>=frames.length||!valid(run))return false;
    try {
      const value=await read(at);
      if(!valid(run))return false;
      await validate(value,frames[at]);
      if(!valid(run))return false;
      const drawing=Promise.resolve(render(value,frames[at],at));presenting=drawing;
      try{await drawing;}finally{if(presenting===drawing)presenting=undefined;}
      if(destroyed||selection!==selectionVersion)return false;
      index=at;
      if(!valid(run)){if(!playing)report('paused');return false;}
      return true;
    } catch(error) {
      if(valid(run)){playing=false;cancel(timer);report('error',error);}
      return false;
    }
  }
  async function prepare(run) {
    if(!valid(run)||!playing)return false;
    if(!available()){pause();return false;}
    if(index>=frames.length-1){playing=false;report('paused');return false;}
    // Start the dwell clock while prefetching, instead of adding fetch time to every frame.
    timer=schedule(()=>advance(run),dwell);
    try {await read(index+1);}
    catch(error){if(valid(run)){playing=false;cancel(timer);report('error',error);}return false;}
    if(!valid(run)||!playing)return false;
    if(!available()){pause();return false;}
    report('playing');return true;
  }
  async function advance(run) {
    if(!valid(run)||!playing)return;
    if(!available()){pause();return;}
    report('buffering');
    if(await show(index+1,run))await prepare(run);
  }
  return {
    get playing(){return playing;},
    async select(at){selectionVersion++;pause();const run=generation;report('loading');const ok=await show(at,run);if(ok)report('paused');return ok;},
    async play({automatic=false}={}) {
      if(destroyed||playing||frames.length-firstPlayable<2||!available()||automatic&&reducedMotion())return false;
      pause();const run=generation;playing=true;report('buffering');
      // Pause may finish one in-flight visual transition. Resume from its committed frame.
      if(presenting){try{await presenting;}catch{/* show owns presentation errors. */}if(!valid(run)||!playing)return false;}
      if(index<firstPlayable||index>=frames.length-1){if(!await show(firstPlayable,run)){if(valid(run))playing=false;return false;}}
      return prepare(run);
    },
    pause,
    destroy(){selectionVersion++;pause();destroyed=true;cache.clear();},
  };
}
