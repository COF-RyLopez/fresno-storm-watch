// Compiler fixtures: unused expect-error directives fail the build if a
// boundary becomes permissive. This function is never executed or imported.
import type { ModuleLoader, PlaybackOptions, TerrainOptions } from "./module-contracts.ts";
export async function checkContracts(load: ModuleLoader) {
  // @ts-expect-error Unknown modules cannot become arbitrary deployment paths.
  await load("../../private");
  const data = await load("command-data");
  // @ts-expect-error Missing exports must fail at compile time.
  data.notAnExport();
  // @ts-expect-error Feed callbacks receive a normalized FeedState.
  data.createCommandFeeds({onChange: (value: number) => value});
  // @ts-expect-error Base URL must be a URL.
  data.createCommandFeeds({baseUrl: 42});
  const terrain = await load("watch-terrain-map");
  // @ts-expect-error Map selection supplies a stable string ID.
  terrain.createWatchTerrain({container: "map", onSelect: (id: number) => id, onError: () => {}});
  const map = await terrain.createWatchTerrain({container: "map", onSelect: () => {}, onError: () => {}} satisfies TerrainOptions);
  // @ts-expect-error Camera bounds require exactly four numeric ordinates.
  map.focus(["west", 1, 2, 3]);
  // @ts-expect-error Playback loaders must return asynchronous frame data.
  const invalid: PlaybackOptions<number, string> = {frames: [1], load: () => 2, render: () => {}};
  const player = (await load("command-weather-player")).createForecastPlayback({frames:[1],load:async()=>"frame",render:()=>{}});
  // @ts-expect-error Playback uses numeric frame indexes.
  player.select("tomorrow");
  const privateStore = (await load("command-private")).createCommandPrivate({config: {}});
  // @ts-expect-error A username alone is not an authenticated county session.
  privateStore.connect({username: "example"});
  // @ts-expect-error Actual weather adapter requires asynchronous loaders.
  (await load("command-weather-player")).createForecastPlayback({frames:[1],load:()=>42,render:()=>{}});
  void invalid;
}
