import {reportHealth} from './source-health.js';
import { CAMERA_FEED, normalizeCameras, cameraAvailability, cameraImageFreshness } from './camera-model.js';
import { createCameraVideo } from './camera-video.js';
import { formatTime } from './model.js';

const $=id=>document.getElementById(id);
/** @param {string} tag @param {string} text @param {object} attrs @returns {HTMLElement} */
function el(tag,text='',attrs={}) {const n=document.createElement(tag);n.textContent=text;for(const[k,v]of Object.entries(attrs))if(v!==false&&v!==null)n.setAttribute(k,v===true?'':String(v));return n;}

/** @param {object} options @returns {Promise<object>} Camera failure never blocks gauges or map. */
export async function createCameraWatch({config,timeZone,exercise,onGauge,initialOpen=true,onOpenChange=()=>{},onMap=()=>{}}) {
  let selection=[],cameras=[],selected=null,map=null,open=initialOpen,busy=false,feedError=null,lastCheck=null;
  let feedTimer,imageTimer,imageController,objectUrl=null,imageState=null,imageGeneration=0,nextImage=0;
  let imageBusy=false,videoActive=false,suspended=false;
  let listSignature='';
  const time=value=>formatTime(value??null,timeZone);
  const current=()=>cameras.find(c=>c.id===selected);
  const available=c=>cameraAvailability(c,feedError,Date.now(),config.staleMs);
  const video=createCameraVideo($('camera-video'),(message,active)=>{
    videoActive=active;$('camera-video-status').textContent=message;
    $('camera-stop').hidden=!active;$('camera-play').hidden=active;$('camera-image-wrap').hidden=active;
    $('camera-video').hidden=!active;
  });
  const paintImageTime=()=>{
    const c=current(),age=cameraImageFreshness(imageState,Date.now(),Math.max(config.imageMaxAgeMs,(c?.imageIntervalMs||60_000)*3));
    $('camera-image-state').textContent=age.label;$('camera-image-state').dataset.tone=age.tone;
    $('camera-image-updated').textContent=time(imageState?.modified);
    $('camera-image-loaded').textContent=time(imageState?.loaded);
  };
  const clearImage=()=>{imageGeneration++;imageController?.abort();imageController=null;imageBusy=false;clearTimeout(imageTimer);imageState=null;nextImage=0;
    $('camera-image').removeAttribute('src');$('camera-image').hidden=true;if(objectUrl)URL.revokeObjectURL(objectUrl);objectUrl=null;paintImageTime();};
  const paint=()=>{
    if(!exercise)reportHealth('caltrans-cameras','Caltrans camera catalog',{checked:lastCheck,error:feedError,maxAgeMs:config.pollMs*2,detail:'Catalog availability does not confirm a camera image is current.'});
    const c=current();
    $('camera-count').textContent=String(selection.length);$('camera-count').setAttribute('label',`${selection.length} selected river-area cameras`);
    $('camera-feed-status').textContent=exercise?'Cameras disabled in fictional exercise':busy?'Checking Caltrans catalog…':feedError?`Catalog check failed · ${feedError}`:lastCheck?`Catalog checked ${time(lastCheck)}`:'Waiting for Caltrans catalog';
    $('camera-catalog-refresh').toggleAttribute('disabled',busy||exercise||!selection.length);
    const signature=JSON.stringify(cameras.map(c=>[c.id,available(c).label,c.id===selected]));
    if(signature!==listSignature){listSignature=signature;const list=$('camera-list');list.replaceChildren();
      for(const camera of cameras){const a=available(camera);const b=el('calcite-list-item','',{value:camera.id,label:camera.name,description:`${camera.corridor} · ${camera.county}`,selected:camera.id===selected,'icon-start':'camera'});
        b.append(el('p',!a.usable?a.label:camera.imageReview?.needsReview?'Image placeholder at last visual check':'Still image / video source',{slot:'content-bottom',class:'camera-caption'}));
        list.append(b);}}
    if(selected)$('camera-picker').value=selected;
    $('camera-empty').hidden=cameras.length>0;$('camera-empty').textContent=exercise?'Live camera requests are disabled in the fictional exercise. Open the live view to inspect conditions.':'Loading the camera selection…';
    $('camera-evidence').hidden=!c;
    if(!c)return;
    const a=available(c);
    $('camera-name').textContent=c.name;$('camera-corridor').textContent=`${c.corridor} · ${c.scopeRole}`;
    $('camera-location-note').textContent=`Publisher county: ${c.county}. ${c.note}`;
    $('camera-review').hidden=!c.imageReview?.needsReview;
    $('camera-review').textContent=c.imageReview?.needsReview?`Visual check ${c.imageReview.checked}: publisher image showed “Temporarily Unavailable.” Verify the current frame or try video; a new file time does not prove recovery.`:'';
    $('camera-service').textContent=a.label+(a.reason?` · ${a.reason}`:'');$('camera-service').dataset.tone=a.usable?'current':'gap';
    $('camera-record-time').textContent=`Catalog record changed ${time(c.recordChanged)}. This is not the image time.`;
    $('camera-refresh').toggleAttribute('disabled',!a.usable||!c.imageUrl||imageBusy);
    $('camera-play').toggleAttribute('disabled',!a.usable||!c.videoUrl);
    $('camera-focus').toggleAttribute('disabled',!map);
    $('camera-gauge').hidden=!c.gaugeId;$('camera-gauge').toggleAttribute('disabled',!c.gaugeId);
    $('camera-source-image').hidden=!c.imageUrl;if(c.imageUrl)$('camera-source-image').setAttribute('href',c.imageUrl);
    $('camera-image').alt=`Caltrans highway camera: ${c.name}. Inspect the on-image timestamp; river visibility is unverified.`;
    $('camera-cadence').textContent=c.imageIntervalMs?`Publisher image interval: ${c.imageIntervalMs/60_000} min. Refreshes while this panel and tab are visible.`:'Publisher image interval unknown. App checks once per minute while visible.';
    if(!a.usable&&videoActive)video.stop('Video stopped · camera service status needs verification');
    paintImageTime();map?.updateCameras(cameras.map(camera=>({...camera,usable:available(camera).usable&&!camera.imageReview?.needsReview})));
  };
  const refreshImage=async()=>{
    const c=current();clearTimeout(imageTimer);
    if(!c||!open||suspended||document.hidden||exercise||!available(c).usable||!c.imageUrl||imageBusy)return;
    imageBusy=true;const token=++imageGeneration,controller=new AbortController();imageController=controller;paint();
    let candidateUrl;
    try {
      const response=await fetch(c.imageUrl,{credentials:'omit',cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(config.requestTimeoutMs)])});
      if(!response.ok)throw new Error(`Image HTTP ${response.status}`);
      if(!response.headers.get('content-type')?.startsWith('image/'))throw new Error('Publisher did not return an image.');
      const blob=await response.blob();candidateUrl=URL.createObjectURL(blob);
      const check=new Image();check.src=candidateUrl;await check.decode();
      if(token!==imageGeneration){URL.revokeObjectURL(candidateUrl);return;}
      if(objectUrl)URL.revokeObjectURL(objectUrl);objectUrl=candidateUrl;
      $('camera-image').src=objectUrl;$('camera-image').hidden=false;
      const modified=Date.parse(response.headers.get('last-modified')||'');
      imageState={modified:Number.isFinite(modified)?modified:null,loaded:Date.now(),error:null};
    }catch(error){
      if(candidateUrl&&candidateUrl!==objectUrl)URL.revokeObjectURL(candidateUrl);
      if(token!==imageGeneration)return;
      imageState={...(imageState||{}),error:error.name==='AbortError'||error.name==='TimeoutError'?'Image request timed out.':error.message};
    }finally{
      if(token===imageGeneration){imageController=null;imageBusy=false;nextImage=Date.now()+Math.max(config.imagePollMs,c.imageIntervalMs||0);paint();
        if(open&&!suspended&&!document.hidden)imageTimer=setTimeout(()=>void refreshImage(),Math.max(config.imagePollMs,c.imageIntervalMs||0));}
    }
  };
  const select=id=>{
    if(id===selected){onMap();map?.focusCamera(id);return;}
    video.stop('Video is on demand');clearImage();selected=id;paint();onMap();map?.selectCamera(id);map?.focusCamera(id);void refreshImage();
    $('camera-evidence').scrollIntoView({block:'start',behavior:'instant'});
  };
  const refreshCatalog=async()=>{
    if(busy||exercise||!selection.length)return;busy=true;clearTimeout(feedTimer);paint();
    try{
      const response=await fetch(CAMERA_FEED,{credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(config.requestTimeoutMs)});
      if(!response.ok)throw new Error(`Caltrans HTTP ${response.status}`);
      const previous=current();cameras=normalizeCameras(await response.json(),selection);feedError=null;lastCheck=Date.now();
      const updated=current();if(previous?.checked&&updated&&(previous.videoUrl!==updated.videoUrl||previous.imageUrl!==updated.imageUrl)){video.stop('Camera source updated · press Play to reconnect');clearImage();}
      if(!selected)selected=cameras[0]?.id||null;
    }catch(error){feedError=error.name==='AbortError'||error.name==='TimeoutError'?'Camera catalog request timed out.':error.message;}
    finally{busy=false;paint();if(!document.hidden)feedTimer=setTimeout(()=>void refreshCatalog(),config.pollMs);}
    void refreshImage();
  };
  const setOpen=(value,{notify=true}={})=>{
    open=value;if(notify)onOpenChange(open);
    $('toggle-cameras').setAttribute('aria-pressed',String(open));$('toggle-cameras').textContent=open?'Hide cameras':'Show cameras';
    if(!open){clearTimeout(imageTimer);imageGeneration++;imageController?.abort();imageBusy=false;video.stop('Video stopped · camera panel closed');}
    else {if(!videoActive)video.stop('Video is on demand');void refreshImage();}
  };
  $('toggle-cameras').addEventListener('click',()=>setOpen(suspended?true:!open));
  $('camera-close').addEventListener('click',()=>setOpen(false));
  $('camera-catalog-refresh').addEventListener('click',()=>void refreshCatalog());
  $('camera-refresh').addEventListener('click',()=>void refreshImage());
  $('camera-play').addEventListener('click',()=>{const c=current();if(c&&available(c).usable)void video.play(c.videoUrl);});
  $('camera-stop').addEventListener('click',()=>video.stop('Video stopped · still-image view'));
  $('camera-focus').addEventListener('click',()=>{onMap();map?.focusCamera(selected);});
  $('camera-gauge').addEventListener('click',()=>{const c=current();if(c?.gaugeId)onGauge(c.gaugeId);});
  $('camera-picker').addEventListener('calciteSelectChange',event=>select(event.target.value));
  $('camera-list').addEventListener('calciteListChange',event=>{const id=event.target.selectedItems?.[0]?.value;if(id)select(id);});
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden){clearTimeout(feedTimer);clearTimeout(imageTimer);video.stop('Video stopped while tab was hidden');}
    else{if(!lastCheck||Date.now()-lastCheck>=config.pollMs)void refreshCatalog();else feedTimer=setTimeout(()=>void refreshCatalog(),config.pollMs-(Date.now()-lastCheck));if(Date.now()>=nextImage)void refreshImage();}
  });
  window.addEventListener('offline',()=>{feedError='This browser is offline.';video.stop('Video stopped · browser offline');paint();});
  window.addEventListener('online',()=>{if(!document.hidden)void refreshCatalog();});
  setInterval(()=>{if(!document.hidden)paint();},30_000);
  try {
    const response=await fetch(new URL('../data/camera-watchlist.json',import.meta.url));if(!response.ok)throw new Error('Camera watchlist unavailable.');
    const data=await response.json();selection=data.cameras;
    if(!Array.isArray(selection))throw new Error('Camera watchlist has an unexpected format.');
    for(const camera of selection)$('camera-picker').append(el('calcite-option',camera.name,{value:camera.id}));
    $('camera-picker').toggleAttribute('disabled',exercise);
    $('camera-coverage-note').textContent=data.coverageGaps;
    if(!exercise){cameras=selection.map(s=>({...s,checked:null,inService:null,error:'Waiting for live catalog'}));selected=cameras[0]?.id||null;void refreshCatalog();}
    paint();
  }catch(error){$('camera-feed-status').textContent=error.message;}
  return {setMap:controller=>{map=controller;paint();map.selectCamera(selected);},select:id=>{setOpen(true);select(id);},setOpen,setSuspended(value){suspended=!!value;$('toggle-cameras').textContent=suspended?'Show cameras':open?'Hide cameras':'Show cameras';if(suspended){clearTimeout(imageTimer);imageGeneration++;imageController?.abort();imageBusy=false;video.stop('Video stopped · supporting evidence is open');}else if(open&&!document.hidden)void refreshImage();}};
}
