import test from 'node:test';
import assert from 'node:assert/strict';
import {readdir,readFile} from 'node:fs/promises';
const root=new URL('../site/',import.meta.url),legacy=new URL('lib/map.js',root).href;
const files=(await Promise.all(['','lib/'].map(async prefix=>(await readdir(new URL(prefix,root))).filter(name=>name.endsWith('.js')).map(name=>new URL(prefix+name,root))))).flat();
const source=new Map(await Promise.all(files.map(async url=>[url.href,await readFile(url,'utf8')])));
// Local literal static/lazy imports are the relevant boundary; computed remote
// SDK imports remain lazy and are exercised separately in browser checks.
const graph=new Map([...source].map(([url,text])=>[url,[...text.matchAll(/(?:\bfrom\s*|\bimport\s*\()\s*['"]([^'"]+)['"]/g)]
 .map(m=>m[1]).filter(path=>path.startsWith('.')).map(path=>new URL(path.split('?')[0],url).href)]));
function reaches(start,target,seen=new Set()){
 if(start===target)return true;if(seen.has(start))return false;seen.add(start);
 return (graph.get(start)||[]).some(next=>reaches(next,target,seen));
}
test('SDK-only consumers cannot pull in the legacy map controller, including through lazy imports',()=>{
 const clients=[...source].filter(([url,text])=>url!==legacy&&url!==new URL('lib/sdk.js',root).href&&/\bloadSdk\b/.test(text));
 assert(clients.length>=26,'retain coverage of both specialist pages and layer controllers');
 for(const [url] of clients)assert.equal(reaches(url,legacy),false,new URL(url).pathname+' must load the SDK independently');
});
test('terrain/pilot lazy dependency path cannot close the old legacy-map cycle',()=>{
 assert.equal(reaches(new URL('lib/watch-terrain-map.js',root).href,legacy),false);
 assert.equal(reaches(new URL('app.js',root).href,legacy),true,'the legacy front door still deliberately owns its map');
});
