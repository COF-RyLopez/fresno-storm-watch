/** Pure, in-memory feature search. Queries and private features are never persisted. */
const ABBREVIATIONS={rd:'road',ave:'avenue',av:'avenue',hwy:'highway',sr:'highway',rte:'highway',blvd:'boulevard',dr:'drive',ln:'lane',ct:'court',st:'street',fwy:'freeway',n:'north',s:'south',e:'east',w:'west'};
export const searchText=value=>String(value??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('en-US').replace(/[^a-z0-9]+/g,' ').trim().split(/\s+/).map(token=>ABBREVIATIONS[token]??token).join(' ');

/** Rank exact names, then prefixes, then token matches; preserve separate sources/IDs. */
export function findMapEntries(entries,query,scope='all',limit=40){
  const q=searchText(query).slice(0,160);if(q.length<2)return {rows:[],total:0};const tokens=q.split(' ');
  const seen=new Set(),matches=[];
  for(const row of entries){
    if(seen.has(row.key)||scope!=='all'&&row.kind!==scope)continue;
    const name=searchText(row.name),aliases=(row.aliases??[]).map(searchText),terms=[name,...aliases,searchText(row.detail)];
    if(!tokens.every(token=>terms.some(term=>term.includes(token))))continue;
    seen.add(row.key);const score=name===q?0:aliases.includes(q)?1:name.startsWith(q)?2:3;
    matches.push({row,score});
  }
  matches.sort((a,b)=>a.score-b.score||Number(b.row.kind==='waterbody')-Number(a.row.kind==='waterbody')||a.row.name.localeCompare(b.row.name)||a.row.key.localeCompare(b.row.key));
  return {rows:matches.slice(0,limit).map(x=>x.row),total:matches.length};
}

export const pointGeometry=p=>Number.isFinite(p?.longitude)&&Number.isFinite(p?.latitude)&&Math.abs(p.longitude)<=180&&Math.abs(p.latitude)<=90?{x:p.longitude,y:p.latitude,spatialReference:{wkid:4326}}:null;

/** Search all returned road records, including filtered history; never change clearance rules. */
export function roadSearchEntries(data){return (data?.snapshot?.rows??[]).map(row=>({key:row.key,name:row.name,kind:'road-record',aliases:[row.id,row.location,row.alternateRoute],history:row.active==='no',detail:`${row.kind} · ${row.status}${row.issues?.length?' · '+row.issues.join('; '):''}${data.error?' · Feed update failed; retained record':''}`,geometry:row.geometry?{...row.geometry,spatialReference:{wkid:4326}}:null,sourceUrl:row.official,sourceTime:row.sourceTime,start:row.start,end:row.end,active:row.active,reference:`County closure / detour record. Location: ${row.location||'Not supplied'}. ${row.comment||''} Alternate route: ${row.alternateRoute||'Not supplied'}. Verify official status and access.`}));}

/** Authorized asset records stay in this object graph only; no server-side name lookup. */
export function facilitySearchEntries(data){return (data?.sites??[]).map(row=>({key:row.site.key,name:row.site.name,kind:'asset',aliases:[row.site.id,row.site.reference,row.site.owner,row.site.assetType,row.site.kind],detail:`${row.site.kind} · ${row.site.sourceTitle}${row.site.sourceError?' · Source needs verification':''}`,geometry:row.site.geometry,private:true,sourceUrl:row.site.reference?.startsWith('https://')?row.site.reference:null,sourceTime:row.site.updated,reference:`Loaded authorized asset inventory. Owner: ${row.site.owner||'Not supplied'}. Backup power: ${row.site.backup||'Unknown'}. Location does not establish power, capacity, readiness or current operating status.`}));}

export function gaugeSearchEntries(data){return (data?.stations??[]).map(station=>{const gauge=data.entries?.get(station.id)?.gauge;return {key:'gauge:'+station.id,name:gauge?.name||station.name,kind:'gauge',aliases:[station.id,station.basin],detail:`NWS gauge · ${station.id}${data.entries?.get(station.id)?.error?' · Query failed; verify retained data':''}`,sourceUrl:`https://water.noaa.gov/gauges/${station.id.toLowerCase()}`,sourceTime:gauge?.observed?.points?.at(-1)?.time,geometry:pointGeometry(gauge)||pointGeometry(station),reference:`${gauge?.observed?.points?.length?'Last returned observation: '+gauge.observed.points.at(-1).value+' '+gauge.observed.units+'.':'No observation available.'} Open gauge evidence to verify freshness, forecast and published thresholds.`};});}

export function reservoirSearchEntries(data){return (data?.selection?.stations??[]).map(station=>({key:'reservoir:'+station.id,name:station.name,kind:'reservoir',aliases:[station.id,station.river],detail:`Reservoir reporting location · ${station.id}`,geometry:pointGeometry(station),reference:'Reservoir reference point; not a surveyed outlet or inundation extent.'}));}

/** Public geometry is loaded in bounded, versioned shards; only known shard names are accepted. */
export function geometryShardUrl(row,base){if(!/^[a-f0-9]{2}\.json$/.test(row.shard??''))throw new Error('Invalid public geometry reference');return new URL(row.shard,base);}
