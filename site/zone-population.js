import {loadSdk} from './lib/map.js';
import {readZoneProduct,estimatedResidents,zoneLabel,zoneRows,boundaryFingerprint} from './lib/zone-population-product.js?v=0.73.0-r2';
import {readCareCollection} from './lib/care-data.js?v=0.74.0-helpers';
import {pioZoneLink} from './lib/pio-zone-context.js?v=0.73.0-r2';
const $=id=>document.getElementById(id),el=(tag,text='')=>{const n=document.createElement(tag);n.textContent=text;return n;};
const time=t=>new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',dateStyle:'medium',timeStyle:'short'}).format(t)+' PT';
let product=null,view=null,layer=null,layerView=null,selected=null,highlight=null,epoch=0,graphics=new Map(),blobUrl=null;

function notice(title,detail,kind='warning'){$('notice-title').textContent=title;$('notice-detail').textContent=detail;$('source-notice').kind=kind;$('source-notice').hidden=false;$('source-notice').open=true;}
function mobile(mode){document.querySelector('main').dataset.mobile=mode;$('show-list').setAttribute('aria-pressed',String(mode==='list'));$('show-map').setAttribute('aria-pressed',String(mode==='map'));}
$('show-list').onclick=()=>mobile('list');$('show-map').onclick=()=>mobile('map');$('print-map').onclick=()=>{mobile('map');requestAnimationFrame(()=>window.print());};
$('zones-search').oninput=renderList;$('only-unknown').onchange=renderList;$('map-labels').onchange=()=>{if(layer)layer.labelsVisible=$('map-labels').checked;};
$('fit-county').onclick=()=>{history.pushState(null,'',location.pathname);clearSelection();};

function clearSelection(){selected=null;highlight?.remove();highlight=null;$('selected-zone').hidden=true;renderList();void view?.goTo(layer.fullExtent.expand(1.05)).catch(mapError);}
function mapError(e){if(e.name!=='AbortError')$('map-status').textContent='Map navigation unavailable. Zone figures and downloads remain available.';}
function renderList(){
  if(!product)return;const rows=zoneRows(product.data.features,$('zones-search').value,$('only-unknown').checked),host=$('zone-rows');host.replaceChildren();
  $('zone-counts').textContent=`${product.meta.counts.zones} zones · ${product.meta.counts.estimated} estimated · ${product.meta.counts.unknown} need review${rows.length!==product.data.features.length?' · '+rows.length+' shown':''}. No county total is calculated.`;
  for(const f of rows){const p=f.properties,tr=el('tr'),name=el('td'),b=el('button',p.name);b.type='button';b.setAttribute('aria-label',p.name+' · '+(p.population===null?'estimate unavailable':estimatedResidents(p.population)+' estimated residents'));b.setAttribute('aria-current',String(selected?.properties.oid===p.oid));b.onclick=()=>void select(f,true);name.append(b);tr.className=selected?.properties.oid===p.oid?'selected':'';const count=el('td',p.population===null?'Needs review':estimatedResidents(p.population));if(p.population===null)count.className='unknown';tr.append(name,count);host.append(tr);}
  $('list-empty').hidden=!!rows.length;
}
async function select(feature,updateUrl=false){
  const generation=++epoch;selected=feature;const p=feature.properties,host=$('selected-zone');host.hidden=false;host.replaceChildren(el('h2','Zone '+p.name),el('p',p.population===null?'Estimate unavailable':estimatedResidents(p.population)+' residents'));host.children[1].className='residents';
  host.append(el('p',p.population===null?p.reason:`ACS ${product.meta.period} · ${p.tracts} contributing Fresno tract${p.tracts===1?'':'s'}.`));
  const outreach=el('a','Open private PIO outreach for this zone');outreach.href=pioZoneLink(p.oid,product.meta.geojson.sha256,product.meta.built);outreach.className='outreach-link';host.append(outreach);
  if(p.countyShare<.999)host.append(el('p','This source zone extends outside the county. The estimate includes only its Fresno County portion.'));
  host.append(el('p',p.samplingMoe===null?'Sampling-only MOE component unavailable.':`Sampling-only MOE component: ± ${Math.ceil(p.samplingMoe).toLocaleString()} residents. Total allocation uncertainty is not quantified.`));
  const details=el('details');details.append(el('summary','Calculation evidence & dates'),el('p',product.meta.limits.method),el('p',product.meta.limits.uncertainty),el('p',`County zone snapshot queried ${time(product.meta.zonesChecked)}. Calculation prepared ${time(product.meta.built)}. Neither is a population observation or order issue time.`));
  const link=el('a','Open selected-zone evidence in Storm Watch');link.href='./?'+new URLSearchParams({view:'watch',population:'1',zone:p.name});link.target='_blank';link.rel='noopener noreferrer';details.append(link);host.append(details);renderList();
  if(updateUrl){const u=new URL(location.href);u.searchParams.set('zone',p.name);u.searchParams.set('id',p.oid);history.pushState(null,'',u);}
  if(matchMedia('(max-width:760px)').matches){mobile('map');await new Promise(requestAnimationFrame);}
  const graphic=graphics.get(p.oid);if(!graphic)return;
  highlight?.remove();highlight=layerView.highlight(graphic.getObjectId());
  try{await view.goTo(graphic.geometry.extent.expand(1.3),{duration:matchMedia('(prefers-reduced-motion:reduce)').matches?0:500});if(generation===epoch)$('map-status').textContent=p.name+' · '+(p.population===null?'estimate needs review':estimatedResidents(p.population)+' estimated residents');}catch(e){if(generation===epoch)mapError(e);}
}

function fromUrl(){if(!product)return;const q=new URLSearchParams(location.search),id=Number(q.get('id')),name=q.get('zone'),f=product.data.features.find(f=>q.has('id')?f.properties.oid===id:f.properties.name===name);if(f)void select(f);else if(!name&&!q.has('id'))clearSelection();}
window.addEventListener('popstate',fromUrl);

async function initialize(){
  try{
    product=await readZoneProduct();const m=product.meta;
    $('snapshot-period').textContent='ACS '+m.period+' · allocated residents';$('snapshot-date').textContent='Zone snapshot '+time(m.zonesChecked);$('download-csv').hidden=false;
    $('print-source').textContent=`Fresno County Sheriff evacuation zones · ACS ${m.period}, allocated using 2020 Census block population weights. Boundaries queried ${time(m.zonesChecked)}; calculated ${time(m.built)}. Approximate residents, not live occupancy or current orders. Overlapping zones must not be added. Source: Fresno County / U.S. Census Bureau / Esri Living Atlas; allocation by F.R.O.G.`;
    for(const key of ['method','interpretation','uncertainty','geometry','boundary'])$('method-details').append(el('p',m.limits[key]));renderList();
    const [ArcMap,MapView,Basemap,TileLayer,GeoJSONLayer]=await(await loadSdk()).import(['@arcgis/core/Map.js','@arcgis/core/views/MapView.js','@arcgis/core/Basemap.js','@arcgis/core/layers/TileLayer.js','@arcgis/core/layers/GeoJSONLayer.js']);
    const display={...product.data,features:product.data.features.map(f=>({...f,properties:{...f.properties,displayLabel:zoneLabel(f.properties),availability:f.properties.population===null?'unknown':'estimated'}}))};
    blobUrl=URL.createObjectURL(new Blob([JSON.stringify(display)],{type:'application/json'}));
    layer=new GeoJSONLayer({url:blobUrl,title:'Sheriff evacuation zones · approximate ACS residents',copyright:'Fresno County | U.S. Census Bureau | Esri Living Atlas | F.R.O.G.',outFields:['*'],popupEnabled:false,
      fields:[{name:'oid',type:'integer'},{name:'name',type:'string'},{name:'displayLabel',type:'string'},{name:'population',type:'double'},{name:'samplingMoe',type:'double'},{name:'availability',type:'string'}],
      renderer:{type:'unique-value',field:'availability',uniqueValueInfos:[{value:'estimated',label:'Zone with estimated residents',symbol:{type:'simple-fill',color:[80,180,200,.06],outline:{color:'#76d7e8',width:.8}}},{value:'unknown',label:'Estimate unavailable',symbol:{type:'simple-fill',color:[160,160,160,.06],outline:{color:'#b3b6bb',width:1,style:'dash'}}}]},
      labelingInfo:[{labelPlacement:'always-horizontal',deconflictionStrategy:'static',labelExpressionInfo:{expression:'$feature.displayLabel'},symbol:{type:'text',color:'#e5f6ff',haloColor:'#17232b',haloSize:1.5,font:{size:10,family:'Arial',weight:'bold'}},minScale:0,maxScale:0}]});
    const map=new ArcMap({basemap:new Basemap({baseLayers:[new TileLayer({url:'https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer'})],referenceLayers:[new TileLayer({url:'https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer'})]}),layers:[layer]});
    view=new MapView({container:'zone-map',map,center:[-119.7,36.75],zoom:8,popupEnabled:false,constraints:{rotationEnabled:false},highlightOptions:{color:'#ffffff',haloOpacity:1,fillOpacity:.1}});
    await Promise.all([view.when(),layer.load()]);layerView=await view.whenLayerView(layer);const result=await layer.queryFeatures({where:'1=1',outFields:['oid','name'],returnGeometry:true});
    // The unified CDN runtime registers map components when they enter the DOM.
    const scale=document.createElement('arcgis-scale-bar');scale.setAttribute('unit','dual');view.ui.add(scale,'bottom-left');
    void customElements.whenDefined('arcgis-scale-bar').then(()=>{scale.view=view;});
    if(result.features.length!==m.counts.zones)throw Error('Map drawing did not return the full zone inventory.');graphics=new Map(result.features.map(g=>[g.attributes.oid,g]));
    $('fit-county').disabled=false;await view.goTo(layer.fullExtent.expand(1.05),{animate:false});$('map-status').textContent='';fromUrl();
    view.on('click',async event=>{try{const hit=await view.hitTest(event,{include:[layer]}),id=hit.results.find(r=>r.type==='graphic'&&r.graphic.layer===layer)?.graphic.attributes.oid;const f=product.data.features.find(f=>f.properties.oid===id);if(f)void select(f,true);}catch(e){mapError(e);}});
  }catch(error){
    $('map-status').textContent='Map unavailable: '+error.message;
    if(!product){$('snapshot-period').textContent='Population snapshot unavailable';$('zone-counts').textContent='No verified zone figures loaded.';}
    notice('Population map needs a retry',error.message+'. Reload this page to retry. '+(product?'The verified zone list and CSV remain available.':'Population figures could not be verified. Official county links remain available under Sources & estimation limits.'));
  }
  finally{if(product)$('check-boundaries').disabled=false;}
}
$('check-boundaries').onclick=async()=>{
  const b=$('check-boundaries');b.disabled=true;b.textContent='Checking county boundaries…';
  try{const county=(await(await fetch('./data/counties.geojson',{credentials:'omit',cache:'no-store'})).json()).features.find(f=>f.properties.GEOID==='06019'),current=await readCareCollection('zones',{county}),hash=await boundaryFingerprint(current.rows);
    if(hash!==product.meta.geometryFingerprint)notice('County zone source differs from this snapshot','Use the official county reference and request a refreshed analysis before applying these estimates to changed boundaries. The dated map has been retained.');
    else notice('County boundaries match this snapshot','Zone IDs, names and geometry match the latest county query at '+time(current.checked)+'. This is not confirmation of current orders or people present.','info');
  }catch(e){notice('Live boundary check unavailable','The dated map is still available. Current boundary applicability is unverified; retry or consult the county source.');}
  finally{b.disabled=false;b.textContent='Check current boundaries';}
};
window.addEventListener('pagehide',()=>{if(blobUrl)URL.revokeObjectURL(blobUrl);});
void initialize();
