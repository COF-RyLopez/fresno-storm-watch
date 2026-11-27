interface LayoutInput {
  width: number; height: number; pane: string;
  inspectorOpen: boolean; attentionCollapsed: boolean;
}

/** Presentation only: resizing never changes the selected place, time or drafts. */
export function layoutPresentation(input: LayoutInput) {
  const {width,height,pane,inspectorOpen,attentionCollapsed}=input;
  const compact=width<=700||height<=520;
  if(compact)return {compact,attention:pane==='attention',evidence:pane==='details'&&inspectorOpen,map:pane==='map'||pane==='details'&&!inspectorOpen};
  const evidence=inspectorOpen&&(width>1150||pane!=='attention');
  return {compact,attention:!attentionCollapsed&&(width>1150||!evidence),evidence,map:true};
}

interface LayoutOptions {
  get?: (id: string)=>HTMLElement;
  viewport?: ()=>{width:number;height:number};
  resize(): void;
  onPane?: (pane:string)=>void;
}

export function createCommandLayout({get=id=>document.getElementById(id)!,viewport=()=>({width:innerWidth,height:innerHeight}),resize,onPane}: LayoutOptions){
  let pane='attention',inspectorOpen=false,attentionCollapsed=false;
  function refresh(){
    const size=viewport(),p=layoutPresentation({...size,pane,inspectorOpen,attentionCollapsed});
    get('attention-shell').hidden=!p.attention;
    get('evidence').hidden=!p.evidence;
    get('map-panel').hidden=!p.map;
    get('watch-view').toggleAttribute('data-compact',p.compact);
    get('attention-toggle').toggleAttribute('active',p.attention);
    get('attention-toggle').setAttribute('aria-pressed',String(p.attention));
    get('map-action-bar').setAttribute('layout',size.height<=520?'horizontal':'vertical');
    resize();
  }
  function choosePane(value:string){pane=value;onPane?.(value);refresh();}
  return {
    refresh,
    pane(value:string){pane=value;if(value==='attention')attentionCollapsed=false;refresh();},
    inspector(open:boolean){
      const wasOpen=inspectorOpen;inspectorOpen=open;
      if(open&&!wasOpen)choosePane('details');
      else if(!open&&wasOpen&&pane==='details')choosePane('map');
      else refresh();
    },
    toggleAttention(){
      const p=layoutPresentation({...viewport(),pane,inspectorOpen,attentionCollapsed});
      attentionCollapsed=p.attention;
      choosePane(p.attention?(inspectorOpen?'details':'map'):'attention');
    },
  };
}
