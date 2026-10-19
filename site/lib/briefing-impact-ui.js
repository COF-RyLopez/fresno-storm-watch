import {validateBriefingImpacts,briefingImpacts} from './briefing-impact-model.js?v=0.21.0';
import {HNX_BRIEFING_PAGE} from './briefing-model.js';
const el=(tag,text='')=>{const n=document.createElement(tag);n.textContent=text;return n;};
/** @param {object} options @returns {object} Read-only planning context; never mutates attention counts, assignments or private records. */
export function createBriefingImpactView({exercise=false,onOpen}){
  const host=document.getElementById('briefing-impacts'),block=document.getElementById('briefing-impact-block');
  let register=null,snapshot=null,error=null,signature='';
  function render(){
    const model=briefingImpacts(register,snapshot),key=JSON.stringify({model,error,exercise});if(key===signature)return;signature=key;
    host.replaceChildren();block.description=exercise?'Live briefing context disabled':model.unreviewed?'New public revision · summary review needed':`${model.rows.filter(r=>r.period!=='past').length} dated outlooks · separate from area-review counts`;
    const status=el('calcite-notice');status.open=true;status.width='full';status.kind=model.unreviewed||error||model.missing?'warning':'info';status.icon='information';
    const title=el('span',exercise?'Fictional exercise · live summaries hidden':error?'Briefing summaries unavailable':model.unreviewed?'New public briefing needs Fresno impact review':model.missing?'Public briefing identity unavailable':'Fresno planning context · NWS Hanford');title.slot='title';
    const note=el('span',exercise?'Read live briefings in the live workspace.':error|| (model.unreviewed?'The public PDF changed. Its previous summary is withheld; dated partner context below is separate. Read the new source before using it.':model.missing?'Current public summaries are withheld until the document revision is verified. Any partner context below is a dated archive.':'Regional forecasts applied as county review prompts, not predicted impacts at individual sites. Check dates and source qualifications.'));note.slot='message';status.append(title,note);host.append(status);
    const source=el('a','Current NWS Hanford source ↗');source.href=HNX_BRIEFING_PAGE;source.target='_blank';source.rel='noopener noreferrer';host.append(source);
    if(exercise)return;
    const outlooks=el('calcite-accordion');outlooks.scale='s';host.append(outlooks);
    for(const row of model.rows){
      const outlook=el('calcite-accordion-item');outlook.heading=row.area;outlook.description=`${row.status} · ${row.overview}`;
      const card=el('article');card.className='briefing-impact';card.append(el('p',row.status));card.lastChild.className='briefing-impact-status';
      const facts=el('dl');
      for(const [name,value] of [['NWS outlook',row.impact],['Timing',row.timing],['Confidence',row.confidence],['Probability',row.probability]])facts.append(el('dt',name),el('dd',value));card.append(facts);
      if(row.qualification){const p=el('p',row.qualification);p.className='briefing-impact-qualification';card.append(p);}
      if(row.period==='past')card.append(el('p','Past-period context only. Do not use this as a current prepositioning cue.'));
      const evidence=el('calcite-accordion'),item=el('calcite-accordion-item');evidence.scale='s';item.heading='Prepositioning review & scope';
      item.append(el('p',row.planning),el('p','County planning prompt · app interpretation, not an NWS resource recommendation or county-approved assignment.'),el('p',row.geography),el('p',row.limitation));evidence.append(item);card.append(evidence);
      const citation=el('p',`${row.document.label} · page ${row.page}`);citation.className='briefing-impact-citation';card.append(citation);
      const button=el('calcite-button',`Read source · page ${row.page}`);button.scale='s';button.appearance='outline';button.iconStart='file-text';button.onclick=()=>onOpen(row.document.kind,row.page,row.document.sha256);card.append(button);
      const link=el('a',row.document.kind==='archive'?'Saved partner PDF ↗':'NWS public PDF ↗');link.href=row.document.sourcePdf+'#page='+row.page;link.target='_blank';link.rel='noopener noreferrer';card.append(link);
      if(row.document.kind==='latest')card.append(el('small','Publisher link can change. The in-app source button opens the checked PDF revision.'));
      outlook.append(card);outlooks.append(outlook);
    }
    host.append(el('small','These summaries do not change official alert or area-review counts, establish flood thresholds, or confirm resource placement. No new risk boundaries are drawn.'));
  }
  if(!exercise)void(async()=>{try{const response=await fetch('./data/hanford-briefing-impacts.json?v=0.21.0',{credentials:'omit',signal:AbortSignal.timeout(15_000)});if(!response.ok)throw new Error(`Summary register HTTP ${response.status}`);register=validateBriefingImpacts(await response.json());}catch(e){error=e.message;}render();})();
  render();return {update:value=>{snapshot=value;render();}};
}
