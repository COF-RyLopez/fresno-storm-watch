const FEMA_SERVICE = 'https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28';
const FRESNO_VIEW = Object.freeze({ longitude: -119.7, latitude: 36.8, altitude: 180_000, heading: 0, tilt: 0 });

/** @param {object} value @returns {object} Validate geographic camera coordinates; never serialize NaN or projected x/y. */
export function sceneCamera(value) {
  if (!value || !Number.isFinite(value.longitude) || Math.abs(value.longitude) > 180 ||
      !Number.isFinite(value.latitude) || Math.abs(value.latitude) > 90 ||
      !Number.isFinite(value.altitude) || value.altitude < 0 || value.altitude > 30_000_000 ||
      !Number.isFinite(value.heading) || !Number.isFinite(value.tilt) || value.tilt < 0 || value.tilt > 90) {
    return { ...FRESNO_VIEW };
  }
  return { longitude: value.longitude, latitude: value.latitude, altitude: Math.max(100, value.altitude),
    heading: ((value.heading % 360) + 360) % 360, tilt: value.tilt };
}

/** @param {object} config @param {object|null} camera @returns {string} Use only the official hosted viewer; no keys or app tokens in the URL. */
export function sceneCompanionUrl(config, camera = null) {
  const portal = new URL(config.portalUrl);
  if (portal.protocol !== 'https:' || !/^[a-z0-9-]+\.maps\.arcgis\.com$/i.test(portal.hostname) ||
      portal.port || portal.username || portal.password || portal.search || portal.hash || !['', '/'].includes(portal.pathname)) {
    throw new Error('The companion must use the county ArcGIS Online organization URL.');
  }
  const id = config.photorealisticSceneId?.trim() || '';
  if (id && !/^[a-f0-9]{32}$/i.test(id)) throw new Error('The companion Web Scene item ID must contain 32 hexadecimal characters.');
  const url = new URL('/home/webscene/viewer.html', portal);
  if (id) url.searchParams.set('webscene', id);
  else url.searchParams.set('url', FEMA_SERVICE);
  const c = sceneCamera(camera);
  url.searchParams.set('viewpoint', `cam:${c.longitude.toFixed(6)},${c.latitude.toFixed(6)},${c.altitude.toFixed(1)};${c.heading.toFixed(1)},${c.tilt.toFixed(1)}`);
  return url.href;
}

/** @param {object} config @param {Function} getCamera @param {boolean} exercise @returns {void} Open a named-user companion without replacing the live workspace. */
export function setupSceneCompanion(config, getCamera, exercise = false) {
  const button = document.querySelector('#open-photorealistic');
  const dialog = document.querySelector('#photorealistic-help');
  const link = document.querySelector('#open-scene-companion');
  const status = document.querySelector('#scene-companion-status');
  const configured = Boolean(config.photorealisticSceneId?.trim());
  button.addEventListener('click', () => {
    link.removeAttribute('href');
    link.setAttribute('disabled', '');
    try {
      // Exercise records are never exported. Only a geographic camera is passed.
      link.setAttribute('href', sceneCompanionUrl(config, getCamera()));
      link.removeAttribute('disabled');
      link.textContent = configured ? 'Open county 3D companion' : 'Open county Scene Viewer';
      status.textContent = configured
        ? 'A county scene is connected. Your ArcGIS account and organization basemap access still apply.'
        : 'County setup needed: a photorealistic scene is not connected yet. Scene Viewer opens with FEMA reference at your current map area; select the Google basemap after your administrator enables it.';
    } catch {
      status.textContent = 'The county scene configuration is invalid. Use the setup guide; the Storm Watch map and feeds remain available.';
    }
    document.querySelector('#scene-exercise-note').hidden = !exercise;
    dialog.setAttribute('open', '');
  });
}
