/** Display hierarchy only; never a connectivity, hazard or operating-state rule. */
export const OVERVIEW_NAMES=new Set(['san joaquin river','kings river','fresno slough','james bypass','san luis canal','delta-mendota canal','friant-kern canal','fresno canal','enterprise canal','gould canal','fancher creek','big dry creek','little dry creek','los gatos creek','cantua creek','panoche creek']);
export const normalizedName=name=>String(name??'').trim().replace(/\s+/g,' ').toLocaleLowerCase('en-US');
export function waterwayRole({name,kind}){
  if(kind===3)return 'drainageway';
  if(kind===2||/\b(canal|ditch)\b/i.test(name??''))return 'canal';
  if(kind===1||(kind===5&&/\briver\b/i.test(name??'')))return 'river';
  return 'connector';
}
export const overviewRank=properties=>OVERVIEW_NAMES.has(normalizedName(properties.name))?0:1;
