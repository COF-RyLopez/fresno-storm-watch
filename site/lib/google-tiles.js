/** Google Photorealistic 3D Tiles attribution. Each glTF tile carries its data providers in asset.copyright; Google
 * requires them shown on the map, most frequent first, with the Google Maps logo. */
const MAGIC=0x46546c67,JSON_CHUNK=0x4e4f534a;

/** @param {ArrayBuffer} buffer binary glTF @returns {string[]} Providers in this tile, or [] for anything that is not a GLB. */
export function glbCopyright(buffer){
  try{
    const v=new DataView(buffer);
    if(buffer.byteLength<20||v.getUint32(0,true)!==MAGIC||v.getUint32(16,true)!==JSON_CHUNK)return [];
    const length=v.getUint32(12,true);if(20+length>buffer.byteLength)return [];
    const json=JSON.parse(new TextDecoder().decode(new Uint8Array(buffer,20,length)));
    const text=typeof json?.asset?.copyright==='string'?json.asset.copyright:'';
    return text.split(';').map(s=>s.trim()).filter(Boolean);
  }catch{return [];}
}

/** Rolling credits from recently loaded tiles, a stand-in for "tiles in view".
 * ponytail: last 300 tiles approximates the current view; per-frame visibility would need renderer internals. */
export function createCredits(limit=300){
  const recent=[];
  return {
    add(names){if(!names.length)return false;recent.push(names);if(recent.length>limit)recent.shift();return true;},
    /** @returns {string} "Google, Airbus, …" ordered by how many recent tiles name each provider. */
    line(){const n=new Map();for(const names of recent)for(const s of new Set(names))n.set(s,(n.get(s)||0)+1);return [...n].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).map(([s])=>s).join('; ');}
  };
}
