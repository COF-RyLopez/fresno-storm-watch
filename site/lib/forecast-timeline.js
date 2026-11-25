/** A keyboard/touch timeline over available forecast windows, never invented gap frames. */
export function createForecastTimeline({frames,selectedStart,format,label:accessibleLabel='Six-hour snow forecast window',emptyLabel='No matching snowfall windows'}){
 const element=document.createElement('div'),label=document.createElement('output'),input=document.createElement('input');
 element.className='forecast-timeline';input.type='range';input.min='0';input.max=String(Math.max(0,frames.length-1));input.step='1';
 input.setAttribute('aria-label',accessibleLabel);input.disabled=frames.length<2;
 function setIndex(index){
  const at=Math.max(0,Math.min(frames.length-1,Number.isInteger(index)?index:0)),frame=frames[at];
  input.value=String(at);input.dataset.forecastStart=frame?String(frame.start):'';
  label.textContent=frame?format(frame.start,frame.end,frame):emptyLabel;
  input.setAttribute('aria-valuetext',label.textContent);
 }
 input.addEventListener('input',()=>setIndex(Number(input.value)));
 element.append(label,input);setIndex(frames.findIndex(frame=>frame.start===selectedStart));
 return {element,label,input,setIndex};
}
