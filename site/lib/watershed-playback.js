/** Show each frame's settled result long enough to read it. Stop when there is no next frame. */
export function createWatershedPlayback({advance,changed,canAdvance,dwell=1400,schedule=setTimeout,cancel=clearTimeout}){
 let generation=0,playing=false,timer;
 function pause(){
  if(!playing)return;
  generation++;playing=false;cancel(timer);changed(false);
 }
 async function step(run){
  if(run!==generation||!playing)return;
  if(!canAdvance()){pause();return;}
  const result=await advance();
  if(run!==generation)return;
  if(!result||!canAdvance()){pause();return;}
  timer=schedule(()=>void step(run),dwell);
 }
 return {pause,get playing(){return playing;},play(){
  if(playing||!canAdvance())return;
  playing=true;changed(true);void step(++generation);
 }};
}
