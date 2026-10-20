/** Build the bounded, static MVT pilot. Never reads private services or credentials. */
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import geojsonvt from 'geojson-vt';
import vtpbf from 'vt-pbf';

const root=new URL('../',import.meta.url),input=new URL('work/waterway-pilot/',root);
const output=new URL('site/basemaps/frog-waterways-dark/',root);
const data=JSON.parse(await readFile(new URL('pilot.geojson',input),'utf8'));
const manifest=JSON.parse(await readFile(new URL('manifest.json',input),'utf8'));
const baseBytes=await readFile(new URL('scripts/basemap-dark-source.json',root));
const style=JSON.parse(baseBytes);
const bounds=[-119.86,36.72,-119.13,37.16],maxzoom=14;
if(data.features.length!==manifest.accepted||manifest.rejected!==0)throw new Error('Pilot source accounting mismatch');
const named=new Map();
// Label targets only: anchors snap to published source paths, never become
// inferred channels, facilities, staging points or gauge locations.
const labelTargets={'san joaquin river':[-119.733,36.994],'kings river':[-119.34,36.823],'madera canal':[-119.73,37.01],'friant-kern canal':[-119.69,36.986]};
for(const feature of data.features){
  const name=feature.properties.name,kind=feature.properties.kind;
  feature.properties.role=kind===2||kind===3||/\b(canal|ditch)\b/i.test(name)?'canal':kind===1||(kind===5&&/\briver\b/i.test(name))?'river':'connector';
  if(!name)continue;
  const key=name.toLocaleLowerCase('en-US');
  for(const line of feature.geometry.type==='LineString'?[feature.geometry.coordinates]:feature.geometry.coordinates){
    const distances=line.slice(1).map((p,i)=>Math.hypot(p[0]-line[i][0],p[1]-line[i][1]));
    const length=distances.reduce((a,b)=>a+b,0);
    if(labelTargets[key]){
      const target=labelTargets[key];
      for(let i=0;i<line.length-1;i++){
        const a=line[i],b=line[i+1],dx=b[0]-a[0],dy=b[1]-a[1],den=dx*dx+dy*dy;
        const t=den?Math.min(1,Math.max(0,((target[0]-a[0])*dx+(target[1]-a[1])*dy)/den)):0;
        const point=[a[0]+t*dx,a[1]+t*dy],score=Math.hypot(point[0]-target[0],point[1]-target[1]);
        if(score<(named.get(key)?.score??Infinity))named.set(key,{score,length,point,properties:feature.properties});
      }
      continue;
    }
    if(length<=(named.get(key)?.length??0))continue;
    let remaining=length/2,point=line[0];
    for(let i=0;i<distances.length;i++){if(remaining<=distances[i]){const t=remaining/distances[i];point=[line[i][0]+t*(line[i+1][0]-line[i][0]),line[i][1]+t*(line[i+1][1]-line[i][1])];break;}remaining-=distances[i];}
    named.set(key,{length,point,properties:feature.properties});
  }
}
// One stable anchor per normalized name for the entire pilot. This is a label
// placement choice, not a merge of source geometries or inferred connectivity.
const names={type:'FeatureCollection',features:[...named.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([,v],i)=>({type:'Feature',id:i+1,properties:v.properties,geometry:{type:'Point',coordinates:v.point}}))};
const options={maxZoom:maxzoom,indexMaxZoom:8,indexMaxPoints:50000,extent:4096,buffer:128,tolerance:2};
const linesIndex=geojsonvt(data,options),namesIndex=geojsonvt(names,options);
const x=(lon,z)=>Math.floor((lon+180)/360*2**z);
const y=(lat,z)=>Math.floor((1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*2**z);
let tiles=0,bytes=0;const hashes=[];
for(let z=0;z<=maxzoom;z++){
  for(let tx=x(bounds[0],z);tx<=x(bounds[2],z);tx++){
    const dir=new URL(`tiles/${z}/${tx}/`,output);await mkdir(dir,{recursive:true});
    for(let ty=y(bounds[3],z);ty<=y(bounds[1],z);ty++){
      const layers={};const lines=linesIndex.getTile(z,tx,ty),labels=namesIndex.getTile(z,tx,ty);
      if(lines)layers.flowlines=lines;if(labels)layers.names=labels;
      const buffer=Buffer.from(vtpbf.fromGeojsonVt(layers));
      const relative=`tiles/${z}/${tx}/${ty}.pbf`;await writeFile(new URL(relative,output),buffer);
      hashes.push([relative,createHash('sha256').update(buffer).digest('hex')]);tiles++;bytes+=buffer.length;
    }
  }
}
const publicUrl='https://cof-rylopez.github.io/fresno-storm-watch/basemaps/frog-waterways-dark/';
const tilejson={tilejson:'3.0.0',name:'F.R.O.G. Waterways — Dark · pilot',scheme:'xyz',tiles:[publicUrl+'tiles/{z}/{x}/{y}.pbf'],minzoom:10,maxzoom,bounds,tileSize:512,
  attribution:'USGS 3DHP; Esri and its data providers',vector_layers:[{id:'flowlines',geometry_type:'line',fields:{name:'String',kind:'Number',role:'String',source_id:'String'}},{id:'names',geometry_type:'point',fields:{name:'String',kind:'Number',source_id:'String'}}]};
await writeFile(new URL('tilejson.json',output),JSON.stringify(tilejson,null,2)+'\n');
style.name='F.R.O.G. Waterways — Dark · pilot';
style.sources.frog={type:'vector',url:publicUrl+'tilejson.json'};
// Replace Esri's river/canal line labels, retaining lake/reservoir labels and
// understated Esri geometry outside the pilot. All labels share one style.
style.layers=style.layers.filter(l=>!['Water line/label/Default','Water point/Canal or ditch','Water point/Stream or river','Water area/label/Canal or ditch','Water area/label/Small river','Water area/label/Large river','Water area large scale/label/River'].includes(l.id));
for(const layer of style.layers)if(/^Water line (small|medium|large) scale$/.test(layer.id)||/^Water line\/(Canal or ditch|Stream or river)/.test(layer.id))layer.maxzoom=Math.min(layer.maxzoom??24,10);
const line=(id,filter,color,width,minzoom=10,dash)=>({id,type:'line',source:'frog','source-layer':'flowlines',filter,minzoom,layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':color,'line-width':{stops:[[10,width*.5],[14,width],[18,width*1.4]]},...(dash?{'line-dasharray':dash}:{})}});
const hydro=[
  line('frog-network-connectors',['==','role','connector'],'#667f8d',.8,14,[1,3]),
  line('frog-unnamed-streams',['all',['==','role','river'],['==','name','']],'#4e839e',.9,14),
  line('frog-named-streams',['all',['==','role','river'],['!=','name',''],['!=','kind',5]],'#70b9f4',1.9,10),
  line('frog-named-waterbody-centrelines',['all',['==','role','river'],['!=','name',''],['==','kind',5]],'#70b9f4',1.3,10,[1,3]),
  line('frog-canals-ditches',['==','role','canal'],'#83d4e6',1.6,11,[4,2])
];
// Draw hydro lines beneath the labels; native road/place labels remain intact.
const firstLabel=style.layers.findIndex(l=>l.layout?.['text-field']);
style.layers.splice(firstLabel,0,...hydro);
const nameStyle={id:'frog-waterway-names',type:'symbol',source:'frog','source-layer':'names',minzoom:11,filter:['!=','name','Madera Canal'],
  layout:{'text-field':'{name}','text-font':['Arial Regular'],'text-size':16,'text-max-width':15,'text-padding':12,'text-allow-overlap':false,'text-ignore-placement':false},
  paint:{'text-color':'#b5e3ff','text-halo-color':'#17252e','text-halo-width':1.5}};
style.layers.push(nameStyle,{...structuredClone(nameStyle),id:'frog-madera-intake-name',filter:['==','name','Madera Canal'],layout:{...nameStyle.layout,'text-anchor':'bottom-right','text-offset':[-1,-1]}});
await writeFile(new URL('root.json',output),JSON.stringify(style,null,2)+'\n');
const preview=data.features.filter(f=>f.properties.name&&['river','canal'].includes(f.properties.role)).flatMap(f=>(f.geometry.type==='LineString'?[f.geometry.coordinates]:f.geometry.coordinates).map(path=>`<path d="M${path.map(p=>`${((p[0]-bounds[0])/(bounds[2]-bounds[0])*240).toFixed(1)},${(145-(p[1]-bounds[1])/(bounds[3]-bounds[1])*125).toFixed(1)}`).join(' L')}" stroke="${f.properties.role==='canal'?'#83d4e6':'#70b9f4'}"${f.properties.role==='canal'?' stroke-dasharray="3 2"':''}/>`));
await writeFile(new URL('thumbnail.svg',output),`<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160" viewBox="0 0 240 160"><rect width="240" height="160" fill="#252a2d"/><g fill="none" stroke-width="1.4">${preview.join('')}</g><rect width="240" height="24" fill="#17252e"/><text x="9" y="17" fill="#b5e3ff" font-family="Arial" font-size="12">USGS waterways · pilot</text></svg>`);
await writeFile(new URL('manifest.json',output),JSON.stringify({...manifest,basemapVersion:'0.28.0',
  backgroundStyle:{itemId:'c11ce4f7801740b2905eb03ddc963ac8',owner:'esri_vector',url:'https://www.arcgis.com/sharing/rest/content/items/c11ce4f7801740b2905eb03ddc963ac8/resources/styles/root.json',sha256:createHash('sha256').update(baseBytes).digest('hex')},
  cartography:{projection:'EPSG:3857 web tiles',tileSize:512,extent:4096,buffer:128,maxzoom,simplificationTolerance:2,labelAnchors:names.features.length,labelTargets,labelRule:'One point anchor per normalized published name; four principal names snap to source paths near the dam areas, others use the midpoint of the longest clipped source path. Native collision avoidance may hide crowded names.',symbolRule:'Canal: source types 2/3 or published name containing canal/ditch. River: type 1 or named type 5 containing river. Other network connectors dotted. Named waterbody centerlines remain references, not channel beds.'},
  tileCount:tiles,tileBytes:bytes,tilesSha256:createHash('sha256').update(JSON.stringify(hashes)).digest('hex')},null,2)+'\n');
console.log(JSON.stringify({features:data.features.length,names:names.features.length,tiles,bytes}));
