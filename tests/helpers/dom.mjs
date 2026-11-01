/** Shared test DOM: just enough Element for the site's UI controllers. Subclass in a test only for extra behaviour. */
export class FakeElement extends EventTarget{
  constructor(tag='div'){super();this.tag=tag;this.children=[];this.attributes=new Map();this.dataset={};this.style={};this.textContent='';this.isConnected=true;}
  /** Moves nodes like the DOM: an appended node leaves its previous parent. */
  append(...nodes){for(const n of nodes){if(n&&typeof n==='object'){if(n.parentElement)n.parentElement.children=n.parentElement.children.filter(c=>c!==n);n.parentElement=this;}this.children.push(n);}}
  prepend(...nodes){this.children.unshift(...nodes);}
  replaceChildren(...nodes){this.children=[];this.append(...nodes);}
  get lastChild(){return this.children.at(-1);}
  contains(n){return this===n||this.children.some(c=>c instanceof FakeElement&&c.contains(n));}
  setAttribute(k,v){this.attributes.set(k,String(v));}
  removeAttribute(k){this.attributes.delete(k);}
  hasAttribute(k){return this.attributes.has(k);}
  toggleAttribute(k,on=!this.hasAttribute(k)){if(on)this.setAttribute(k,'');else this.removeAttribute(k);return on;}
  setFocus(){return Promise.resolve();}
}

/** Replace globalThis properties; returns a function that restores (or deletes) each one. */
export function stubGlobals(stubs){
  const saved=Object.keys(stubs).map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]);
  for(const [k,value]of Object.entries(stubs))Object.defineProperty(globalThis,k,{value,configurable:true,writable:true});
  return ()=>{for(const [k,d]of saved)if(d)Object.defineProperty(globalThis,k,d);else delete globalThis[k];};
}

/** Run fn with globalThis stubs, always restoring them afterwards, even when fn throws. */
export async function withGlobals(stubs,fn){const restore=stubGlobals(stubs);try{return await fn();}finally{restore();}}
