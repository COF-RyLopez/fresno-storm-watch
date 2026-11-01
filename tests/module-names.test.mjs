import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';

// Refactors move imports; a dropped import of a constant object only fails when that code path runs.
const BUILTINS=new Set(['JSON','URL','CSS','NaN','DOMException','DOMParser']);
const code=s=>s.replace(/\/\*[\s\S]*?\*\/|(?<![:\\])\/\/.*$/gm,'').replace(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g,'""');

test('every UPPER_CASE constant a site module uses is declared or imported there',async()=>{
  const missing=[];
  for(const dir of ['../site/','../site/lib/']){
    const base=new URL(dir,import.meta.url);
    for(const name of (await readdir(base)).filter(n=>n.endsWith('.js'))){
      const source=await readFile(new URL(name,base),'utf8'),body=code(source);
      for(const id of new Set(body.match(/(?<![\w.$])[A-Z][A-Z0-9_]{2,}(?=\s*(?:\?\.|[.[(]))/g))){
        if(BUILTINS.has(id))continue;
        const known=[`\\b(?:const|let|var)\\s+(?:[^=;]*?[\\s{,])?${id}\\s*[=,}]`,`\\b(?:function|class)\\s+${id}\\b`,`\\bimport\\s*\\{[^}]*\\b${id}\\b`,`\\bas\\s+${id}\\b`,`\\bimport\\s+${id}\\b`,`,\\s*${id}\\s*=`].some(p=>new RegExp(p).test(source));
        if(!known)missing.push(`${dir.slice(3)}${name}: ${id}`);
      }
    }
  }
  assert.deepEqual(missing,[]);
});
