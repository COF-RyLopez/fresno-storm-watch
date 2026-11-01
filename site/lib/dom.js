/** Shared one-line DOM builders. Publisher values are always textContent, never HTML. The variants differ on purpose (empty class attribute, when text is written, property vs attribute, onclick vs listener): keep each caller on the exact one it used. */
export const el=(tag,text='')=>{const n=document.createElement(tag);n.textContent=text;return n;};
/** Always writes className, so an empty class still renders class="". */
export const elClass=(tag,text='',cls='')=>{const n=document.createElement(tag);n.textContent=text;n.className=cls;return n;};
/** Writes text only when it is not undefined. */
export const node=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
/** Writes text only when it is truthy. */
export const elIfText=(tag,text)=>{const n=document.createElement(tag);if(text)n.textContent=text;return n;};
/** Attributes are safe before custom-element upgrade: false/null are skipped, true writes an empty attribute. */
export const elAttrs=(tag,text='',attrs={})=>{const n=document.createElement(tag);n.textContent=text;for(const[k,v]of Object.entries(attrs))if(v!==false&&v!==null)n.setAttribute(k,v===true?'':String(v));return n;};

export const button=(text,fn)=>{const b=el('calcite-button',text);b.scale='s';b.appearance='outline';b.onclick=fn;return b;};
export const nodeButton=(text,fn)=>{const b=node('calcite-button',text);b.scale='s';b.appearance='outline';b.addEventListener('click',fn);return b;};
export const classButton=(text,fn)=>{const b=elClass('calcite-button',text);b.setAttribute('scale','s');b.setAttribute('appearance','outline');b.onclick=fn;return b;};

export const link=(text,url)=>{const a=el('a',text);a.href=url;a.target='_blank';a.rel='noopener noreferrer';return a;};
export const nodeLink=(text,url)=>{const a=node('a',text);a.href=url;a.target='_blank';a.rel='noopener noreferrer';return a;};
export const classLink=(text,url)=>{const a=elClass('a',text);a.href=url;a.target='_blank';a.rel='noopener noreferrer';return a;};

/** Collapsible calcite-block in place of <details>. Open state is the reflected `expanded` attribute: write it with toggleAttribute and read it with hasAttribute, which stay correct before Calcite hydrates the tag (the property does not). */
export const disclosure=(heading,expanded=false)=>elAttrs('calcite-block','',{heading,collapsible:true,expanded,scale:'s'});
/** fn(open) after this block (not a nested one: Calcite events bubble) expands or collapses. Like native `toggle` it also fires for code changes, but only once Calcite has hydrated the block, so code that opens a block runs its own follow-up directly. */
export const onExpand=(block,fn)=>{for(const type of ['calciteBlockExpand','calciteBlockCollapse'])block.addEventListener(type,e=>e.target===block?fn(type==='calciteBlockExpand'):undefined);};
/** Read-only calcite-table (5.1.1). Static mode keeps table/cell roles without a tab stop per cell. Calcite shows `caption` to assistive tech only, so an aria-hidden visible copy precedes it.
 * rows: arrays of text or nodes (the first becomes a row header when rowHeader), or prebuilt calcite-table-row elements. end: column indexes aligned to the end (numbers). */
export function dataTable(caption,head,rows,{rowHeader=false,end=[]}={}){
  const make=tag=>document.createElement(tag),wrap=make('div'),label=make('div'),table=make('calcite-table');
  wrap.className='data-table';label.className='data-table-caption';label.textContent=caption;label.setAttribute('aria-hidden','true');
  table.caption=caption;table.interactionMode='static';table.scale='s';
  const row=(cells,slot)=>{const r=make('calcite-table-row');if(slot)r.slot=slot;r.append(...cells);return r;};
  const header=(text,i)=>{const h=make('calcite-table-header');h.heading=text;if(end.includes(i))h.alignment='end';return h;};
  const cell=(value,i)=>{const c=make('calcite-table-cell');if(end.includes(i))c.alignment='end';if(typeof value!=='string')c.append(value);else if(end.includes(i)){const n=make('span');n.className='data-table-num';n.textContent=value;c.append(n);}else c.textContent=value;return c;};
  if(head.length)table.append(row(head.map(header),'table-header'));
  for(const cells of rows)table.append(Array.isArray(cells)?row(cells.map((v,i)=>i===0&&rowHeader?header(v,i):cell(v,i))):cells);
  wrap.append(label,table);return wrap;
}
