import {elIfText as element} from './dom.js';
/** Public documentary references only. No inferred geometry, routing or private records. */
export function createIrrigationReference({onLocate=()=>{},fetchImpl=fetch}={}){
  const panel=document.getElementById('irrigation-evidence'),host=document.getElementById('irrigation-reference-content');
  let loaded=false,pending;
  const link=(text,url)=>{const a=element('a',text);a.href=url;a.target='_blank';a.rel='noopener noreferrer';return a;};
  const paragraph=text=>element('p',text);
  async function load(){
    if(loaded)return;if(pending)return pending;
    host.replaceChildren(paragraph('Loading irrigation sources and documentary connections…'));
    pending=(async()=>{
      try{
        const response=await fetchImpl(new URL('../data/irrigation-sources.json',import.meta.url),{credentials:'omit',cache:'no-cache',signal:AbortSignal.timeout(15_000)});
        if(!response.ok)throw new Error(`HTTP ${response.status}`);
        const data=await response.json(),sources=new Map(data.sources.map(source=>[source.id,source]));
        host.replaceChildren(paragraph(`Sources checked ${data.checkedDate}. Arrows below describe published supply relationships, not modeled routes, current flow, gate settings or verified asset-level connectivity.`));
        const routes=element('calcite-accordion');routes.scale='s';
        for(const row of data.connections){
          const item=element('calcite-accordion-item');item.heading=row.title;item.description=row.dateLabel;
          item.append(paragraph(row.nodes.join(' → ')),paragraph(row.note));
          const button=element('calcite-button',row.locate==='SJMC1'?'Locate Mendota watchpoint':row.locate==='MIL'?'Locate Millerton':'Locate Pine Flat');button.scale='s';button.appearance='outline';
          const status=paragraph('Location controls focus existing reservoir/gauge reference points, not an exact intake or modeled route.');status.setAttribute('role','status');
          button.addEventListener('click',()=>{status.textContent=onLocate(row.locate)===false?'Map is still initializing. Retry when the map is available.':'Located existing reservoir/gauge reference. This is not an exact intake or modeled route.';});item.append(button,status);
          for(const id of row.sources){const source=sources.get(id);item.append(paragraph('Source: '));item.lastChild.append(link(source.title,source.url));}
          routes.append(item);
        }
        host.append(routes);
        const inventory=element('details');inventory.append(element('summary','Available maps, GIS and remaining gaps'));
        for(const source of data.sources){const section=element('section');section.append(element('h3',source.title),paragraph(`${source.publisher} · ${source.kind}`),paragraph(source.dateLabel),paragraph(source.status),paragraph(source.coverage),paragraph(source.limitation),link('Open publisher source',source.url));inventory.append(section);}
        host.append(inventory);
        const request=element('details');request.append(element('summary','District coordination and data request'));
        request.append(paragraph('Start with FID, Consolidated, Alta and Laguna for Kings/Friant links; coordinate western and border systems with James, Tranquillity, CCID, Firebaugh, Westlands and their river/conveyance operators.'));
        const fields=element('ul');for(const field of data.request.fields)fields.append(element('li',field));request.append(fields,paragraph(data.request.format),paragraph(data.request.review),link('Download request text',new URL('../irrigation-data-request.txt',import.meta.url).href));host.append(request);
        loaded=true;
      }catch(error){host.replaceChildren(paragraph(`Irrigation references unavailable: ${error.message}. Retry by reopening this pane, or use the planning guide.`),link('Open source guide',new URL('../planning.html#irrigation-connections',import.meta.url).href));}
      finally{pending=null;}
    })();return pending;
  }
  for(const button of document.querySelectorAll('[data-open-irrigation]'))button.addEventListener('click',()=>{panel.setAttribute('open','');void load();});
  return {load};
}
