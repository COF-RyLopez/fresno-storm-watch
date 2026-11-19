/** Source text is reorganized for reading; quantities, impacts and instructions remain NWS wording. */
const clean = value => typeof value === 'string' ? value.replace(/\s+/g,' ').trim() : '';
const headings = /^\s*\*?\s*(WHAT|WHERE|WHEN|IMPACTS?|HAZARD|SOURCE|ADDITIONAL DETAILS|PRECAUTIONARY\/PREPAREDNESS ACTIONS)\.{3,}\s*/gm;
const tagNames = {
  flashFloodDamageThreat:'Flash-flood damage threat', thunderstormDamageThreat:'Thunderstorm damage threat',
  tornadoDetection:'Tornado source', flashFloodDetection:'Flash-flood source', snowSquallDetection:'Snow-squall source',
};

function corridors(text) {
  const routes = new Map();
  const pattern = /\b(interstates?|i(?=[-\s]\d)|u\.?s\.?(?:\s+(?:highways?|routes?))?|state\s+(?:routes?|highways?)|sr|ca|highways?|hwy)\s*[-–]?\s*(\d{1,3}(?:(?:\s*,\s*(?:and\s+)?|\s+and\s+)\d{1,3})*)\b/gi;
  for (const match of text.matchAll(pattern)) {
    const prefix = match[1].toLowerCase();
    const family = /^(?:interstate|i\b)/.test(prefix) ? 'interstate' : /^u/.test(prefix) ? 'us'
      : /^(?:state|sr|ca)/.test(prefix) ? 'state' : 'highway';
    const numbers = match[2].match(/\d+/g);
    const following = text.slice(match.index + match[0].length);
    // A comma after the road can introduce distance, time or a weather quantity.
    if (numbers.length > 1 && /^(?:\.\d+)?\s*(?:(?:to|[-–])\s*\d+(?:\.\d+)?\s*)?(?:miles?\b|mi\b|km\b|kilometers?\b|feet\b|ft\b|meters?\b|mph\b|knots?\b|hours?\b|minutes?\b|inches?\b|[ap]\.?m\b|percent\b|%|:\d{2}\b)/i.test(following)) numbers.pop();
    if (numbers.length > 1 && !/\b(?:routes|highways|interstates)\b/.test(prefix) && !/\band\b/.test(match[2])) numbers.splice(1);
    for (const number of numbers) {
      const label = (family === 'interstate' ? 'I-' : family === 'us' ? 'US ' : family === 'state' ? 'SR ' : 'Highway ') + Number(number);
      routes.set(family + ':' + Number(number), {family, number:Number(number), label});
    }
  }
  return [...routes.values()];
}

export function nwsGuidance(alert) {
  const text = typeof alert.description === 'string' ? alert.description : '';
  const matches = [...text.matchAll(headings)], sections = {};
  for (const [index, match] of matches.entries()) {
    const key = match[1] === 'IMPACT' ? 'IMPACTS' : match[1];
    const body = clean(text.slice(match.index + match[0].length, matches[index+1]?.index));
    sections[key] = [sections[key], body].filter(Boolean).join(' ');
  }
  return {
    publisher:clean(alert.office) || 'NWS', issued:Number.isFinite(alert.issued) ? alert.issued : null,
    what:sections.WHAT || sections.HAZARD || clean(alert.headline) || clean(alert.type),
    where:sections.WHERE || clean(alert.area), when:sections.WHEN || '',
    impacts:sections.IMPACTS || '', source:sections.SOURCE || '', instruction:clean(alert.instruction),
    tags:Object.entries(tagNames).flatMap(([key,label]) => {
      const values = alert.parameters?.[key];
      return Array.isArray(values) ? [...new Set(values.filter(value => typeof value === 'string').map(clean))]
        .filter(Boolean).map(value => ({label,value})) : [];
    }),
    corridors:corridors(text),
  };
}

/** Exact route identity in the prepared county street index, with ramps excluded from corridor emphasis. */
export function citedRoadEntries(entries, routes) {
  return entries.flatMap(entry => {
    if (entry.kind !== 'street' || /\b(?:on|off|onramp|offramp|ramp)\b/i.test(entry.name)) return [];
    const named = corridors([entry.name,...(entry.aliases || [])].join(' '));
    return routes.filter(route => named.some(road => road.number === route.number &&
      (road.family === route.family || route.family === 'highway' || road.family === 'highway' &&
        !named.some(other => other.number === route.number && other.family !== 'highway' && other.family !== route.family))))
      .map(route => ({entry,route}));
  });
}
