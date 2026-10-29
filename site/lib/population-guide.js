import {POPULATION_SOURCES,POPULATION_METHOD,POPULATION_LIMIT} from './population-model.js?v=0.66.0';
import {CARE_SOURCES} from './care-model.js?v=0.56.0-r1';
import {PIO_GUIDANCE} from './acs-model.js?v=0.65.0-r1';
const el=(tag,text='')=>{const n=document.createElement(tag);n.textContent=text;return n;};
const link=(text,url)=>{const a=el('a',text);a.href=url;a.target='_blank';a.rel='noopener noreferrer';return a;};
export function populationSourceGuide(){
  const box=el('details');box.id='pio-source-guide';box.append(el('summary','Where the zone population information comes from'));
  box.append(el('p','The county Population Map and its Population Density Map are published under the ArcGIS account COF_EOC_PROD (item ownership checked October 28, 2026). This identifies the publishing account; an individual analyst is not identified in those item descriptions.'),link('Original county Population Map',POPULATION_SOURCES.countyMap),el('br'),link('County Population Density Map · source layers',POPULATION_SOURCES.countyWebMap));
  box.append(el('p','Underlying counts: U.S. Census Bureau 2020 P.L. 94-171 data, distributed by Esri as California Census 2020 Redistricting Blocks under esri_demographics. County evacuation boundaries and published status come from Fresno County’s separate evacuation layer.'),link('Esri Census block item & methods',POPULATION_SOURCES.blocksItem),el('br'),link('County evacuation-zone item',CARE_SOURCES.zoneItem));
  box.append(el('p','The approximate number inside a selected zone is calculated by F.R.O.G.; it is not a zone population figure published by the original county viewer. '+POPULATION_METHOD),el('p',POPULATION_LIMIT));
  box.append(el('p','The newer Living Atlas ACS data is whole-tract context with 90% margins of error. Its age, language and household estimates are not allocated to individual zones or buildings. ACS sampling margins do not describe the uncertainty of the separate 2020 area allocation.'),link('Current Living Atlas ACS population source',POPULATION_SOURCES.acsItem));
  box.append(el('p','For current applicability: verify the zone name and map boundary with the county’s authorized source; record who confirmed it and when. A query time is not an order’s issue time. Lifted, missing or failed records do not establish safe access. Language preferences, delivery needs and community partners require local confirmation.'));
  box.append(link('Cal OES accessible emergency communications',PIO_GUIDANCE.communication),el('br'),link('Cal OES AFN Library · communications resources','https://www.caloes.ca.gov/office-of-the-director/policy-administration/access-functional-needs/afn-library/'),el('br'),link('CalAlerts translated templates',PIO_GUIDANCE.templates));return box;
}
