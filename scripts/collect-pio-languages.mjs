import {writeFile,rename} from 'node:fs/promises';
import {B16001,validateLanguageAreas} from '../site/lib/afn-model.js';
// ACS 5-year detailed language table, published for PUMAs, not tracts or counties. Annual; rerun when a new period is released.
const period=process.argv[2]||'2024',url=`https://www2.census.gov/programs-surveys/acs/summary_file/${period}/table-based-SF/data/5YRData/acsdt5y${period}-b16001.dat`;
const output=new URL('../site/data/acs-b16001-fresno.json',import.meta.url),temp=new URL('../site/data/acs-b16001-fresno.tmp',import.meta.url);
const r=await fetch(url,{signal:AbortSignal.timeout(60000)});if(!r.ok)throw Error('Census summary file HTTP '+r.status);
const [header,...lines]=(await r.text()).trim().split('\n'),columns=header.split('|');
const value=(cells,name)=>{const i=columns.indexOf(name);if(i<0)throw Error('B16001 column missing: '+name);const n=Number(cells[i]);return cells[i]!==''&&Number.isFinite(n)&&n>=0?n:null;};
const measure=(cells,n)=>({estimate:value(cells,`B16001_E${n}`),moe:value(cells,`B16001_M${n}`)});
const rows=lines.map(l=>l.split('|')).filter(c=>/^795P200US06019\d{2}$/.test(c[0])).map(c=>({puma:c[0].slice(-7),...Object.fromEntries(Object.entries(B16001).map(([key,n])=>[key,measure(c,n)]))}));
const snapshot=validateLanguageAreas({schemaVersion:1,table:'B16001',period:`${Number(period)-4}–${period}`,source:url,collected:new Date().toISOString().slice(0,10),rows});
await writeFile(temp,JSON.stringify(snapshot,null,1)+'\n','utf8');await rename(temp,output);
console.log(JSON.stringify({event:'pio-language-collection',period:snapshot.period,pumas:rows.length}));
