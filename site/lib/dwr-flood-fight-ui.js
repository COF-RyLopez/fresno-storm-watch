import {loadSdk} from './map.js';
import {countyGeometry} from './model.js';
import {reportHealth} from './source-health.js';
import {fresnoDefinition,inspectionDate,inventoryQuantity,assertScopedInventory} from './dwr-flood-fight-model.js';
import {normalizeSupplyFeatures} from './dwr-supply-planning-model.js';
import {node,nodeLink as link} from './dom.js';

const KEY='dwrFloodFight', REFRESH_MS=300000;

/** Live, public DWR reference layers. Only service queries and tab-memory scope are used; no AGOL copies or editing. */
export function createDwrFloodFight({exercise=false,onMap=()=>{},onSupplies=()=>{}}={}) {
  const $=id=>document.getElementById(id),states=new Map();
  let controller,county,catalog,group,classes,pendingCatalog,started=false,inventoryWatching=false;
  const checkedText=ms=>new Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeStyle:'short',timeZone:'America/Los_Angeles'}).format(ms)+' Pacific';
  function status(s,text){s.status.textContent=text;}
  async function legend(s){
    s.legend.replaceChildren();
    if(!s.layer?.renderer)return;
    const r=s.layer.renderer,entries=r.uniqueValueInfos?.length?[...r.uniqueValueInfos]:[{label:s.config.sourceTitle,symbol:r.symbol}];
    if(r.defaultSymbol)entries.push({label:r.defaultLabel||'Other publisher category',symbol:r.defaultSymbol});
    for(const entry of entries){
      if(!entry.symbol)continue;
      const row=node('div');row.className='dwr-legend-row';
      try{row.append(await classes.symbolUtils.renderPreviewHTML(entry.symbol,{size:22}));}catch{row.append(node('span','Symbol preview unavailable · '));}
      row.append(node('span',entry.label||entry.value||'Publisher symbol'));s.legend.append(row);
    }
  }
  function supplyCards(features){
    const host=$('dwr-supply-list');host.replaceChildren();
    for(const f of features){
      const a=f.attributes,card=node('section');card.className='dwr-supply-card';
      card.append(node('h3',a.Location||'Unnamed supply location'),node('p',[a.Address,a.City].filter(Boolean).join(' · ')),node('p',`Source inspection: ${inspectionDate(a.Inspection_Date)} (UTC date) · Location ID: ${String(a.Location_ID||'Unknown').trim()}`));
      const dl=node('dl');
      for(const [field,label]of [['Burlap_Sandbags__ea_','Burlap sandbags (each)'],['Plastic_Sandbags__ea_','Plastic sandbags (each)'],['Plastic__rolls_','Plastic (rolls)'],['Containers','Containers']])dl.append(node('dt',label),node('dd',inventoryQuantity(a[field])));
      card.append(dl,node('p','Reported inspection inventory · confirm current stock and release arrangements with DWR.'));
      const button=node('calcite-button','Locate on map');button.scale='s';button.appearance='outline';
      button.addEventListener('click',()=>{onMap();controller.setLayerPreference(KEY,true);void controller.focusReferenceGeometry(f.geometry.toJSON(),20000);});card.append(button);host.append(card);
    }
    if(!features.length)host.append(node('p','No supply locations returned for Fresno County. This does not establish that supplies are unavailable.'));
  }
  async function refreshLayer(s){
    if(s.pending)return s.pending;
    s.pending=(async()=>{
      status(s,'Checking publisher service and Fresno scope…');
      try{
        const c=s.config;
        if(!s.layer){
          const fields=c.fields.map(f=>({fieldName:f.name,label:f.label,...(f.type==='esriFieldTypeDate'?{format:{dateFormat:'short-date'}}:f.type!=='esriFieldTypeString'?{format:{places:0,digitSeparator:true}}:{})}));
          const note=c.key==='supplies'?catalog.inventoryNote:'DWR dashboard reference. Geometry does not establish current flow, levee condition, flood depth, supply availability or safe access.';
          s.layer=new classes.FeatureLayer({url:c.url,title:`DWR · ${c.title}`,visible:false,definitionExpression:'1=0',outFields:['*'],editingEnabled:false,labelsVisible:false,minScale:c.minScale,elevationInfo:{mode:'on-the-ground'},renderer:c.renderer?classes.renderers.fromJSON(c.renderer):undefined,
            popupTemplate:{title:c.key==='supplies'?'Flood-fight supplies · {Location}':c.key==='offices'?'DWR office · {DWR_Office}':c.title,content:[{type:'text',text:note},{type:'fields',fieldInfos:fields},{type:'text',text:`<a href="${c.url}" target="_blank" rel="noopener noreferrer">Publisher layer</a> · <a href="${catalog.dashboard}" target="_blank" rel="noopener noreferrer">DWR-provided dashboard</a>`}]}});
          group.add(s.layer);
        }
        await s.layer.load();
        const q={where:c.where,geometry:county,spatialRelationship:'intersects'};
        // The layer starts with 1=0. Query the source directly so its own display restriction cannot empty the scope.
        const source=new classes.FeatureLayer({url:c.url});
        let ids;
        try{await source.load();ids=await source.queryObjectIds(q);}finally{source.destroy();}
        const expression=fresnoDefinition(s.layer.objectIdField,ids,c.where);
        s.layer.definitionExpression=expression;s.layer.visible=s.box.checked;s.layer.refresh();s.checked=Date.now();s.error=null;s.count=new Set(ids).size;
        status(s,`${s.count.toLocaleString()} Fresno-intersecting record${s.count===1?'':'s'} · checked ${checkedText(s.checked)}${c.minScale?' · details at 1:'+c.minScale.toLocaleString()+' or closer':''}.`);
        if(c.key==='supplies'){
          // Read after setting the verified definition; the initial layer is deliberately closed.
          const result=ids.length?await s.layer.queryFeatures({...q,where:expression,objectIds:ids,returnGeometry:true,outSpatialReference:{wkid:4326},outFields:['*']}):{features:[]};
          if(result.exceededTransferLimit)throw new Error('Supply inventory is incomplete');
          const features=assertScopedInventory(result.features,ids,s.layer.objectIdField),rows=normalizeSupplyFeatures(features);
          supplyCards(features);onSupplies({loaded:true,rows,checked:s.checked,error:null,source:c.url});
        }
        await legend(s);
        reportHealth('dwr:'+c.key,'DWR '+c.title,{checked:s.checked,maxAgeMs:REFRESH_MS+120000,detail:'Publisher reference query works; inspection dates and current resource availability are separate.'});
      }catch(error){
        s.error=error.message||'Publisher query failed';if(s.layer){s.layer.visible=false;s.layer.definitionExpression='1=0';}
        status(s,'Unavailable · '+s.error+'. No statewide fallback is shown.');
        if(s.config.key==='supplies'){
          $('dwr-supply-list').replaceChildren(node('p','Supply inventory unavailable. Use the DWR dashboard and confirm with DWR; previous quantities are not shown as current.'));
          onSupplies({loaded:true,rows:[],checked:s.checked,error:s.error,source:s.config.url});
        }
        reportHealth('dwr:'+s.config.key,'DWR '+s.config.title,{checked:Date.now(),error:s.error,detail:s.config.url});
      }finally{s.pending=null;}
    })();return s.pending;
  }
  const refreshWatched=()=>Promise.all([...states.values()].filter(s=>group?.visible&&s.box.checked||inventoryWatching&&s.config.key==='supplies').map(refreshLayer));
  async function setup(){
    if(started){if(group?.visible)await Promise.all([...states.values()].filter(s=>s.box.checked&&!s.checked).map(refreshLayer));return;}if(pendingCatalog)return pendingCatalog;
    pendingCatalog=(async()=>{
      if(!controller||!county){$('dwr-status').textContent='Map is still initializing. Reopen this pane when it is ready.';return;}
      if(exercise){$('dwr-status').textContent='Live DWR resources are disabled in the fictional exercise view. Open the live map to inspect publisher records.';return;}
      const r=await fetch('./data/dwr-flood-fight.json?v=0.61.0',{cache:'no-cache'});if(!r.ok)throw new Error('DWR source catalog unavailable');catalog=await r.json();
      const sdk=await loadSdk();const [FeatureLayer,GroupLayer,renderers,symbolUtils]=await sdk.import(['@arcgis/core/layers/FeatureLayer.js','@arcgis/core/layers/GroupLayer.js','@arcgis/core/renderers/support/jsonUtils.js','@arcgis/core/symbols/support/symbolUtils.js']);classes={FeatureLayer,renderers,symbolUtils};
      group=new GroupLayer({title:'DWR flood-fight context · Fresno County',visibilityMode:'independent'});controller.registerLayer(KEY,group,true);
      const host=$('dwr-layer-options');host.replaceChildren();
      for(const c of catalog.layers){
        const row=node('section');row.className='dwr-layer-row';const label=node('calcite-label');label.layout='inline';const box=node('calcite-checkbox');box.checked=c.defaultOn;box.dataset.dwrLayer=c.key;label.append(box,document.createTextNode(c.title));
        const statusNode=node('p',c.sourceIssue?`Dashboard source issue at onboarding: ${c.sourceIssue}. Select to recheck.`:'Not loaded · select to query the publisher.');statusNode.setAttribute('role','status');
        const details=node('details');details.append(node('summary','Publisher symbols & source'));const key=node('div');details.append(key,link('Publisher layer',c.url));row.append(label,statusNode,details);host.append(row);
        const s={config:c,box,status:statusNode,legend:key,layer:null,pending:null,checked:null};states.set(c.key,s);
        box.addEventListener('calciteCheckboxChange',()=>{if(box.checked){controller.setLayerPreference(KEY,true);void refreshLayer(s);}else if(s.layer)s.layer.visible=false;});
      }
      $('dwr-status').textContent=catalog.scopeNote+' Select a mapped feature for publisher attributes.';
      started=true;await refreshWatched();
    })().catch(error=>{$('dwr-status').textContent='DWR context unavailable · '+error.message;onSupplies({loaded:true,rows:[],checked:null,error:error.message});}).finally(()=>{pendingCatalog=null;});return pendingCatalog;
  }
  async function loadInventory({refresh=false}={}){
    inventoryWatching=true;
    const wasStarted=started;await setup();
    const s=states.get('supplies');if(s&&(refresh&&wasStarted||!s.checked))await refreshLayer(s);
  }
  function open(){onMap();$('dwr-evidence').setAttribute('open','');controller?.setLayerPreference(KEY,true);void setup();}
  $('dwr-open').addEventListener('click',open);
  $('dwr-refresh').addEventListener('click',()=>{if(!started)void setup();else void Promise.all([...states.values()].filter(s=>s.box.checked).map(refreshLayer));});
  document.addEventListener('frogLayerPreference',e=>{if(e.detail.key===KEY&&e.detail.wanted)void setup();});
  setInterval(()=>{if(!document.hidden)void refreshWatched();},REFRESH_MS);
  return {open,loadInventory,setMap(map,feature){controller=map;county={type:'polygon',...countyGeometry(feature.geometry)};if(new URLSearchParams(location.search).get('dwr')==='1')open();if(inventoryWatching)void loadInventory();}};
}
