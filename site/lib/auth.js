import { loadSdk } from './map.js';
/** ArcGIS keeps the token per tab (sessionStorage) unless the person ticks "Keep me signed in", so a second tab (Map and EOC
 * side by side) started signed out. Tokens still stay per tab; only a non-secret flag is shared: a tab that opens while the
 * flag is set signs itself in through the County portal (no password while the portal session lasts), and signing out
 * anywhere clears the flag and signs out every open tab. */
const SIGNED_IN='frog-county-signin',AUTO_TRIED='frog-county-signin-tried';
const storage=(area,fn)=>{try{return fn(window[area]);}catch{return null;}};
/** @returns {boolean} Whether this tab should try the portal on load: flag set and no attempt in the last 2 minutes (a cancel never loops). */
export function shouldAutoSignIn(flag,tried,now=Date.now()){return flag==='1'&&!(now-Number(tried)<120000);}
/** Shared PKCE sign-in. Private controllers clear memory before sign-out or expiry. */
export async function setupAuth(config,exercise,onChange=()=>{}) {
  const button=document.querySelector('#sign-in'),status=document.querySelector('#identity-status');
  const label=text=>button.setAttribute('text',text),help=()=>{const h=document.querySelector('#signin-help');h?.setAttribute(h.localName==='calcite-block'?'expanded':'open','');};
  if(!config.clientId||exercise){label(exercise?'Exercise only':'ArcGIS sign-in setup');button.addEventListener('click',help);onChange(null);return {check:async()=>false,invalidate:()=>onChange(null)};}
  button.setAttribute('disabled','');
  let portal=null,identity=null,checking=null,generation=0;
  const clear=(message='Signed out · private workspace cleared')=>{generation++;portal=null;onChange(null);label('County ArcGIS sign-in');status.textContent=message;};
  try {
    const sdk=await loadSdk(),[OAuthInfo,manager,Portal]=await sdk.import(['@arcgis/core/identity/OAuthInfo.js','@arcgis/core/identity/IdentityManager.js','@arcgis/core/portal/Portal.js']);identity=manager;
    identity.registerOAuthInfos([new OAuthInfo({appId:config.clientId,portalUrl:config.portalUrl,flowType:'authorization-code',popup:false,authNamespace:config.authNamespace})]);
    const check=async()=>{
      if(checking)return checking;const epoch=generation;
      checking=(async()=>{try{
        await identity.checkSignInStatus(`${config.portalUrl}/sharing`);
        if(epoch!==generation)return false;
        if(!portal){const p=new Portal({url:config.portalUrl,authMode:'immediate'});await p.load();if(epoch!==generation)return false;portal=p;onChange({portal,username:p.user.username,getToken:async()=>{const c=identity.findCredential(`${config.portalUrl}/sharing`);if(!c?.token||c.expires<=Date.now())throw Error('County sign-in expired.');return c.token;}});}
        status.textContent=`Signed in as ${portal.user.username}`;label('Sign out');storage('localStorage',s=>s.setItem(SIGNED_IN,'1'));storage('sessionStorage',s=>s.removeItem(AUTO_TRIED));return true;
      }catch{if(epoch===generation)clear('Sign-in required · private workspace cleared');return false;}finally{checking=null;}})();return checking;
    };
    const signOut=message=>{clear(message);identity.destroyCredentials();};
    if(!await check()&&shouldAutoSignIn(storage('localStorage',s=>s.getItem(SIGNED_IN)),storage('sessionStorage',s=>s.getItem(AUTO_TRIED)))){
      storage('sessionStorage',s=>s.setItem(AUTO_TRIED,String(Date.now())));status.textContent='Signing in with your County session…';
      try{await identity.getCredential(`${config.portalUrl}/sharing`);await check();}catch{/* Cancelled or failed: the button stays available. */}
    }
    button.removeAttribute('disabled');
    window.addEventListener('storage',e=>{if(e.key!==SIGNED_IN)return;
      if(!e.newValue&&portal)signOut('Signed out in another tab · private workspace cleared');
      else if(e.newValue&&!portal)status.textContent='Signed in in another tab · select Sign in to continue here';});
    button.onclick=async()=>{button.setAttribute('disabled','');try{if(portal){storage('localStorage',s=>s.removeItem(SIGNED_IN));signOut();}else{await identity.getCredential(`${config.portalUrl}/sharing`);await check();}}catch{clear('Sign-in did not complete');}finally{button.removeAttribute('disabled');}};
    setInterval(()=>{if(portal)void check();},30000);
    document.addEventListener('visibilitychange',()=>{if(!document.hidden&&portal)void check();});
    window.addEventListener('pagehide',()=>clear());
    return {check,invalidate:()=>{clear('Session unavailable · sign in again');identity.destroyCredentials();}};
  }catch{clear('ArcGIS sign-in unavailable');label('Sign-in setup');button.removeAttribute('disabled');button.onclick=help;return {check:async()=>false,invalidate:()=>clear()};}
}
