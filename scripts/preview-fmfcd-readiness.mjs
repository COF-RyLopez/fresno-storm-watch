import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,relative,isAbsolute,dirname} from 'node:path';
import {previewFmfcdReadiness} from './lib/fmfcd-readiness-import.mjs';
const [input,map,crosswalk,output]=process.argv.slice(2);
if(!input||!map||!crosswalk||!output)throw Error('Usage: node scripts/preview-fmfcd-readiness.mjs <private-rows.json> <mapping.json> <private-crosswalk.json> <private-output.json>');
// Site files and the repository are public. Keep intake and output outside the checkout.
const repo=resolve(import.meta.dirname,'..');
for(const file of [input,map,crosswalk,output]){const rel=relative(repo,resolve(file));if(!rel||!isAbsolute(rel)&&!rel.startsWith('..'))throw Error('Use paths outside the public repository for FMFCD intake, mapping, crosswalk and preview files.');}
const read=async file=>JSON.parse(await readFile(file,'utf8'));
const [rows,mapping,links]=await Promise.all([read(input),read(map),read(crosswalk)]),result=previewFmfcdReadiness({rows,mapping,crosswalk:links});
await mkdir(dirname(resolve(output)),{recursive:true});await writeFile(output,JSON.stringify(result,null,2)+'\n',{encoding:'utf8',flag:'wx'});
console.log(JSON.stringify({previewOnly:true,input:result.inputCount,accepted:result.counts.accepted,rejected:result.counts.rejected}));
