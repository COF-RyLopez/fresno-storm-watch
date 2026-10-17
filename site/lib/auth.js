import { loadSdk } from './map.js';

/** @param {object} config @param {boolean} exercise @returns {Promise<void>} OAuth scaffold; no private layers or write permissions requested. */
export async function setupAuth(config, exercise) {
  const button = document.querySelector('#sign-in');
  const label=text=>button.setAttribute('text',text);
  const status = document.querySelector('#identity-status');
  if (!config.clientId || exercise) {
    label(exercise ? 'Public exercise view' : 'ArcGIS sign-in setup');
    button.addEventListener('click', () => document.querySelector('#signin-help').setAttribute('open', ''));
    return;
  }
  button.setAttribute('disabled', '');
  try {
    const sdk = await loadSdk();
    const [OAuthInfo, identity, Portal] = await sdk.import([
      '@arcgis/core/identity/OAuthInfo.js', '@arcgis/core/identity/IdentityManager.js', '@arcgis/core/portal/Portal.js'
    ]);
    const info = new OAuthInfo({ appId: config.clientId, portalUrl: config.portalUrl,
      flowType: 'authorization-code', popup: false, authNamespace: config.authNamespace });
    identity.registerOAuthInfos([info]);
    let signedIn = false;
    const update = async () => {
      try {
        await identity.checkSignInStatus(`${config.portalUrl}/sharing`);
        const portal = new Portal({ url: config.portalUrl, authMode: 'immediate' });
        await portal.load();
        signedIn = true;
        status.textContent = `Signed in as ${portal.user.username} · public NWS view`;
        label('Sign out');
      } catch {
        signedIn = false;
        status.textContent = 'Public NWS view';
        label('County ArcGIS sign-in');
      }
    };
    await update();
    button.removeAttribute('disabled');
    button.addEventListener('click', async () => {
      button.setAttribute('disabled', '');
      try {
        if (signedIn) {
          identity.destroyCredentials();
          signedIn = false;
          status.textContent = 'Public NWS view';
          label('County ArcGIS sign-in');
        } else {
          await identity.getCredential(`${config.portalUrl}/sharing`);
          await update();
        }
      } catch {
        status.textContent = 'Sign-in did not complete. Public alerts remain available.';
      } finally { button.removeAttribute('disabled'); }
    });
  } catch {
    status.textContent = 'ArcGIS sign-in unavailable. Public alerts remain available.';
    label('Sign-in setup');
    button.removeAttribute('disabled');
    button.addEventListener('click', () => document.querySelector('#signin-help').setAttribute('open', ''));
  }
}
