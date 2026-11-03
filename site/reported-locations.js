import {reportedFeatures,filterReports} from './lib/reported-locations-model.js';
async function start(){

const [reportData,countySource,roadsSource]=await Promise.all(['locations','county','roads'].map(async name=>{
 const response=await fetch(`./data/reported-locations/${name}.geojson?v=2026-11-03`,{signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw new Error(`Location map source unavailable (${response.status}).`);
 return response.json();
}));
const features=reportedFeatures(reportData);
document.getElementById('load-status').hidden=true;
const params=new URLSearchParams(location.search);
if(params.get('embed')==='1')document.documentElement.classList.add('embedded');
if(['d1','oes'].includes(params.get('source')))document.getElementById('source').value=params.get('source');
document.querySelector('.legend-details').open=matchMedia('(min-width:601px)').matches;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const map=L.map('map',{preferCanvas:true}).setView([36.75,-119.85],8);
const county=L.geoJSON(countySource,{interactive:false,style:{color:'#667b88',weight:1,fillColor:'#f3f6f8',fillOpacity:.2}}).addTo(map);
const roadLayer=L.geoJSON(roadsSource,{interactive:false,style:{color:'#b7c4cc',weight:.7,opacity:.6}}).addTo(map);
const base=L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',{maxZoom:16,attribution:'Esri, HERE, Garmin, © OpenStreetMap contributors'}).addTo(map);
const ref=L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}',{maxZoom:16,pane:'overlayPane',attribution:'County road references: Fresno County; generalized'}).addTo(map);
let failures=0;base.on('tileerror',()=>{if(++failures>3){const el=document.getElementById('map-status');el.style.display='block';el.textContent='Street tiles are unavailable. County road reference lines remain visible.'}});
L.control.scale({imperial:true,metric:true,position:'bottomright'}).addTo(map);
const layer=L.featureGroup().addTo(map), refs=new Map();let showIds=false,selected='';
function popup(p){return `<span class="badge">${esc(p.id)} · ${esc(p.position_status)}</span><h2>${esc(p.name)}</h2><p><b>Reported concern</b><br>${esc(p.reported_text).replace(/\n/g,'<br>')}</p><p><b>How it is placed</b><br>${esc(p.position_basis)}</p>${p.coordinate_text?`<p><b>Supplied coordinate</b><br>${esc(p.coordinate_text)}<br><small>Coordinate precision does not demonstrate field accuracy.</small></p>`:''}<p><b>Location detail still needed</b><br>${esc(p.confirmation)}</p><p><b>Source</b><br>${esc(p.source)}</p>${p.nearest_county_road_context?`<p><small>Nearest generalized County road: ${esc(p.nearest_county_road_context)}. Context only; the coordinate has not been snapped to it.</small></p>`:''}${p.photo_status.startsWith('Photo links')?`<p><small>${esc(p.photo_status)}</small></p>`:''}`}
function color(p){return p.id.startsWith('D1')?'#0072b2':'#d55e00'}
function visibleReports(){return filterReports(features,{query:document.getElementById('search').value,source:document.getElementById('source').value,section:document.getElementById('section').value})}
function focus(id){selected=id;const g=refs.get(id);if(!g)return;map.fitBounds(g.getBounds().pad(.2),{maxZoom:15});let first;g.eachLayer(l=>{if(!first)first=l});if(first)first.openPopup();document.querySelectorAll('.item').forEach(b=>b.classList.toggle('selected',b.dataset.id===id));}
function render(){layer.clearLayers();refs.clear();const selectedFeatures=visibleReports();const list=document.getElementById('list');list.replaceChildren();for(const f of selectedFeatures){const p=f.properties;const g=L.geoJSON(f,{style:{color:color(p),weight:5,opacity:.85,dashArray:'7 4'},pointToLayer:(_,latlng)=>L.circleMarker(latlng,{radius:p.has_reported_coordinate?6:8,color:color(p),weight:2,fillColor:p.has_reported_coordinate?color(p):'#ffffff',fillOpacity:1}),onEachFeature:(_,l)=>{l.bindPopup(popup(p),{maxWidth:390});l.bindTooltip(showIds?p.id:`${p.id} · ${p.name}`,{permanent:showIds,direction:'top',className:showIds?'id-label':''});l.on('click',()=>{selected=p.id;document.querySelectorAll('.item').forEach(b=>b.classList.toggle('selected',b.dataset.id===p.id))})}}).addTo(layer);refs.set(p.id,g);const b=document.createElement('button');b.className='item'+(selected===p.id?' selected':'');b.dataset.id=p.id;b.innerHTML=`<b style="color:${color(p)}">${esc(p.id)} · ${p.id.startsWith('D1')?'District 1':'OES addition'}</b><span>${esc(p.name)}</span><small>${esc(p.position_status)}</small>`;b.addEventListener('click',()=>focus(p.id));list.appendChild(b)}document.getElementById('list-head').textContent=`${selectedFeatures.length} of 92 records · Select a row or map symbol`;if(!selectedFeatures.length)list.textContent='No reports match these filters.';window.mapReviewState={visibleRecords:selectedFeatures.length,recordIds:selectedFeatures.map(f=>f.properties.id),totalRecords:reportData.features.length,reportedCoordinates:reportData.features.filter(f=>f.properties.has_reported_coordinate).length};}
for(const s of [...new Set(reportData.features.map(f=>f.properties.section))].sort()){const o=document.createElement('option');o.value=s;o.textContent=s;document.getElementById('section').appendChild(o)}
for(const id of ['source','section'])document.getElementById(id).addEventListener('change',()=>{render();const bounds=layer.getBounds();if(bounds.isValid())map.fitBounds(bounds.pad(.1),{maxZoom:14});});document.getElementById('search').addEventListener('input',render);
document.getElementById('labels').addEventListener('click',()=>{showIds=!showIds;document.getElementById('labels').textContent=showIds?'Hide IDs':'Show IDs';document.getElementById('labels').setAttribute('aria-pressed',String(showIds));render()});
const regions={west:[[35.99,-120.70],[36.90,-119.73]],north:[[36.90,-119.77],[37.21,-119.24]],south:[[36.65,-119.55],[36.85,-118.97]]};
document.querySelectorAll('[data-region]').forEach(b=>b.addEventListener('click',()=>{if(b.dataset.region==='all'){const bounds=layer.getBounds();if(bounds.isValid())map.fitBounds(bounds.pad(.1))}else map.fitBounds(regions[b.dataset.region])}));
document.getElementById('download').addEventListener('click',e=>{e.preventDefault();const u=URL.createObjectURL(new Blob([JSON.stringify(reportData,null,2)],{type:'application/geo+json'}));const a=document.createElement('a');a.href=u;a.download='reported-storm-problem-locations.geojson';a.click();setTimeout(()=>URL.revokeObjectURL(u),1000)});
render();map.fitBounds(layer.getBounds().pad(.08));window.reviewMap=map;window.reviewFeatures=refs;new ResizeObserver(()=>map.invalidateSize({pan:false})).observe(document.getElementById('map'));

}
start().catch(error=>{const status=document.getElementById('load-status');status.hidden=false;status.setAttribute('role','alert');status.textContent='Reported location map could not load. '+error.message+' Reload or use the printable map.';});
