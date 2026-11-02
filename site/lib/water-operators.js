/** Who owns / operates water-control features: dams (USACE NID), levees (USACE NLD) and dam-failure inundation areas
 * (Cal OES copy of DSOD-approved maps). Public reference data; not duty contacts and not current operating status. */
export const DAMS_URL='https://services2.arcgis.com/FiaPA4ga0iQKduv3/arcgis/rest/services/NID_v1/FeatureServer/0';
export const LEVEES_URL='https://services2.arcgis.com/FiaPA4ga0iQKduv3/arcgis/rest/services/NLD2_PUBLIC_v1/FeatureServer/14';
export const DISTRICTS_URL='https://utility.arcgis.com/usrsvcs/servers/538bfc2e4ad64ff78ff18fbb8ca36033/rest/services/Boundaries/i03_WaterDistricts/MapServer/0';
/** DWR i03 also holds small drinking-water systems (apartments, schools, parks) from CDPH / SWRCB; they are not the irrigation,
 * water and flood agencies this layer is for. The SWRCB spellings are as published. */
export const DISTRICTS_WHERE="SOURCE NOT IN ('CDPH','SWRCB','SWCRB','SWRCBO','Copid from SWRCB')";
/** @param {string} name DWR AGENCYNAME @returns {string} Tidy display name: trims stray whitespace/line breaks and "Fresno  City Of" -> "Fresno, City of". */
export const districtName=name=>String(name||'').replace(/\s+/g,' ').trim().replace(/^(.*?) City Of$/i,'$1, City of');
export const INUNDATION_URL='https://services.arcgis.com/BLN4oKB0N1YSgvY8/arcgis/rest/services/DSOD_Approved_Inundation_Boundaries_View/FeatureServer/0';
/** Fresno County plus the reservoirs upstream of it (Madera side of Millerton, upper San Joaquin and Kings). */
export const REGION=Object.freeze({xmin:-121.0,ymin:35.9,xmax:-118.3,ymax:37.6});
/** Public NID leaves private owner names blank. The large private dams here are utility hydro systems; the licensee is
 * the operator. ponytail: name patterns for this county's hydro systems only; extend if other private dams matter. */
const HYDRO_LICENSEES=Object.freeze([
  [/^(big creek|florence lake|huntington lake|shaver lake|mammoth pool|vermilion valley|balsam meadow|portal|mono creek|bear creek diversion)/i,'Southern California Edison','Big Creek hydroelectric system'],
  [/^(wishon|courtright|balch|kerckhoff|crane valley)/i,'Pacific Gas and Electric','Kings River / San Joaquin hydroelectric system']
]);
/** @param {object} a NID attributes @returns {{operator:string,basis:string}} */
export function damOperator(a){
  const fed=String(a?.FED_AGENCY_OPERATIONS||'').trim();
  if(fed)return {operator:fed,basis:'National Inventory of Dams (federal operator)'};
  const hit=HYDRO_LICENSEES.find(([re])=>re.test(String(a?.NAME||'')));
  if(hit)return {operator:hit[1],basis:`Hydropower licensee · ${hit[2]} (verify with the utility)`};
  return {operator:'Not listed',basis:`Public NID omits non-federal owner names${a?.PRIMARY_OWNER_TYPE?` · owner type: ${a.PRIMARY_OWNER_TYPE}`:''}`};
}
/** @param {object} a NLD system attributes @returns {{sponsors:string[],roles:string[],listed:boolean}} Names and roles as published; NLD lists
 * them separately and their counts do not always match, so they are shown side by side rather than paired. */
export function leveeSponsors(a){
  const split=(v,sep)=>String(v||'').split(sep).map(s=>s.trim()).filter(Boolean);
  const sponsors=split(a?.SPONSORS,',').filter(s=>!/^(undefined|unknown)$/i.test(s));
  return {sponsors,roles:split(a?.SPONSOR_ROLE,';'),listed:sponsors.length>0};
}

const norm=s=>String(s||'').toLowerCase().replace(/\bdam\b/g,'').replace(/[^a-z0-9]+/g,' ').trim();
/** The app's prepared dam-failure scenarios (data/flood-scenarios/index.json) for a dam, by name.
 * "Big Dry Creek Dam spillway failure (hypothetical)" belongs to "Big Dry Creek"; works for NID and DSOD dam names.
 * @param {string} damName @param {{id:string,label:string}[]} scenarios @returns {{id:string,label:string,variant:string}[]} */
export function scenariosFor(damName,scenarios){
  const want=norm(damName);if(!want)return [];
  return (scenarios||[]).flatMap(s=>{
    const text=String(s.label||'').replace(/\s*\(hypothetical\)\s*$/i,'').replace(/\s+failure$/i,'');
    const base=text.replace(/(\s+dam\b.*|\s+spillway.*|\s+outlet.*)$/i,'');
    if(norm(base)!==want)return [];
    const rest=text.slice(base.length).replace(/^\s*dam\b/i,'').trim();
    return [{id:s.id,label:s.label,variant:rest?rest[0].toUpperCase()+rest.slice(1):'Main dam'}];
  });
}
