import {searchGeometry} from './nearby-search.js?v=0.32.0';

export const CONNECTION_GROUPS=Object.freeze({
  upstream:{label:'Upstream candidates',color:'#47dcd2'},
  downstream:{label:'Downstream candidates',color:'#ffb45b'},
  ambiguous:{label:'Both directions / loop',color:'#d3afff'},
  unknown:{label:'Direction unconfirmed',color:'#b3bac3'},
  anchor:{label:'At selected asset',color:'#ffffff'}
});
const MAX_VERTICES=40000,START_RADIUS=25,EARTH_RADIUS=6371008.8;
// Nine decimal degrees only absorbs coordinate serialization noise (<0.2 mm
// here). No metre-scale snapping, pipe crossings or nearest-link inference.
const nodeKey=p=>p.slice(0,2).map(n=>n.toFixed(9)).join(',');
const rad=n=>n*Math.PI/180;
const separation=(a,b)=>{const dlat=rad(b[1]-a[1]),dlon=rad(b[0]-a[0]),h=Math.sin(dlat/2)**2+Math.cos(rad(a[1]))*Math.cos(rad(b[1]))*Math.sin(dlon/2)**2;return 2*EARTH_RADIUS*Math.asin(Math.sqrt(Math.min(1,h)));};

/** Even-odd containment preserves multipart polygons and holes. Boundary vertices count as candidates only. */
function inside(p,rings){
  let hit=false;
  for(const ring of rings)for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const a=ring[j],b=ring[i],cross=(p[0]-a[0])*(b[1]-a[1])-(p[1]-a[1])*(b[0]-a[0]);
    if(Math.abs(cross)<1e-14&&p[0]>=Math.min(a[0],b[0])-1e-12&&p[0]<=Math.max(a[0],b[0])+1e-12&&p[1]>=Math.min(a[1],b[1])-1e-12&&p[1]<=Math.max(a[1],b[1])+1e-12)return true;
    if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])hit=!hit;
  }return hit;
}

/** Read-only, selection-bounded candidate topology. O(V+E), plus bounded polygon and pump-start checks.
 * Shared source vertices support geographic candidates, never verified hydraulic links.
 * Directions require the current layer's publisher description, not inverts, slope or a pump code.
 */
export function drainageConnections(record,result,{includeUnknown=true,start=null}={}){
  const base={items:[],lines:[],starts:[],counts:Object.fromEntries(Object.keys(CONNECTION_GROUPS).map(k=>[k,0])),verified:0,seedCount:0,manual:false,seedDistance:null,seedLink:null,unlinked:0,plannedExcluded:0,partial:false,error:null};
  if(record?.category!=='existing')return {...base,error:'Connection review requires an existing basin or pump inventory record.'};
  if(!searchGeometry(record.geometry)||!['basin','pump'].includes(record.kind)||record.kind==='pump'&&!Number.isFinite(record.geometry.x)||record.kind==='basin'&&!record.geometry.rings)return {...base,error:'Selected asset geometry is unavailable.'};
  if(!result)return base;
  const all=result.layers.flatMap(l=>l.rows),rows=all.filter(r=>r.category!=='planned'&&(includeUnknown||r.category!=='unknown'));
  base.plannedExcluded=all.filter(r=>r.category==='planned').length;
  base.partial=result.layers.some(l=>!l.spec.planned&&l.error);
  if(result.layers.some(l=>l.spec.kind==='pipe'&&!l.spec.planned&&l.error))return {...base,error:'Pipe source incomplete. Candidate tracing is unavailable; other nearby features remain reference only.'};
  const directionLayers=new Set(result.layers.filter(l=>l.directionDocumented===true&&!l.spec.planned).map(l=>l.spec.id));
  const nodes=new Map(),edges=[],paths=[],seen=new Set();let vertices=0;
  function node(xy){const id=nodeKey(xy);if(!nodes.has(id))nodes.set(id,{id,xy:xy.slice(0,2),in:[],out:[],all:[],terminal:false,rowKeys:new Set()});return nodes.get(id);}
  for(const row of rows.filter(r=>r.kind==='pipe')){
    if(seen.has(row.key))return {...base,error:'Duplicate pipe identity; refresh before reviewing connections.'};seen.add(row.key);
    if(!searchGeometry(row.geometry)||!row.geometry.paths)return {...base,error:'A pipe geometry is invalid; candidate tracing is unavailable.'};
    for(const path of row.geometry.paths){
      vertices+=path.length;if(vertices>MAX_VERTICES)return {...base,error:'Connection geometry exceeds the review limit. Choose a smaller nearby distance.'};
      const parts=[];
      for(let i=0;i<path.length;i++){
        const n=node(path[i]);n.rowKeys.add(row.key);if(i===0||i===path.length-1)n.terminal=true;
        if(!i)continue;const a=node(path[i-1]);if(a.id===n.id)continue;
        const e={id:edges.length,from:a.id,to:n.id,row,directed:directionLayers.has(row.layerId)};edges.push(e);parts.push(e.id);a.out.push(e.id);n.in.push(e.id);a.all.push(e.id);n.all.push(e.id);
      }paths.push({row,edges:parts});
    }
  }
  const seeds=new Set();
  if(record.kind==='basin'){
    if(!record.geometry.rings)return {...base,error:'A basin outline is required.'};
    for(const n of nodes.values())if(n.terminal&&inside(n.xy,record.geometry.rings))seeds.add(n.id);
  }else{
    const p=[record.geometry.x,record.geometry.y],id=nodeKey(p);if(nodes.has(id))seeds.add(id);
    // Candidate starts are suggestions only. Nothing automatically snaps a pump.
    base.starts=[...nodes.values()].filter(n=>n.terminal).map(n=>({id:n.id,xy:n.xy,rowKey:[...n.rowKeys].sort()[0],meters:separation(p,n.xy)})).filter(n=>n.meters<=START_RADIUS).sort((a,b)=>a.meters-b.meters||a.id.localeCompare(b.id)).slice(0,3);
    if(!seeds.size&&start){const candidate=base.starts.find(n=>n.id===start);if(!candidate)return {...base,error:'Starting point changed or is outside the 25 m review search. Refresh and select again.'};seeds.add(start);base.manual=true;base.seedDistance=candidate.meters;base.seedLink={key:candidate.rowKey,geometry:{paths:[[p,candidate.xy]],spatialReference:{wkid:4326}}};}
  }
  base.seedCount=seeds.size;
  if(!seeds.size){base.unlinked=rows.length;return base;}
  function walk(direction){
    const found=new Set(seeds),used=new Set(),queue=[...seeds];
    for(let i=0;i<queue.length;i++){
      const n=nodes.get(queue[i]),ids=direction==='all'?n.all:direction==='upstream'?n.in:n.out;
      for(const id of ids){const e=edges[id];if(direction!=='all'&&!e.directed)continue;const next=direction==='upstream'?e.from:direction==='downstream'?e.to:e.from===n.id?e.to:e.from;used.add(id);if(!found.has(next)){found.add(next);queue.push(next);}}
    }return {nodes:found,edges:used};
  }
  const whole=walk('all'),up=walk('upstream'),down=walk('downstream');
  const group=(u,d)=>u&&d?'ambiguous':u?'upstream':d?'downstream':'unknown';
  const edgeGroup=e=>group(up.edges.has(e.id),down.edges.has(e.id));
  const itemGroups=new Map(),add=(row,g,evidence)=>{if(!itemGroups.has(row.key))itemGroups.set(row.key,{row,groups:new Set(),evidence:new Set()});const item=itemGroups.get(row.key);item.groups.add(g);item.evidence.add(evidence);};
  for(const path of paths){
    let line=null;
    for(const id of path.edges){const e=edges[id];if(!whole.edges.has(id)){line=null;continue;}
      const g=edgeGroup(e),a=nodes.get(e.from).xy,b=nodes.get(e.to).xy;
      if(!line||line.group!==g){line={key:e.row.key,group:g,category:e.row.category,geometry:{paths:[[a,b]],spatialReference:{wkid:4326}}};base.lines.push(line);}else line.geometry.paths[0].push(b);
      add(e.row,g,e.directed?'Shared mapped vertices; direction from FMFCD’s general-flow drawing convention.':'Shared mapped vertices; publisher direction documentation unavailable.');
    }
  }
  for(const row of rows.filter(r=>r.kind!=='pipe')){
    if(!searchGeometry(row.geometry)||!Number.isFinite(row.geometry.x))continue;
    const id=nodeKey([row.geometry.x,row.geometry.y]);if(!whole.nodes.has(id))continue;
    add(row,seeds.has(id)?'anchor':group(up.nodes.has(id),down.nodes.has(id)),'Point coincides with a traced pipe vertex; hydraulic connection unverified.');
  }
  for(const item of itemGroups.values()){
    const groups=[...item.groups],g=groups.length===1?groups[0]:groups.includes('unknown')?'unknown':'ambiguous';
    base.items.push({row:item.row,group:g,verified:false,evidence:[...item.evidence].join(' ')});base.counts[g]++;
  }
  base.items.sort((a,b)=>a.row.key.localeCompare(b.row.key));base.unlinked=rows.length-base.items.length;
  return base;
}

/** View filters never expand the bounded trace or promote unverified links. */
export function connectionShown(group,mode){return mode==='connections'||mode==='upstream'&&(group==='upstream'||group==='anchor'||group==='ambiguous')||mode==='downstream'&&(group==='downstream'||group==='anchor'||group==='ambiguous')||mode==='unresolved'&&(group==='unknown'||group==='ambiguous');}
