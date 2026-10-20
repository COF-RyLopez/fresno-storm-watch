/** SDK core and component event compatibility; no application state or records. */
export function viewEventData(event){
  return event?.detail&&typeof event.detail==='object'?event.detail:event;
}

/** Removing a layer/view cancels pending work; it does not establish a feed failure. */
export function isMapLoadCancellation(error){
  return error?.name==='AbortError'||error?.code==='AbortError'||/^aborted\.?$/i.test(error?.message??'');
}
