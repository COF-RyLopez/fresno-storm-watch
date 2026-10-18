/** Public configuration only. Never put a password, token, or client secret here. */
export const CONFIG = Object.freeze({
  title: 'Fresno County Storm Watch',
  season: '2026–27',
  nwsLayerUrl: 'https://mapservices.weather.noaa.gov/eventdriven/rest/services/WWA/watch_warn_adv/FeatureServer/1',
  pollMs: 300_000,
  staleMs: 420_000,
  requestTimeoutMs: 25_000,
  timeZone: 'America/Los_Angeles',
  environment: {
    pollMs:300_000,
    weatherCheckMaxAgeMs:420_000,
    radarMaxAgeMs:20*60_000,
    qpfMaxAgeMs:24*3_600_000,
    snapshotPollMs:60_000,
    collectorMaxAgeMs:45*60_000
  },
  cameras: {
    pollMs:300_000,
    staleMs:420_000,
    imagePollMs:60_000,
    imageMaxAgeMs:300_000,
    requestTimeoutMs:20_000
  },
  rivers: {
    baseUrl: 'https://api.water.noaa.gov/nwps/v1',
    pollMs: 300_000,
    staleMs: 420_000,
    requestTimeoutMs: 25_000,
    observationMaxAgeMs: 2 * 3_600_000,
    forecastMaxAgeMs: 24 * 3_600_000,
    defaultHorizonHours: 72
  },
  arcgis: {
    portalUrl: 'https://cofgisonline.maps.arcgis.com',
    // Optional saved Web Scene in the official county Scene Viewer. Public item ID only.
    // Esri's photorealistic preview is not yet supported inside this custom app.
    photorealisticSceneId: 'c01a4396e54448e59b83cfb4bf40ebd7',
    // Set true only after the county enables the basemap and verifies the saved scene.
    photorealisticVerified: false,
    // Fill with the public Client ID of an OAuth credential for USER authentication.
    clientId: '',
    authNamespace: 'fresno-storm-watch-prototype-v1'
  }
});
