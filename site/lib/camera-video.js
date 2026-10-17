import { cameraMediaUrl } from './camera-model.js';

/** @param {HTMLVideoElement} video @param {Function} report @returns {object} One on-demand stream; no unattended playback. */
export function createCameraVideo(video, report) {
  let hls=null, generation=0, timeout, watchdog, lastProgress=0, lastTime=-1, running=false;
  const stop=(message='Video stopped')=>{
    generation++;running=false;clearTimeout(timeout);clearInterval(watchdog);
    hls?.destroy();hls=null;video.pause();video.removeAttribute('src');video.load();video.hidden=true;
    report(message,false);
  };
  const fail=message=>stop(`${message} · still-image view is available`);
  video.addEventListener('playing',()=>{
    if(!running)return;clearTimeout(timeout);lastProgress=Date.now();report('Live video playing · latency varies; inspect the camera timestamp',true);
  });
  video.addEventListener('pause',()=>{if(running)report('Video paused · displayed frame is not current',true);});
  video.addEventListener('waiting',()=>{if(running)report('Video buffering · displayed frame may be delayed',true);});
  video.addEventListener('ended',()=>{if(running)fail('Video ended');});
  video.addEventListener('error',()=>{if(running)fail('Video unavailable in this browser or at the publisher');});
  video.addEventListener('timeupdate',()=>{if(running&&video.currentTime>lastTime){lastTime=video.currentTime;lastProgress=Date.now();}});
  const play=async url=>{
    stop();const safe=cameraMediaUrl(url,'video');if(!safe){report('No supported publisher video address',false);return;}
    const token=generation;running=true;lastTime=-1;lastProgress=Date.now();
    video.hidden=false;video.muted=true;report('Connecting to Caltrans video…',true);
    timeout=setTimeout(()=>{if(token===generation)fail('Video connection timed out');},25_000);
    watchdog=setInterval(()=>{if(running&&!video.paused&&Date.now()-lastProgress>20_000)fail('Video stopped advancing');},5_000);
    try {
      const {default:Hls}=await import('../vendor/hls-1.7.3.light.js');
      if(token!==generation)return;
      // Prefer MSE playback: some Chromium builds advertise native HLS but fail it.
      if(Hls.isSupported()){
        hls=new Hls({enableWorker:false,maxBufferLength:15,backBufferLength:0,liveSyncDurationCount:3});
        hls.on(Hls.Events.ERROR,(_event,data)=>{if(data.fatal&&token===generation)fail('Publisher video unavailable');});
        hls.loadSource(safe);hls.attachMedia(video);
      }else if(video.canPlayType('application/vnd.apple.mpegurl'))video.src=safe;
      else throw new Error('HLS video is unsupported');
      await video.play();
    } catch(error) {
      if(token===generation){
        if(error.name==='NotAllowedError')report('Press Play in the video controls to begin',true);
        else fail('Video could not start');
      }
    }
  };
  return {play,stop,get active(){return running;}};
}
