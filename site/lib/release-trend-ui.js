import {buildReleaseTrend,TREND_REACHES,trendSegments} from './release-trend-model.js';
import {HOUR,riverValue} from './river-model.js';
import {formatTime} from './model.js';

const $=id=>document.getElementById(id);
const el=(tag,text='',className='')=>{const n=document.createElement(tag);n.textContent=text;n.className=className;return n;};
const svg=(tag,attrs={},text='')=>{const n=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const[k,v]of Object.entries(attrs))n.setAttribute(k,String(v));n.textContent=text;return n;};
const link=(label,href)=>{const n=el('a',label);n.href=href;n.target='_blank';n.rel='noopener noreferrer';return n;};

/** @param {object} series @param {object} model @param {number[]} domain @param {boolean} release @param {string} zone @returns {HTMLElement} Aligned small multiples; no curve fitting, carry-forward or inferred water-arrival time. */
export function releaseTrendChart(series,model,domain,release,zone,selectionKey=null){
  const figure=el('figure','','release-trend-chart');
  const time=t=>formatTime(t,zone);
  const rows=[...series.observed,...series.forecast,...(release?model.markers:[])].filter(p=>Number.isFinite(p.value)).sort((a,b)=>a.time-b.time);
  const width=400,left=55,right=382,top=30,bottom=176;
  const x=t=>left+(t-model.start)/(model.end-model.start)*(right-left),y=v=>bottom-(v-domain[0])/(domain[1]-domain[0])*(bottom-top);
  const chart=svg('svg',{viewBox:`0 0 ${width} 224`,role:'img',tabindex:rows.length?'0':'-1','aria-label':`${series.title}, ${series.units}. Use left and right arrow keys to inspect samples; exact values also appear in the data table.`});
  chart.append(svg('title',{},`${series.title} (${series.units})`));
  chart.append(svg('rect',{x:x(model.now),y:top,width:right-x(model.now),height:bottom-top,fill:'var(--chart-forecast)',opacity:'.05'}));
  for(let i=0;i<3;i++){
    const v=domain[0]+i*(domain[1]-domain[0])/2;
    chart.append(svg('line',{x1:left,x2:right,y1:y(v),y2:y(v),stroke:'var(--chart-grid)'}),svg('text',{x:left-7,y:y(v)+4,'text-anchor':'end',fill:'var(--chart-text)','font-size':14},new Intl.NumberFormat('en-US',{maximumFractionDigits:series.units==='ft'?2:0}).format(v)));
  }
  chart.append(svg('text',{x:left,y:16,fill:'var(--chart-text)','font-size':14},series.units));
  const date=new Intl.DateTimeFormat('en-US',{timeZone:zone,month:'short',day:'numeric'}),hour=new Intl.DateTimeFormat('en-US',{timeZone:zone,hour:'numeric',minute:'2-digit'});
  for(const t of [model.start,model.now,model.end]){
    const anchor=t===model.start?'start':t===model.end?'end':'middle';
    chart.append(svg('text',{x:x(t),y:198,'text-anchor':anchor,fill:'var(--chart-text)','font-size':14},date.format(t)),svg('text',{x:x(t),y:216,'text-anchor':anchor,fill:'var(--chart-text)','font-size':13},hour.format(t)));
  }
  chart.append(svg('line',{x1:x(model.now),x2:x(model.now),y1:top,y2:bottom,stroke:'var(--chart-now)','stroke-dasharray':'3 3'}),svg('text',{x:x(model.now),y:16,'text-anchor':'middle','font-size':12,fill:'var(--chart-text)'},'Now'));
  for(const notice of model.markers){
    const color=notice.current?'var(--watch)':'var(--chart-missing)';
    chart.append(svg('line',{x1:x(notice.time),x2:x(notice.time),y1:top,y2:bottom,stroke:color,'stroke-dasharray':'2 5',opacity:'.65'}));
    if(release){const px=x(notice.time),py=y(notice.value);chart.append(svg('path',{d:`M${px},${py-5} l5,5 -5,5 -5,-5 Z`,fill:'var(--chart-background)',stroke:color,'stroke-width':2}));}
  }
  for(const [points,kind]of [[series.observed,'observed'],[series.forecast,'forecast']]){
    const color=kind==='forecast'?(series.forecastCurrent?'var(--chart-forecast)':'var(--chart-missing)'):'var(--chart-observed)';
    for(const segment of trendSegments(points,kind==='forecast'?6*HOUR:2*HOUR)){
      if(!series.daily||kind==='forecast')chart.append(svg('path',{d:segment.map((p,i)=>`${i?'L':'M'}${x(p.time).toFixed(2)},${y(p.value).toFixed(2)}`).join(' '),fill:'none',stroke:color,'stroke-width':2,'stroke-dasharray':kind==='forecast'?'6 4':'none'}));
      if(series.daily||segment.length===1)for(const p of segment)chart.append(svg('circle',{cx:x(p.time),cy:y(p.value),r:3.5,fill:color}));
    }
  }
  if(!rows.length)chart.append(svg('text',{x:(left+right)/2,y:95,'text-anchor':'middle','font-size':13,fill:'var(--chart-text)'},'No valid samples in this window'));
  const readout=el('div','','trend-readout');
  const focusLine=svg('line',{y1:top,y2:bottom,stroke:'var(--chart-text)','stroke-dasharray':'1 3',visibility:'hidden'});chart.append(focusLine);
  const key=p=>`${p.kind}:${p.time}`;
  let cursor=rows.findIndex(p=>key(p)===selectionKey);if(cursor<0)cursor=Math.max(0,rows.findLastIndex(p=>p.time<=model.now));
  const describe=p=>`${p.kind==='scheduled'?'Planned release':p.kind==='NWS forecast'?`NWS forecast${series.forecastCurrent?'':' · old/unverified'}`:p.kind==='daily report'?'Daily report':'Observed'} · ${riverValue(p.value,series.units)} · ${p.kind==='daily report'?`report date ${p.reportDate} (PST)`:time(p.time)}${p.kind==='scheduled'?' · reservoir effective time'+(p.current?'':' · retained/unverified'):''}`;
  const inspect=()=>{const p=rows[cursor];if(!p)return;chart.dataset.selection=key(p);focusLine.setAttribute('x1',String(x(p.time)));focusLine.setAttribute('x2',String(x(p.time)));focusLine.setAttribute('visibility','visible');readout.textContent=describe(p);};
  if(rows.length)readout.textContent=describe(rows[cursor]);else readout.textContent='Data unavailable; gaps are not zero flow.';
  chart.addEventListener('pointermove',event=>{if(!rows.length)return;const box=chart.getBoundingClientRect(),px=(event.clientX-box.left)*width/box.width,py=(event.clientY-box.top)*224/box.height;let distance=Infinity;rows.forEach((p,i)=>{const d=Math.abs(x(p.time)-px)+Math.abs(y(p.value)-py)*.15;if(d<distance){distance=d;cursor=i;}});readout.setAttribute('aria-live','off');inspect();});
  chart.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)||!rows.length)return;event.preventDefault();cursor=event.key==='Home'?0:event.key==='End'?rows.length-1:Math.max(0,Math.min(rows.length-1,cursor+(event.key==='ArrowRight'?1:-1)));readout.setAttribute('aria-live','polite');inspect();});
  chart.addEventListener('focus',inspect);
  const caption=el('figcaption',`${release?(series.daily?'Blue dots: daily reports at the midpoint of their PST report date.':'Solid blue: reported hourly releases.'):'Solid blue: observations. Dashed purple: NWS forecast; grey dashed: old forecast.'} ${release?'Hollow diamonds: planned releases. ':''}Dotted amber guides mark reservoir schedule times, not downstream arrival. Times: ${zone}.`);
  const data=el('details','','trend-sample-data');data.append(el('summary',`Inspect chart data (${rows.length} valid samples)`));
  data.addEventListener('toggle',()=>{if(!data.open||data.children.length>1)return;const wrap=el('div','','trend-table-scroll'),table=el('table');const head=el('thead'),tr=el('tr');for(const label of ['Type','Time / report date',series.units])tr.append(el('th',label));head.append(tr);table.append(head);const body=el('tbody');for(const p of rows){const row=el('tr');row.append(el('td',p.kind==='scheduled'?'Planned':p.kind),el('td',p.kind==='daily report'?`${p.reportDate} PST`:time(p.time)),el('td',riverValue(p.value)));body.append(row);}table.append(body);wrap.append(table);data.append(wrap);});
  figure.append(chart,readout,caption,data);return figure;
}

/** @param {object} options @returns {object} Reuse live controllers; no extra polling or private storage. */
export function createReleaseTrends({config,timeZone,exercise}){
  let reservoirs={},entries=new Map(),stations=[],stationId='MIL',gaugeId='SJXC1',measure='flow',historyHours=168,futureHours=72,lastSignature='';
  const dialog=$('release-trend-dialog'),time=t=>Number.isFinite(t)?formatTime(t,timeZone):'Not supplied';
  function render(force=false){
    if(!dialog.hasAttribute('open'))return;
    const model=buildReleaseTrend({stationId,gaugeId,measure,historyHours,futureHours,reservoirs,entries,config});
    const signature=JSON.stringify([stationId,gaugeId,measure,historyHours,futureHours,reservoirs,entries.get(gaugeId),Math.floor(Date.now()/60000)]);
    if(!force&&signature===lastSignature)return;lastSignature=signature;
    const host=$('release-trend-content'),oldCharts=[...host.querySelectorAll('.release-trend-chart svg')];
    const selections=force?[]:oldCharts.map(n=>n.dataset.selection),focused=force?-1:oldCharts.indexOf(document.activeElement),expanded=force?[]:[...host.querySelectorAll('.trend-sample-data')].map(n=>n.open);
    host.replaceChildren();
    const title=el('h3',`${exercise?'EXERCISE · ':''}${model.reach.name}`);host.append(title);
    host.append(el('p',`Past ${historyHours/24} days → next ${futureHours/24} days · ${time(model.start)} → ${time(model.end)}. ${!model.gauge.id?'Release in cfs. Downstream comparison unavailable.':measure==='flow'?'Shared cfs scale for release and gauge flow.':'Gauge stage uses a separate, focused ft scale.'}`,'trend-window'));
    const columns=el('div','','release-trend-columns');
    const left=el('section');left.append(el('h4',`${stationId} · ${model.release.title}`),el('p',model.release.health,'trend-health'));
    left.append(releaseTrendChart(model.release,model,model.releaseDomain,true,timeZone,selections[0]));
    left.append(el('p',`Last reservoir collection: ${time(model.release.collected)}. Collection time is not observation time.`,'trend-source'));
    if(model.release.source)left.append(link('Official CDEC observations',model.release.source));
    const right=el('section');right.append(el('h4',`${model.gauge.id?model.gauge.id+' · ':''}${model.gauge.title}`),el('p',model.gauge.health,'trend-health'));
    if(model.gauge.id){right.append(releaseTrendChart(model.gauge,model,model.gaugeDomain,false,timeZone,selections[1]),el('p',`NWS forecast issued: ${time(model.gauge.issued)} · forecast ends: ${time(model.gauge.forecastEnd)} · station checked: ${time(model.gauge.checked)}.`,'trend-source'));if(model.gauge.source)right.append(link('Official NWS gauge',model.gauge.source));}
    else{right.append(el('p','Downstream comparison unavailable. Pine Flat outflow remains visible on the release chart; it is not a separate downstream measurement.','trend-empty'),link('USACE Kings basin hourly report','https://www.spk-wc.usace.army.mil/fcgi-bin/hourly.py?report=pnf'),el('p','Downstream travel time, diversions and distributary operations require operator confirmation.'),link('USGS 11221500 record availability','https://waterdata.usgs.gov/monitoring-location/USGS-11221500/'));}
    columns.append(left,right);host.append(columns);
    host.append(el('p',model.reach.note,'trend-context'));
    const notices=el('section','','trend-notice-section');notices.append(el('h4','Scheduled releases in the selected window'));
    notices.append(el('p',`${model.schedule.current?'Schedule checked':'Schedule requires verification'} · ${time(model.schedule.collected)}. Notice issuance time is not supplied; effective times are at the reservoir.`));
    if(!model.schedule.current)notices.append(el('p',model.schedule.reason,'watch-gap'));
    if(!model.schedule.upcoming.some(n=>n.time<=model.end))notices.append(el('p',model.schedule.current?`No upcoming notices returned through ${time(Math.min(model.end,model.schedule.windowEnd))}. This does not guarantee unchanged releases.`:'Upcoming changes are unknown while schedule data is unavailable or overdue.'));
    if(futureHours===72&&model.schedule.upcoming.some(n=>n.time>model.end))notices.append(el('p','Additional notices fall after this window. Select Next 7 days to see them.'));
    const shown=model.schedule.notices.filter(n=>n.time>=model.start&&n.time<=model.end);
    if(shown.length){const list=el('ul');for(const n of shown){const text=`${n.time>model.now?'UPCOMING':'Past effective time'} · ${time(n.time)} · ${n.valid?riverValue(n.value,'cfs'):'Amount flagged / unknown'}${n.delta===null?'':` · ${n.delta>=0?'+':''}${riverValue(n.delta,'cfs')} from previous schedule`}`;list.append(el('li',text));}notices.append(list);}
    notices.append(link('Official CDEC release notices',model.schedule.source));host.append(notices);
    host.append(el('p','Schedules can change without advance notice. These charts align source times only: they do not route releases, calculate downstream arrival, or establish safe access. Missing and flagged measurements leave gaps; no values are carried into the future.','trend-context'));
    host.querySelectorAll('.trend-sample-data').forEach((n,i)=>{n.open=!!expanded[i];});
    if(focused>=0)host.querySelectorAll('.release-trend-chart svg')[focused]?.focus({preventScroll:true});
  }
  function selectStation(id){
    stationId=TREND_REACHES[id]?id:'MIL';const options=TREND_REACHES[stationId].gauges;
    if(!options.includes(gaugeId))gaugeId=options[0]||'';
    const picker=$('trend-gauge');picker.replaceChildren();
    for(const id of options){const o=el('calcite-option',`${id} · ${stations.find(s=>s.id===id)?.name||id}`);o.setAttribute('value',id);o.toggleAttribute('selected',id===gaugeId);picker.append(o);}
    if(!options.length){const o=el('calcite-option','No connected downstream gauge');o.setAttribute('value','');o.setAttribute('selected','');picker.append(o);}
    picker.toggleAttribute('disabled',!options.length);$('trend-measure').toggleAttribute('disabled',!options.length);
    for(const o of $('trend-reservoir').children)o.toggleAttribute('selected',o.getAttribute('value')===stationId);
  }
  function open(id='MIL',preferredGauge=null){if(preferredGauge)gaugeId=preferredGauge;selectStation(id);$('river-dialog').removeAttribute('open');dialog.setAttribute('open','');render(true);}
  $('trend-reservoir').addEventListener('calciteSelectChange',e=>{selectStation(e.target.value);render(true);});
  $('trend-gauge').addEventListener('calciteSelectChange',e=>{gaugeId=e.target.value;render(true);});
  $('trend-measure').addEventListener('calciteSelectChange',e=>{measure=e.target.value;render(true);});
  $('trend-history').addEventListener('calciteSelectChange',e=>{historyHours=Number(e.target.value);render(true);});
  $('trend-future').addEventListener('calciteSelectChange',e=>{futureHours=Number(e.target.value);render(true);});
  $('open-release-trends').addEventListener('click',()=>open(stationId));
  setInterval(()=>{if(!document.hidden)render();},30000);
  const restoreRoute=()=>{const id=new URLSearchParams(location.search).get('trends');if(TREND_REACHES[id])open(id);else dialog.removeAttribute('open');};
  window.addEventListener('popstate',restoreRoute);restoreRoute();
  return {open,setReservoirData:data=>{reservoirs=data;render();},setRiverData:data=>{entries=new Map(data.entries);stations=data.stations||stations;if(dialog.hasAttribute('open'))selectStation(stationId);render();}};
}
