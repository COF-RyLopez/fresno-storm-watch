import {POWER_COLORS, POWER_STATES} from './power-model.js?v=0.16.0';

/** One visual vocabulary for map markers, utility cards and both legends. */
export const POWER_SYMBOLS = Object.freeze({
  consideration:{label:'PSPS watch',meaning:'Shutoff under consideration',shape:'clock',fill:'none',line:'dash'},
  warning:{label:'PSPS warning',meaning:'Utility warning of a possible shutoff',shape:'triangle',fill:'backward-diagonal',line:'solid'},
  psps:{label:'PSPS shutoff',meaning:'Utility reports power shut off for safety',shape:'octagon',fill:'diagonal-cross',line:'solid'},
  outage:{label:'Other reported outage',meaning:'Outage not identified as PSPS by this feed',shape:'square',fill:'solid',line:'solid'},
  restored:{label:'Utility reports restored',meaning:'Confirm power at each critical site',shape:'check',fill:'none',line:'solid'},
  cancelled:{label:'PSPS notice cancelled',meaning:'Notice cancelled; site power is not established',shape:'cancel',fill:'none',line:'dot'},
  unknown:{label:'Status unknown',meaning:'Verify with the utility',shape:'question',fill:'diagonal-cross',line:'dash'}
});

/** @param {string} status @returns {string} Unknown future statuses never imply restoration. */
const knownStatus = status => Object.hasOwn(POWER_SYMBOLS,status) ? status : 'unknown';
const dataUri = svg => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

/** @param {string} status @param {boolean} retained @returns {string} Distinct shape and glyph; clock badge preserves last reported state. */
export function powerMarkerUrl(status, retained=false) {
  status=knownStatus(status);
  const c=POWER_COLORS[status],s=POWER_SYMBOLS[status].shape;
  const shapes={
    clock:'<circle cx="16" cy="16" r="11"/>',
    triangle:'<path d="M16 3 30 28H2Z"/>',
    octagon:'<path d="M10 3H22L29 10V22L22 29H10L3 22V10Z"/>',
    square:'<rect x="4" y="4" width="24" height="24" rx="3"/>',
    check:'<circle cx="16" cy="16" r="11"/>',
    cancel:'<rect x="5" y="5" width="22" height="22" rx="2"/>',
    question:'<path d="M16 2 30 16 16 30 2 16Z"/>'
  };
  const glyphs={
    clock:'<path d="M16 9v7l5 3"/>',
    triangle:'<path d="M16 11v8m0 4v.3"/>',
    octagon:'<path d="M16 7v9m-5-5a8 8 0 1 0 10 0"/>',
    square:'<path d="m18 7-8 11h6l-2 7 9-12h-7Z" fill="currentColor" stroke-width="1"/>',
    check:'<path d="m10 16 4 4 8-9"/>',
    cancel:'<path d="m11 11 10 10m0-10L11 21"/>',
    question:'<path d="M12 12a4 4 0 0 1 8 0c0 3-4 3-4 6m0 5v.3"/>'
  };
  const hollow=['consideration','restored','cancelled'].includes(status);
  const badge=retained?'<g transform="translate(25 25)"><circle r="7" fill="#24313b" stroke="white" stroke-width="1.5"/><path d="M0-4v4l3 2" fill="none" stroke="white" stroke-width="1.7"/></g>':'';
  return dataUri(`<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="-2 -2 36 36"><g fill="${hollow?'#17252e':c}" stroke="#17252e" stroke-width="5">${shapes[s]}</g><g fill="${hollow?'#17252e':c}" stroke="${hollow?c:'#fff'}" stroke-width="2">${shapes[s]}</g><g fill="none" color="${hollow?c:'#17252e'}" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${glyphs[s]}</g>${badge}</svg>`);
}

/** @param {object} row @returns {object} A failed retrieval marks retained evidence without changing utility status. */
export function powerMapStyle(row) {
  const status=knownStatus(row.status),spec=POWER_SYMBOLS[status],color=POWER_COLORS[status],retained=!!row.health;
  return {status,label:POWER_STATES[status],retained,
    point:{type:'picture-marker',url:powerMarkerUrl(status,retained),width:26,height:26},
    area:{type:'simple-fill',color:spec.fill==='solid'?`${color}38`:`${color}b3`,style:spec.fill,
      outline:{color:retained?'#c3c9d0':color,width:retained?3:2,style:retained?'dash-dot':spec.line}}
  };
}

/** @param {string} status @returns {string} Match ArcGIS area fill and boundary conventions in the HTML legend. */
export function powerAreaUrl(status) {
  status=knownStatus(status);const s=POWER_SYMBOLS[status],c=POWER_COLORS[status];
  const pattern=s.fill==='diagonal-cross'?'<path d="M0 0 8 8M8 0 0 8"/>':'<path d="M-2 2 2-2M0 8 8 0M6 10 10 6"/>';
  const fill=s.fill==='none'?'none':s.fill==='solid'?`${c}38`:'url(#h)';
  return dataUri(`<svg xmlns="http://www.w3.org/2000/svg" width="42" height="28" viewBox="0 0 42 28"><defs><pattern id="h" width="8" height="8" patternUnits="userSpaceOnUse"><g stroke="${c}" stroke-width="1.3">${pattern}</g></pattern></defs><rect x="3" y="3" width="36" height="22" rx="2" fill="${fill}" stroke="${c}" stroke-width="2"${s.line==='dash'?' stroke-dasharray="6 3"':s.line==='dot'?' stroke-dasharray="2 3"':''}/></svg>`);
}

/** @param {HTMLElement} host @returns {void} Same examples appear in the power workspace and map key. */
export function renderPowerLegend(host) {
  host.replaceChildren();
  const heading=document.createElement('p');heading.className='power-key-heading';heading.textContent='Utility-reported power · point / area';host.append(heading);
  const grid=document.createElement('div');grid.className='power-key-grid';
  for(const [status,spec] of Object.entries(POWER_SYMBOLS)){
    const item=document.createElement('div');item.className='power-key-item';
    const point=document.createElement('img');point.src=powerMarkerUrl(status);point.alt='';point.width=32;point.height=32;
    const area=document.createElement('img');area.src=powerAreaUrl(status);area.alt='';area.width=42;area.height=28;
    const label=document.createElement('div'),strong=document.createElement('strong'),small=document.createElement('small');strong.textContent=spec.label;small.textContent=spec.meaning;label.append(strong,small);item.append(point,area,label);grid.append(item);
  }
  const note=document.createElement('p');note.className='power-key-note';
  const clock=document.createElement('img');clock.src=powerMarkerUrl('outage',true);clock.alt='Outage symbol with a clock badge';clock.width=28;clock.height=28;
  note.append(clock,document.createTextNode('Clock badge / gray dash-dot boundary: source check failed or overdue. The symbol retains the last reported status. Areas are approximate; points do not show the full outage footprint.'));
  host.append(grid,note);
}
