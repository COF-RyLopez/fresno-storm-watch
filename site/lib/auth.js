import { loadSdk } from './map.js?v=0.73.1';
/** Shared PKCE sign-in. Private controllers clear memory before sign-out or expiry. */
export async function setupAuth(config,exercise,onChange=()=>{}) {
  const button=document.querySelector('#sign-in'),status=document.querySelector('#identity-status');
  const label=text=>button.setAttribute('text',text),help=()=>document.querySelector('#signin-help')?.setAttribute('open','');
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
        status.textContent=`Signed in as ${portal.user.username}`;label('Sign out');return true;
      }catch{if(epoch===generation)clear('Sign-in required · private workspace cleared');return false;}finally{checking=null;}})();return checking;
    };
    await check();button.removeAttribute('disabled');
    button.onclick=async()=>{button.setAttribute('disabled','');try{if(portal){clear();identity.destroyCredentials();}else{await identity.getCredential(`${config.portalUrl}/sharing`);await check();}}catch{clear('Sign-in did not complete');}finally{button.removeAttribute('disabled');}};
    setInterval(()=>{if(portal)void check();},30000);
    document.addEventListener('visibilitychange',()=>{if(!document.hidden&&portal)void check();});
    window.addEventListener('pagehide',()=>clear());
    return {check,invalidate:()=>{clear('Session unavailable · sign in again');identity.destroyCredentials();}};
  }catch{clear('ArcGIS sign-in unavailable');label('Sign-in setup');button.removeAttribute('disabled');button.onclick=help;return {check:async()=>false,invalidate:()=>clear()};}
}
