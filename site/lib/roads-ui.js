import {fetchRoads,roadHealth,roadInCurrentView,roadConflictBacklog,ROAD_MAP,EVAC_MAP} from './roads.js';
const el=(tag,text='')=>{const n=document.createElement(tag);n.textContent=text;return n;};
export function createRoadWatch({exercise=false,timeZone,onOpen=()=>{}}={}) {
  let snapshot=null,error=null,map=null,busy=false,selected=null;
  const host=document.getElementById('road-list'),status=document.getElementById('road-health');
  const time=value=>value?new Intl.DateTimeFormat('en-US',{timeZone,year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(value):'Not supplied';
  function render(){
    status.textContent=exercise?'Exercise mode — live county records are not mixed into fictional scenarios':roadHealth(snapshot,error);
    document.getElementById('road-times').textContent=snapshot?`Application checked ${time(snapshot.checked)} · source dates appear on each record`:'';
    host.replaceChildren();
    if(!snapshot)return;
    const all=document.getElementById('roads-all').checked;
    const rows=snapshot.rows.filter(r=>all||roadInCurrentView(r));
    const conflicts=roadConflictBacklog(snapshot.rows).length;
    document.getElementById('road-count').textContent=`${rows.length} shown / ${snapshot.rows.length} returned. ${conflicts} elapsed-date records still have active flags — verification backlog; use the history toggle. No reopening inferred.`;
    if(!rows.length)host.append(el('p','No records in this filter. No inference of safe access.'));
    for(const row of rows){
      const card=el('article');card.className='road-card';
      card.append(el('strong',`${row.kind} · ${row.name}`),el('p',`${row.status} · ${row.location}`));
      card.append(el('p',`Source updated ${time(row.sourceTime)} · edited ${time(row.edited)}`));
      const b=el('calcite-button','Review record');b.setAttribute('scale','s');b.setAttribute('appearance','outline');b.onclick=()=>detail(row);card.append(b);host.append(card);
    }
    map?.setRoads(rows);
  }
  function detail(row){
    selected=row.key;const d=document.getElementById('road-detail');d.replaceChildren();
    for(const [label,value] of [['Status',row.status],['Location',row.location],['Reason',row.reason||'Not supplied'],['Comment',row.comment||'Not supplied'],['Alternate route',row.alternateRoute||'Not supplied'],['Active flag',row.active||'Not supplied'],['Start',time(row.start)],['End',time(row.end)],['Source update',time(row.sourceTime)],['Editor timestamp',time(row.edited)],['GlobalID',row.id]])d.append(el('strong',label),el('p',value));
    for(const issue of row.issues)d.append(el('p',issue));
    const link=el('a','County official road map');link.href=ROAD_MAP;link.target='_blank';link.rel='noopener noreferrer';d.append(link);
    document.getElementById('road-dialog').setAttribute('heading',`${row.kind} · ${row.name}`);document.getElementById('road-dialog').setAttribute('open','');map?.focusRoad(row.key);
  }
  async function refresh(){if(busy||exercise)return;busy=true;document.getElementById('roads-refresh').setAttribute('loading','');try{snapshot=await fetchRoads();error=null;}catch{error=true;}finally{busy=false;document.getElementById('roads-refresh').removeAttribute('loading');render();}}
  document.getElementById('roads-refresh').onclick=()=>void refresh();document.getElementById('roads-all').addEventListener('change',render);
  for(const [id,url] of [['county-roads-link',ROAD_MAP],['county-evac-link',EVAC_MAP]])document.getElementById(id).setAttribute('href',url);
  document.getElementById('toggle-roads').onclick=()=>{const b=document.getElementById('toggle-roads'),visible=b.getAttribute('aria-pressed')!=='true';b.setAttribute('aria-pressed',String(visible));b.textContent=`County roads: ${visible?'on':'off'}`;map?.setRoadsVisible(visible);};
  void refresh();setInterval(()=>void refresh(),300000);setInterval(()=>{status.textContent=exercise?'Exercise mode · live road feed disabled':roadHealth(snapshot,error);},15000);
  return {setMap(controller){map=controller;render();},select(key){const row=snapshot?.rows.find(r=>r.key===key);if(row){onOpen();detail(row);}},get snapshot(){return snapshot;}};
}
