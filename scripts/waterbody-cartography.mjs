/** Shared FROG basemap build helpers: county polygon style, native-label suppression, MVT tile writer. */
import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import vtpbf from 'vt-pbf';

export const PUBLIC_URL='https://cof-rylopez.github.io/fresno-storm-watch/basemaps/frog-waterways-dark/';

/** @param {number[]} bounds lon/lat bbox @returns {(p:number[])=>number[]} 240x160 gallery thumbnail projection. */
export const thumbnailPoint=bounds=>p=>[(p[0]-bounds[0])/(bounds[2]-bounds[0])*240,145-(p[1]-bounds[1])/(bounds[3]-bounds[1])*125];

/** Suppress matching native water / marine names in place (once per name list); other labels remain. */
export function suppressNames(style,names){
  for(const layer of style.layers){
    const field=/^\{(_name(?:_global)?)\}$/.exec(layer.layout?.['text-field']??'')?.[1];
    if(field&&/^(Water |Marine waterbody)/.test(layer['source-layer']??'')){
      const filter=['!in',field,...names];
      if(!JSON.stringify(layer.filter??[]).includes(JSON.stringify(filter)))layer.filter=layer.filter?['all',layer.filter,filter]:filter;
    }
  }
  return style;
}

/**
 * Write every z/x/y .pbf covering bounds for zooms 0..maxzoom. Layers are encoded in `indexes` order;
 * `represented` holds the first layer's source_id values seen at maxzoom.
 * @param {URL} output @param {string} tileDirectory @param {number[]} bounds @param {number} maxzoom @param {Object<string,object>} indexes geojson-vt indexes by layer name
 * @returns {Promise<{tiles:number,bytes:number,represented:Set<string>,tilesSha256:string}>}
 */
export async function writeTiles(output,tileDirectory,bounds,maxzoom,indexes){
  const x=(lon,z)=>Math.floor((lon+180)/360*2**z),y=(lat,z)=>Math.floor((1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*2**z);
  const entries=Object.entries(indexes),hashes=[],represented=new Set();let tiles=0,bytes=0;
  for(let z=0;z<=maxzoom;z++)for(let tx=x(bounds[0],z);tx<=x(bounds[2],z);tx++){
    await mkdir(new URL(`${tileDirectory}/${z}/${tx}/`,output),{recursive:true});
    for(let ty=y(bounds[3],z);ty<=y(bounds[1],z);ty++){
      const layers={};
      entries.forEach(([name,index],i)=>{const tile=index.getTile(z,tx,ty);if(tile)layers[name]=tile;if(!i&&z===maxzoom)for(const row of tile?.features??[])represented.add(row.tags.source_id);});
      const buffer=Buffer.from(vtpbf.fromGeojsonVt(layers)),path=`${tileDirectory}/${z}/${tx}/${ty}.pbf`;
      await writeFile(new URL(path,output),buffer);hashes.push([path,createHash('sha256').update(buffer).digest('hex')]);tiles++;bytes+=buffer.length;
    }
  }
  return {tiles,bytes,represented,tilesSha256:createHash('sha256').update(JSON.stringify(hashes)).digest('hex')};
}

/** Add county polygon context below hydro lines, keeping the original flowline cache. */
export function addWaterbodyStyle(input,manifest,baseUrl){
  const style=structuredClone(input),version=manifest.version;
  style.sources.frogWaterbodies={type:'vector',url:baseUrl+'waterbodies-tilejson.json?v='+version};
  style.layers=style.layers.filter(layer=>!layer.id.startsWith('frog-waterbody-'));
  suppressNames(style,manifest.labelNames);
  const source={source:'frogWaterbodies','source-layer':'waterbodies'};
  const fill={id:'frog-waterbody-fill',type:'fill',...source,minzoom:5,
    paint:{'fill-color':'#294d60','fill-opacity':.85}};
  const shore={id:'frog-waterbody-outline',type:'line',...source,minzoom:9,
    paint:{'line-color':'#6997aa','line-width':{stops:[[9,.5],[14,1]]},'line-opacity':.8}};
  const first=style.layers.findIndex(layer=>layer.source==='esri'&&/^Road/.test(layer['source-layer']??''));
  style.layers.splice(first<0?0:first,0,fill,shore);
  const labels={type:'symbol',source:'frogWaterbodies','source-layer':'waterbodyNames',
    layout:{'text-field':'{name}','text-font':['Arial Regular'],'text-size':13,'text-max-width':14,'text-padding':10,'text-allow-overlap':false,'text-ignore-placement':false},
    paint:{'text-color':'#c2e1ed','text-halo-color':'#17252e','text-halo-width':1.5}};
  style.layers.push({...structuredClone(labels),id:'frog-waterbody-major-names',minzoom:7,filter:['>=','area_sqkm',1],layout:{...labels.layout,'text-size':15}},
    {...structuredClone(labels),id:'frog-waterbody-local-names',minzoom:11,filter:['<','area_sqkm',1]});
  style.metadata={...(style.metadata??{}),frog:{...(style.metadata?.frog??{}),waterbodies:{version,source:manifest.source,retrievedAt:manifest.retrievedAt,accepted:manifest.accepted}}};
  return style;
}
