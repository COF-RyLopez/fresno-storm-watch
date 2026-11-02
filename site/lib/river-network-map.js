/** 2D/3D-agnostic ArcGIS graphics for the river network and illustrative surge pulses. Canals and small channels stay in the waterway basemap tiles. */
const line=paths=>({type:'polyline',paths,spatialReference:{wkid:4326}});
const width=order=>order>=8?2.6:order>=6?1.8:order>=5?1.2:0.8;
export const SURGE_COLORS=Object.freeze({observed:'#ffd166',forecast:'#ff8fab'});
/** @returns {object} {setNetwork(net), setFrames(frames)} */
export function createRiverNetworkMap({GraphicsLayer,Graphic,registerLayer}){
  const base=new GraphicsLayer({title:'River network · USGS 3DHP routable streams',elevationInfo:{mode:'on-the-ground'},popupEnabled:false});
  const pulses=new GraphicsLayer({title:'Illustrative surge travel · measured / assumed speeds',elevationInfo:{mode:'on-the-ground'},popupEnabled:false});
  registerLayer('riverNetwork',base,true,2);registerLayer('riverNetwork',pulses);
  return {
    setNetwork(net){
      base.removeAll();
      base.addMany([...net.paths.values()].map(p=>new Graphic({geometry:line(p.parts.map(q=>q.c)),attributes:{riverPath:p.id,name:p.name},
        symbol:{type:'simple-line',color:[96,170,220,p.order>=6?0.85:0.55],width:width(p.order)}})));
    },
    setFrames(frames){
      pulses.removeAll();
      for(const f of frames){
        if(f.lines.length)pulses.add(new Graphic({geometry:line(f.lines),attributes:{surge:f.key},
          symbol:{type:'simple-line',color:SURGE_COLORS[f.kind],width:7,cap:'round',style:f.kind==='forecast'?'short-dash':'solid'}}));
        const pt=f.lines.at(-1)?.at(-1);
        if(pt)pulses.add(new Graphic({geometry:{type:'point',longitude:pt[0],latitude:pt[1],spatialReference:{wkid:4326}},attributes:{surge:f.key},
          symbol:{type:'simple-marker',size:16,color:SURGE_COLORS[f.kind],outline:{color:'#1b1f23',width:2}}}));
      }
    }
  };
}
