/** County-provided service identifiers and field mappings only. No asset records or credentials are bundled. */
export const FACILITY_PRESETS = Object.freeze([
  {id:'facilities',title:'County facility points',kind:'County facility',family:'county-buildings',
    url:'https://services3.arcgis.com/ibgDyuD2DLBge82s/arcgis/rest/services/FacilityPoints_Exp_Lim/FeatureServer',
    fields:{id:'GlobalID',name:'FacilityPoints_COPY_BUILDINGDES',owner:'FacilityPoints_COPY_DEPARTMENT',reference:'FacilityPoints_COPY_BUILDING_NU',status:'FacilityPoints_COPY_BUILDINGSTA'},
    note:'Restricted AGOL point inventory. Department is source context, not a confirmed follow-up assignment. No backup-power or per-record date field is exposed.'},
  {id:'footprints',title:'County building footprints (alternate)',kind:'County building footprint',family:'county-buildings',
    url:'https://services3.arcgis.com/ibgDyuD2DLBge82s/arcgis/rest/services/County_Building_Footprints_Reader_View_V2/FeatureServer',
    fields:{id:'GlobalID',name:'locationName',reference:'buildingNumber',status:'isInactive'},
    note:'Alternate polygon inventory. Kept separate from facility points to avoid double-counting representations. isInactive is retained as source text; confirm code meanings with the owner.'},
  {id:'generators',title:'County generator / fuel assets',kind:'Generator / fuel asset',family:'county-fuel-assets',
    url:'https://gisprod10.co.fresno.ca.us/server/rest/services/Hosted/Fuel_Stoage_Generator_tanks/FeatureServer',
    fields:{id:'globalid',name:'loc_name',reference:'tank_id',assetType:'user_asset_type',updated:'last_edited_date'},
    note:'County Enterprise sign-in required. These are separate generator/fuel asset records, not confirmed backup systems for the facility inventory. Tank size does not establish fuel available, runtime or generator capacity.'}
]);

export const COUNTY_ASSET_REFERENCES = Object.freeze([
  {title:'Generator / fuel-storage inventory',url:'https://gisprod10.co.fresno.ca.us/server/rest/services/Hosted/Fuel_Stoage_Generator_tanks/FeatureServer',note:'Available in the county inventory selector. A fuel asset does not establish that a nearby facility has working backup power.'},
  {title:'Special Districts pump/asset inventory',url:'https://gisprod10.co.fresno.ca.us/server/rest/services/Hosted/SD_Assets_for_OSHA/FeatureServer/0',note:'Reference pending a maintained asset ID and pump classification. The current schema has only ObjectID, name, notes and editor tracking; names are not established stable IDs. Contains mixed infrastructure, not only pumps.'},
  {title:'Ponding basins',url:'https://gisprod10.co.fresno.ca.us/server/rest/services/PublicWorks/PWP_FMFCD_BASINS/MapServer',note:'Hydrologic context, not a pump or generator inventory. Electrical dependencies need operator confirmation.'},
  {title:'County SD, Road Yard and Parks web map',url:'https://gisportal.co.fresno.ca.us/portal/home/item.html?id=92da47a98f044096a167f8e31b0e6dee',note:'County Enterprise reference; parks and road yards are not assumed approved shelters or staging sites.'}
]);
