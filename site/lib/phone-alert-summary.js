/** Compact presentation only; counts and Warning classification come from NWS. */
export function phoneAlertSummary(count,{warnings=0,error=null,stale=false}={}){
 if(error)return {text:'NWS · unavailable',tone:'gap'};
 if(stale)return {text:'NWS · outdated',tone:'gap'};
 if(count===null)return {text:'NWS · checking',tone:'neutral'};
 if(warnings>0)return {text:'NWS · '+warnings+' regional '+(warnings===1?'warning':'warnings'),tone:'warning'};
 return {text:'NWS · '+count+' regional',tone:'neutral'};
}
