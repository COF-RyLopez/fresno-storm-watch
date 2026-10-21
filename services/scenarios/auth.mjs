/** Portal verifies the user token and group membership on every service request. */
export async function authorize(token,config,fetcher=fetch){
 if(!token||token.length>8192)throw Object.assign(Error('County sign-in required.'),{status:401});
 const response=await fetcher(`${config.portalUrl}/sharing/rest/community/self?f=json`,{headers:{'X-Esri-Authorization':`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(10000)});
 if(!response.ok)throw Object.assign(Error('County identity service unavailable.'),{status:503});const user=await response.json();
 if(user.error||!user.username||user.orgId!==config.orgId)throw Object.assign(Error('A valid county user account is required.'),{status:401});
 const groups=new Set((user.groups||[]).filter(g=>['member','admin','owner'].includes(g.userMembership?.memberType)).map(g=>g.id));
 if(!config.eocGroups.some(g=>groups.has(g)))throw Object.assign(Error('County EOC group membership required.'),{status:403});
 return {username:user.username,reviewer:config.reviewerGroups.some(g=>groups.has(g))};
}
