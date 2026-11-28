import type { Concern, FeedState } from "./contracts.ts";

export type Bounds = [number, number, number, number];
export interface Camera { center: [number, number]; zoom: number; pitch: number; bearing: number }
export interface CommandState {
  view: string; selected: string | null; camera: Camera | null; filter: string;
  query: string; mobile: string; weather: string; concerns: Concern[];
}
export interface FeedOptions {
  baseUrl?: URL;
  onChange?: (value: FeedState) => void;
  fetchImpl?: typeof fetch;
}
export interface TerrainOptions {
  container: string | HTMLElement;
  onSelect: (record: {id?: string; [key: string]: unknown}) => void;
  onError: (error: unknown) => void;
  onCamera?: (camera: Camera) => void;
  onInspect?: (value: {name?:string;readout:string}) => void;
}
export interface PlaybackStatus {
  status: string; error?: unknown; playing: boolean; index: number; count: number;
}
export interface PlaybackOptions<Frame = unknown, Value = unknown> {
  frames: Frame[];
  load: (frame: Frame, signal: AbortSignal) => Promise<Value>;
  render: (value: Value, frame: Frame, index: number) => void | Promise<void>;
  validate?: (value: Value, frame: Frame) => Promise<void>;
  changed?: (state: PlaybackStatus) => void;
  available?: () => boolean;
  reducedMotion?: () => boolean;
  dwell?: number;
  firstPlayable?: number;
  schedule?: typeof setTimeout;
  cancel?: typeof clearTimeout;
}
export interface ForecastPlayback {
  readonly playing: boolean;
  select(index: number): Promise<boolean>;
  play(options?: {automatic?: boolean}): Promise<boolean>;
  pause(): void;
  destroy(): void;
}

// The implementations remain external JS modules. These inferred surfaces are
// checked with their public JSDoc, rather than detached declaration shims.
export interface Modules {
  "auth": typeof import("../../site/lib/auth.js");
  "command-assets": typeof import("../../site/lib/command-assets.js");
  "command-data": typeof import("../../site/lib/command-data.js");
  "command-gust": typeof import("../../site/lib/command-gust.js");
  "command-model": typeof import("../../site/lib/command-model.js");
  "command-rain": typeof import("../../site/lib/command-rain.js");
  "command-private": typeof import("../../site/lib/command-private.js");
  "command-private-ui": typeof import("../../site/lib/command-private-ui.js");
  "command-search": typeof import("../../site/lib/command-search.js");
  "command-snow": typeof import("../../site/lib/command-snow.js");
  "command-weather-player": typeof import("../../site/lib/command-weather-player.js");
  "eoc-model": typeof import("../../site/lib/eoc-model.js");
  "forecast-timeline": typeof import("../../site/lib/forecast-timeline.js");
  "sdk": typeof import("../../site/lib/sdk.js");
  "watch-regional-radar-ui": typeof import("../../site/lib/watch-regional-radar-ui.js");
  "watch-terrain-map": typeof import("../../site/lib/watch-terrain-map.js");
  "county-scene-map": typeof import("../../site/lib/county-scene-map.js");
  "watch-watershed-data": typeof import("../../site/lib/watch-watershed-data.js");
  "watershed-timeline-model": typeof import("../../site/lib/watershed-timeline-model.js");
}
export type ModuleLoader = <K extends keyof Modules>(name: K) => Promise<Modules[K]>;
export type TerrainMap = Awaited<ReturnType<Modules["watch-terrain-map"]["createWatchTerrain"]>>;

export interface CountySession { username: string; getToken(): Promise<string>; portal: unknown }
export type PrivateEvent = ReturnType<typeof import("../../site/lib/eoc-model.js").makeEvent>;
export interface PrivateState {
  allowed: Set<string>; username: string | null; incidents: PrivateEvent[];
  records: Record<string, PrivateEvent[]>; incident: string | null; period: string | null;
  captures: Array<{id: string; evidence: ReturnType<typeof import("../../site/lib/command-model.js").snapshotConcern>}>;
  loading: boolean; saving: boolean; error: string | null;
}
