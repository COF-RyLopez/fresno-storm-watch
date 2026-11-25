import type { Modules, ModuleLoader } from "./module-contracts.ts";

type FunctionExports<T> = {[K in keyof T]: T[K] extends (...args: never[]) => unknown ? K : never}[keyof T];
const exportsByModule = {
  "auth": ["setupAuth"],
  "command-assets": ["createCommandAssets"],
  "command-data": ["createCommandFeeds", "riverConcerns", "roadConcerns", "alertConcerns"],
  "command-gust": ["loadGustForecast", "gustPointFeatures", "loadGustImage"],
  "command-model": ["createCommandState", "routeState", "advisoryForecastMode", "geometryBounds"],
  "command-rain": ["createCommandRainDelivery"],
  "command-private": ["createCommandPrivate", "taskRows", "buildCommandBriefing"],
  "command-private-ui": ["mountCommandPrivate"],
  "command-search": ["createCommandSearch"],
  "command-snow": ["loadSnowAdvisory", "loadSnowCover", "loadSnowForecast", "loadSnowGrid", "loadSnowGridImage", "snowWindow"],
  "command-weather-player": ["createForecastPlayback"],
  "eoc-model": ["current"],
  "forecast-timeline": ["createForecastTimeline"],
  "sdk": ["loadCoreSdk"],
  "watch-regional-radar-ui": ["installRegionalRadar"],
  "watch-terrain-map": ["createWatchTerrain"],
  "watch-watershed-data": ["loadWatershedRain"],
  "watershed-timeline-model": ["precipitationTimeline"],
} as const satisfies {[K in keyof Modules]: readonly FunctionExports<Modules[K]>[]};

export function validateModule<K extends keyof Modules>(name: K, value: unknown): Modules[K] {
  if (!Object.hasOwn(exportsByModule, name)) throw Error("Unknown Command module: " + name);
  if (!value || typeof value !== "object") throw Error("Invalid Command module: " + name);
  for (const key of exportsByModule[name]) {
    if (typeof (value as Record<string, unknown>)[key] !== "function")
      throw Error(`Command module ${name} is missing function ${key}`);
  }
  // The only runtime assertion: dynamic imports cannot be statically resolved
  // from a deployment URL. Names and required exports are checked above.
  return value as Modules[K];
}

export function createModuleLoader(root: URL,
  importModule: (url: string) => Promise<unknown> = url => import(/* @vite-ignore */ url),
): ModuleLoader {
  return async name => {
    if (!Object.hasOwn(exportsByModule, name)) throw Error("Unknown Command module: " + name);
    return validateModule(name, await importModule(new URL(`lib/${name}.js`, root).href));
  };
}
