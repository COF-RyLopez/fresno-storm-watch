import type { Concern, FeedState } from "./contracts.ts";
import type { ModuleLoader, Modules, TerrainMap, ForecastPlayback } from "./module-contracts.ts";
export type WeatherMode = "off" | "rain" | "gust" | "radar" | "snow-now" | "snow-forecast";
export type AdvisoryTiming = {start: number | null; end: number | null};
export const isWeatherMode = (value: string): value is WeatherMode =>
  ["off","rain","gust","radar","snow-now","snow-forecast"].includes(value);
interface WeatherDependencies {
  root: URL; moduleAt: ModuleLoader; model: Modules["command-model"];
  createForecastPlayback: Modules["command-weather-player"]["createForecastPlayback"];
  getMap(): TerrainMap | undefined; ensureMap(): Promise<void>;
  getState(): {view: string; mobile: string}; getSelection(): Concern | undefined;
  getTimeline(): FeedState["timeline"];
  updateMap(): void; renderEvidence(): void; pane(value: string): void;
  requestFit(): void; notify(message: string): void; date(value: unknown): string;
}
const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const el = (tag: string, text?: string, className?: string) => {
  const n = document.createElement(tag);
  if (text != null) n.textContent = text;
  if (className) n.className = className;
  return n;
};
const button = (text: string, action: () => void, cls?: string) => {
  const b = el("button", text, cls) as HTMLButtonElement;
  b.type = "button";
  b.onclick = action;
  return b;
};
const localForecastTime = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles", month: "short", day: "numeric",
  hour: "numeric", minute: "2-digit", timeZoneName: "short",
});
const link = (text: string, href: string) => {
  const a = el("a", text) as HTMLAnchorElement;
  try {
    const u = new URL(href, location.href);
    if (!["https:", "http:"].includes(u.protocol)) return el("span", text);
    a.href = u.href;
    a.target = "_blank";
    a.rel = "noopener";
  } catch {
    return el("span", text);
  }
  return a;
};

/** Owns weather imports, requests, playback and visibility for one Command shell.
 * The map and operational scope remain owned by the shell. No browser persistence.
 */
export function createCommandWeather({root,moduleAt,model,createForecastPlayback,getMap,ensureMap,
  getState,getSelection,getTimeline,updateMap,renderEvidence,pane,requestFit,notify,date}: WeatherDependencies) {
  let destroyed = false, weatherEpoch = 0;
  let weatherMode: WeatherMode = "off";
  const weatherViews: Partial<Record<WeatherMode, ReturnType<Modules["watch-regional-radar-ui"]["installRegionalRadar"]>>> = {};
  let forecastPlayer: ForecastPlayback | undefined;
  let resumeFrame: (() => boolean) | null = null;
  let forecastRequest: AbortController | undefined, snowRequest: AbortController | undefined;
  let advisoryRequest: AbortController | undefined;
  let gustTimer: ReturnType<typeof setTimeout> | undefined, snowTimer: ReturnType<typeof setTimeout> | undefined;
  let snowDraw: (()=>void) | null = null, gustDraw: (()=>void) | null = null;
  let checkedAdvisory: string | undefined, advisoryWeatherId: string | undefined, advisoryPlaybackIntent: string | undefined;
  const snowSummaries = new Map<string,string>();
  let currentRainWindow: {layer: number; start: number; end: number; issue?: number} | null = null;
  let lastRain: Awaited<ReturnType<Modules["watch-watershed-data"]["loadWatershedRain"]>> | null = null;
  const phone = matchMedia("(max-width:700px)");
  const visible = () => !document.hidden && getState().view === "watch" &&
    (!phone.matches || getState().mobile === "map");
  let weatherSuspended = !visible();
  function syncAdvisoryWeather(reopen = false) {
    if (destroyed) return;
    const c = getState().view === "watch" ? getSelection() : undefined;
    const id = c && ["alert","burn-scar"].includes(c.kind) ? c.id : undefined;
    if (!reopen && id === checkedAdvisory) return;
    checkedAdvisory = id;
    advisoryRequest?.abort();
    if (advisoryWeatherId && advisoryWeatherId !== id) {
      advisoryWeatherId = undefined;
      pauseWeather();
    }
    if (!c || !id) return;
    const request = new AbortController(), epoch = weatherEpoch;
    const autoplay = advisoryPlaybackIntent === id;
    advisoryPlaybackIntent = undefined;
    advisoryRequest = request;
    let selectedEpoch = epoch;
    void (async () => {
      if (c.kind === "burn-scar") {
        if (matchMedia("(max-width:700px)").matches) pane("map");
        advisoryWeatherId = id;
        const pending = chooseWeather("rain"); selectedEpoch = weatherEpoch; await pending;
        return;
      }
      const mode = model.advisoryForecastMode(c);
      let timing: AdvisoryTiming | null = c.alertTiming ?? { start: null, end: null };
      if (!mode) {
        const source = await moduleAt("command-snow");
        if (request.signal.aborted || epoch !== weatherEpoch || !source.snowAdvisoryCandidate(c)) return;
        timing = await source.loadSnowAdvisory(c, request.signal);
      }
      if (!timing || request.signal.aborted || epoch !== weatherEpoch) return;
      if (matchMedia("(max-width:700px)").matches && getState().mobile === "attention") pane("map");
      advisoryWeatherId = id;
      const pending = chooseWeather(mode || "snow-forecast", timing, autoplay);
      selectedEpoch = weatherEpoch; await pending;
    })().catch(() => {
      if (!destroyed && !request.signal.aborted && selectedEpoch === weatherEpoch && checkedAdvisory === id) {
        advisoryWeatherId = undefined;
        pauseWeather();
        notify("Forecast could not be opened. The official advisory remains available in Details.");
      }
    });
  }

  async function showSnow(mode: string, epoch: number, rainWindow: any, advisory?: AdvisoryTiming, autoplay = false) {
    let shouldAutoplay = autoplay;
    const source = await moduleAt("command-snow");
    if (destroyed || epoch !== weatherEpoch) return;
    const info = $("weather-time"), items = $("weather-source"), controls = $("weather-controls");
    const request = new AbortController();
    snowRequest = request;
    const active = () => epoch === weatherEpoch && !request.signal.aborted;
    const update = async () => {
      try {
        if (mode === "snow-now") {
          items.replaceChildren(el("p", "Daily 1 km analysis from satellite and surface evidence. Unshaded areas may be snow-free or have missing coverage. The overlay fades at close zoom."), link("U.S. National Ice Center source", source.IMS));
          const snow = await source.loadSnowCover(request.signal);
          if (!active()) return;
          snowDraw = () => {
            if (!weatherSuspended && active()) getMap()?.snowCover(snow);
          };
          snowDraw();
          info.textContent = "Snow cover · source file " + date(snow.fileTime);
          colors([{ label: "Mapped snow", color: "#eef8ff" }]);
        } else {
          items.replaceChildren(el("p", "NWS six-hour new snowfall in inches. Point guidance is separate; missing coverage stays unknown."),
            link("NWS Hanford snowfall ranges and probabilities", source.HANFORD_WINTER));
          const [sites, grid] = await Promise.all([
            source.loadSnowForecast(request.signal), source.loadSnowGrid(request.signal).catch(() => null),
          ]);
          if (!active()) return;
          const step = 6 * 3600000, first = Math.floor(Date.now() / step) * step;
          const starts = Array.from({length:12},(_,i)=>first+i*step);
          const frames = starts.map(start=>({start,end:start+step,grid:grid?.frames.find((f: any)=>f.start===start)}))
            .filter(w=>(w.grid || sites.some((site: any)=>source.snowWindow(site,w.start,w.end).inches!==null)) &&
              (!advisory || model.advisoryForecastWindow([w],advisory)));
          const {createForecastTimeline}=await moduleAt("forecast-timeline");
          if(!active())return;
          const previous=controls.querySelector<HTMLInputElement>('input[type="range"]')?.dataset.forecastStart;
          const desired=previous ? Number(previous) : advisory ? frames[0]?.start : rainWindow?.start ?? frames[0]?.start;
          const timeline=createForecastTimeline({frames,selectedStart:desired,format:(start:number,end:number)=>localForecastTime.formatRange(start,end)+" · 6 h"});
          const picker=timeline.input;
          const fit = button(advisory ? "Fit advisory" : "Fit snow",()=>{
            if (advisory) {requestFit();updateMap();}
            else if(grid?.coordinates){const c=grid.coordinates;getMap()?.focus([c[0][0],c[2][1],c[2][0],c[0][1]],true);}
          });
          controls.replaceChildren(timeline.element,...(advisory ? getSelection()?.features.length ? [fit] : [] : grid?.frames.length ? [fit] : []));
          const player = await mountForecastPlayer({frames,picker,key:(w: any)=>String(frames.indexOf(w)),epoch,autoplay:shouldAutoplay,
            load: async (w: any,signal: AbortSignal) => w.grid
              ? source.loadSnowGridImage(w.grid,grid!.coordinates,signal).catch(()=>null) : null,
            render: (image: any,w: any,index:number) => {
              timeline.setIndex(index);
              const timeLabel=localForecastTime.formatRange(w.start,w.end);
              const points=sites.map((site: any)=>{
                const values=source.snowWindow(site,w.start,w.end);
                const depth=values.inches===null ? "Unavailable" : values.inches.toLocaleString("en-US",{maximumFractionDigits:1})+" in";
                const level=values.level ? [...new Set<number>(values.level)].map(n=>n.toLocaleString("en-US")).join("–")+" ft" : "unavailable";
                snowSummaries.set(site.basin,`${date(w.start)} to ${date(w.end)} · ${site.name} sample. Snow level ${level}. New snow: ${depth}. ${site.issued ? 'NWS grid updated '+date(site.issued) : 'NWS forecast unavailable.'}`);
                return {type:"Feature",geometry:{type:"Point",coordinates:site.coordinates},properties:{label:site.name+"\n"+depth+(values.inches===null ? "" : " new snow")}};
              });
              if(!weatherSuspended){getMap()?.snowPoints(points);getMap()?.snowfall(image);}
              if(image){
                info.textContent="NWS new snowfall · "+timeLabel+" · issued "+localForecastTime.format(w.grid.issued)+(w.grid.snowCells===0 ? " · No accumulation in valid cells" : "");
                colors([{label:"0",color:"#365f75"},...grid!.legend]);
                $("weather-legend").prepend(el("strong","New snow · inches "));
                $("weather-legend").append(el("small","Clear outside grid or where data is missing"));
              } else {
                $("weather-legend").hidden=true;
                info.textContent="Snowfall grid unavailable · point guidance · "+timeLabel;
              }
              renderEvidence();
              if(w.grid&&!image) throw Error("Snowfall frame unavailable");
            },
          });
          if (!active()) return;
          shouldAutoplay=false;
          snowDraw=()=>void player.select(Number(picker.value));
          if(!frames.length){
            info.textContent="No six-hour snowfall forecast available during this advisory";
            getMap()?.snowfall(null);getMap()?.snowPoints([]);$("weather-legend").hidden=true;
          }
        }
      } catch {
        if (!active()) return;
        snowDraw = null;
        snowSummaries.clear();
        getMap()?.snowCover(null);
        getMap()?.snowfall(null);
        getMap()?.snowPoints([]);
        controls.replaceChildren();
        $("weather-legend").hidden = true;
        info.textContent = mode === "snow-now" ? "Recent snow cover unavailable" : "Recent snow forecast unavailable";
        renderEvidence();
      }
      if (active()) snowTimer = setTimeout(() => void update(), 15 * 60000);
    };
    await update();
  }

  function suspendWeather() {
    if (weatherSuspended) return;
    weatherSuspended = true;
    forecastPlayer?.pause();
    weatherViews[weatherMode]?.suspend();
    if (weatherMode === "rain") getMap()?.rain(null);
    if (weatherMode === "gust") {getMap()?.gust(null); getMap()?.gustPoints([]);}
    if (weatherMode.startsWith("snow-")) {
        getMap()?.snowCover(null);
      getMap()?.snowfall(null);
      getMap()?.snowPoints([]);
    }
  }
  function resumeWeather() {
    if (
      !weatherSuspended ||
      document.hidden ||
      getState().view !== "watch" ||
      (matchMedia("(max-width:700px)").matches && getState().mobile !== "map")
    )
      return;
    weatherSuspended = false;
    weatherViews[weatherMode]?.resume();
    if (resumeFrame?.()) return;
    snowDraw?.();
    gustDraw?.();
    if (weatherMode === "rain" && lastRain) {
      if (lastRain.cycle.end > Date.now()) getMap()?.rain(lastRain);
      else
        $("weather-time").textContent =
          "Selected forecast expired · choose a current window";
    }
  }
  function pauseWeather() {
    forecastPlayer?.destroy();
    forecastPlayer = undefined;
    resumeFrame = null;
    snowRequest?.abort();
    snowDraw = null;
    snowSummaries.clear();
    clearTimeout(snowTimer);
    getMap()?.snowCover(null);
    getMap()?.snowfall(null);
    getMap()?.snowPoints([]);
    getMap()?.gust(null);
    getMap()?.gustPoints([]);
    clearTimeout(gustTimer);
    weatherSuspended = !visible();
    lastRain = null;
    gustDraw = null;
    weatherEpoch++;
    forecastRequest?.abort();
    weatherViews.radar?.close();
    getMap()?.rain(null);
    weatherMode = "off";
    $<HTMLSelectElement>("weather").value = "off";
    $("weather-controls").replaceChildren();
    $("weather-purpose").hidden = true;
    $("weather-time").hidden = true;
    delete $("weather-dock").dataset.advisory;
    $("weather-legend").hidden = true;
    $("weather-details").hidden = true;
    renderEvidence();
  }
  function colors(bands: any[]) {
    const box = $("weather-legend");
    box.replaceChildren();
    box.hidden = false;
    for (const b of bands) {
      const span = el("span", undefined, "legend-band"),
        swatch = el("i", undefined, "legend-swatch");
      swatch.style.backgroundColor = b.color;
      span.append(swatch, document.createTextNode(String(b.label ?? b.value)));
      box.append(span);
    }
  }

  async function mountForecastPlayer<Frame, Value>({frames,picker,key,load,render,epoch,autoplay=false,onError}: {
    frames: Frame[]; picker: HTMLInputElement | HTMLSelectElement; key(frame: Frame): string;
    load(frame: Frame, signal: AbortSignal): Promise<Value>;
    render(value: Value, frame: Frame, index: number): void;
    epoch: number; autoplay?: boolean; onError?: () => void;
  }) {
    forecastPlayer?.destroy();
    let requestedIndex = frames.findIndex(frame => key(frame) === picker.value), renderedIndex = -1;
    const play = button("Play", () => {
      if (player.playing) player.pause();
      else void player.play();
    });
    play.setAttribute("aria-label", "Play forecast animation");
    play.disabled = frames.length < 2;
    const status = el("span", undefined, "forecast-playback-status");
    status.setAttribute("role", "status");
    const player = createForecastPlayback({frames,load,
      available: () => epoch === weatherEpoch && !weatherSuspended && visible(),
      changed: ({playing,status: phase,index}: any) => {
        if (epoch !== weatherEpoch) return;
        play.textContent = playing ? "Pause" : "Play";
        play.setAttribute("aria-label", playing ? "Pause forecast animation" : "Play forecast animation");
        play.setAttribute("aria-pressed", String(playing));
        status.textContent = phase === "buffering" ? "Buffering next frame…"
          : phase === "loading" ? "Loading forecast frame…"
          : phase === "error" ? "Frame unavailable · playback stopped"
          : frames.length < 2 ? (frames.length ? "One forecast frame available" : "No playable forecast frames")
          : index >= 0 ? `${index + 1} of ${frames.length}` : "Choose a forecast time";
        if (phase === "error") onError?.();
      },
      render: (value, frame, index) => {
        if (epoch !== weatherEpoch) return;
        renderedIndex = index; requestedIndex = index;
        picker.value = key(frame);
        render(value,frame,index);
      },
    });
    forecastPlayer = player;
    resumeFrame = () => {
      if (epoch !== weatherEpoch || forecastPlayer !== player || requestedIndex < 0 || requestedIndex === renderedIndex) return false;
      void player.select(requestedIndex);
      return true;
    };
    $("weather-controls").prepend(play);
    $("weather-controls").append(status);
    const selectFrame = () => {
      requestedIndex = frames.findIndex(frame => key(frame) === picker.value);
      void player.select(requestedIndex);
    };
    if(picker.type==='range')picker.oninput=selectFrame;else picker.onchange=selectFrame;
    const selected = requestedIndex;
    if (selected >= 0 && await player.select(selected) && autoplay) await player.play({automatic:true});
    return player;
  }

  async function showGust(epoch: number, advisory?: AdvisoryTiming, preferNws = false, autoplay = false) {
    const source = await moduleAt("command-gust");
    if (epoch !== weatherEpoch) return;
    forecastPlayer?.destroy();
    forecastPlayer = undefined;
    const info = $("weather-time"), items = $("weather-source"), controls = $("weather-controls");
    const previousTime = Number(controls.querySelector<HTMLSelectElement>("select")?.value);
    forecastRequest?.abort();
    const request = new AbortController();
    forecastRequest = request;
    clearTimeout(gustTimer);
    controls.replaceChildren();
    getMap()!.gust(null);
    getMap()!.gustPoints([]);
    $("weather-legend").hidden = true;
    info.textContent = "Checking current gust forecasts…";
    items.replaceChildren(
      el("p", "Regional HRRR model forecast of surface gusts. Clear areas are outside coverage or have missing values."),
      link("NOAA HRRR model", "https://rapidrefresh.noaa.gov/hrrr/"),
    );
    try {
      const forecast = await source.loadGustForecast(request.signal, {preferNws});
      const { manifest, windows, snapshot } = forecast;
      if (epoch !== weatherEpoch || request.signal.aborted) return;
      items.replaceChildren(...(forecast.provider === 'nws' ? [
        el("p", "NWS gust forecasts at nine named sample locations. Values apply to those samples; coverage between them is unassessed."),
        el("p", "Regional HRRR unavailable. Showing current NWS samples."),
        ...(snapshot as {sites:any[]}).sites.filter((site: any) => site.error).map((site: any) => el("p", `${site.name} · source check failed`)),
        link("NWS Hanford", "https://www.weather.gov/hnx/"),
      ] : [el("p", manifest.attribution), link("NOAA HRRR model", "https://rapidrefresh.noaa.gov/hrrr/")]));
      const picker = el("select") as HTMLSelectElement;
      picker.setAttribute("aria-label", "Gust forecast time");
      const frames = advisory ? model.advisoryForecastFrames(windows, advisory) : windows;
      if (advisory && !frames.length) picker.append(new Option("No matching forecast times", ""));
      for (const step of frames) picker.append(new Option(localForecastTime.format(step.start), String(step.start)));
      const retained = windows.find((step: {start:number; end:number}) => step.start === previousTime &&
        (advisory ? model.advisoryForecastWindow([step], advisory) : step.end >= Date.now()));
      const initial = retained || (advisory ? model.advisoryForecastWindow(windows, advisory) : windows[0]);
      picker.value = initial ? String(initial.start) : "";
      controls.replaceChildren(picker);
      await mountForecastPlayer({frames,picker,key:(step: any)=>String(step.start),epoch,autoplay,
        onError: forecast.provider === 'hrrr' ? () => void showGust(epoch,advisory,true,false) : undefined,
        load: async (step: any, signal: AbortSignal) => {
          if (forecast.provider === 'hrrr') return {image:await source.loadGustImage(manifest, step.entry, signal)};
          const features = source.gustPointFeatures(snapshot, step.start);
          if (!features.length) throw Error("Selected NWS forecast time is unavailable");
          return {features};
        },
        render: (value: any,step: any) => {
          const valid = localForecastTime.format(step.start) + (forecast.provider === 'nws' ? ` → ${localForecastTime.format(step.end)}` : "");
          gustDraw = () => {
            if (weatherSuspended) return;
            getMap()?.gust(null);getMap()?.gustPoints([]);
            if (forecast.provider === "nws") getMap()?.gustPoints(value.features);
            else getMap()?.gust(value.image);
          };
          gustDraw();
          if (forecast.provider === 'nws') {
            const issued = Math.min(...value.features.map((feature: any) => feature.properties.issued));
            info.textContent = `NWS gust samples · valid ${valid} · ${value.features.length}/9 locations · earliest issue ${localForecastTime.format(issued)}`;
          } else {
            info.textContent = `HRRR gusts · valid ${valid} · model run ${localForecastTime.format(Date.parse(manifest.run))}`;
          }
          colors(source.gustLegend);
          $("weather-legend").prepend(el("strong", forecast.provider === 'nws' ? "Sample gusts · mph " : "Surface gusts · mph "));
          if (forecast.provider === 'nws') $("weather-legend").append(el("small", "Dots show named samples. Tap a dot for its forecast period and issue time."));
        },
      });
      if (!frames.length) info.textContent = "No gust forecast time available during this alert";
    } catch {
      if (epoch === weatherEpoch && !request.signal.aborted)
        info.textContent = "Current regional gust forecast unavailable";
    }
    if (epoch === weatherEpoch) {
      clearTimeout(gustTimer);
      gustTimer = setTimeout(() => {
        if (epoch === weatherEpoch) void showGust(epoch, advisory);
      }, 15 * 60000);
    }
  }

  async function chooseWeather(mode: WeatherMode, advisory?: AdvisoryTiming, autoplay = false) {
    const rainWindow = currentRainWindow;
    pauseWeather();
    weatherSuspended = !visible();
    weatherMode = mode;
    $<HTMLSelectElement>("weather").value = mode;
    if (advisory) $("weather-dock").dataset.advisory = mode;
    const epoch = weatherEpoch;
    const request = new AbortController();
    forecastRequest = request;
    if (mode === "off") { updateMap(); return; }
    await ensureMap();
    if (epoch !== weatherEpoch || !getMap()) return;
    updateMap();
    const controls = $("weather-controls"),
      info = $("weather-time"),
      items = $("weather-source");
    info.hidden = false;
    $("weather-details").hidden = false;
    info.textContent = "Loading dated weather evidence…";
    $("weather-purpose").hidden = !advisory && getSelection()?.kind !== "burn-scar";
    $("weather-purpose").textContent = getSelection()?.kind === "burn-scar" && mode === "rain" ? "Forecast rainfall · recent burn perimeter context"
      : mode === "radar" ? "Recent precipitation · observed scans, not a forecast"
      : mode === "gust" ? "Expected gusts during this alert"
      : mode === "rain" ? "Expected rainfall during this alert" : "Expected new snowfall during this alert";
    if (mode.startsWith("snow-")) {
      await showSnow(mode, epoch, rainWindow, advisory, autoplay);
      return;
    }
    if (mode === "gust") {
      await showGust(epoch, advisory, false, autoplay);
      return;
    }
    if (mode === "rain") {
      const { loadWatershedRain, regionalForecastBounds } = await moduleAt(
        "watch-watershed-data",
      );
      if (epoch !== weatherEpoch) return;
      const { precipitationTimeline } = await moduleAt("watershed-timeline-model");
      if (epoch !== weatherEpoch) return;
      let timeline = getTimeline();
      // The alert can arrive before the independent timeline collector finishes.
      if (advisory && !timeline) {
        try {
          const response = await fetch(new URL("data/watershed-timeline.json", root), {
            signal: AbortSignal.any([request.signal, AbortSignal.timeout(6000)]), credentials: "omit", cache: "no-store",
          });
          if (response.ok) timeline = await response.json();
        } catch { /* The independently verified 72-hour product remains available. */ }
      }
      if (epoch !== weatherEpoch) return;
      const { windows: allWindows } = precipitationTimeline(timeline, Date.now());
      const windows = advisory ? allWindows.filter((w: any) => model.advisoryForecastWindow([w], advisory)) : allWindows;
      const choose = el("select") as HTMLSelectElement;
      choose.setAttribute("aria-label", "Rain forecast window");
      if (!advisory) choose.append(new Option("72-hour overview", ""));
      else if (!windows.length) choose.append(new Option("No matching forecast windows", ""));
      for (const w of windows) choose.append(new Option(date(w.start) + " · 6 h", String(w.layer)));
      if (advisory && windows.length) choose.value = String(windows[0].layer);
      controls.append(choose);
      const frames = [...(!advisory ? [{layer:"",start:0,end:0}] : []), ...windows];
      await mountForecastPlayer({frames,picker:choose,key:(w: any)=>String(w.layer),epoch,autoplay,
        load: (w: any,signal: AbortSignal) => loadWatershedRain(regionalForecastBounds, {window:w.layer === "" ? null : w,signal}),
        render: (rain: any,w: any) => {
          currentRainWindow = w.layer === "" ? null : w;
          lastRain = rain;
          if (!weatherSuspended) getMap()!.rain(rain);
          info.textContent = `${rain.cycle.hours}-hour WPC rain · ${localForecastTime.formatRange(rain.cycle.start, rain.cycle.end)} · issued ${localForecastTime.format(rain.cycle.issue)}${rain.legend.length ? '' : ' · No contours ≥0.01 in shown'}`;
          colors(rain.legend);$("weather-legend").prepend(el("strong", "Forecast rain · inches "));
          if (advisory) $("weather-legend").append(el("small", "Gauge dots are current observations, not forecasts."));
          items.replaceChildren(el("p", "Published rainfall accumulation. Gauges, roads and power records remain current context, not future predictions."),
            link("WPC forecast source", "https://www.wpc.ncep.noaa.gov/qpf/qpf2.shtml"));
        },
      });
      if (!frames.length) info.textContent = "No rainfall forecast window overlaps this alert";
    } else {
      if (!weatherViews[mode]) {
        const mod = await moduleAt("watch-regional-radar-ui");
        if (epoch !== weatherEpoch) return;
        const options = {
          allowVolume: false,
          session: getMap()!,
          info,
          items,
          source: link,
          visible: () =>
            getState().view === "watch" &&
            (!matchMedia("(max-width:700px)").matches ||
              getState().mobile === "map"),
          renderColors: (title: string, bands: any[]) => {
            colors(bands);
            $("weather-legend").prepend(el("strong", title + " "));
          },
        };
        weatherViews[mode] = mod.installRegionalRadar(options);
      }
      const view = weatherViews[mode];
      controls.append(view.controls);
      if (mode === "radar") {
        controls.append(view.cloudButton);
        controls.append(view.cloudStatus, view.cloudLegend);
      }
      view.open({autoplay: autoplay && !matchMedia("(prefers-reduced-motion: reduce)").matches});
      if (weatherSuspended) view.suspend();
    }
  }
  async function selectWeather(mode: WeatherMode) {
    if (destroyed) return;
    advisoryRequest?.abort();
    advisoryWeatherId = undefined;
    const pending = chooseWeather(mode), epoch = weatherEpoch;
    try { await pending; } catch {
      if (!destroyed && epoch === weatherEpoch) {
        pauseWeather();
        notify("Weather display unavailable. Try another product.");
      }
    }
  }

  const picker = $<HTMLSelectElement>("weather");
  const onSelect = () => {if(isWeatherMode(picker.value)) void selectWeather(picker.value);};
  const onVisibility = () => {if(!visible()) suspendWeather(); else resumeWeather();};
  picker.addEventListener("change", onSelect);
  document.addEventListener("visibilitychange", onVisibility);
  phone.addEventListener("change", onVisibility);
  return {
    select: selectWeather, syncAdvisory: syncAdvisoryWeather,
    requestAutoplay(id: string) {advisoryPlaybackIntent = id;},
    suspend: suspendWeather, resume: resumeWeather,
    invalidateScope() {
      if(destroyed) return;
      advisoryRequest?.abort(); checkedAdvisory = undefined; advisoryWeatherId = undefined;
      advisoryPlaybackIntent = undefined; currentRainWindow = null; pauseWeather();
    },
    viewportChanged() {if(!destroyed) weatherViews.radar?.viewportChanged();},
    get snapshot() {return {mode: weatherMode, window: currentRainWindow ? {...currentRainWindow} : null} as const;},
    snowSummaryFor(watershed: string) {return snowSummaries.get(watershed);},
    destroy() {
      if(destroyed) return;
      destroyed = true; advisoryRequest?.abort(); pauseWeather();
      document.removeEventListener("visibilitychange", onVisibility);
      phone.removeEventListener("change", onVisibility);
      picker.removeEventListener("change", onSelect);
    },
  };
}
