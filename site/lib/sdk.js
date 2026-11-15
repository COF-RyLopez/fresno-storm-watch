let sdkPromise;
let corePromise;

/** Load the pinned SDK used by the existing map and EOC. */
export function loadSdk() {
  sdkPromise ??= import('https://js.arcgis.com/5.1/').then(() => globalThis.$arcgis);
  return sdkPromise;
}

/** Load the core API for pages that supply Calcite independently. */
export function loadCoreSdk() {
  corePromise ??= import('https://js.arcgis.com/5.1/core.js').then(() => globalThis.$arcgis);
  return corePromise;
}
