import {installWaterwayLabels} from './waterway-labels.js?v=0.27.1';
/** Public reference context; no facility attributes, matching or hazard inference. */
export const CONTEXT_SOURCES = Object.freeze({
  waterways: 'https://3dhp.nationalmap.gov/arcgis/rest/services/usgs_3dhp_all/MapServer/50',
  buildings: 'c444b24b184c4523a5dc96248bfea4e1',
  waterwaysScale: 400_000,
  namesScale: 160_000,
  detailScale: 30_000,
  buildingsScale: 80_000
});

/** @param {object} options @returns {object} Attach lazy 3D context and county-filtered hydrography. */
export function installMapContext({map, FeatureLayer, sdk, reactiveUtils, fresnoGeometry, getView}) {
  const waterButton = document.querySelector('#toggle-waterways');
  const buildingButton = document.querySelector('#toggle-buildings');
  const waterStatus = document.querySelector('#waterways-status');
  const buildingStatus = document.querySelector('#buildings-status');
  const expandButton = document.querySelector('#expand-map');
  const panel = expandButton.closest('calcite-panel');
  const expandedNote = document.querySelector('#expanded-map-note');
  const expandMap = (expanded, restoreFocus=true) => {
    panel.classList.toggle('map-expanded',expanded);
    expandedNote.hidden=!expanded;
    expandButton.text=expanded?'Restore workspace':matchMedia('(max-width:900px)').matches?'Expand':'Expand map';
    expandButton.icon=expanded?'full-screen-exit':'full-screen';
    expandButton.setAttribute('aria-expanded',String(expanded));
    // Keep keyboard focus on the reversible control, not behind the enlarged map.
    if(restoreFocus)void expandButton.setFocus();
  };
  expandButton.addEventListener('click',()=>expandMap(!panel.classList.contains('map-expanded')));
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&panel.classList.contains('map-expanded'))expandMap(false);
  });
  document.addEventListener('focusin',event=>{
    // If keyboard navigation or a gauge dialog moves outside the map, reveal
    // that destination instead of leaving focus behind the expanded panel.
    if(panel.classList.contains('map-expanded')&&!panel.contains(event.target))expandMap(false,false);
  });
  const waterViews = new WeakMap();
  const buildingViews = new WeakMap();
  const boundViews = new WeakSet();
  let buildings = null, buildingsLoading = false, buildingsWanted = false, buildingsError = false;
  let waterEnabled = false, waterError = false, basemapPilot=false;
  let namesError=false,namesCount=null;
  const waterSymbol = (color, width, style = 'solid') => ({type:'simple-line', color, width, style});
  const waterRenderer = () => ({type:'unique-value',field:'featuretype',defaultLabel:'Other network connector',defaultSymbol:waterSymbol('#a6b9c3',0.8,'dot'),uniqueValueInfos:[
    {value:1,label:'River / stream channel',symbol:waterSymbol('#70b9f4',1.6)},
    {value:2,label:'Canal / ditch',symbol:waterSymbol('#83d4e6',1.5,'dash')},
    {value:3,label:'Drainageway',symbol:waterSymbol('#83d4e6',1,'dash')},
    {value:4,label:'Surface connector',symbol:waterSymbol('#a6b9c3',0.8,'dot')},
    {value:5,label:'Waterbody connector',symbol:waterSymbol('#70b9f4',0.8,'dot')},
    {value:7,label:'Hydro unenforced connector',symbol:waterSymbol('#a6b9c3',0.8,'dot')}
  ]});
  const popup = () => ({
    title:'{expression/waterway-name}',
    expressionInfos:[{name:'waterway-name',title:'Waterway',expression:"IIf(IsEmpty(Trim(DefaultValue($feature.gnisidlabel, ''))), 'Unnamed mapped waterway', $feature.gnisidlabel)"}],
    content:[{type:'text',text:'USGS mapped hydrography. Names, geometry and network connections are reference data, not current water levels, gate settings or predicted inundation. Confirm local ditch names and operations with the responsible district.'},
      {type:'fields',fieldInfos:[
        {fieldName:'gnisidlabel',label:'Published name'},
        {fieldName:'featuretypelabel',label:'Mapped feature type'},
        {fieldName:'id3dhp',label:'USGS feature ID'},
        {fieldName:'gnisid',label:'Geographic name ID'},
        {fieldName:'featuredate',label:'Source feature date (not observation time)',format:{dateFormat:'short-date'}},
        {fieldName:'lengthkm',label:'Full source segment length (km)',format:{places:2,digitSeparator:true}}
      ]},
      {type:'text',text:`<a href="${CONTEXT_SOURCES.waterways}" target="_blank" rel="noopener noreferrer">USGS layer and schema</a>`}]
  });
  const common = {url:CONTEXT_SOURCES.waterways,outFields:['id3dhp','gnisidlabel','gnisid','featuretype','featuretypelabel','featuredate','lengthkm'],
    elevationInfo:{mode:'on-the-ground'},popupTemplate:popup(),renderer:waterRenderer(),opacity:0.9};
  const named = new FeatureLayer({...common,id:'fresno-named-waterways',title:'USGS named rivers, canals and ditches — reference',
    minScale:CONTEXT_SOURCES.waterwaysScale,definitionExpression:"gnisidlabel IS NOT NULL AND gnisidlabel <> ''",
    labelsVisible:false
  });
  const unnamed = new FeatureLayer({...common,id:'fresno-unnamed-waterways',title:'USGS unnamed waterways — close-scale reference',
    minScale:CONTEXT_SOURCES.detailScale,definitionExpression:"gnisidlabel IS NULL OR gnisidlabel = ''",opacity:0.55});
  const detailSource=new FeatureLayer({...common,title:'Nearby USGS waterway reference — current publisher attributes'});
  // Reference geometry is beneath operational points/lines. Each view is filtered
  // by the same complete county polygon; panning never changes source scope.
  map.addMany([unnamed,named],1);
  const names=installWaterwayLabels({map,sdk,reactiveUtils,getView,enabled:()=>waterEnabled&&!basemapPilot,minScale:CONTEXT_SOURCES.namesScale,onError:error=>{namesError=!!error;updateStatus();},onCount:count=>{namesCount=count;updateStatus();}}).catch(error=>{namesError=true;updateStatus();console.warn('Waterway names:',error.message);return null;});
  const updateStatus = () => {
    const view = getView(), state = waterViews.get(view);
    waterButton.textContent = `Waterways: ${waterEnabled?'on':'off'}`;
    waterButton.setAttribute('aria-pressed',String(waterEnabled));
    waterStatus.textContent = basemapPilot ? 'USGS pilot geometry / names are in the basemap · select another basemap for countywide reference'
      : !waterEnabled ? 'USGS waterway context off'
      : waterError || namesError || state?.some(s=>s==='error') ? 'Waterway reference incomplete — check USGS source'
      : !state || state.some(s=>s==='loading') ? 'Loading USGS waterway reference'
      : view.scale > CONTEXT_SOURCES.waterwaysScale ? 'USGS waterways · zoom to 1:400,000'
      : view.scale > CONTEXT_SOURCES.namesScale ? 'USGS waterways · zoom closer for names'
      : `USGS · ${namesCount===null?'loading names':namesCount+' spaced names'} · ${view.scale <= CONTEXT_SOURCES.detailScale ? 'unnamed details also shown' : 'unnamed detail at 1:30,000'}`;
    const scene = view.type === '3d';
    buildingButton.disabled = !scene || buildingsLoading;
    buildingButton.textContent = `Buildings: ${buildingsWanted?'on':'off'}`;
    buildingButton.setAttribute('aria-pressed',String(scene && buildingsWanted));
    buildingStatus.textContent = !scene ? 'Open 3D buildings · select 3D'
      : !buildingsWanted ? 'Open 3D building context off'
      : buildingsError || buildingViews.get(view)==='error' ? 'Open 3D buildings unavailable — use facility footprints'
      : buildingsLoading || !buildings || buildingViews.get(view)!=='ready' ? 'Loading Open 3D building context'
      : view.scale > CONTEXT_SOURCES.buildingsScale ? 'Open 3D buildings · zoom to 1:80,000'
      : 'Open 3D · county matches unverified';
  };
  const bindBuildings = view => {
    if (!buildings || view.type !== '3d' || buildingViews.has(view)) return;
    buildingViews.set(view,'loading');
    void view.whenLayerView(buildings).then(()=>{buildingViews.set(view,'ready');updateStatus();})
      .catch(()=>{buildingViews.set(view,'error');updateStatus();});
  };
  const ensureBuildings = async () => {
    if (buildings || buildingsLoading || !buildingsWanted || getView().type !== '3d') return;
    buildingsLoading = true; buildingsError = false; updateStatus();
    try {
      const [SceneLayer] = await sdk.import(['@arcgis/core/layers/SceneLayer.js']);
      buildings = new SceneLayer({id:'open-3d-buildings',portalItem:{id:CONTEXT_SOURCES.buildings,portal:{url:'https://www.arcgis.com'}},
        title:'Open 3D Buildings — approximate context',minScale:CONTEXT_SOURCES.buildingsScale,popupEnabled:false,
        visible:getView().type==='3d' && buildingsWanted,
        renderer:{type:'simple',symbol:{type:'mesh-3d',symbolLayers:[{type:'fill',material:{color:'#83949e',colorMixMode:'replace'}}]}}});
      // Keep the 3D-only layer out of MapView, even when switching views quickly.
      if (getView().type==='3d') map.add(buildings,0);
      await buildings.load();
      bindBuildings(getView());
    } catch { buildingsError = true; }
    finally { buildingsLoading = false; updateStatus(); }
  };
  const bindView = view => {
    if (boundViews.has(view)) return;
    boundViews.add(view);
    const state = ['loading','loading']; waterViews.set(view,state);
    [named,unnamed].forEach((layer,i)=>{
      void view.whenLayerView(layer).then(layerView=>{
        layerView.filter = {geometry:fresnoGeometry,spatialRelationship:'intersects'};
        state[i]='ready';if(i===0)void names.then(labels=>labels?.bind(view,layerView));updateStatus();
      }).catch(()=>{state[i]='error';updateStatus();});
    });
    view.addHandles(reactiveUtils.watch(()=>view.scale,updateStatus));
    view.on('layerview-create-error',event=>{
      if(event.layer===buildings){buildingViews.set(view,'error');updateStatus();}
    });
  };
  waterButton.addEventListener('click',()=>{
    waterEnabled=!waterEnabled; named.visible=waterEnabled&&!basemapPilot; unnamed.visible=waterEnabled&&!basemapPilot;void names.then(labels=>labels?.sync());updateStatus();
  });
  buildingButton.addEventListener('click',()=>{
    buildingsWanted=!buildingsWanted;
    if(buildings)buildings.visible=buildingsWanted && getView().type==='3d';
    void ensureBuildings();updateStatus();
  });
  for (const layer of [named,unnamed]) void layer.load().catch(()=>{waterError=true;updateStatus();});
  return {
    bindView,
    async queryPilot(point){
      if(!basemapPilot||!point)return [];
      const lon=point.longitude,lat=point.latitude;
      if(!((lon>=-119.86&&lon<=-119.50&&lat>=36.89&&lat<=37.16)||(lon>=-119.52&&lon<=-119.13&&lat>=36.72&&lat<=37.02)))return [];
      // Query current publisher attributes near the click; cached tile IDs never
      // masquerade as a live observation. Bounded tolerance, no analysis buffer.
      const distance=Math.min(150,Math.max(8,getView().scale*.00028*5));
      const query=detailSource.createQuery();query.where='1=1';query.geometry=point;
      query.distance=distance;query.units='meters';query.num=5;query.returnGeometry=true;
      const result=await detailSource.queryFeatures(query);return result.features;
    },
    setBasemapPilot:value=>{basemapPilot=!!value;named.visible=waterEnabled&&!basemapPilot;unnamed.visible=waterEnabled&&!basemapPilot;void names.then(labels=>labels?.sync());updateStatus();},
    setVisibility:(water,build)=>{waterEnabled=!!water;buildingsWanted=!!build;named.visible=waterEnabled&&!basemapPilot;unnamed.visible=waterEnabled&&!basemapPilot;void names.then(labels=>labels?.sync());if(buildings)buildings.visible=buildingsWanted&&getView().type==='3d';void ensureBuildings();updateStatus();},
    onViewChanged:()=>{
      const view=getView();void names.then(labels=>labels?.changeView());
      if(buildings){
        if(view.type==='3d'){
          if(!map.layers.includes(buildings))map.add(buildings,0);
          buildings.visible=buildingsWanted;
          // A removed layer gets a fresh LayerView on return to 3D.
          buildingViews.delete(view);bindBuildings(view);
        } else if(map.layers.includes(buildings))map.remove(buildings);
      }
      void ensureBuildings();updateStatus();
    }
  };
}
