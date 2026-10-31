import {loadSdk} from './map.js?v=0.74.0-infra-weather';
import {ACS_SOURCES,ACS_LIMIT,ACS_DENSITY_EXPRESSION,PIO_GUIDANCE,acsFields,formatAcsMeasure} from './acs-model.js?v=0.65.0-r1';
import {readAcsMetadata,readAcsTracts,readPioContext} from './acs-data.js?v=0.65.0';
import {reportHealth} from './source-health.js?v=0.73.1';
const $=id=>document.getElementById(id),node=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
const link=(text,url)=>{const a=node('a',text);a.href=url;a.target='_blank';a.rel='noopener noreferrer';return a;};
const colors=[[0,100,'#e4f1f5'],[100,500,'#b4d5e6'],[500,2000,'#74a9cf'],[2000,5000,'#3685b5'],[5000,1e12,'#145a87']];
const time=t=>new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',dateStyle:'medium',timeStyle:'short',timeZoneName:undefined}).format(t)+' Pacific';
function table(rows,caption){
  const t=node('table');t.append(node('caption',caption));const body=node('tbody');
  for(const r of rows){const tr=node('tr'),th=node('th',r.label);th.scope='row';tr.append(th,node('td',formatAcsMeasure(r)));body.append(tr);}t.append(body);return t;
}

/** Public aggregate context only. Selection, outlines and results live in memory. */
export function createAcsContext({exercise=false,onMap=()=>{},onOpenWatch=()=>{}}={}){
  const pane=$('acs-evidence'),picker=$('acs-tract'),checkbox=$('population-density');
  let scope={},map=null,meta=null,layer=null,highlight=null,Graphic=null,layerPending=null,mapError=null,epoch=0,abort=null,pioAbort=null,selected=null,loadingPio=false,selectedRow=null;
  const isWatch=()=>$('storm-shell').dataset.workspace==='watch'&&$('storm-shell').dataset.destination==='watch';
  function legend(){
    const host=$('population-density-key');host.replaceChildren();host.hidden=!checkbox.checked;
    host.append(node('strong',`Living Atlas ACS ${meta?.period||'period checking'} · residents / land square mile`));
    const key=node('div');key.className='population-swatches';
    for(const [label,color]of [['0–100',colors[0][2]],['>100–500',colors[1][2]],['>500–2,000',colors[2][2]],['>2,000–5,000',colors[3][2]],['>5,000',colors[4][2]],['No data','#949ca4']]){const row=node('div'),swatch=node('span');swatch.style.backgroundColor=color;row.append(swatch,document.createTextNode(label));key.append(row);}host.append(key);
    if(mapError)host.append(node('p','ACS map unavailable: '+mapError+'. The 2020 block baseline is a separate source.'));
  }
  async function ensureLayer(){
    if(layer)return;if(layerPending)return layerPending;if(!map||exercise)return;
    layerPending=(async()=>{
      const verified=await readAcsMetadata('population');meta=verified;
      const sdk=await loadSdk(),[FeatureLayer,GraphicsLayer,G]=await sdk.import(['@arcgis/core/layers/FeatureLayer.js','@arcgis/core/layers/GraphicsLayer.js','@arcgis/core/Graphic.js']);Graphic=G;
      const next=new FeatureLayer({id:'frog-acs-population',url:ACS_SOURCES.population.url,title:`Living Atlas ACS ${meta.period} · tract population density`,definitionExpression:"GEOID LIKE '06019%'",outFields:acsFields('population'),opacity:.65,minScale:0,popupEnabled:false,renderer:{type:'class-breaks',valueExpression:ACS_DENSITY_EXPRESSION,valueExpressionTitle:'Residents per land square mile',defaultSymbol:{type:'simple-fill',color:'#949ca4',outline:{color:'#343d45',width:.3}},defaultLabel:'No usable density',classBreakInfos:colors.map(([minValue,maxValue,color])=>({minValue,maxValue,symbol:{type:'simple-fill',color,outline:{color:'#536775',width:.3}}}))}});
      try{await next.load();}catch(e){next.destroy();throw e;}
      layer=next;highlight=new GraphicsLayer({title:'Selected ACS tract · whole-tract context',popupEnabled:false,elevationInfo:{mode:'on-the-ground'}});
      map.registerLayer('populationDensity',layer,true,1);map.registerLayer('populationDensity',highlight);mapError=null;legend();
      reportHealth('population:acs','Living Atlas ACS tract context',{checked:meta.checked,maxAgeMs:Infinity,detail:`ACS ${meta.period}; whole-tract estimates and 90% MOEs, not current occupancy.`});
    })().catch(e=>{mapError=e.message;legend();reportHealth('population:acs','Living Atlas ACS tract context',{error:mapError});throw e;}).finally(()=>{layerPending=null;});return layerPending;
  }
  async function showContext(){if(!isWatch()||exercise)return;try{await ensureLayer();if(isWatch())map?.setLayerPreference('populationDensity',checkbox.checked);}catch{/* Inline source failure is retained. */}}
  function draw(row){
    highlight?.removeAll();if(highlight&&row.geometry)highlight.add(new Graphic({geometry:{...row.geometry,type:'polygon'},attributes:{acsTractId:row.id},symbol:{type:'simple-fill',color:[0,0,0,0],outline:{color:'#f0a8df',width:2.5}}}));
  }
  async function focusSelected(row,generation){
    try{await ensureLayer();if(generation!==epoch||!isWatch())return;checkbox.checked=true;map?.setLayerPreference('populationDensity',true);legend();draw(row);await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));if(generation===epoch&&isWatch())void map?.focusReferenceGeometry(row.geometry);}catch{/* Data remains usable if map fails. */}
  }
  function guidance(host){
    host.append(node('h4','Plan distribution with the PIO / Joint Information Center'));
    const ul=node('ul');for(const text of [
      'Confirm languages with local partners; prepare qualified translation and interpretation. Broad Census groups cannot identify specific languages such as Hmong or Punjabi, or a person’s preferred alert language.',
      'Use coordinated channels: county alerts, radio/TV, accessible web and social posts, plus community partners and offline outreach. Internet access counts do not measure cell coverage, alert enrollment or message delivery.',
      'Keep protective actions in plain language. Provide captions, ASL interpretation, audio/text alternatives and accessible documents; these remain useful when ACS counts are zero or unavailable.',
      'Include verified transport-assistance instructions and accessible pickup information when authorized. No-vehicle households are context, not a count of people needing evacuation transport.'
    ])ul.append(node('li',text));host.append(ul,link('Cal OES accessible emergency communications',PIO_GUIDANCE.communication),node('br'),link('CalAlerts translated templates & language style guides',PIO_GUIDANCE.templates));
    host.append(node('p','Confirm hazard, affected location, protective action, timing and issuing authority before release. This tool does not send alerts or approve public messages.'));
  }
  async function loadPio(host,generation,row){
    if(loadingPio||host.dataset.loaded)return;loadingPio=true;pioAbort?.abort();pioAbort=new AbortController();
    host.replaceChildren(node('p','Checking public ACS outreach context…'));const signal=pioAbort.signal;
    try{const topics=await readPioContext(row.id,row.period,{signal});if(generation!==epoch||!host.isConnected)return;host.dataset.loaded='1';host.replaceChildren();
      for(const topic of topics){const source=ACS_SOURCES[topic.key],section=node('section');section.append(node('h4',source.title));
        if(topic.error){section.append(node('p','Unavailable: '+topic.error));reportHealth('population:pio:'+topic.key,source.title,{error:topic.error});}
        else{const values=topic.rows[0].measures;section.append(node('p',`ACS ${topic.metadata.period} · ${source.universe}.`));
          if(topic.key==='language'){section.append(table(values.slice(0,1),'People age 5+ · estimate ± 90% MOE'));const more=node('details');more.append(node('summary','Language groups · estimates & uncertainty'),table(values.slice(1),'Groups retain Census categories; no specific-language inference'));section.append(more);}
          else section.append(table(values,topic.key==='disability'?'People · estimate ± 90% MOE':'Households · estimate ± 90% MOE'));
          section.append(node('p',`Checked ${time(topic.checked)}.`));reportHealth('population:pio:'+topic.key,source.title,{checked:topic.checked,maxAgeMs:Infinity,detail:`ACS ${topic.metadata.period}, whole-tract context; not current individual needs.`});
        }
        section.append(link('Publisher, fields & methods',source.item));host.append(section);
      }
      host.append(node('p','Categories overlap and have different universes. Do not add people and households, or use these counts to infer an individual’s needs. Large MOEs indicate substantial sampling uncertainty.'));guidance(host);
    }catch(e){if(generation===epoch&&e.name!=='AbortError'){host.replaceChildren(node('p','Outreach context unavailable: '+e.message));guidance(host);}}
    finally{if(generation===epoch)loadingPio=false;}
  }
  async function select(id){
    abort?.abort();pioAbort?.abort();abort=new AbortController();const generation=++epoch;loadingPio=false;selectedRow=null;selected=id;picker.value=id;$('acs-detail').replaceChildren(node('p','Checking the selected tract…'));highlight?.removeAll();
    try{const data=await readAcsTracts({id,metadata:meta,signal:abort.signal});if(generation!==epoch||!isWatch())return;meta=data.metadata;const row={...data.rows[0],period:data.metadata.period},host=$('acs-detail');host.replaceChildren(node('h3',row.name),node('p',`GEOID ${row.id} · ACS ${meta.period} five-year estimates · checked ${time(data.checked)}.`),table(row.measures,'Whole tract · residents ± 90% MOE'),node('p','Whole-tract estimates; separate from the 2020 zone baseline. ± is the 90% margin of error, not a current affected-person count.'));
      if(row.measures.some(r=>r.estimate!==null&&r.moe!==null&&r.moe>r.estimate))host.append(node('p','At least one margin of error exceeds its estimate. Treat small counts with particular caution.'));

      const disclosure=node('details');disclosure.id='acs-pio';const content=node('div');disclosure.append(node('summary','PIO reach, accessibility & transport'),content);disclosure.addEventListener('toggle',()=>{if(disclosure.open)void loadPio(content,generation,row);});host.append(disclosure);const method=node('details');method.append(node('summary','Estimate limits, map key & source'),node('p',ACS_LIMIT),node('p','Pink outline: selected whole tract. Publisher boundaries are trimmed around water for display; they are not used to calculate the 2020 zone estimate. Age groups do not establish an individual’s support needs.'),link('ACS population source, vintage & fields',ACS_SOURCES.population.item));host.append(method);host.scrollIntoView({block:'start'});legend();
      selectedRow=row;void focusSelected(row,generation);
    }catch(e){if(generation!==epoch||e.name==='AbortError')return;$('acs-detail').replaceChildren(node('p','Tract context unavailable: '+e.message),link('Open the publisher source',ACS_SOURCES.population.item));}
  }
  async function open({geometry=null,zone=null,id=null}={}){
    if(exercise)return;scope={geometry,zone};onOpenWatch();$('population-watch').open=true;onMap();pane.setAttribute('open','');abort?.abort();pioAbort?.abort();abort=new AbortController();const generation=++epoch;loadingPio=false;selectedRow=null;selected=null;highlight?.removeAll();picker.disabled=true;picker.replaceChildren();$('acs-detail').replaceChildren();
    $('acs-status').textContent=zone?`Finding ACS tracts intersecting zone ${zone}…`:'Checking Fresno County ACS tracts…';
    try{const data=await readAcsTracts({geometry,signal:abort.signal});if(generation!==epoch||!isWatch())return;meta=data.metadata;
      $('acs-status').textContent=`${data.rows.length} ${zone?'tracts intersecting zone '+zone:'Fresno County tracts'} · ACS ${meta.period}. Whole-tract context only; tract totals are never added as zone population.`;
      const empty=node('option','Choose a census tract…');empty.value='';picker.append(empty);for(const r of data.rows){const option=node('option',r.name+' · '+r.id);option.value=r.id;picker.append(option);}picker.disabled=!data.rows.length;legend();void showContext();
      if(id&&data.rows.some(r=>r.id===id))await select(id);else if(data.rows.length===1)await select(data.rows[0].id);else $('acs-detail').append(node('p','Choose a tract for age counts, margins of error and PIO planning context. The separate 2020 block estimate remains in evacuation-zone evidence.'));
    }catch(e){if(generation!==epoch||e.name==='AbortError')return;$('acs-status').textContent='ACS context unavailable: '+e.message;$('acs-detail').append(link('Publisher source',ACS_SOURCES.population.item));}
  }
  picker.addEventListener('change',()=>{if(picker.value)void select(picker.value);else{epoch++;abort?.abort();pioAbort?.abort();highlight?.removeAll();$('acs-detail').replaceChildren();selected=null;selectedRow=null;loadingPio=false;}});
  $('acs-open').addEventListener('click',()=>void open());$('acs-retry').addEventListener('click',()=>{if(selected)void select(selected);else void open(scope);});
  checkbox.addEventListener('change',()=>{legend();void showContext();});document.addEventListener('frogLayerPreference',e=>{if(e.detail?.key==='populationDensity'){checkbox.checked=e.detail.wanted;legend();}});
  window.addEventListener('frogAcsTractSelect',e=>{if(/^06019\d{6}$/.test(e.detail?.id||''))void open({id:e.detail.id});});
  pane.addEventListener('stormEvidenceClose',()=>{epoch++;abort?.abort();pioAbort?.abort();loadingPio=false;});
  window.addEventListener('pagehide',()=>{epoch++;abort?.abort();pioAbort?.abort();highlight?.removeAll();});
  if(exercise)$('acs-open').disabled=true;legend();
  return {open,legend,showContext,setMap(value){map=value;if(selectedRow&&isWatch())void focusSelected(selectedRow,epoch);}};
}
