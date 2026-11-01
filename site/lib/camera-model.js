/** Caltrans camera contracts. Catalog times never stand in for image capture times. */
export const CAMERA_FEED = 'https://cwwp2.dot.ca.gov/data/d6/cctv/cctvStatusD06.json';

/** @param {unknown} value @param {'image'|'video'} kind @returns {string|null} */
export function cameraMediaUrl(value, kind) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:' || u.username || u.password || u.port || u.search || u.hash) return null;
    const image = u.hostname === 'cwwp2.dot.ca.gov' && /^\/data\/d6\/cctv\/image\/[a-z0-9_-]+\/[a-z0-9_-]+\.jpg$/i.test(u.pathname);
    const video = u.hostname === 'wzmedia.dot.ca.gov' && /^\/D6\/[a-z0-9_-]+\.stream\/playlist\.m3u8$/i.test(u.pathname);
    return (kind === 'image' ? image : video) ? u.href : null;
  } catch { return null; }
}

/** @param {unknown} value @returns {number|null} */
function numeric(value) { return value !== null && value !== undefined && String(value).trim() !== '' && Number.isFinite(Number(value)) ? Number(value) : null; }

/** @param {object} payload @param {object[]} selection @param {number} now @returns {object[]} */
export function normalizeCameras(payload, selection, now = Date.now()) {
  if (!Array.isArray(payload?.data)) throw new Error('Caltrans camera catalog has an unexpected format.');
  const byIndex = new Map();
  for (const item of payload.data) {
    const c = item?.cctv;
    if (c && String(c.location?.district) === '6') {
      const key = String(c.index);
      byIndex.set(key, [...(byIndex.get(key) || []), c]);
    }
  }
  return selection.map(site => {
    const matches = byIndex.get(site.index) || [];
    const c = matches.length === 1 ? matches[0] : null;
    const lon = numeric(c?.location?.longitude), lat = numeric(c?.location?.latitude);
    let error = !matches.length ? 'Camera is absent from the current catalog.' : matches.length > 1 ? 'Duplicate camera identifier; maintainer review needed.' : null;
    if (c && String(c.location?.locationName).trim() !== site.sourceName) error = 'Camera identity changed; maintainer review needed.';
    // An index may be reused. Do not silently move this curated river camera.
    if (c && (lon === null || lat === null || Math.abs(lon-site.longitude) > 0.001 || Math.abs(lat-site.latitude) > 0.001)) error = 'Camera location changed or is invalid; maintainer review needed.';
    const service = c?.inService === true || c?.inService === 'true' ? true : c?.inService === false || c?.inService === 'false' ? false : null;
    const minutes = numeric(c?.imageData?.static?.currentImageUpdateFrequency);
    const epoch = numeric(c?.recordTimestamp?.recordEpoch);
    return { ...site, longitude:error?site.longitude:lon, latitude:error?site.latitude:lat,
      county:c?.location?.county || site.county, route:c?.location?.route || site.route,
      inService:service, error, checked:now, recordChanged:epoch !== null && epoch > 0 ? epoch*1000 : null,
      imageUrl:error ? null : cameraMediaUrl(c?.imageData?.static?.currentImageURL, 'image'),
      videoUrl:error ? null : cameraMediaUrl(c?.imageData?.streamingVideoURL, 'video'),
      imageIntervalMs:minutes !== null && minutes >= 1 && minutes <= 1440 ? minutes*60_000 : null };
  });
}

/** @param {object} camera @param {string|null} feedError @param {number} now @param {number} staleMs @returns {object} */
export function cameraAvailability(camera, feedError = null, now = Date.now(), staleMs = 420_000) {
  if (feedError) return { usable:false, label:'Catalog check failed', reason:feedError };
  if (camera.error) return { usable:false, label:'Camera unverified', reason:camera.error };
  if (!camera.checked || now-camera.checked > staleMs) return { usable:false, label:'Catalog check overdue', reason:'Refresh the camera catalog before loading media.' };
  if (camera.inService === false) return { usable:false, label:'Out of service', reason:'Caltrans marks this camera out of service.' };
  if (camera.inService !== true) return { usable:false, label:'Service status unknown', reason:'Caltrans did not supply a usable service status.' };
  if (!camera.imageUrl && !camera.videoUrl) return { usable:false, label:'No supported media', reason:'No approved image or video address was supplied.' };
  return { usable:true, label:'Publisher reports in service', reason:'' };
}

/** @param {object|null} image @param {number} now @param {number} maxAgeMs @returns {object} File modification is only a freshness proxy. */
export function cameraImageFreshness(image, now = Date.now(), maxAgeMs = 300_000) {
  if (!image) return { tone:'unknown', label:'No image loaded' };
  if (image.error) return { tone:'gap', label:'Image update failed · previous image may be old' };
  if (now-image.loaded > maxAgeMs) return { tone:'gap', label:'Image check overdue' };
  if (!Number.isFinite(image.modified) || image.modified <= 0) return { tone:'unknown', label:'Image time unknown' };
  if (image.modified > now+60_000) return { tone:'unknown', label:'Image file time is in the future · verify source' };
  if (now-image.modified > maxAgeMs) return { tone:'gap', label:'Image file is old · do not assume current conditions' };
  return { tone:'current', label:'Recent image file · capture time unverified' };
}

/** Distance in km from [lon,lat] to the nearest point of a polyline; equirectangular, fine at county scale. */
function kmToLine(p,line){
  const k=Math.cos(p[1]*Math.PI/180),xy=([lon,lat])=>[(lon-p[0])*111.32*k,(lat-p[1])*110.57];
  let best=Infinity;const pts=line.map(xy);
  for(let i=0;i<pts.length;i++){
    const a=pts[i],b=pts[i+1]||a,dx=b[0]-a[0],dy=b[1]-a[1],t=dx||dy?Math.max(0,Math.min(1,-(a[0]*dx+a[1]*dy)/(dx*dx+dy*dy))):0;
    best=Math.min(best,Math.hypot(a[0]+t*dx,a[1]+t*dy));
  }
  return best;
}
/** @param {object} payload Caltrans D6 catalog @param {number[][]} line [[lon,lat],...] @returns {object[]} In-service cameras with an approved image within maxKm, nearest first. Distance only: view direction is the publisher's road direction, not a verified view of the spot. */
export function nearbyCameras(payload,line,{maxKm=2,limit=2}={}){
  if(!Array.isArray(payload?.data))throw new Error('Caltrans camera catalog has an unexpected format.');
  const out=[];
  for(const item of payload.data){
    const c=item?.cctv,lon=numeric(c?.location?.longitude),lat=numeric(c?.location?.latitude),imageUrl=cameraMediaUrl(c?.imageData?.static?.currentImageURL,'image');
    if(String(c?.location?.district)!=='6'||!(c?.inService===true||c?.inService==='true')||lon===null||lat===null||!imageUrl)continue;
    const km=kmToLine([lon,lat],line);
    if(km<=maxKm)out.push({index:String(c.index),name:String(c.location.locationName||'').trim(),route:c.location.route||null,direction:c.location.direction||null,km,imageUrl,longitude:lon,latitude:lat});
  }
  return out.sort((a,b)=>a.km-b.km||a.index.localeCompare(b.index)).slice(0,limit);
}
