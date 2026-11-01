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
