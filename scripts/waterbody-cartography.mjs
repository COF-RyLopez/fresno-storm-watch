/** Add county polygon context below hydro lines, keeping the original flowline cache. */
export function addWaterbodyStyle(input,manifest,baseUrl){
  const style=structuredClone(input),version=manifest.version;
  style.sources.frogWaterbodies={type:'vector',url:baseUrl+'waterbodies-tilejson.json?v='+version};
  style.layers=style.layers.filter(layer=>!layer.id.startsWith('frog-waterbody-'));
  // Suppress only matching native names. Labels outside county coverage remain.
  for(const layer of style.layers){
    const field=/^\{(_name(?:_global)?)\}$/.exec(layer.layout?.['text-field']??'')?.[1];
    if(field&&/^(Water |Marine waterbody)/.test(layer['source-layer']??'')){
      const filter=['!in',field,...manifest.labelNames];
      if(!JSON.stringify(layer.filter??[]).includes(JSON.stringify(filter)))layer.filter=layer.filter?['all',layer.filter,filter]:filter;
    }
  }
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
