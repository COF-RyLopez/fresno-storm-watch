/**
 * Cache keys for the static site: one generated import map per page, keyed by file content.
 *
 * Modules import each other with plain relative specifiers ('./map.js'). Each page carries an
 * import map that points every module it can reach at '<path>?v=<content hash>', and its own
 * <script src> / <link href> tags get the same treatment. A changed file therefore gets a new
 * URL on every page that uses it, and nothing else changes. Vendor files are versioned by path.
 *
 * Run `npm run build:import-map` after editing site JS/CSS; tests fail while a page is stale.
 */
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const SITE=new URL('../site/',import.meta.url);
const SPECIFIER=/(?:\bfrom\s*|\bimport\s*\(?\s*)(['"])(\.{1,2}\/[^'"?]+)(\?[^'"]*)?\1/g;
const ASSET=/\b(src|href)="(\.\/[^"?]+\.(?:m?js|css))(?:\?v=[^"]*)?"/g;
const MAP=/<script type="importmap">[\s\S]*?<\/script>\n?/;
const local=url=>url.href.startsWith(SITE.href)&&!url.pathname.includes('/vendor/')&&/\.m?js$/.test(url.pathname);
const key=url=>'./'+url.href.slice(SITE.href.length);
const hashes=new Map();
const hash=async url=>{if(!hashes.has(url.href))hashes.set(url.href,createHash('sha256').update(await readFile(url)).digest('hex').slice(0,10));return hashes.get(url.href);};

/** @returns {Promise<URL[]>} Every first-party module reachable from the entry modules, sorted. */
async function reachable(entries){
  const seen=new Map(),queue=[...entries];
  while(queue.length){
    const url=queue.pop();if(seen.has(url.href))continue;seen.set(url.href,url);
    for(const [,,spec] of (await readFile(url,'utf8')).matchAll(SPECIFIER)){const next=new URL(spec,url);if(local(next))queue.push(next);}
  }
  return [...seen.values()].sort((a,b)=>a.href.localeCompare(b.href));
}

const cspHash=text=>`'sha256-${createHash('sha256').update(text).digest('base64')}'`;
const CSP=/(http-equiv="Content-Security-Policy" content="[^"]*?script-src)([^;"]*)/;
/** A page CSP that forbids inline scripts admits exactly its own import map, by hash. */
function allowMap(html,previous,next){
  return html.replace(CSP,(_,head,sources)=>{let list=sources.split(' ').filter(Boolean);if(previous)list=list.filter(s=>s!==cspHash(previous));if(next)list.push(cspHash(next));return head+' '+list.join(' ');});
}

/** @param {string} html @returns {Promise<string>} The page with current asset keys and import map. */
export async function renderPage(html){
  const previous=html.match(/<script type="importmap">([\s\S]*?)<\/script>/)?.[1];
  html=allowMap(html.replace(MAP,''),previous,null);
  const assets=[...html.matchAll(ASSET)].map(m=>m[2]);
  const keyed=new Map();for(const path of assets)keyed.set(path,await hash(new URL(path,SITE)));
  html=html.replace(ASSET,(_,attr,path)=>`${attr}="${path}?v=${keyed.get(path)}"`);
  const entries=[...html.matchAll(/<script type="module" src="(\.\/[^"?]+)/g)].map(m=>new URL(m[1],SITE));
  if(!entries.length)return html;
  const modules=await reachable(entries),lines=[];
  for(const url of modules)lines.push(`${JSON.stringify(key(url))}:${JSON.stringify(`${key(url)}?v=${await hash(url)}`)}`);
  const text=`\n{"imports":{\n${lines.join(',\n')}\n}}\n`;
  html=allowMap(html,null,text);
  const at=html.indexOf('<script type="module"');
  return html.slice(0,at)+`<script type="importmap">${text}</script>\n`+html.slice(at);
}

/** @returns {Promise<{file:URL,current:string,expected:string}[]>} Every site page and its generated form. */
export async function pages(){
  const names=(await readdir(SITE)).filter(n=>n.endsWith('.html')).sort();
  return Promise.all(names.map(async n=>{const file=new URL(n,SITE),current=await readFile(file,'utf8');return {file,current,expected:await renderPage(current)};}));
}

/** @returns {Promise<string[]>} Site JS files whose first-party imports carry a cache key (stripped when write). */
export async function keyedSpecifiers({write=false}={}){
  const keyed=[];
  for(const dir of ['','lib/'])for(const n of await readdir(new URL(dir,SITE))){
    if(!/\.m?js$/.test(n))continue;
    const file=new URL(dir+n,SITE),source=await readFile(file,'utf8');
    const next=source.replace(SPECIFIER,(m,q,spec,query)=>query&&local(new URL(spec,file))?m.replace(spec+query,spec):m);
    if(next!==source){keyed.push(key(file));if(write)await writeFile(file,next);}
  }
  return keyed;
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
  const stripped=(await keyedSpecifiers({write:true})).length;let written=0;
  for(const p of await pages())if(p.current!==p.expected){await writeFile(p.file,p.expected);written++;}
  console.log(JSON.stringify({specifierFilesStripped:stripped,pagesUpdated:written}));
}
