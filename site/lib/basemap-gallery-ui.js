/** The existing SDK loader registers this component; no second Calcite or SDK runtime. */
export async function installBasemapGallery({sdk,map,reactiveUtils,basemaps,getView,onSelect=()=>{}}){
  const host=document.getElementById('basemap-gallery-host'),status=document.getElementById('basemap-gallery-status');
  const gallery=document.createElement('arcgis-basemap-gallery');gallery.setAttribute('auto-destroy-disabled','');gallery.label='Workspace basemap gallery';host.append(gallery);
  let ready=false;
  try{
    const [LocalBasemapsSource]=await sdk.import(['@arcgis/core/widgets/BasemapGallery/support/LocalBasemapsSource.js']);
    let timeout;try{await Promise.race([customElements.whenDefined('arcgis-basemap-gallery'),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('Basemap Gallery component did not load')),15_000);})]);}finally{clearTimeout(timeout);}
    gallery.source=new LocalBasemapsSource({basemaps:Object.values(basemaps)});gallery.view=getView();ready=true;
    status.textContent='Choose a basemap for this workspace. Imagery is historical reference, not current conditions.';
    reactiveUtils.watch(()=>map.basemap,base=>{if(base!==map.basemap)return;const id=Object.keys(basemaps).find(key=>basemaps[key]===base||basemaps[key].id===base?.id);if(id)onSelect(id);});
    gallery.addEventListener('arcgisPropertyChange',e=>{if(e.detail.name==='state'&&gallery.state==='error')status.textContent='Basemap gallery unavailable. Existing map layers remain available; retry or choose another basemap.';});
  }catch(error){status.textContent=`Basemap gallery unavailable · ${error.message}`;gallery.remove();}
  return {setView(){if(ready)gallery.view=getView();}};
}
