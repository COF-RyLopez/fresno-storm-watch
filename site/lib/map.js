import { CATEGORIES, COUNTIES, countyGeometry } from './model.js';
import { RIVER_COLORS } from './river-model.js';

let sdkPromise;
/** @returns {Promise<object>} Load the pinned vendor SDK without blocking feed/error text. */
export function loadSdk() {
  sdkPromise ??= import('https://js.arcgis.com/5.1/').then(() => globalThis.$arcgis);
  return sdkPromise;
}

/** @param {object[]} counties @param {Function} onSelect @returns {Promise<object>} */
export async function createMap(counties, onSelect, onGaugeSelect = ()=>{}, initialScope = 'fresno', onCameraSelect = ()=>{}) {
  const color = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const darkMode = () => document.documentElement.dataset.theme === 'dark';
  const sdk = await loadSdk();
  const [Map, MapView, Basemap, TileLayer, GraphicsLayer, Graphic, Polygon, reactiveUtils, webMercatorUtils, FeatureLayer, Extent] = await sdk.import([
    '@arcgis/core/Map.js', '@arcgis/core/views/MapView.js', '@arcgis/core/Basemap.js',
    '@arcgis/core/layers/TileLayer.js', '@arcgis/core/layers/GraphicsLayer.js',
    '@arcgis/core/Graphic.js', '@arcgis/core/geometry/Polygon.js', '@arcgis/core/core/reactiveUtils.js',
    '@arcgis/core/geometry/support/webMercatorUtils.js', '@arcgis/core/layers/FeatureLayer.js', '@arcgis/core/geometry/Extent.js'
  ]);
  const boundaryLayer = new GraphicsLayer({ title: 'Five-county scope' });
  const alertLayer = new GraphicsLayer({ title: 'Regional NWS alerts' });
  const selectedLayer = new GraphicsLayer({ title: 'Selected alert' });
  const labels = new GraphicsLayer({ title: 'County labels', elevationInfo:{mode:'relative-to-ground'} });
  const gauges = new GraphicsLayer({ title: 'NWS river watchpoints', elevationInfo:{mode:'relative-to-ground'} });
  const cameras = new GraphicsLayer({ title: 'Caltrans river-area highway cameras', elevationInfo:{mode:'relative-to-ground'} });
  const fema = new FeatureLayer({
    url:'https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28',
    title:'FEMA mapped flood hazard — planning reference', minScale:100_000, opacity:0.55, elevationInfo:{mode:'on-the-ground'},
    definitionExpression:"SFHA_TF = 'T' OR ZONE_SUBTY LIKE '%0.2%' OR FLD_ZONE = 'D'",
    outFields:['FLD_ZONE','ZONE_SUBTY','SFHA_TF','DFIRM_ID','FLD_AR_ID','SOURCE_CIT'],
    renderer:{type:'unique-value',valueExpression:"When($feature.SFHA_TF == 'T', 'sfha', $feature.FLD_ZONE == 'D', 'undetermined', 'moderate')",uniqueValueInfos:[
      {value:'sfha',label:'1% annual chance',symbol:{type:'simple-fill',color:'#8f6fbe',outline:{color:'#715096',width:0.4}}},
      {value:'moderate',label:'0.2% annual chance',symbol:{type:'simple-fill',color:'#dba64f',outline:{color:'#99763d',width:0.4}}},
      {value:'undetermined',label:'Undetermined (Zone D)',symbol:{type:'simple-fill',color:'#aeb6bd',style:'diagonal-cross',outline:{color:'#6e7e86',width:0.4}}}
    ]},
    popupTemplate:{title:'FEMA zone {FLD_ZONE}',content:[{type:'text',text:'Mapped flood-hazard reference, not a current flood forecast. Other zones are filtered from this view.'},{type:'fields',fieldInfos:[
      {fieldName:'FLD_ZONE',label:'Zone'},{fieldName:'ZONE_SUBTY',label:'Subtype'},{fieldName:'SFHA_TF',label:'Special flood hazard area'},
      {fieldName:'DFIRM_ID',label:'FIRM study ID'},{fieldName:'FLD_AR_ID',label:'Flood area ID'},{fieldName:'SOURCE_CIT',label:'Source citation'}]}]}
  });
  const basemaps = {};
  const themedBasemap = () => {
    const mode = darkMode() ? 'Dark' : 'Light';
    return basemaps[mode] ??= new Basemap({ title: `${mode} gray context`, baseLayers: [new TileLayer({
      url: `https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_${mode}_Gray_Base/MapServer`
    })], referenceLayers: [new TileLayer({
      url: `https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_${mode}_Gray_Reference/MapServer`
    })] });
  };
  const map = new Map({ basemap: themedBasemap(), layers: [fema, alertLayer, boundaryLayer, selectedLayer, labels, gauges, cameras] });
  let imageryBasemap=null,imagery=false;
  document.querySelector('#toggle-imagery').addEventListener('click',()=>{
    imagery=!imagery;
    imageryBasemap??=new Basemap({baseLayers:[new TileLayer({url:'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer'})],
      referenceLayers:[new TileLayer({url:'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer'})]});
    map.basemap=imagery?imageryBasemap:themedBasemap();
    updateContextSymbols();
    document.querySelector('#toggle-imagery').textContent=`Imagery: ${imagery?'on':'off'}`;
    document.querySelector('#toggle-imagery').setAttribute('aria-pressed',String(imagery));
    document.querySelector('#imagery-note').hidden=!imagery;
  });
  let region, fresnoGeometry;
  for (const feature of counties) {
    const geometry = new Polygon(countyGeometry(feature.geometry));
    region = region ? region.union(geometry.extent) : geometry.extent.clone();
    const id = String(feature.properties.GEOID).padStart(5, '0');
    const primary = id === '06019';
    if(primary)fresnoGeometry=geometry;
    boundaryLayer.add(new Graphic({ geometry, attributes:{countyId:id}, visible:primary||initialScope!=='fresno', symbol: {
      type: 'simple-fill', color: [255, 255, 255, 0.03], outline: { color: color(primary ? '--map-county' : '--map-neighbor'), width: primary ? 2 : 1 }
    }}));
    labels.add(new Graphic({ geometry: geometry.extent.center, attributes:{countyId:id}, visible:primary||initialScope!=='fresno', symbol: {
      type: 'text', text: COUNTIES[id], color: color('--map-label'), haloColor: color('--map-halo'), haloSize: 2,
      font: { family: 'Arial', size: primary ? 13 : 11, weight: 'bold' }
    }}));
  }
  // Navigation uses the basemap's projection; source and query geometry stay WGS84.
  const regionView = webMercatorUtils.geographicToWebMercator(region);
  if(!fresnoGeometry)throw new Error('Fresno County boundary is required for the river view.');
  const fresnoView = webMercatorUtils.geographicToWebMercator(fresnoGeometry);
  let mapScope=initialScope;
  const scopeExtent=()=>mapScope==='fresno'?fresnoView.extent:regionView;
  const mapView = new MapView({ container: 'map', map, center: [-119.6, 36.8], zoom: 7,
    padding: { top: 12, right: 12, bottom: 32, left: 12 },
    constraints: { rotationEnabled: false, minZoom: 5, snapToZoom: false }, popupEnabled: true,
    popup: { dockEnabled: true, dockOptions: { position: 'bottom-right', buttonEnabled: false, breakpoint: false } },
    attributionVisible: true, ui: { components: ['zoom'] } });
  let view=mapView, sceneView=null, modeBusy=false, terrain=null, terrainError=false;
  const viewListeners=new Set();
  await view.when();
  let femaError=false, selectedGauge=null, gaugeRows=[], cameraRows=[], selectedCamera=null;
  const femaViews=new WeakMap();
  const femaStatus=()=>{
    const host=document.querySelector('#fema-status');
    host.textContent=!fema.visible?'FEMA overlay off':femaError||femaViews.get(view)==='error'?'FEMA unavailable in this view — check publisher source':fema.loadStatus!=='loaded'||!femaViews.get(view)?'Loading FEMA reference':view.scale>100_000?'Fresno FEMA zones · zoom to 1:100,000 or closer':'FEMA zones intersecting Fresno County';
  };
  void fema.load().then(femaStatus).catch(()=>{femaError=true;femaStatus();});
  document.querySelector('#toggle-fema').addEventListener('click',()=>{
    fema.visible=!fema.visible;document.querySelector('#toggle-fema').textContent=`FEMA zones: ${fema.visible?'on':'off'}`;
    document.querySelector('#toggle-fema').setAttribute('aria-pressed',String(fema.visible));document.querySelector('#fema-legend').hidden=!fema.visible;femaStatus();
  });
  const drawGauges=()=>{
    gauges.removeAll();
    for(const row of gaugeRows){const g=row.gauge||row.station,tone=row.assessment.tone;
      gauges.add(new Graphic({geometry:{type:'point',longitude:g.longitude,latitude:g.latitude,spatialReference:{wkid:4326}},attributes:{gaugeId:row.station.id},
        symbol:{type:'simple-marker',style:{threshold:'triangle',change:'square',monitor:'circle',gap:'diamond'}[tone],size:row.station.id===selectedGauge?14:10,color:color(`--gauge-${tone}`)||RIVER_COLORS[tone],outline:{color:row.station.id===selectedGauge?color('--map-selection'):darkMode()?'#202427':'#ffffff',width:row.station.id===selectedGauge?2.5:1.3}}}));
    }
  };
  const drawCameras=()=>{
    cameras.removeAll();
    for(const row of cameraRows)cameras.add(new Graphic({
      geometry:{type:'point',longitude:row.longitude,latitude:row.latitude,spatialReference:{wkid:4326}},
      attributes:{cameraId:row.id},symbol:{type:'picture-marker',url:new URL(row.usable?'../assets/camera-pin.svg':'../assets/camera-pin-unavailable.svg',import.meta.url).href,
        width:row.id===selectedCamera?29:23,height:row.id===selectedCamera?29:23}}));
  };
  function updateContextSymbols() {
    boundaryLayer.graphics.forEach(graphic => {
      const symbol = graphic.symbol.clone();
      symbol.outline.color = imagery ? '#86c6d6' : color(graphic.attributes.countyId === '06019' ? '--map-county' : '--map-neighbor');
      graphic.symbol = symbol;
    });
    labels.graphics.forEach(graphic => {
      const symbol = graphic.symbol.clone();
      symbol.color = imagery ? '#e3e6e8' : color('--map-label');
      symbol.haloColor = imagery ? '#202427' : color('--map-halo');
      graphic.symbol = symbol;
    });
  }
  const applyMapTheme = () => {
    if (!imagery) map.basemap = themedBasemap();
    updateContextSymbols();
    drawGauges();
    alertLayer.graphics.forEach(graphic => {
      const symbol = graphic.symbol.clone(), shade = color(`--${graphic.attributes.category}`);
      symbol.color = `${shade}38`; symbol.outline.color = shade; graphic.symbol = symbol;
    });
    selectedLayer.graphics.forEach(graphic => {
      const symbol = graphic.symbol.clone(); symbol.outline.color = color('--map-selection'); graphic.symbol = symbol;
    });
  };
  window.addEventListener('storm-theme-change', applyMapTheme);
  applyMapTheme();
  const navigate = target => view.goTo(target, { animate: false }).catch(error => {
    if (error.name !== 'AbortError') { const status=document.querySelector('#map-status');status.hidden=false;status.textContent='Map navigation failed. Select records in the list for details.'; }
  });
  // Calcite can resize the panel after MapView becomes ready. Keep the initial
  // region fitted until the operator deliberately navigates the map.
  let followRegion = true;
  const fitTarget=()=>view.type==='3d'?{target:scopeExtent().clone().expand(1.15),tilt:45,heading:0}:scopeExtent().clone().expand(1.15);
  const geographicTarget=bounds=>{const extent=new Extent({...bounds,spatialReference:{wkid:4326}});return view.type==='3d'?{target:extent,tilt:35,heading:0}:webMercatorUtils.geographicToWebMercator(extent);};
  for (const type of ['pointerdown', 'wheel', 'keydown']) document.querySelector('#map').addEventListener(type, () => { followRegion = false; }, { passive: true });
  const bindView=targetView=>{
    // Apply the same county display filter independently to both layer views.
    void targetView.whenLayerView(fema).then(layerView=>{
      layerView.filter={geometry:fresnoView,spatialRelationship:'intersects'};femaViews.set(targetView,'ready');femaStatus();
    }).catch(()=>{femaViews.set(targetView,'error');femaStatus();});
    targetView.addHandles(reactiveUtils.watch(()=>[targetView.scale,fema.visible],femaStatus));
    targetView.addHandles(reactiveUtils.watch(()=>[targetView.width,targetView.height],([width,height])=>{
      if(view===targetView&&!modeBusy&&followRegion&&width>0&&height>0)void navigate(fitTarget());
    }));
    targetView.addHandles(reactiveUtils.watch(()=>targetView.fatalError,error=>{
      if(error&&view===targetView){const status=document.querySelector('#map-status');status.hidden=false;status.textContent='Map graphics failed. Try 2D, or use the lists and camera panel.';}
    }));
    targetView.on('click',async event=>{
      try{
        const hit=await targetView.hitTest(event,{include:[cameras,gauges,alertLayer]});
        const cameraId=hit.results.find(r=>r.graphic?.attributes?.cameraId)?.graphic.attributes.cameraId;
        if(cameraId){onCameraSelect(cameraId);return;}
        const gaugeId=hit.results.find(r=>r.graphic?.attributes?.gaugeId)?.graphic.attributes.gaugeId;
        if(gaugeId){onGaugeSelect(gaugeId);return;}
        const key=hit.results.find(r=>r.graphic?.attributes?.alertKey)?.graphic.attributes.alertKey;
        if(key)onSelect(key);
      }catch{const status=document.querySelector('#map-status');status.hidden=false;status.textContent='Map selection unavailable; select a record in the list.';}
    });
  };
  bindView(mapView);
  // Publisher layers can stay updating during an outage. Bind navigation and
  // gauges as soon as the view has dimensions, independently of those requests.
  await reactiveUtils.whenOnce(() => view.width > 0 && view.height > 0);
  await view.goTo(scopeExtent().clone().expand(1.15), { animate: false });
  const modeStatus=()=>{
    document.querySelector('#view-mode-status').textContent=view.type==='3d'
      ? terrainError?'3D terrain unavailable · return to 2D for map context':'3D terrain context · no flood-depth model'
      : '2D map';
    document.querySelector('#scene-controls').hidden=view.type!=='3d';
    for(const mode of ['2d','3d']){const button=document.querySelector(`#mode-${mode}`);button.setAttribute('aria-pressed',String(view.type===mode));button.setAttribute('appearance',view.type===mode?'solid':'outline');}
    for(const listener of viewListeners)listener();
  };
  const setMode=async mode=>{
    if(modeBusy||mode===view.type)return;modeBusy=true;
    for(const m of ['2d','3d'])document.querySelector(`#mode-${m}`).setAttribute('disabled','');
    const previous=view, originalViewpoint=view.viewpoint.clone(), viewpoint=originalViewpoint.clone();
    const status=document.querySelector('#map-status');status.hidden=false;status.textContent=`Opening ${mode==='3d'?'3D terrain':'2D map'}…`;
    try{
      if(mode==='3d'&&!sceneView){
        const [SceneView,ElevationLayer]=await sdk.import(['@arcgis/core/views/SceneView.js','@arcgis/core/layers/ElevationLayer.js']);
        terrain=new ElevationLayer({url:'https://elevation3d.arcgis.com/arcgis/rest/services/WorldElevation3D/Terrain3D/ImageServer',title:'Esri World Terrain — context only'});
        map.ground={layers:[terrain]};
        void terrain.load().catch(()=>{terrainError=true;modeStatus();});
        sceneView=new SceneView({map,container:null,qualityProfile:'medium',viewingMode:'global',
          environment:{lighting:{type:'virtual'},atmosphereEnabled:false,starsEnabled:false},
          popup:{dockEnabled:true,dockOptions:{position:'bottom-right',buttonEnabled:false,breakpoint:false}},
          ui:{components:['zoom','compass','navigation-toggle']}});
        bindView(sceneView);
      }
      const target=mode==='3d'?sceneView:mapView;
      const point=previous.center;
      const latitude=point?.latitude ?? 36.8;
      const factor=Math.cos(latitude*Math.PI/180);
      // Carry the same ground position across views. 3D adds a useful oblique tilt.
      viewpoint.scale*=mode==='3d'?factor:1/factor;
      previous.container=null;target.container='map';target.viewpoint=viewpoint;view=target;
      let readyTimer;
      try{await Promise.race([target.when(),new Promise((_,reject)=>{readyTimer=setTimeout(()=>reject(new Error('View initialization timed out')),25_000);})]);}finally{clearTimeout(readyTimer);}
      if(mode==='3d')await target.goTo({target:point,scale:viewpoint.scale,tilt:55,heading:0},{animate:false});
      if(target.fatalError)throw target.fatalError;
      status.hidden=true;modeStatus();femaStatus();
    }catch(error){
      if(view!==previous)view.container=null;
      previous.container='map';view=previous;previous.viewpoint=originalViewpoint;
      status.hidden=false;status.textContent=`${mode==='3d'?'3D':'2D'} could not open. The previous view and data panels remain available.`;
      console.warn('Storm Watch view switch:',error.message);modeStatus();
    }finally{modeBusy=false;for(const m of ['2d','3d'])document.querySelector(`#mode-${m}`).removeAttribute('disabled');}
  };
  for(const mode of ['2d','3d'])document.querySelector(`#mode-${mode}`).addEventListener('click',()=>void setMode(mode));
  document.querySelector('#scene-overhead').addEventListener('click',()=>void navigate({tilt:0,heading:0}));
  document.querySelector('#scene-tilt').addEventListener('click',()=>void navigate({tilt:55,heading:0}));
  modeStatus();for(const mode of ['2d','3d'])document.querySelector(`#mode-${mode}`).removeAttribute('disabled');
  return {
    addEnvironmentLayers:(overlays,reservoirs)=>{map.addMany(overlays,1);map.add(reservoirs);},
    onViewChanged:listener=>{viewListeners.add(listener);},
    clearEnvironmentPopup:()=>view.closePopup(),
    focusEnvironment:(longitude,latitude)=>{followRegion=false;return navigate({center:[longitude,latitude],scale:90_000,...(view.type==='3d'?{tilt:50,heading:0}:{})});},
    fitEnvironment:()=>{followRegion=false;return navigate(geographicTarget({xmin:-121.2,ymin:35.5,xmax:-118.2,ymax:38.2}));},
    focusPlanningPoints:points=>{if(!points.length)return;followRegion=false;const xs=points.map(p=>p.longitude),ys=points.map(p=>p.latitude);return navigate(geographicTarget({xmin:Math.min(...xs)-0.04,ymin:Math.min(...ys)-0.04,xmax:Math.max(...xs)+0.04,ymax:Math.max(...ys)+0.04}));},
    updateCameras: rows=>{cameraRows=rows;drawCameras();},
    selectCamera: id=>{selectedCamera=id;drawCameras();},
    setCamerasVisible: visible=>{cameras.visible=visible;},
    focusCamera: id=>{const row=cameraRows.find(c=>c.id===id);if(row){followRegion=false;return navigate({center:[row.longitude,row.latitude],scale:25_000,...(view.type==='3d'?{tilt:55,heading:0}:{})});}},
    updateGauges: rows=>{gaugeRows=rows;drawGauges();},
    selectGauge: id=>{selectedGauge=id;drawGauges();},
    focusGauge: id=>{const row=gaugeRows.find(r=>r.station.id===id);if(row){followRegion=false;const g=row.gauge||row.station;return navigate({center:[g.longitude,g.latitude],scale:35_000,...(view.type==='3d'?{tilt:55,heading:0}:{})});}},
    setScope: scope=>{if(mapScope!==scope){mapScope=scope;followRegion=true;for(const layer of [boundaryLayer,labels])layer.graphics.forEach(g=>{g.visible=scope!=='fresno'||g.attributes.countyId==='06019';});return navigate(fitTarget());}},
    fit: () => { followRegion = true; return navigate(fitTarget()); },
    update: alerts => {
      alertLayer.removeAll();
      selectedLayer.removeAll();
      // Lower-priority products draw first. Counts never come from the current view extent.
      for (const alert of [...alerts].reverse()) for (const geometry of alert.geometries) {
        const shade = color(`--${alert.category}`) || CATEGORIES[alert.category].color;
        alertLayer.add(new Graphic({ geometry: new Polygon(geometry), attributes: { alertKey: alert.key, category: alert.category },
          symbol: { type: 'simple-fill', color: `${shade}38`, outline: { color: shade, width: 1.5 } } }));
      }
    },
    select: (alert, zoom = false) => {
      selectedLayer.removeAll();
      if (!alert) return;
      let extent;
      for (const json of alert.geometries) {
        const geometry = new Polygon(json);
        extent = extent ? extent.union(geometry.extent) : geometry.extent.clone();
        selectedLayer.add(new Graphic({ geometry, symbol: { type: 'simple-fill', style: 'none', outline: { color: color('--map-selection'), width: 3, style: 'dash' } } }));
      }
      if (zoom && extent) { followRegion = false; void navigate(webMercatorUtils.geographicToWebMercator(extent).expand(1.3)); }
    },
    get view(){return view;}
  };
}
