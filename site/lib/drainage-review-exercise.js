import {powerExercise} from './power-exercise.js';
/** Fictional fixtures only; never a county inventory or operational forecast. */
export function drainageReviewExercise(now=Date.now()){
  const sr={wkid:4326},x=-119.70,y=36.92,box=(a,b)=>({rings:[[[a,b],[a+.002,b],[a+.002,b+.002],[a,b+.002],[a,b]]],spatialReference:sr});
  const basin={key:'fictional-basin',name:'Fictional basin A',code:'EXERCISE-A',kind:'basin',category:'existing',updated:null,status:'Fictional existing inventory',geometry:box(x,y)};
  const pump={key:'fictional-pump',name:'Fictional pump A',code:'EXERCISE-A',kind:'pump',category:'existing',updated:null,status:'Fictional existing inventory',geometry:{x:x+.001,y:y+.001,spatialReference:sr}};
  const row={key:'fictional-road',kind:'Road closure',name:'Fictional road / elapsed end date',status:'Verification needed',active:'yes',start:now-86400000,end:now-3600000,issues:['End date elapsed; reopening not confirmed'],sourceTime:now-3600000,edited:now-3600000,geometry:{paths:[[[x-.001,y],[x+.003,y]]],spatialReference:sr}};
  const site={key:'fictional-facility',name:'Fictional county operations facility',owner:'Fictional county team',backup:null,fetched:now,geometry:{x:x+.001,y:y+.001,spatialReference:sr}};
  const power=powerExercise('watch',now);power.rows=power.feeds.flatMap(f=>f.rows);power.checked=now;power.error=null;
  return {power,snapshot:{connected:true,checked:now,error:null,rows:[basin,pump,{...pump,key:'fictional-proposed',code:'EXERCISE-PROPOSED',category:'proposed'}]},roads:{snapshot:{checked:now,rows:[row]},error:null},facilities:{connected:true,sourceGaps:0,sites:[{site,active:[],review:true}]},rain:{checked:now,error:null,cycle:{issue:now-3600000,start:now+3600000,end:now+73*3600000,hours:72,units:'in'},features:[{value:.5,geometry:box(x,y)}]}};
}
